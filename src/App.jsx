import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, Scissors, ChevronsRight, Download, RotateCcw, X, AlertCircle, Loader, HardDriveDownload, Check, HelpCircle, Megaphone } from 'lucide-react';

// === Helper Functions & Constants ===

// CDN URLs for external libraries
const HEIC_CDN_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const CROPPER_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
const CROPPER_CSS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const FILESAVER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';

// メディアごとのリサイズ定義
const RESIZE_DEFINITIONS = {
  EPARK: {
    '写真': { w: 660, h: 440 },
    'スタッフ': { w: 150, h: 174 },
    'ロゴ': { w: 330, h: 220 },
  },
  'ピークマネージャー': {
    '写真': { w: 900, h: 600 },
    'スタッフ': { w: 400, h: 400 },
    'ロゴ': null, // 対象外
  },
};

// 画像種別の定義
const IMAGE_TYPES = ['写真', 'スタッフ', 'ロゴ'];

// ファイル名から画像種別を自動判定
const detectImageType = (fileName) => {
  const lowerCaseName = fileName.toLowerCase();
  if (lowerCaseName.includes('staff')) return 'スタッフ';
  if (lowerCaseName.includes('logo') || lowerCaseName.includes('ロゴ')) return 'ロゴ';
  if (['main', 'top', 'shop', 'photo'].some(keyword => lowerCaseName.includes(keyword))) return '写真';
  return '写真'; // デフォルト
};

const generateCroppedPreview = (imageUrl, cropData) => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous'; // CORSエラーを防ぐために必要
    image.src = imageUrl;
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = cropData.width;
      canvas.height = cropData.height;

      ctx.drawImage(
        image,
        cropData.x,
        cropData.y,
        cropData.width,
        cropData.height,
        0,
        0,
        cropData.width,
        cropData.height
      );
      resolve(canvas.toDataURL('image/jpeg', 0.9)); // プレビュー用の画質
    };
    image.onerror = (error) => {
      reject(error);
    };
  });
};

const createFinalThumbnail = (imageUrl, targetSize) => {
  return new Promise((resolve, reject) => {
    const THUMB_SIZE = 240; // サムネイル画像の解像度 (96x96の表示領域に対して高めに設定)
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = imageUrl;

    image.onload = () => {
      let sourceX, sourceY, sourceWidth, sourceHeight;
      const imageAspect = image.width / image.height;
      const targetAspect = targetSize.w / targetSize.h;

      if (imageAspect > targetAspect) {
        sourceHeight = image.height;
        sourceWidth = image.height * targetAspect;
        sourceX = (image.width - sourceWidth) / 2;
        sourceY = 0;
      } else {
        sourceWidth = image.width;
        sourceHeight = image.width / targetAspect;
        sourceX = 0;
        sourceY = (image.height - sourceHeight) / 2;
      }

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = THUMB_SIZE;
      thumbCanvas.height = THUMB_SIZE;
      const ctx = thumbCanvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);

      let destWidth, destHeight;
      if (targetAspect >= 1) { // 横長または正方形
        destWidth = THUMB_SIZE;
        destHeight = THUMB_SIZE / targetAspect;
      } else { // 縦長
        destHeight = THUMB_SIZE;
        destWidth = THUMB_SIZE * targetAspect;
      }
      const destX = (THUMB_SIZE - destWidth) / 2;
      const destY = (THUMB_SIZE - destHeight) / 2;

      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destX,
        destY,
        destWidth,
        destHeight
      );

      resolve(thumbCanvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = reject;
  });
};

// === React Components ===

// カスタムフック：動的スクリプトの読み込み
const useScript = (url) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let script = document.querySelector(`script[src="${url}"]`);
    if (script && script.getAttribute('data-loaded')) {
      setIsLoaded(true);
      return;
    }

    if (!script) {
        script = document.createElement('script');
        script.src = url;
        script.async = true;
        document.body.appendChild(script);
    }
    
    const onLoad = () => {
        script.setAttribute('data-loaded', 'true');
        setIsLoaded(true);
    };
    const onError = (e) => setError(e);

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    return () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
  }, [url]);

  return { isLoaded, error };
};

