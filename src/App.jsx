import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, Scissors, ChevronsRight, Download, RotateCcw, X, AlertCircle, Loader, BookOpen, Check, Bot } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
// WebGLバックエンドを明示的にインポートして登録します
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';


// === CDN & ライブラリの定義 ===

// 外部ライブラリのCDN URL
const HEIC_CDN_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const CROPPER_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
const CROPPER_CSS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const FILESAVER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';

// --- 追加ライブラリ ---
// npm install @tensorflow/tfjs @tensorflow-models/pose-detection
// で以下のライブラリをインストールする必要があります。


// === 定数とヘルパー関数 ===

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


/**
 * 自動認識を行い、トリミング領域を計算する
 * @param {HTMLImageElement} image 元画像
 * @param {{w: number, h: number}} targetSize 出力サイズ
 * @param {poseDetection.PoseDetector} detector 姿勢検出モデル
 * @returns {Promise<object|null>} トリミング領域のデータ、またはnull
 */
const getAutoCropRegion = async (image, targetSize, detector) => {
    if (!detector) {
        console.error('Detector not loaded for auto crop region');
        return null;
    }
    try {
        detector.reset();
        const poses = await detector.estimatePoses(image);

        if (poses && poses.length > 0) {
            const keypoints = poses[0].keypoints;
            const nose = keypoints.find(k => k.name === 'nose');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');

            if (nose && leftShoulder && rightShoulder) {
                const targetAspectRatio = targetSize.w / targetSize.h;
                const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
                const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
                const cropAnchorY = nose.y * 0.5 + shoulderCenterY * 0.5;

                const maxCropWidthFromX = 2 * Math.min(shoulderCenterX, image.width - shoulderCenterX);
                const maxCropHeightFromY = Math.min(cropAnchorY / 0.55, (image.height - cropAnchorY) / 0.45);

                let cropWidth, cropHeight;
                if (maxCropWidthFromX / targetAspectRatio <= maxCropHeightFromY) {
                    cropWidth = maxCropWidthFromX;
                    cropHeight = cropWidth / targetAspectRatio;
                } else {
                    cropHeight = maxCropHeightFromY;
                    cropWidth = cropHeight * targetAspectRatio;
                }

                let cropX = shoulderCenterX - (cropWidth * 0.5);
                let cropY = cropAnchorY - (cropHeight * 0.5);

                cropX = Math.max(0, Math.min(cropX, image.width - cropWidth));
                cropY = Math.max(0, Math.min(cropY, image.height - cropHeight));
                
                return { x: cropX, y: cropY, width: cropWidth, height: cropHeight };
            }
        }
        return null;
    } catch (error) {
        console.error("自動トリミング領域の計算中にエラー:", error);
        return null;
    }
};


/**
 * サムネイルを生成する（自動認識、手動、中央トリミング対応）
 * @param {string} imageUrl 元画像のURL
 * @param {{w: number, h: number}} targetSize 出力サイズ
 * @param {object | null} cropData Cropper.jsのデータ (手動トリミング用)
 * @param {string} imageType 画像種別
 * @param {poseDetection.PoseDetector | null} detector 姿勢検出モデル
 * @returns {Promise<string>} サムネイルのData URL
 */
