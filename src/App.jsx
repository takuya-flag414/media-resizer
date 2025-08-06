import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
// import Cropper from 'cropperjs'; // Replaced with CDN
// import 'cropperjs/dist/cropper.css'; // Replaced with CDN
// import JSZip from 'jszip'; // Replaced with CDN
// import { saveAs } from 'file-saver'; // Replaced with CDN
import { UploadCloud, Image as ImageIcon, Scissors, ChevronsRight, Download, RotateCcw, Settings, X, FileText, Bot, User, HardDriveDownload, Sparkles, AlertCircle, Loader, BookOpen } from 'lucide-react';

// === Helper Functions & Constants ===

// CDN URLs for external libraries
const HEIC_CDN_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const CROPPER_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
const CROPPER_CSS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const FILESAVER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';


// 媒体ごとのリサイズ定義
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

// サムネイルを生成する
const createThumbnail = (imageUrl) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const MAX_WIDTH = 300;
      const MAX_HEIGHT = 300;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = imageUrl;
  });
};

// === Helper Functions & Constants ===

// HEICやCropper.jsなどのCDN URL定義の下に追加
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

// 新しく追加するサムネイル生成関数
const createFinalThumbnail = (imageUrl, targetSize) => {
  return new Promise((resolve, reject) => {
    const THUMB_SIZE = 240; // サムネイル画像の解像度 (96x96の表示領域に対して高めに設定)
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = imageUrl;

    image.onload = () => {
      // 1. 出力アスペクト比で中央クロップするためのソース領域を計算
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

      // 2. 正方形のサムネイル用キャンバスを作成し、白で塗りつぶす
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = THUMB_SIZE;
      thumbCanvas.height = THUMB_SIZE;
      const ctx = thumbCanvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);

      // 3. クロップした画像を、余白付きでサムネイルキャンバスの中央に描画
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
  <div className="w-full h-full flex flex-col items-center justify-center text-center">
      <h1 className="text-2xl font-bold text-gray-700 mb-10">
          メディア別一括リサイズツール <span className="text-lg font-normal text-gray-500">(β版)</span>
      </h1>
      <Loader className="w-16 h-16 animate-spin text-blue-500" />
      <h2 className="text-2xl font-semibold mt-4 text-gray-600">{title}</h2>
      {progress !== undefined && total !== undefined && total > 0 && (
        <>
          <p className="mt-2 text-lg">{`${progress} / ${total} 枚`}</p>
          <div className="w-64 bg-gray-200 rounded-full h-2.5 mt-4">
            <div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${(progress / total) * 100}%` }}></div>
          </div>
        </>
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

  // noClick: true を追加し、useDropzoneからopen関数を取得
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/heic': ['.heic', '.heif'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    noClick: true, // ドロップゾーンのクリックを無効化
  });

  return (
    // ルート要素はドラッグエリアとしてのみ機能させる
    <div {...getRootProps()} className="w-full h-full flex flex-col items-center justify-center p-8 text-center relative">
      <input {...getInputProps()} />
      
      {isDragActive && (
        <div className="absolute inset-0 bg-black bg-opacity-60 z-10 flex items-center justify-center">
          <p className="text-white text-3xl font-bold">ファイル・フォルダをドロップしてアップロード</p>
        </div>
      )}

      <div className="max-w-2xl w-full">
        <h1 className="text-3xl font-bold text-gray-800">
          メディア別一括リサイズツール <span className="text-lg font-normal text-gray-500">(β版)</span>
        </h1>
        <p className="text-gray-600 mt-2 mb-10">複数の写真を、指定の媒体サイズに一括変換します。</p>
        <div className={`w-full h-80 rounded-2xl flex flex-col items-center justify-center transition-colors duration-300 bg-gray-50`}>
          <div className="flex flex-col items-center">
            <UploadCloud className="w-16 h-16 text-gray-400 mb-4" />
            <p className="text-gray-500 mb-2">ここに画像をドラッグ＆ドロップ</p>
            <p className="text-gray-500 mb-4">または</p>
            
            {/* ボタンをbuttonタグに変更し、onClick={open}とホバー効果を追加 */}
            <button
                type="button"
                onClick={open}
                className="px-6 py-3 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 transition-colors cursor-pointer"
            >
                ファイルを選択
            </button>

            <p className="text-xs text-gray-500 mt-4">フォルダをアップロードする場合は、ドラッグ＆ドロップしてください。</p>
          </div>
        </div>
        <p className="text-sm text-gray-400 mt-4">(JPG, PNG, HEIC, WebP / 30枚まで)</p>
        <div className="mt-8">
            <a 
                href="/manual.html" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center text-gray-600 hover:text-blue-500 hover:underline transition-colors"
            >
                <BookOpen size={18} className="mr-2"/>
                <span>ご利用マニュアル</span>
            </a>
        </div>
      </div>
    </div>
  );
};

// トリミング調整モーダル
const CropModal = ({ image, onClose, onSave }) => {
  const imgRef = useRef(null);
  const [cropper, setCropper] = useState(null);
  const targetSize = image?.targetSize || { w: 1, h: 1 };

  useEffect(() => {
    if (!imgRef.current || !image?.originalUrl || !window.Cropper) {
      return;
    }

    const cropperInstance = new window.Cropper(imgRef.current, {
      aspectRatio: targetSize.w / targetSize.h,
      viewMode: 2,
      autoCropArea: 1,
      dragMode: 'move',
      background: false,
      ready() {
          if (image.cropData) {
              this.cropper.setData(image.cropData);
          }
      },
    });
    setCropper(cropperInstance);

    // クリーンアップ関数で、このeffect内で生成したインスタンスを直接破棄する
    return () => {
      cropperInstance.destroy();
    };
  }, [image, targetSize]);
  
  const handleSave = () => {
    if (cropper) {
      onSave(image.id, cropper.getData(true));
      onClose();
    }
  };

  if (!image) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col m-4">
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
          <button onClick={handleSave} className="px-6 py-2 rounded-lg text-white bg-blue-500 hover:bg-blue-600 transition-colors">決定</button>
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
            onClick={() => onSelect(image.id)}
            className={`bg-white border rounded-xl overflow-hidden shadow-sm transition-all duration-200 cursor-pointer flex p-3 space-x-3 ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:shadow-md hover:border-gray-300'}`}
        >
            {/* ★ 変更点: サムネイルのコンテナの背景を白にし、枠線を追加 */}
            <div className="w-24 h-24 bg-white border border-gray-200 rounded-md flex-shrink-0 flex items-center justify-center overflow-hidden">
                {/* ★ 変更点: object-cover を object-contain に変更 */}
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
const EditScreen = ({ images, setImages, onProcess, onBack, setErrors }) => {
    const [media, setMedia] = useState('EPARK');
    const [quality, setQuality] = useState(9.0);
    const [croppingImageId, setCroppingImageId] = useState(null);
    const [selectedImageId, setSelectedImageId] = useState(null);

    // 最初に画像が読み込まれたとき、最初の画像を選択状態にする
    useEffect(() => {
        if (images.length > 0 && !selectedImageId) {
            setSelectedImageId(images[0].id);
        }
    }, [images, selectedImageId]);

    useEffect(() => {
        const processThumbnails = async () => {
          // 更新が必要な画像（未処理 or 媒体が変更された）を特定
          const imagesToUpdate = images.filter(img => !img.isProcessed || img.processedMedia !== media);
          if (imagesToUpdate.length === 0) return;

          const updatedImages = await Promise.all(images.map(async (image) => {
            // 更新対象でなければ、そのままのデータを返す
            if (!imagesToUpdate.some(u => u.id === image.id)) {
              return image;
            }

            const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];
            // ターゲットサイズがない（対象外の）画像は、処理済みとしてマークのみ行う
            if (!targetSize) {
              return { ...image, isProcessed: true, processedMedia: media, thumbnailUrl: image.thumbnailUrl };
            }

            try {
              // 新しいサムネイルを生成
              const newThumbnailUrl = await createFinalThumbnail(image.originalUrl, targetSize);
              return {
                  ...image,
                  thumbnailUrl: newThumbnailUrl, // サムネイルを更新
                  isProcessed: true,
                  processedMedia: media
              };
            } catch (error) {
              console.error("最終サムネイルの生成に失敗しました:", image.file.name, error);
              // エラーが発生した場合も、再試行を防ぐために処理済みとしてマーク
              return { ...image, isProcessed: true, processedMedia: media };
            }
          }));

          setImages(updatedImages);
        };

        processThumbnails();
        // setImagesは依存配列から除外して無限ループを防止
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [media, images]);


    const handleTypeChange = (id, type) => {
        setImages(prev => prev.map(img => img.id === id ? { ...img, type, cropData: null, isProcessed: false } : img));
    };

    const handleCropAdjust = (id) => {
        setCroppingImageId(id);
    };

    const handleCropSave = async (id, cropData) => {
        const imageToUpdate = images.find(img => img.id === id);
        if (!imageToUpdate) return;

        try {
            // 元の画像URLとトリミングデータから、新しいプレビュー画像を生成
            const newThumbnailUrl = await generateCroppedPreview(imageToUpdate.originalUrl, cropData);

            // stateを更新してプレビューを差し替える
            setImages(prevImages =>
                prevImages.map(img =>
                    img.id === id
                        ? { ...img, cropData: cropData, thumbnailUrl: newThumbnailUrl }
                        : img
                )
            );
        } catch (error) {
            console.error("プレビューの生成に失敗しました:", error);
            setErrors(['トリミング後のプレビュー生成に失敗しました。']);
        }
    };

    const handleProcessClick = () => {
        const imagesToProcess = images.filter(img => RESIZE_DEFINITIONS[media]?.[img.type]);
        if (imagesToProcess.length === 0) {
            setErrors(['処理対象の画像がありません。媒体や種別を確認してください。']);
            return;
        }
        onProcess(imagesToProcess, media, quality / 10.0);
    };

    const selectedImage = images.find(img => img.id === selectedImageId);
    if(selectedImage) {
      selectedImage.targetSize = RESIZE_DEFINITIONS[media]?.[selectedImage.type];
    }
    const croppingImage = images.find(img => img.id === croppingImageId);
    if(croppingImage) {
      croppingImage.targetSize = RESIZE_DEFINITIONS[media]?.[croppingImage.type];
    }

    return (
        <div className="w-full h-full flex flex-col bg-gray-50">
            <header className="p-4 border-b border-gray-200 bg-white flex-shrink-0 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-800">
                    メディア別一括リサイズツール <span className="font-normal text-gray-500">(β版) (ステップ2)</span>
                </h2>
                <a href="/manual.html" target="_blank" rel="noopener noreferrer" title="ご利用マニュアルを開く" className="p-2 text-gray-400 hover:text-blue-500 transition-colors">
                    <BookOpen size={24} />
                </a>
            </header>

            <main className="flex-grow flex min-h-0">
                {/* 左側: 画像一覧エリア */}
                <div className="w-2/3 border-r border-gray-200 overflow-y-auto p-4">
                    <p className="text-xs text-gray-500 mb-4 pb-4 border-b border-gray-200">
                        ※一覧のプレビューには、表示を高速化するための軽量なサムネイル画像が使用されています。最終的な出力は元の高画質データから行われます。
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {images.map(image => (
                            <ImageCard
                                key={image.id}
                                image={image}
                                onSelect={setSelectedImageId}
                                isSelected={image.id === selectedImageId}
                                media={media}
                            />
                        ))}
                    </div>
                </div>

                {/* 右側: 操作パネル */}
                <div className="w-1/3 flex flex-col">
                    <div className="flex-grow p-6 space-y-8 overflow-y-auto">
                        {/* 全体設定 */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-700 border-b pb-2">全体設定</h3>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-2">媒体選択:</label>
                                <select value={media} onChange={(e) => setMedia(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg">
                                    {Object.keys(RESIZE_DEFINITIONS).map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-2">画質: <span className="ml-3 font-mono text-sm bg-gray-100 px-2 py-1 rounded-md">{quality.toFixed(1)}</span></label>
                                <input
                                    type="range" min="0.5" max="10.0" step="0.5"
                                    value={quality}
                                    onChange={(e) => setQuality(parseFloat(e.target.value))}
                                    className="w-full"
                                />
                            </div>
                        </div>

                        {/* 選択中画像の編集 */}
                        {selectedImage && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-gray-700 border-b pb-2">選択中の画像</h3>
                                <p className="text-sm text-gray-800 bg-gray-100 p-2 rounded-md truncate" title={selectedImage.file.name}>
                                    <span className="font-semibold">ファイル名:</span> {selectedImage.file.name}
                                </p>
                                <div>
                                    <label className="block text-sm font-medium text-gray-600 mb-2">種別:</label>
                                    <select
                                        value={selectedImage.type}
                                        onChange={(e) => handleTypeChange(selectedImage.id, e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-lg"
                                    >
                                        {IMAGE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
                                {selectedImage.targetSize ? (
                                    <>
                                        <p className="text-sm text-gray-800">
                                            <span className="font-semibold">出力サイズ:</span> {`${selectedImage.targetSize.w} x ${selectedImage.targetSize.h} px`}
                                        </p>
                                        <button
                                            onClick={() => handleCropAdjust(selectedImage.id)}
                                            className="w-full py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors text-sm flex items-center justify-center"
                                        >
                                            <Scissors size={14} className="mr-2" />
                                            トリミング調整
                                        </button>
                                    </>
                                ) : (
                                    <div className="text-sm text-yellow-600 bg-yellow-100 p-2 rounded-md text-center">
                                        この媒体では「ロゴ」は対象外です
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <footer className="p-4 border-t border-gray-200 bg-white flex justify-between items-center flex-shrink-0">
                        <button onClick={onBack} className="flex items-center px-6 py-2 rounded-lg text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors">
                            <RotateCcw size={16} className="mr-2"/>
                            最初に戻る
                        </button>
                        <button onClick={handleProcessClick} className="flex items-center px-6 py-2 rounded-lg text-white bg-blue-500 hover:bg-blue-600 transition-colors font-semibold">
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
const DownloadScreen = ({ zipBlob, onRestart }) => {
    const handleDownload = () => {
      if (window.saveAs && zipBlob) {
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
        const fileName = `resized_images_${timestamp.slice(0,8)}_${timestamp.slice(9)}.zip`;
        window.saveAs(zipBlob, fileName);
      }
    };

    return (
        <div className="w-full h-full flex flex-col">
            <header className="p-4 border-b border-gray-200 bg-white flex-shrink-0 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-800">
                  メディア別一括リサイズツール <span className="font-normal text-gray-500">(β版) (ステップ3)</span>
                </h2>
                <a href="/manual.html" target="_blank" rel="noopener noreferrer" title="ご利用マニュアルを開く" className="p-2 text-gray-400 hover:text-blue-500 transition-colors">
                  <BookOpen size={24} />
                </a>
            </header>
            <main className="flex-grow w-full h-full flex flex-col items-center justify-center text-center">
                <HardDriveDownload className="w-24 h-24 text-green-500 mb-6" />
                <h2 className="text-3xl font-bold text-gray-800">画像処理が完了しました！</h2>
                <p className="text-gray-600 mt-2">下のボタンからZIPファイルをダウンロードしてください。</p>
                <button 
                    onClick={handleDownload}
                    className="mt-10 flex items-center px-12 py-4 rounded-xl text-white bg-green-500 hover:bg-green-600 transition-colors font-bold text-lg shadow-lg hover:shadow-xl"
                >
                    <Download size={24} className="mr-3" />
                    ZIPファイルをダウンロード
                </button>
                <button 
                    onClick={onRestart}
                    className="mt-8 flex items-center text-gray-600 hover:text-blue-500 transition-colors"
                >
                    <RotateCcw size={16} className="mr-2"/>
                    最初に戻る
                </button>
            </main>
        </div>
    );
};

// メインアプリケーションコンポーネント
export default function App() {
  const [screen, setScreen] = useState('initializing'); // 'initializing', 'upload', 'loading', 'edit', 'processing', 'download'
  const [images, setImages] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [zipBlob, setZipBlob] = useState(null);
  const [errors, setErrors] = useState([]);
  

  // Load external scripts
  const { isLoaded: isHeicLoaded, error: heicLoadError } = useScript(HEIC_CDN_URL);
  const { isLoaded: isCropperLoaded, error: cropperLoadError } = useScript(CROPPER_JS_CDN);
  const { isLoaded: isJszipLoaded, error: jszipLoadError } = useScript(JSZIP_CDN);
  const { isLoaded: isFilesaverLoaded, error: filesaverLoadError } = useScript(FILESAVER_CDN);

  // Load Cropper CSS
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CROPPER_CSS_CDN;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);
  
  // Check if all scripts are loaded and handle errors
  useEffect(() => {
    const scriptErrors = [
        heicLoadError && 'HEIC変換ライブラリの読み込みに失敗しました。',
        cropperLoadError && 'トリミングライブラリの読み込みに失敗しました。',
        jszipLoadError && 'ZIP圧縮ライブラリの読み込みに失敗しました。',
        filesaverLoadError && 'ファイル保存ライブラリの読み込みに失敗しました。'
    ].filter(Boolean);

    if (scriptErrors.length > 0) {
        handleFileErrors(scriptErrors);
    }
  }, [heicLoadError, cropperLoadError, jszipLoadError, filesaverLoadError]);

  // Transition to upload screen when scripts are ready
  useEffect(() => {
    const allLoaded = isHeicLoaded && isCropperLoaded && isJszipLoaded && isFilesaverLoaded;
    if (screen === 'initializing' && allLoaded) {
      setScreen('upload');
    }
  }, [isHeicLoaded, isCropperLoaded, isJszipLoaded, isFilesaverLoaded, screen]);


  const handleFileErrors = (newErrors) => {
    setErrors(newErrors);
    setTimeout(() => setErrors([]), 8000);
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

    const newImages = [];
    for (const file of files) {
      try {
        let blob = file;
        let originalUrl;
        const lowerCaseName = file.name.toLowerCase();
        if ((lowerCaseName.endsWith('.heic') || lowerCaseName.endsWith('.heif')) && window.heic2any) {
            blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        }
        originalUrl = URL.createObjectURL(blob);
        const thumbnailUrl = await createThumbnail(originalUrl);

        newImages.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          originalUrl,
          thumbnailUrl,
          type: detectImageType(file.name),
          cropData: null,
          isProcessed: false,
          processedMedia: null,
        });
      } catch(err) {
        console.error("Error processing file:", file.name, err);
        handleFileErrors([`ファイル処理中にエラーが発生しました: ${file.name}`]);
      }
      setLoadingProgress(prev => prev + 1);
    }

    setImages(newImages);
    setScreen('edit');
  };

  const getCroppedCanvas = (imageUrl, cropData, targetSize, quality) => {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = imageUrl;
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = targetSize.w;
            canvas.height = targetSize.h;
            const ctx = canvas.getContext('2d');

            let sourceX, sourceY, sourceWidth, sourceHeight;

            if (cropData) {
                // 手動トリミングデータがある場合
                sourceX = cropData.x;
                sourceY = cropData.y;
                sourceWidth = cropData.width;
                sourceHeight = cropData.height;
            } else {
                // 自動カヴァークロップ
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
            }

            ctx.drawImage(
                image,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                0,
                0,
                targetSize.w,
                targetSize.h
            );
            resolve(canvas);
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
        setProcessingProgress(prev => prev + 1);
        continue;
      }
      
      try {
        const canvas = await getCroppedCanvas(image.originalUrl, image.cropData, targetSize, quality);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        const fileNameWithoutExt = image.file.name.substring(0, image.file.name.lastIndexOf('.')) || image.file.name;
        zip.file(`${fileNameWithoutExt}.jpg`, blob);
      } catch (err) {
        console.error("Error processing image:", image.file.name, err);
        handleFileErrors([`画像処理エラー: ${image.file.name}`]);
      }
      setProcessingProgress(prev => prev + 1);
    }

    const zipFile = await zip.generateAsync({ type: 'blob' });
    setZipBlob(zipFile);
    setScreen('download');
  };

  const handleRestart = () => {
    images.forEach(image => {
      URL.revokeObjectURL(image.originalUrl);
    });
    setImages([]);
    setZipBlob(null);
    setScreen('upload');
    setErrors([]);
  };

  const renderScreen = () => {
    switch (screen) {
      case 'initializing':
        return <LoadingScreen title="ライブラリを準備中..." />;
      case 'loading':
        return <LoadingScreen title="画像を読み込んでいます..." progress={loadingProgress} total={totalFiles} />;
      case 'edit':
        return <EditScreen images={images} setImages={setImages} onProcess={handleProcess} onBack={handleRestart} setErrors={handleFileErrors}/>;
      case 'processing':
        return <LoadingScreen title="画像を処理中です..." progress={processingProgress} total={totalFiles} />;
      case 'download':
        return <DownloadScreen zipBlob={zipBlob} onRestart={handleRestart} />;
      case 'upload':
      default:
        return <UploadScreen onFilesAccepted={handleFilesAccepted} setErrors={handleFileErrors} />;
    }
  };

 
  return (
      <div className="font-sans w-full h-screen flex flex-col antialiased bg-gray-50">
          <div className="flex-grow relative min-h-0 flex flex-col">
            <div className="absolute top-4 left-4 right-4 z-20 space-y-2">
              {errors.map((error, index) => (
                  <Alert key={index} message={error} onDismiss={() => setErrors(prev => prev.filter((_, i) => i !== index))} />
              ))}
            </div>
            {renderScreen()}
          </div>
      </div>
  );
}