const AppHeader = ({ currentStep, steps, isLoading }) => {
  return (
    <header className="bg-white/80 backdrop-blur-lg border-b border-gray-200/80 px-4 sm:px-6 py-3 grid grid-cols-3 items-center flex-shrink-0 h-20 z-10">
      <div className="text-base sm:text-lg font-bold text-gray-800 truncate">
        メディア別一括リサイズツール
      </div>

      <div className="flex justify-center">
        <div className="flex items-center">
          {steps.map((step, index) => {
            const stepNumber = index + 1;

            let activeStep = currentStep;
            if (isLoading) {
              activeStep = currentStep - 1;
              if (activeStep < 1) {
                activeStep = 1;
              }
            }

            const isCompleted = activeStep > stepNumber;
            const isCurrent = currentStep === stepNumber;
            const isLoadingThisStep = isLoading && activeStep === stepNumber;

            return (
              <React.Fragment key={step.id}>
                <div className="flex flex-col items-center w-16 sm:w-24">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 border-2
                      ${
                        isCompleted
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : (isCurrent && !isLoading) || isLoadingThisStep
                          ? 'bg-white border-blue-500 text-blue-600 ring-4 ring-blue-500/20'
                          : 'bg-gray-100 border-gray-300 text-gray-400'
                      }
                    `}
                  >
                    {isLoadingThisStep ? (
                      <Loader size={18} className="animate-spin" />
                    ) : isCompleted ? (
                      <Check size={18} />
                    ) : (
                      stepNumber
                    )}
                  </div>
                  <span className={`mt-2 text-xs font-semibold transition-colors duration-300 ${isCurrent && !isLoading ? 'text-blue-600' : 'text-gray-500'} hidden sm:block`}>
                    {step.name}
                  </span>
                </div>

                {index < steps.length - 1 && (
                  <div className={`w-4 sm:w-12 h-1 -mx-1 sm:-mx-2 mb-6 transition-colors duration-300 rounded-full
                    ${activeStep > stepNumber ? 'bg-blue-400' : 'bg-gray-300'}
                  `} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 
      <div className="flex justify-end">
        <a
          href="manual.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center w-10 h-10 rounded-full text-gray-500 hover:bg-gray-200/80 hover:text-gray-700 transition-colors"
          aria-label="マニュアルを開く"
        >
          <HelpCircle size={24} />
        </a>
      </div>
      */}
      
    </header>
  );
};

// アラートコンポーネント
const Alert = ({ message, type = 'error', onDismiss }) => {
  if (!message) return null;
  const colors = {
    error: 'bg-red-100 border-red-400 text-red-700',
    success: 'bg-green-100 border-green-400 text-green-700',
    warning: 'bg-yellow-100 border-yellow-400 text-yellow-700',
  };

  return (
    <div className={`border-l-4 p-4 rounded-md shadow-md ${colors[type]}`} role="alert">
      <div className="flex items-center">
        <AlertCircle className="mr-3"/>
        <p className="font-bold">{message}</p>
        {onDismiss && (
          <button onClick={onDismiss} className="ml-auto text-xl font-bold">&times;</button>
        )}
      </div>
    </div>
  );
};

// ローディング画面コンポーネント
const LoadingScreen = ({ title, progress, total }) => (
  <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 bg-gray-100">
    <div className="relative">
      <div className="w-28 h-28 bg-white/70 backdrop-blur-lg rounded-full flex items-center justify-center shadow-lg">
        <Loader className="w-16 h-16 text-blue-500 animate-spin" />
      </div>
    </div>
    <h2 className="text-2xl font-semibold mt-10 text-gray-700 tracking-wide">
      {title}
    </h2>
    {progress !== undefined && total !== undefined && total > 0 && (
      <div className="w-full max-w-sm mt-8">
        <p className="mb-2 text-lg font-medium text-gray-600">
          {`${progress} / ${total} 枚`}
        </p>
        <div className="w-full bg-gray-200/80 rounded-full h-3 shadow-inner overflow-hidden">
          <div 
            className="bg-gradient-to-r from-blue-500 to-sky-500 h-3 rounded-full transition-all duration-500 ease-out" 
            style={{ width: `${(progress / total) * 100}%` }}
          ></div>
        </div>
      </div>
    )}
  </div>
);

// ファイルアップロード画面
const UploadScreen = ({ onFilesAccepted, setErrors }) => {
  const onDrop = useCallback((acceptedFiles, fileRejections) => {
    let currentErrors = [];
    if (acceptedFiles.length + fileRejections.length > 30) {
      currentErrors.push('一度にアップロードできるファイルは30枚までです。');
    }
    
    fileRejections.forEach(rejection => {
        rejection.errors.forEach(err => {
            if (err.code === 'file-too-large') {
                currentErrors.push(`ファイルサイズが大きすぎます: ${rejection.file.name} (10MBまで)`);
            }
            if (err.code === 'file-invalid-type') {
                currentErrors.push(`対応していないファイル形式です: ${rejection.file.name}`);
            }
        });
    });

    if (currentErrors.length > 0) {
        setErrors(currentErrors);
        return;
    }

    if (acceptedFiles.length > 0) {
        onFilesAccepted(acceptedFiles);
    }
  }, [onFilesAccepted, setErrors]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/heic': ['.heic', '.heif'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} className="w-full h-full overflow-y-auto bg-gray-100 relative">
      <input {...getInputProps()} />
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-8 py-10 sm:py-12 text-center flex flex-col items-center justify-center min-h-full">
        <div>
          <h1 className="text-3xl sm:text-5xl font-bold text-gray-800 tracking-tight">
            画像をアップロード
          </h1>
          <p className="text-base sm:text-lg text-gray-500 mt-4 mb-8 sm:mb-12">
            複数の写真を、指定のメディアサイズに一括変換します。
          </p>
          <div 
            className="relative w-full h-80 sm:h96 rounded-3xl flex flex-col items-center justify-center 
                       bg-white/60 backdrop-blur-xl border border-gray-200/50 shadow-xl p-4"
          >
            <div className="text-center">
              <UploadCloud className="w-16 sm:w-20 h-16 sm:h-20 text-gray-400 mx-auto" />
              <p className="mt-6 text-lg sm:text-xl font-medium text-gray-700">
                この画面にファイル・フォルダをドラッグ＆ドロップ
              </p>
              
              <p className="mt-2 text-sm text-gray-500">または</p>
              <button 
                type="button" 
                onClick={(e) => {
                    e.stopPropagation();
                    open();
                }} 
                className="mt-6 px-6 sm:px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg 
                           hover:bg-blue-700 transform hover:-translate-y-0.5 transition-all duration-200"
              >
                ファイルを選択
              </button>
            </div>
            <div className="absolute bottom-4 sm:bottom-6 text-center w-full text-xs text-gray-500 px-2">
              <p>対応: JPG, PNG, HEIC, WebP | サイズ: 10MBまで | 上限: 30枚</p>
            </div>
          </div>
        </div>
      </div>
      {isDragActive && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center 
                       bg-gray-900/80 backdrop-blur-sm transition-opacity duration-300 ease-in-out p-4">
          <UploadCloud className="w-24 sm:w-32 h-24 sm:h-32 text-white/90 animate-bounce" />
          <p className="mt-8 text-2xl sm:text-4xl font-bold text-white text-center">
            ファイルをドロップしてアップロード
          </p>
        </div>
      )}
    </div>
  );
};

// トリミング調整モーダル
const CropModal = ({ image, onClose, onSave }) => {
  const imgRef = useRef(null);
  const [cropper, setCropper] = useState(null);
  const targetSize = image?.targetSize || { w: 1, h: 1 };

  useEffect(() => {
    if (!imgRef.current || !image?.originalUrl || !window.Cropper) return;

    const cropperInstance = new window.Cropper(imgRef.current, {
      aspectRatio: targetSize.w / targetSize.h,
      viewMode: 2,
      autoCropArea: 1,
      dragMode: 'move',
      background: false,
      ready() { if (image.cropData) this.cropper.setData(image.cropData); },
    });
    setCropper(cropperInstance);

    return () => cropperInstance.destroy();
  }, [image, targetSize]);
  
  const handleSave = () => {
    if (cropper) {
      onSave(image.id, cropper.getData(true));
      onClose();
    }
  };

  if (!image) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center">
            <Scissors className="mr-2 text-gray-500" />
            トリミング調整
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </header>
        <div className="p-6 flex-grow overflow-y-auto">
            <p className="text-sm text-gray-600 mb-4 truncate">ファイル: {image.file.name}</p>
            <div className="w-full h-[60vh] bg-gray-100">
              <img ref={imgRef} src={image.originalUrl} alt="トリミング対象" style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}/>
            </div>
        </div>
        <footer className="flex justify-end p-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-6 py-2 mr-4 rounded-lg text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors">キャンセル</button>
          <button onClick={handleSave} className="px-6 py-2 rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors">決定</button>
        </footer>
      </div>
    </div>
  );
};

// 画像カードコンポーネント
const ImageCard = ({ image, onSelect, isSelected, media }) => {
    const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];

    return (
        <div 
            onClick={(e) => onSelect(image.id, e)}
            className={`bg-white/60 border rounded-xl overflow-hidden shadow-sm transition-all duration-200 cursor-pointer flex p-3 space-x-3 ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-200/80 hover:shadow-md hover:border-gray-300'}`}
        >
            <div className="w-24 h-24 bg-white border border-gray-200 rounded-md flex-shrink-0 flex items-center justify-center overflow-hidden">
                <img src={image.thumbnailUrl} alt={image.file.name} className="object-contain w-full h-full" />
            </div>
            <div className="flex-grow flex flex-col justify-center min-w-0">
                <p className="font-bold text-sm text-gray-800 truncate" title={image.file.name}>{image.file.name}</p>
                <div className="text-xs text-gray-500 mt-1">
                    種別: <span className="font-medium text-gray-700">{image.type}</span>
                </div>
                {targetSize ? (
                    <div className="text-xs text-gray-500 mt-1">
                        出力: <span className="font-medium text-gray-700">{`${targetSize.w} x ${targetSize.h} px`}</span>
                    </div>
                ) : (
                    <div className="text-xs text-yellow-600 mt-1">
                        対象外
                    </div>
                )}
            </div>
        </div>
    );
};

// 画像一覧・編集画面
const EditScreen = ({ images, setImages, onProcess, onBack, setErrors, setIsLoadingThumbnails }) => {
    const [media, setMedia] = useState('EPARK');
    const [quality, setQuality] = useState(9.0);
    const [croppingImageId, setCroppingImageId] = useState(null);
    // 単一選択から複数選択に対応するため、IDを配列で管理します。
    const [selectedImageIds, setSelectedImageIds] = useState([]);

    useEffect(() => {
        // メディアを変更した際に選択を解除します。
        setSelectedImageIds([]);
        const processThumbnails = async () => {
          setIsLoadingThumbnails(true);
          const imagesToUpdate = images.filter(img => !img.isProcessed || img.processedMedia !== media);
          if (imagesToUpdate.length === 0) {
              setIsLoadingThumbnails(false);
              return;
          }

          const updatedImages = await Promise.all(images.map(async (image) => {
            if (!imagesToUpdate.some(u => u.id === image.id)) return image;
            const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];
            //  cropDataをリセットし、自動トリミングが再計算されるようにします。
            const imageReset = { ...image, cropData: null, isProcessed: false };

            if (!targetSize) return { ...imageReset, isProcessed: true, processedMedia: media, thumbnailUrl: imageReset.originalUrl };

            try {
              const newThumbnailUrl = await createFinalThumbnail(imageReset.originalUrl, targetSize);
              return { ...imageReset, thumbnailUrl: newThumbnailUrl, isProcessed: true, processedMedia: media };
            } catch (error) {
              console.error("サムネイル生成失敗:", imageReset.file.name, error);
              return { ...imageReset, isProcessed: true, processedMedia: media };
            }
          }));
          setImages(updatedImages);
          setIsLoadingThumbnails(false);
        };
        processThumbnails();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [media]);

    // 選択された画像の種別を一括で変更する関数
    const handleBulkTypeChange = (type) => {
        setImages(prev => prev.map(img =>
            selectedImageIds.includes(img.id)
                ? { ...img, type, cropData: null, isProcessed: false } // 種別変更時にcropDataと処理状態をリセット
                : img
        ));
    };

    const handleCropAdjust = (id) => setCroppingImageId(id);

    const handleCropSave = async (id, cropData) => {
        const imageToUpdate = images.find(img => img.id === id);
        if (!imageToUpdate) return;
        try {
            const newThumbnailUrl = await generateCroppedPreview(imageToUpdate.originalUrl, cropData);
            setImages(prevImages =>
                prevImages.map(img => img.id === id ? { ...img, cropData: cropData, thumbnailUrl: newThumbnailUrl } : img)
            );
        } catch (error) {
            console.error("プレビュー生成失敗:", error);
            setErrors(['トリミング後のプレビュー生成に失敗しました。']);
        }
    };

    const handleProcessClick = () => {
        const imagesToProcess = images.filter(img => RESIZE_DEFINITIONS[media]?.[img.type]);
        if (imagesToProcess.length === 0) {
            setErrors(['処理対象の画像がありません。メディアや種別を確認してください。']);
            return;
        }
        onProcess(imagesToProcess, media, quality / 10.0);
    };

    // 画像クリック時の選択ロジック (Shiftキーでの範囲選択、Ctrl/Cmdキーでの個別選択)
    const handleSelectImage = (clickedId, e) => {
        e.stopPropagation(); // イベントの伝播を停止

        const { metaKey, ctrlKey, shiftKey } = e;
        const isCtrlOrMeta = metaKey || ctrlKey;

        const lastSelectedId = selectedImageIds.length > 0 ? selectedImageIds[selectedImageIds.length - 1] : null;

        if (shiftKey && lastSelectedId) {
            const lastIndex = images.findIndex(img => img.id === lastSelectedId);
            const clickedIndex = images.findIndex(img => img.id === clickedId);
            const start = Math.min(lastIndex, clickedIndex);
            const end = Math.max(lastIndex, clickedIndex);
            const rangeIds = images.slice(start, end + 1).map(img => img.id);
            
            // 既存の選択範囲と結合し、重複を削除
            const newSelection = [...new Set([...selectedImageIds, ...rangeIds])];
            setSelectedImageIds(newSelection);

        } else if (isCtrlOrMeta) {
            setSelectedImageIds(prev =>
                prev.includes(clickedId)
                    ? prev.filter(id => id !== clickedId) // 選択解除
                    : [...prev, clickedId] // 選択追加
            );
        } else {
            // 通常のクリック: クリックされたものだけを選択
            setSelectedImageIds([clickedId]);
        }
    };
    
    // 選択状態に応じた変数定義
    const selectedCount = selectedImageIds.length;
    const isSingleSelection = selectedCount === 1;
    const isMultiSelection = selectedCount > 1;
    const noSelection = selectedCount === 0;

    const singleSelectedImage = isSingleSelection ? images.find(img => img.id === selectedImageIds[0]) : null;
    if(singleSelectedImage) singleSelectedImage.targetSize = RESIZE_DEFINITIONS[media]?.[singleSelectedImage.type];
    
    const croppingImage = images.find(img => img.id === croppingImageId);
    if(croppingImage) croppingImage.targetSize = RESIZE_DEFINITIONS[media]?.[croppingImage.type];


    return (
        <div className="w-full h-full flex flex-col bg-gray-100">
            <main className="flex-grow flex flex-col md:flex-row min-h-0">
                <div className="w-full md:w-2/3 border-b md:border-b-0 md:border-r border-gray-200/80 overflow-y-auto p-4" onClick={() => setSelectedImageIds([])}>
                    <p className="text-xs text-gray-500 mb-4 pb-4 border-b border-gray-200">
                        Shiftキーで範囲選択、Ctrl(Cmd)キーで複数選択ができます。
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {images.map(image => (
                            <ImageCard
                                key={image.id} image={image} 
                                onSelect={(id, e) => handleSelectImage(id, e)}
                                isSelected={selectedImageIds.includes(image.id)} 
                                media={media}
                            />
                        ))}
                    </div>
                </div>

                <div className="w-full md:w-1/3 flex flex-col bg-white/30 flex-grow">
                    <div className="flex-grow p-6 space-y-8 overflow-y-auto">
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-700 border-b pb-2">全体設定</h3>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-2">メディア選択:</label>
                                <select value={media} onChange={(e) => setMedia(e.target.value)} className="w-full px-4 py-3 bg-white/80 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition">
                                    {Object.keys(RESIZE_DEFINITIONS).map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-2">画質: <span className="ml-3 font-mono text-sm bg-gray-100 px-2 py-1 rounded-md">{quality.toFixed(1)}</span></label>
                                <input
                                    type="range" min="0.5" max="10.0" step="0.5"
                                    value={quality} onChange={(e) => setQuality(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                />
                            </div>
                        </div>

                        {/* 選択状態に応じて表示を切り替え */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-700 border-b pb-2">
                                {isMultiSelection ? `${selectedCount}件の画像を選択中` : '選択中の画像'}
                            </h3>
                            
                            {noSelection && (
                                <div className="text-sm text-gray-500 bg-gray-100 p-3 rounded-xl text-center">
                                    画像を選択してください
                                </div>
                            )}

                            {(isSingleSelection || isMultiSelection) && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-600 mb-2">
                                        {isMultiSelection ? '種別を一括変更:' : '種別:'}
                                    </label>
                                    <select
                                        value={isSingleSelection ? singleSelectedImage.type : ''} // 複数選択時は空にする
                                        onChange={(e) => handleBulkTypeChange(e.target.value)}
                                        className="w-full px-4 py-3 bg-white/80 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                    >
                                        {isMultiSelection && <option value="" disabled>一括で変更する種別を選択</option>}
                                        {IMAGE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
                            )}

                            {isSingleSelection && singleSelectedImage && (
                                <>
                                    <p className="text-sm text-gray-800 bg-gray-100 p-3 rounded-xl truncate" title={singleSelectedImage.file.name}>
                                        <span className="font-semibold">ファイル名:</span> {singleSelectedImage.file.name}
                                    </p>
                                    {singleSelectedImage.targetSize ? (
                                        <>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">出力サイズ:</span> {`${singleSelectedImage.targetSize.w} x ${singleSelectedImage.targetSize.h} px`}
                                            </p>
                                            <button
                                                onClick={() => handleCropAdjust(singleSelectedImage.id)}
                                                className="w-full py-2.5 px-4 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 transition text-sm flex items-center justify-center"
                                            >
                                                <Scissors size={14} className="mr-2" />
                                                トリミング調整
                                            </button>
                                        </>
                                    ) : (
                                        <div className="text-sm text-yellow-600 bg-yellow-100 p-3 rounded-xl text-center">
                                            このメディアでは対象外です
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    <footer className="p-4 border-t border-gray-200/80 bg-white/50 flex justify-between items-center flex-shrink-0">
                        <button onClick={onBack} className="flex items-center px-6 py-3 rounded-xl text-gray-700 font-semibold bg-gray-200 hover:bg-gray-300 transition">
                            <RotateCcw size={16} className="mr-2"/> 戻る
                        </button>
                        <button onClick={handleProcessClick} className="flex items-center px-6 py-3 rounded-xl text-white font-bold bg-blue-600 hover:bg-blue-700 transform hover:-translate-y-0.5 transition-all duration-200 shadow-lg">
                            リサイズを実行
                            <ChevronsRight size={18} className="ml-2"/>
                        </button>
                    </footer>
                </div>
            </main>

            {croppingImageId && (
                <CropModal
                    image={croppingImage}
                    onClose={() => setCroppingImageId(null)}
                    onSave={handleCropSave}
                />
            )}
        </div>
    );
};

// ダウンロード画面
const DownloadScreen = ({ zipBlob, onRestart, onDownload }) => {
    const [isDownloaded, setIsDownloaded] = useState(false);

    const handleDownload = () => {
      if (isDownloaded || !window.saveAs || !zipBlob) return;

      const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
      const fileName = `resized_images_${timestamp.slice(0,8)}_${timestamp.slice(9)}.zip`;
      window.saveAs(zipBlob, fileName);
      setIsDownloaded(true);
      if (onDownload) onDownload();
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-gray-100 flex items-center justify-center">
            <div className="w-full max-w-xl mx-auto px-4 sm:px-8 py-10 sm:py-12 text-center">
                <div className="relative w-32 h-32 flex items-center justify-center mb-8 mx-auto">
                    <div className={`absolute inset-0 rounded-full shadow-2xl transition-all duration-500 ${isDownloaded ? 'bg-gradient-to-br from-blue-400 to-sky-500 shadow-blue-500/30' : 'bg-gradient-to-br from-green-400 to-emerald-500 shadow-green-500/30'} opacity-80`}></div>
                    <div className="relative w-20 h-20">
                        <HardDriveDownload className={`w-full h-full text-white absolute transition-opacity duration-300 ${isDownloaded ? 'opacity-0' : 'opacity-100'}`} />
                        <Check className={`w-full h-full text-white absolute transition-opacity duration-300 ${isDownloaded ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-800 tracking-tight">
                    {isDownloaded ? 'ダウンロードが完了しました！' : '画像処理が完了しました！'}
                </h1>
                <p className="text-base sm:text-lg text-gray-500 mt-3">
                    {isDownloaded ? 'ファイルをご確認ください。' : '下のボタンからZIPファイルをダウンロードしてください。'}
                </p>
                <button
                    onClick={handleDownload}
                    disabled={isDownloaded}
                    className={`
                        mt-12 flex items-center justify-center w-full max-w-md mx-auto px-8 sm:px-12 py-4 rounded-2xl text-white 
                        font-bold text-lg sm:text-xl shadow-2xl transition-all duration-300 ease-in-out
                        ${isDownloaded 
                            ? 'bg-gradient-to-br from-blue-500 to-sky-500 shadow-blue-500/40 cursor-default' 
                            : 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-500/40 transform hover:-translate-y-1'
                        }
                    `}
                >
                    {isDownloaded ? (
                        <>
                            <Check size={24} className="mr-3" />
                            <span>ダウンロード完了</span>
                        </>
                    ) : (
                        <>
                            <Download size={24} className="mr-3" />
                            <span>ZIPファイルをダウンロード</span>
                        </>
                    )}
                </button>
                <button
                    onClick={onRestart}
                    className="mt-10 flex items-center justify-center mx-auto px-6 py-2 rounded-lg text-gray-500 font-semibold hover:bg-gray-200/80 hover:text-gray-700 transition-colors"
                >
                    <RotateCcw size={16} className="mr-2" />
                    最初に戻る
                </button>
            </div>
        </div>
    );
};

// アップデート情報モーダル
const UpdateModal = ({ info, onClose }) => {
  if (!info) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity duration-300 ease-in-out">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col transform transition-all duration-300 ease-in-out scale-95 opacity-0 animate-fade-in-scale">
        <header className="flex items-center justify-between p-5 border-b border-gray-200 bg-gray-50/70 rounded-t-2xl">
          <h2 className="text-xl font-bold text-gray-800 flex items-center">
            <Megaphone className="mr-3 text-blue-500" />
            {info.title}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </header>
        <div className="p-6 flex-grow overflow-y-auto space-y-5 text-gray-700">
          <p className="text-sm text-gray-500">
            バージョン: <span className="font-semibold text-gray-600">{info.version}</span> ({info.date})
          </p>
          
          {info.features && info.features.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-800 mb-2">🚀 新機能・改善</h3>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {info.features.map((item, index) => <li key={`feat-${index}`}>{item}</li>)}
              </ul>
            </div>
          )}

          {info.fixes && info.fixes.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-800 mb-2">🛠️ 修正点</h3>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {info.fixes.map((item, index) => <li key={`fix-${index}`}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
        <footer className="flex justify-end p-4 border-t border-gray-200 bg-gray-50/70 rounded-b-2xl">
          <button onClick={onClose} className="px-8 py-2.5 rounded-lg text-white font-semibold bg-blue-600 hover:bg-blue-700 transition-all duration-200 transform hover:scale-105">確認</button>
        </footer>
      </div>
      {/* CSS for animation */}
      <style>{`
        @keyframes fade-in-scale {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in-scale {
          animation: fade-in-scale 0.3s forwards cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
};

// メインアプリケーションコンポーネント
export default function App() {
  const [screen, setScreen] = useState('initializing');
  const [isDownloadCompleted, setIsDownloadCompleted] = useState(false);
  const [images, setImages] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [zipBlob, setZipBlob] = useState(null);
  const [errors, setErrors] = useState([]);
  const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  const { isLoaded: isHeicLoaded, error: heicLoadError } = useScript(HEIC_CDN_URL);
  const { isLoaded: isCropperLoaded, error: cropperLoadError } = useScript(CROPPER_JS_CDN);
  const { isLoaded: isJszipLoaded, error: jszipLoadError } = useScript(JSZIP_CDN);
  const { isLoaded: isFilesaverLoaded, error: filesaverLoadError } = useScript(FILESAVER_CDN);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CROPPER_CSS_CDN;
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
  
  const handleFileErrors = useCallback((newErrors) => {
    setErrors(newErrors);
    setTimeout(() => setErrors([]), 8000);
  }, []);

  useEffect(() => {
    const scriptErrors = [
        heicLoadError && 'HEIC変換ライブラリ',
        cropperLoadError && 'トリミングライブラリ',
        jszipLoadError && 'ZIP圧縮ライブラリ',
        filesaverLoadError && 'ファイル保存ライブラリ'
    ].filter(Boolean);

    if (scriptErrors.length > 0) {
        handleFileErrors([`${scriptErrors.join(', ')}の読み込みに失敗しました。`]);
    }
  }, [heicLoadError, cropperLoadError, jszipLoadError, filesaverLoadError, handleFileErrors]);

  useEffect(() => {
    const allLoaded = isHeicLoaded && isCropperLoaded && isJszipLoaded && isFilesaverLoaded;
    if (screen === 'initializing' && allLoaded) {
      setScreen('upload');
    }
  }, [isHeicLoaded, isCropperLoaded, isJszipLoaded, isFilesaverLoaded, screen]);
  
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const response = await fetch('/updateInfo.json');
        if (!response.ok) {
          // If the file doesn't exist, just continue without showing the modal.
          console.log('updateInfo.json not found, skipping version check.');
          return;
        }
        const data = await response.json();
        const lastSeenVersion = localStorage.getItem('lastSeenVersion');

        if (data.version !== lastSeenVersion) {
          setUpdateInfo(data);
          setIsUpdateModalOpen(true);
        }
      } catch (error) {
        console.error("Could not fetch or parse update info:", error);
      }
    };
    // ライブラリの読み込みが完了してからバージョンチェックを実行
    if (screen === 'upload') {
        checkVersion();
    }
  }, [screen]); // screenが'upload'に変わった時に実行

  const generateAndSetInitialThumbnails = async (initialImages) => {
    setScreen('generating-thumbnails');
    setLoadingProgress(0);
    setTotalFiles(initialImages.length);
    const media = 'EPARK'; // Default media for initial thumbnails

    const updatedImages = [];
    for (const image of initialImages) {
        const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];
        let finalImage = { ...image, isProcessed: true, processedMedia: media };

        if (targetSize) {
            try {
                const newThumbnailUrl = await createFinalThumbnail(image.originalUrl, targetSize);
                finalImage.thumbnailUrl = newThumbnailUrl;
            } catch (error) {
                console.error("Initial thumbnail generation failed:", image.file.name, error);
            }
        }
        updatedImages.push(finalImage);
        setLoadingProgress(prev => prev + 1);
    }

    setImages(updatedImages);
    setScreen('edit');
  };

  const handleFilesAccepted = async (files) => {
    if (files.length === 0) return;
    if (files.length > 30) {
        handleFileErrors(['一度にアップロードできるファイルは30枚までです。']);
        return;
    }
    setScreen('loading');
    setErrors([]);
    setTotalFiles(files.length);
    setLoadingProgress(0);

    const newImages = await Promise.all(files.map(async (file, index) => {
      try {
        let blob = file;
        const lowerCaseName = file.name.toLowerCase();
        if ((lowerCaseName.endsWith('.heic') || lowerCaseName.endsWith('.heif')) && window.heic2any) {
          blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        }
        const originalUrl = URL.createObjectURL(blob);
        
        setLoadingProgress(prev => prev + 1);

        return {
          id: `${file.name}-${Date.now()}-${index}`,
          file,
          originalUrl,
          thumbnailUrl: originalUrl, // Temporarily use originalUrl
          type: detectImageType(file.name),
          cropData: null,
          isProcessed: false,
          processedMedia: null,
        };
      } catch (err) {
        console.error("ファイル処理エラー:", file.name, err);
        handleFileErrors([`ファイル処理エラー: ${file.name}`]);
        setLoadingProgress(prev => prev + 1);
        return null;
      }
    }));
    
    await generateAndSetInitialThumbnails(newImages.filter(Boolean));
  };

  const getCroppedCanvas = (imageUrl, cropData, targetSize) => {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = imageUrl;
        image.onload = () => {
            let sourceX, sourceY, sourceWidth, sourceHeight;

            if (cropData) {
                sourceX = cropData.x; sourceY = cropData.y;
                sourceWidth = cropData.width; sourceHeight = cropData.height;
            } else {
                const imageAspect = image.width / image.height;
                const targetAspect = targetSize.w / targetSize.h;
                if (imageAspect > targetAspect) {
                    sourceHeight = image.height; sourceWidth = image.height * targetAspect;
                    sourceX = (image.width - sourceWidth) / 2; sourceY = 0;
                } else {
                    sourceWidth = image.width; sourceHeight = image.width / targetAspect;
                    sourceX = 0; sourceY = (image.height - sourceHeight) / 2;
                }
            }

            
            // 1. 元画像から必要な部分だけを高解像度で切り出す
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = sourceWidth;
            cropCanvas.height = sourceHeight;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

            // 2. 段階的にリサイズして品質を維持する
            let currentCanvas = cropCanvas;
            let currentWidth = sourceWidth;
            let currentHeight = sourceHeight;

            // ターゲットサイズの半分より大きい間、半分に縮小を繰り返す
            while (currentWidth > targetSize.w * 2 && currentHeight > targetSize.h * 2) {
                const halfWidth = Math.floor(currentWidth / 2);
                const halfHeight = Math.floor(currentHeight / 2);
                
                // 最後のステップ以外では、スムージングをかけすぎない設定も有効
                if(halfWidth < targetSize.w * 1.5){
                    break;
                }

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = halfWidth;
                tempCanvas.height = halfHeight;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.imageSmoothingQuality = 'medium'; // 中間処理はmedium
                tempCtx.drawImage(currentCanvas, 0, 0, currentWidth, currentHeight, 0, 0, halfWidth, halfHeight);

                currentCanvas = tempCanvas;
                currentWidth = halfWidth;
                currentHeight = halfHeight;
            }

            // 3. 最終的なターゲットサイズに描画する
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetSize.w;
            finalCanvas.height = targetSize.h;
            const finalCtx = finalCanvas.getContext('2d');
            
            // 最終描画では品質を最高に設定
            finalCtx.imageSmoothingQuality = 'high';
            finalCtx.drawImage(currentCanvas, 0, 0, currentWidth, currentHeight, 0, 0, targetSize.w, targetSize.h);
            

            resolve(finalCanvas);
        };
        image.onerror = reject;
    });
  };

  const handleProcess = async (imagesToProcess, media, quality) => {
    if (!window.JSZip) {
        handleFileErrors(['ZIP圧縮ライブラリが読み込まれていません。']);
        return;
    }
    setScreen('processing');
    setProcessingProgress(0);
    setTotalFiles(imagesToProcess.length);
    const zip = new window.JSZip();

    for (const image of imagesToProcess) {
      const targetSize = RESIZE_DEFINITIONS[media][image.type];
      if (!targetSize) {
        setProcessingProgress(prev => prev + 1); continue;
      }
      try {
        const canvas = await getCroppedCanvas(image.originalUrl, image.cropData, targetSize);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        const fileNameWithoutExt = image.file.name.substring(0, image.file.name.lastIndexOf('.')) || image.file.name;
        zip.file(`${fileNameWithoutExt}.jpg`, blob);
      } catch (err) {
        console.error("画像処理エラー:", image.file.name, err);
        handleFileErrors([`画像処理エラー: ${image.file.name}`]);
      }
      setProcessingProgress(prev => prev + 1);
    }

    const zipFile = await zip.generateAsync({ type: 'blob' });
    setZipBlob(zipFile);
    setScreen('download');
  };

  const handleDownload = () => setIsDownloadCompleted(true);
  
  const handleCloseUpdateModal = () => {
    if (updateInfo) {
      localStorage.setItem('lastSeenVersion', updateInfo.version);
    }
    setIsUpdateModalOpen(false);
  };

  const handleRestart = () => {
    images.forEach(image => URL.revokeObjectURL(image.originalUrl));
    setImages([]);
    setZipBlob(null);
    setErrors([]);
    setIsDownloadCompleted(false);
    setScreen('upload');
  };

  const workflowSteps = [
    { id: 'upload', name: 'アップロード' },
    { id: 'edit', name: '画像編集' },
    { id: 'download', name: 'ダウンロード' },
  ];

  const getCurrentStep = () => {
    if (isDownloadCompleted) return 4;
    switch (screen) {
        case 'upload': return 1;
        case 'loading': 
        case 'generating-thumbnails': 
        case 'edit': return 2;
        case 'processing': 
        case 'download': return 3;
        default: return 0;
    }
  };
  const currentStep = getCurrentStep();
  const isLoading = screen === 'loading' || screen === 'processing' || screen === 'generating-thumbnails' || isLoadingThumbnails;

  const renderScreen = () => {
    switch (screen) {
      case 'initializing': return <LoadingScreen title="ライブラリを準備中..." />;
      case 'loading': return <LoadingScreen title="画像を読み込んでいます..." progress={loadingProgress} total={totalFiles} />;
      case 'generating-thumbnails': return <LoadingScreen title="プレビューを生成中..." progress={loadingProgress} total={totalFiles} />;
      case 'edit': 
        if (isLoadingThumbnails) {
          return <LoadingScreen title="プレビューを更新中..." />;
        }
        return <EditScreen images={images} setImages={setImages} onProcess={handleProcess} onBack={handleRestart} setErrors={handleFileErrors} setIsLoadingThumbnails={setIsLoadingThumbnails} />;
      case 'processing': return <LoadingScreen title="画像を処理中です..." progress={processingProgress} total={totalFiles} />;
      case 'download': return <DownloadScreen zipBlob={zipBlob} onRestart={handleRestart} onDownload={handleDownload} />;
      case 'upload': default: return <UploadScreen onFilesAccepted={handleFilesAccepted} setErrors={handleFileErrors} />;
    }
  };

  return (
      <div className="font-noto-sans w-full h-dvh flex flex-col antialiased bg-gray-100">
          {isUpdateModalOpen && updateInfo && (
            <UpdateModal info={updateInfo} onClose={handleCloseUpdateModal} />
          )}
          {screen !== 'initializing' && <AppHeader currentStep={currentStep} steps={workflowSteps} isLoading={isLoading} />}
          <div className="flex-grow relative min-h-0 flex flex-col">
            <div className="absolute top-4 left-4 right-4 z-50 space-y-2 w-auto max-w-full">
              {errors.map((error, index) => (
                  <Alert key={index} message={error} onDismiss={() => setErrors(prev => prev.filter((_, i) => i !== index))} />
              ))}
            </div>
            {renderScreen()}
          </div>
      </div>
  );
}