const createOrUpdateThumbnail = (imageUrl, targetSize, cropData = null, imageType = '写真', detector = null) => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = imageUrl;

    image.onload = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const THUMB_SIZE = 200;

      let sourceX, sourceY, sourceWidth, sourceHeight;
      let autoCropRegion = null;

      // 1. 手動トリミングデータがある場合、最優先
      if (cropData) {
        sourceX = cropData.x;
        sourceY = cropData.y;
        sourceWidth = cropData.width;
        sourceHeight = cropData.height;
      } 
      // 2. 手動でなく、種別が「スタッフ」の場合、自動認識を試みる
      else if (imageType === 'スタッフ' && detector) {
        autoCropRegion = await getAutoCropRegion(image, targetSize, detector);
        if (autoCropRegion) {
          sourceX = autoCropRegion.x;
          sourceY = autoCropRegion.y;
          sourceWidth = autoCropRegion.width;
          sourceHeight = autoCropRegion.height;
        }
      }

      // 3. 手動でも自動でもない場合、中央トリミングにフォールバック
      if (typeof sourceX === 'undefined') {
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

      // 描画先キャンバスのサイズを計算
      const previewAspect = sourceWidth / sourceHeight;
      let previewWidth, previewHeight;
      if (previewAspect >= 1) {
        previewWidth = THUMB_SIZE;
        previewHeight = THUMB_SIZE / previewAspect;
      } else {
        previewHeight = THUMB_SIZE;
        previewWidth = THUMB_SIZE * previewAspect;
      }
      
      canvas.width = previewWidth;
      canvas.height = previewHeight;

      // 描画
      ctx.drawImage(
        image,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, previewWidth, previewHeight
      );
      
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = reject;
  });
};


// === Reactコンポーネント ===

/**
 * ワークフロー表示コンポーネント
 */
const WorkflowIndicator = ({ currentScreen }) => {
  const steps = [
    { id: 'upload', name: 'アップロード' },
    { id: 'edit', name: '編集' },
    { id: 'download', name: '完了' },
  ];

  let activeStepId = 'upload';
  if (['edit', 'processing'].includes(currentScreen)) {
    activeStepId = 'edit';
  } else if (currentScreen === 'download') {
    activeStepId = 'download';
  }
  
  const activeStepIndex = steps.findIndex(s => s.id === activeStepId);

  return (
    <nav aria-label="Progress">
      <ol role="list" className="flex items-center space-x-2 sm:space-x-4">
        {steps.map((step, index) => (
          <li key={step.name} className="flex items-center">
            <div className={`flex items-center transition-colors duration-300 ${index <= activeStepIndex ? 'text-blue-600' : 'text-gray-500'}`}>
              <span className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full border-2 font-bold transition-all
                ${
                  index <= activeStepIndex
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-400 bg-white'
                }
                ${
                  // 現在のステップにだけアニメーションを適用
                  index === activeStepIndex && 'animate-pulse-dot'
                }
              `}>
                {index < activeStepIndex ? <Check className="w-5 h-5" /> : <span>{index + 1}</span>}
              </span>
              <span className={`ml-2 sm:ml-3 text-sm font-medium whitespace-nowrap ${index <= activeStepIndex ? 'text-gray-900' : 'text-gray-500'}`}>{step.name}</span>
            </div>
            {index !== steps.length - 1 && (
              <div className={`w-6 sm:w-12 h-0.5 mx-2 sm:mx-4 transition-colors duration-300 ${index < activeStepIndex ? 'bg-blue-600' : 'bg-gray-300'}`} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};


/**
 * カスタムフック：外部スクリプトを動的に読み込む
 */
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

/**
 * アラート表示コンポーネント
 */
const Alert = ({ message, type = 'error', onDismiss }) => {
  if (!message) return null;
  const colors = {
    error: 'bg-red-100 border-red-400 text-red-700',
    success: 'bg-green-100 border-green-400 text-green-700',
  };

  return (
    <div className={`border-l-4 p-4 rounded-md shadow-md ${colors[type]}`} role="alert">
      <div className="flex items-center">
        <AlertCircle className="mr-3" />
        <p className="font-bold">{message}</p>
        {onDismiss && (
          <button onClick={onDismiss} className="ml-auto text-xl font-bold">&times;</button>
        )}
      </div>
    </div>
  );
};

/**
 * ローディング画面コンポーネント
 */
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
          {`${progress} / ${total} 件`}
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

/**
 * STEP 1: 画像アップロード画面
 */
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
      'image/heic': ['.heic', '.heif'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gray-100 relative">
      <input {...getInputProps()} />
      <div className="max-w-3xl w-full">
        <h1 className="text-5xl font-bold text-gray-800 tracking-tight">
          メディア別一括リサイズツール
        </h1>
        <p className="text-lg text-gray-500 mt-4 mb-12">
          複数の画像を、メディアの規格に合わせて一括でリサイズ・トリミングします。
        </p>
        <div className="relative w-full h-96 rounded-3xl flex flex-col items-center justify-center bg-white/60 backdrop-blur-xl border border-gray-200/50 shadow-xl">
          <div className="text-center">
            <UploadCloud className="w-20 h-20 text-gray-400 mx-auto" />
            <p className="mt-6 text-xl font-medium text-gray-700">
              この画面のどこかにファイルをドラッグ＆ドロップ
            </p>
            <p className="mt-2 text-sm text-gray-500">または</p>
            <button 
              type="button" 
              onClick={(e) => {
                  e.stopPropagation();
                  open();
              }} 
              className="mt-6 px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transform hover:-translate-y-0.5 transition-all duration-200"
            >
              ファイルを選択
            </button>
          </div>
          <div className="absolute bottom-6 text-center w-full text-xs text-gray-500">
            <p>対応: JPG, PNG, HEIC | サイズ: 10MBまで | 上限: 30枚</p>
          </div>
        </div>
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
      {isDragActive && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm transition-opacity duration-300 ease-in-out">
          <UploadCloud className="w-32 h-32 text-white/90 animate-bounce" />
          <p className="mt-8 text-4xl font-bold text-white">
            ファイルをドロップしてアップロード
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * トリミング調整モーダル
 */
const CropModal = ({ image, onClose, onSave }) => {
  const imgRef = useRef(null);
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

    const handleSave = () => {
        if (cropperInstance) {
            onSave(image.id, cropperInstance.getData(true));
            onClose();
        }
    };
    
    // ボタンにイベントリスナーを設定
    const saveButton = document.getElementById('crop-save-button');
    if (saveButton) {
        saveButton.onclick = handleSave;
    }

    return () => {
      cropperInstance.destroy();
    };
  }, [image, targetSize, onSave, onClose]);
  
  if (!image) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity">
        <div className="bg-white/95 backdrop-blur-2xl border border-gray-200 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl">
            <header className="flex items-center justify-between p-5 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-800 flex items-center">
                    <Scissors className="mr-3 text-gray-500" />
                    トリミング調整
                </h2>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-800 rounded-full p-1 hover:bg-gray-200/60 transition-colors">
                    <X size={24} />
                </button>
            </header>
            <main className="p-6 flex-grow overflow-y-auto">
                <p className="text-sm text-gray-600 mb-4 truncate">ファイル: {image.file.name}</p>
                <div className="w-full h-[60vh] bg-gray-100 rounded-lg overflow-hidden">
                    <img ref={imgRef} src={image.originalUrl} alt="トリミング対象" style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}/>
                </div>
            </main>
            <footer className="flex justify-end p-4 border-t border-gray-200">
                <button onClick={onClose} className="px-6 py-2 mr-4 rounded-lg font-semibold text-gray-700 bg-gray-200/70 hover:bg-gray-300/70 transition">キャンセル</button>
                <button id="crop-save-button" className="px-6 py-2 rounded-lg text-white font-bold bg-blue-600 hover:bg-blue-700 shadow-md transition">決定して保存</button>
            </footer>
        </div>
    </div>
  );
};

/**
 * 画像カードコンポーネント (グリッドレイアウト用)
 */
const ImageCard = ({ image, onSelect, isSelected, media }) => {
    const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];

    return (
        <div 
            onClick={() => onSelect(image.id)}
            className={`bg-white border rounded-xl overflow-hidden shadow-sm transition-all duration-200 cursor-pointer flex flex-col
            ${isSelected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:shadow-md hover:border-blue-400'}`}
        >
            <div className="w-full h-32 bg-gray-100 flex items-center justify-center overflow-hidden p-1">
                <img src={image.thumbnailUrl} alt={image.file.name} className="object-contain max-w-full max-h-full rounded-sm" />
            </div>
            <div className="p-3 border-t border-gray-200/80">
                <p className="font-semibold text-xs text-gray-800 truncate" title={image.file.name}>{image.file.name}</p>
                <div className="text-xs text-gray-500 mt-2">
                    種別: <span className="font-medium text-gray-700">{image.type}</span>
                </div>
                {targetSize ? (
                    <div className="text-xs text-gray-500 mt-1">
                        出力: <span className="font-medium text-gray-700">{`${targetSize.w} x ${targetSize.h} px`}</span>
                    </div>
                ) : (
                    <div className="text-xs text-yellow-600 mt-1 font-semibold">
                        対象外
                    </div>
                )}
            </div>
        </div>
    );
};


/**
 * STEP 2: 確認・個別編集画面
 */
const EditScreen = ({ images, setImages, onProcess, onBack, setErrors, modelStatus, detector }) => {
    const [selectedImageId, setSelectedImageId] = useState(null);
    const [media, setMedia] = useState('EPARK');
    const [quality, setQuality] = useState(9.0);
    const [croppingImageId, setCroppingImageId] = useState(null);

    useEffect(() => {
        if (images.length > 0 && !selectedImageId) {
            setSelectedImageId(images[0].id);
        }
    }, [images, selectedImageId]);

    // メディアが変更されたら、サムネイルを更新
    useEffect(() => {
        const updateAllThumbnailsForMedia = async () => {
            const promises = images.map(async (image) => {
                if (!image.cropData) { // 手動クロップされていない画像のみ対象
                    const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];
                    if (targetSize) {
                        try {
                            const newThumbnailUrl = await createOrUpdateThumbnail(image.originalUrl, targetSize, null, image.type, detector);
                            return { ...image, thumbnailUrl: newThumbnailUrl };
                        } catch (e) {
                            console.error("Thumbnail update failed:", e);
                            return image;
                        }
                    }
                }
                return image;
            });
            const updatedImages = await Promise.all(promises);
            setImages(updatedImages);
        };

        if (images.length > 0) {
            updateAllThumbnailsForMedia();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [media]);

    // AIモデルの準備が完了したら、「スタッフ」画像のサムネイルを再生成
    useEffect(() => {
        if (modelStatus === 'ready' && detector) {
            const updateStaffThumbnails = async () => {
                const promises = images.map(async (image) => {
                    if (image.type === 'スタッフ' && !image.cropData) {
                        const targetSize = RESIZE_DEFINITIONS[media]?.[image.type];
                        if (targetSize) {
                            try {
                                const newThumbnailUrl = await createOrUpdateThumbnail(image.originalUrl, targetSize, null, 'スタッフ', detector);
                                return { ...image, thumbnailUrl: newThumbnailUrl };
                            } catch (e) {
                                console.error("Staff thumbnail update failed:", e);
                            }
                        }
                    }
                    return image;
                });
                const updatedImages = await Promise.all(promises);
                setImages(updatedImages);
            };
            updateStaffThumbnails();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelStatus, detector]);

    // 画像の種別が変更されたら、その画像のサムネイルを更新
    const handleTypeChange = async (id, type) => {
        const imageToUpdate = images.find(img => img.id === id);
        if (!imageToUpdate) return;
        
        const targetSize = RESIZE_DEFINITIONS[media]?.[type];
        let newThumbnailUrl = imageToUpdate.thumbnailUrl;

        if (targetSize) {
            newThumbnailUrl = await createOrUpdateThumbnail(imageToUpdate.originalUrl, targetSize, null, type, detector);
        }
        
        setImages(prev => prev.map(img => 
            img.id === id 
            ? { ...img, type, cropData: null, thumbnailUrl: newThumbnailUrl } 
            : img
        ));
    };

    // 手動クロップが保存されたら、その画像のサムネイルを更新
    const handleCropSave = async (id, cropData) => {
        const imageToUpdate = images.find(img => img.id === id);
        if (!imageToUpdate) return;

        const targetSize = RESIZE_DEFINITIONS[media]?.[imageToUpdate.type];
        if (!targetSize) return;

        try {
            const newThumbnailUrl = await createOrUpdateThumbnail(imageToUpdate.originalUrl, targetSize, cropData, imageToUpdate.type, detector);
            setImages(prevImages =>
                prevImages.map(img =>
                    img.id === id ? { ...img, cropData: cropData, thumbnailUrl: newThumbnailUrl } : img
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
            setErrors(['処理対象の画像がありません。メディアや種別を確認してください。']);
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

    const isProcessingDisabled = modelStatus === 'loading';

    return (
        <div className="w-full h-full flex flex-col bg-gray-100">
            <main className="flex-grow flex min-h-0">
                {/* Left Panel: Image List */}
                <div className="w-3/5 border-r border-gray-200/80 overflow-y-auto p-4">
                    <p className="text-sm text-gray-500 px-2 pb-4 mb-4 border-b border-gray-200/80">ファイル一覧 ({images.length}件)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
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

                {/* Right Panel: Editor */}
                <div className="w-2/5 flex flex-col bg-white/30">
                    <div className="flex-grow p-6 space-y-6 overflow-y-auto">
                        <h3 className="text-xl font-semibold text-gray-800 pb-2 border-b border-gray-200">全体設定</h3>
                        <div>
                            <label className="block text-base font-semibold text-gray-700 mb-3">メディア選択</label>
                            <select value={media} onChange={(e) => setMedia(e.target.value)} className="w-full px-4 py-3 bg-white/80 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition">
                                {Object.keys(RESIZE_DEFINITIONS).map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-base font-semibold text-gray-700 mb-3">画質: <span className="ml-3 font-mono text-sm bg-gray-100 px-2 py-1 rounded-md">{quality.toFixed(1)}</span></label>
                            <input
                                type="range" min="0.5" max="10.0" step="0.5"
                                value={quality}
                                onChange={(e) => setQuality(parseFloat(e.target.value))}
                                className="w-full"
                            />
                        </div>

                        <h3 className="text-xl font-semibold text-gray-800 pt-4 pb-2 border-b border-gray-200">選択中画像の編集</h3>
                        {selectedImage ? (
                            <div className="space-y-6">
                                <div className="bg-gray-900/5 p-3 rounded-xl">
                                    <p className="text-xs font-semibold text-gray-600">元ファイル名</p>
                                    <p className="text-sm text-gray-800 truncate mt-1">{selectedImage.file.name}</p>
                                </div>
                                <div>
                                    <label className="block text-base font-semibold text-gray-700 mb-3">種別</label>
                                    <select
                                        value={selectedImage.type}
                                        onChange={(e) => handleTypeChange(selectedImage.id, e.target.value)}
                                        className="w-full px-4 py-3 bg-white/80 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                    >
                                        {IMAGE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                    {selectedImage.type === 'スタッフ' && modelStatus === 'ready' && (
                                        <div className="mt-2 flex items-center text-xs text-blue-600 bg-blue-50 p-2 rounded-md">
                                            <Bot size={14} className="mr-2 flex-shrink-0" />
                                            <span>自動認識トリミングが適用されます。</span>
                                        </div>
                                    )}
                                </div>
                                {selectedImage.targetSize ? (
                                    <button
                                        onClick={() => setCroppingImageId(selectedImage.id)}
                                        className="w-full py-3 px-4 bg-white border border-gray-300/80 text-gray-800 font-semibold rounded-xl hover:bg-gray-200/50 transition-colors text-sm flex items-center justify-center shadow-sm"
                                    >
                                        <Scissors size={16} className="mr-2" />
                                        トリミング調整
                                    </button>
                                ) : (
                                    <div className="text-sm text-center text-yellow-700 bg-yellow-100 p-3 rounded-xl">
                                        このメディアでは「{selectedImage.type}」は対象外です
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-gray-500 text-center mt-10">リストから画像を選択してください</p>
                        )}
                    </div>
                    <footer className="p-4 flex justify-between items-center flex-shrink-0 border-t border-gray-200/80">
                        <button onClick={onBack} className="flex items-center px-6 py-3 rounded-xl text-gray-700 font-semibold bg-gray-200 hover:bg-gray-300 transition">
                            <RotateCcw size={18} className="mr-2" /> 戻る
                        </button>
                        <button 
                            onClick={handleProcessClick} 
                            disabled={isProcessingDisabled}
                            className="flex items-center px-6 py-3 rounded-xl text-white font-bold bg-blue-600 hover:bg-blue-700 transform hover:-translate-y-0.5 transition-all duration-200 shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
                        >
                            {isProcessingDisabled ? 'モデル準備中...' : 'リサイズを実行'}
                            {!isProcessingDisabled && <ChevronsRight size={20} className="ml-2" />}
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

/**
 * STEP 3: ダウンロード画面
 */
const DownloadScreen = ({ zipBlob, onRestart }) => {
    const handleDownload = () => {
      if (window.saveAs && zipBlob) {
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
        const fileName = `resized_images_${timestamp.slice(0,8)}_${timestamp.slice(9)}.zip`;
        window.saveAs(zipBlob, fileName);
      }
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 bg-gray-100">
            <div className="relative w-32 h-32 flex items-center justify-center mb-8">
                <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full shadow-2xl shadow-green-500/30 opacity-80"></div>
                <Download className="w-20 h-20 text-white relative" />
            </div>
            <h1 className="text-4xl font-bold text-gray-800 tracking-tight">画像処理が完了しました！</h1>
            <p className="text-lg text-gray-500 mt-3">下のボタンをクリックして、ZIPファイルをダウンロードしてください。</p>
            <button
                onClick={handleDownload}
                className="mt-12 flex items-center px-12 py-4 rounded-2xl text-white bg-gradient-to-br from-green-500 to-emerald-600 font-bold text-xl shadow-2xl shadow-green-500/40 transform hover:-translate-y-1 transition-all duration-300 ease-in-out"
            >
                <Download size={24} className="mr-3" />
                ZIPファイルをダウンロード
            </button>
            <button
                onClick={onRestart}
                className="mt-10 flex items-center px-6 py-2 rounded-lg text-gray-500 font-semibold hover:bg-gray-200/80 hover:text-gray-700 transition-colors"
            >
                <RotateCcw size={16} className="mr-2" />
                最初に戻る
            </button>
        </div>
    );
};


/**
 * メインアプリケーションコンポーネント
 */
export default function App() {
  const [screen, setScreen] = useState('initializing'); // 'initializing', 'upload', 'loading', 'edit', 'processing', 'download'
  const [images, setImages] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState({ progress: 0, total: 0 });
  const [processingProgress, setProcessingProgress] = useState({ progress: 0, total: 0 });
  const [zipBlob, setZipBlob] = useState(null);
  const [errors, setErrors] = useState([]);
  
  const [detector, setDetector] = useState(null);
  const [modelStatus, setModelStatus] = useState('loading'); // 'loading', 'ready', 'error'

  // 外部スクリプトの読み込み
  const { isLoaded: isHeicLoaded, error: heicLoadError } = useScript(HEIC_CDN_URL);
  const { isLoaded: isCropperLoaded, error: cropperLoadError } = useScript(CROPPER_JS_CDN);
  const { isLoaded: isJszipLoaded, error: jszipLoadError } = useScript(JSZIP_CDN);
  const { isLoaded: isFilesaverLoaded, error: filesaverLoadError } = useScript(FILESAVER_CDN);

  // Cropper CSSの読み込み
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CROPPER_CSS_CDN;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  // 自動認識モデルを読み込むEffect
  useEffect(() => {
    const loadModel = async () => {
        try {
            console.log("自動認識モデルの読み込みを開始...");
            await tf.setBackend('webgl');
            const model = poseDetection.SupportedModels.MoveNet;
            const detectorConfig = { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING };
            const loadedDetector = await poseDetection.createDetector(model, detectorConfig);
            setDetector(loadedDetector);
            setModelStatus('ready');
            console.log("自動認識モデルの読み込みが完了しました。");
        } catch (error) {
            console.error("自動認識モデルの読み込みに失敗しました:", error);
            setModelStatus('error');
            handleFileErrors(['人物自動認識モデルの読み込みに失敗しました。ページを再読み込みしてください。']);
        }
    };
    loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回レンダリング時に一度だけ実行
  
  // スクリプト読み込み完了チェックとエラーハンドリング
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

    if (isHeicLoaded && isCropperLoaded && isJszipLoaded && isFilesaverLoaded && screen === 'initializing') {
      setScreen('upload');
    }
  }, [isHeicLoaded, isCropperLoaded, isJszipLoaded, isFilesaverLoaded, heicLoadError, cropperLoadError, jszipLoadError, filesaverLoadError, screen]);


  const handleFileErrors = (newErrors) => {
    setErrors(newErrors);
    setTimeout(() => setErrors([]), 8000);
  };

  const handleFilesAccepted = async (files) => {
    setScreen('loading');
    setErrors([]);
    setLoadingProgress({ progress: 0, total: files.length });

    const newImages = [];
    for (const file of files) {
      try {
        let blob = file;
        const lowerCaseName = file.name.toLowerCase();
        if ((lowerCaseName.endsWith('.heic') || lowerCaseName.endsWith('.heif')) && window.heic2any) {
            blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        }
        const originalUrl = URL.createObjectURL(blob);
        
        const type = detectImageType(file.name);
        const targetSize = RESIZE_DEFINITIONS['EPARK']?.[type];
        
        let thumbnailUrl = originalUrl; // フォールバック
        if (targetSize) {
            thumbnailUrl = await createOrUpdateThumbnail(originalUrl, targetSize, null, type, detector);
        }

        newImages.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          originalUrl,
          thumbnailUrl,
          type: type,
          cropData: null,
        });
      } catch(err) {
        console.error("Error processing file:", file.name, err);
        handleFileErrors([`ファイル処理中にエラーが発生しました: ${file.name}`]);
      }
      setLoadingProgress(p => ({ ...p, progress: p.progress + 1 }));
    }

    setImages(newImages);
    setScreen('edit');
  };

  const getCroppedCanvas = (imageUrl, cropData, targetSize) => {
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
                sourceX = cropData.x;
                sourceY = cropData.y;
                sourceWidth = cropData.width;
                sourceHeight = cropData.height;
            } else {
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
                image, sourceX, sourceY, sourceWidth, sourceHeight,
                0, 0, targetSize.w, targetSize.h
            );
            resolve(canvas);
        };
        image.onerror = reject;
    });
  };
  
  const getAutoCroppedCanvas = (imageUrl, targetSize, detector) => {
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = imageUrl;

        image.onload = async () => {
            const region = await getAutoCropRegion(image, targetSize, detector);
            if (region) {
                const canvas = document.createElement('canvas');
                canvas.width = targetSize.w;
                canvas.height = targetSize.h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, targetSize.w, targetSize.h);
                resolve(canvas);
            } else {
                resolve(null); // 領域が見つからなければnullを返す
            }
        };
        image.onerror = () => {
            console.error(`画像の読み込みに失敗しました: ${image.src}`);
            resolve(null);
        };
    });
  };

  const handleProcess = async (imagesToProcess, media, quality) => {
    if (!window.JSZip) {
        handleFileErrors(['ZIP圧縮ライブラリが読み込まれていません。']);
        return;
    }
    setScreen('processing');
    setProcessingProgress({ progress: 0, total: imagesToProcess.length });
    const zip = new window.JSZip();

    for (const image of imagesToProcess) {
      const targetSize = RESIZE_DEFINITIONS[media][image.type];
      if (!targetSize) {
        setProcessingProgress(p => ({ ...p, progress: p.progress + 1 }));
        continue;
      }
      
      try {
        let canvas;
        // 種別が'スタッフ'、手動クロップ未設定、モデル準備完了の場合、自動認識を試みる
        if (image.type === 'スタッフ' && !image.cropData && detector && modelStatus === 'ready') {
            console.log(`自動認識を開始: ${image.file.name}`);
            canvas = await getAutoCroppedCanvas(image.originalUrl, targetSize, detector);
            
            // 自動認識が失敗した場合（nullが返された場合）、通常の中央トリミングにフォールバック
            if (!canvas) {
                console.log(`自動認識が失敗したため、中央トリミングにフォールバック: ${image.file.name}`);
                canvas = await getCroppedCanvas(image.originalUrl, null, targetSize);
            }
        } else {
            // それ以外の場合は、従来通りの処理（手動クロップまたは中央トリミング）
            canvas = await getCroppedCanvas(image.originalUrl, image.cropData, targetSize);
        }

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        const fileNameWithoutExt = image.file.name.substring(0, image.file.name.lastIndexOf('.')) || image.file.name;
        zip.file(`${fileNameWithoutExt}.jpg`, blob);

      } catch (err) {
        console.error("Error processing image:", image.file.name, err);
        handleFileErrors([`画像処理エラー: ${image.file.name}`]);
      }
      setProcessingProgress(p => ({ ...p, progress: p.progress + 1 }));
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
        return <LoadingScreen title="画像を読み込んでいます..." progress={loadingProgress.progress} total={loadingProgress.total} />;
      case 'edit':
        return <EditScreen images={images} setImages={setImages} onProcess={handleProcess} onBack={handleRestart} setErrors={handleFileErrors} modelStatus={modelStatus} detector={detector} />;
      case 'processing':
        return <LoadingScreen title="画像を処理中です..." progress={processingProgress.progress} total={processingProgress.total} />;
      case 'download':
        return <DownloadScreen zipBlob={zipBlob} onRestart={handleRestart} />;
      case 'upload':
      default:
        return <UploadScreen onFilesAccepted={handleFilesAccepted} setErrors={handleFileErrors} />;
    }
  };

  const showHeader = ['initializing', 'loading', 'upload', 'edit', 'processing', 'download'].includes(screen);
   
  return (
      <div className="font-sans w-full h-screen flex flex-col antialiased bg-gray-100">
          {showHeader && (
            <header className="flex-shrink-0 bg-white/90 backdrop-blur-sm border-b border-gray-200 z-10">
              <div className="flex items-center justify-between h-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div>
                    <h1 className="text-lg font-bold text-gray-800">メディア別リサイズ</h1>
                </div>
                <div>
                    <WorkflowIndicator currentScreen={screen} />
                </div>
                <div>
                    <a href="/manual.html" target="_blank" rel="noopener noreferrer" title="ご利用マニュアルを開く" className="p-2 text-gray-500 hover:text-blue-600 transition-colors">
                        <BookOpen size={22} />
                    </a>
                </div>
              </div>
            </header>
          )}
          <div className={`flex-grow relative min-h-0 flex flex-col ${!showHeader ? 'h-full' : ''}`}>
            <div className="absolute top-4 left-4 right-4 z-50 space-y-2">
              {errors.map((error, index) => (
                  <Alert key={index} message={error} onDismiss={() => setErrors(prev => prev.filter((_, i) => i !== index))} />
              ))}
            </div>
            {renderScreen()}
          </div>
      </div>
  );
}
