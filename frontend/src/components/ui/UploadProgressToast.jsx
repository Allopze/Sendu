import { useNavigate, useLocation } from 'react-router-dom';
import { Upload, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useUploadContext } from '../../context/UploadContext';

const UploadProgressToast = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { 
        progress, 
        status, 
        currentFile, 
        uploadOriginPath, 
        isUploading,
        cancelUpload,
        uploadSpeed,
        eta
    } = useUploadContext();

    // Solo mostrar si hay una subida activa y no estamos en la página de origen
    // No mostrar en la página principal (/) porque ya muestra el progreso inline
    const shouldShow = isUploading && location.pathname !== '/' && location.pathname !== uploadOriginPath;

    // Formatear velocidad
    const formatSpeed = (bytesPerSec) => {
        if (!bytesPerSec || bytesPerSec <= 0) return '';
        if (bytesPerSec >= 1024 * 1024) {
            return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
        }
        if (bytesPerSec >= 1024) {
            return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
        }
        return `${bytesPerSec.toFixed(0)} B/s`;
    };

    // Formatear ETA
    const formatEta = (seconds) => {
        if (!seconds || seconds <= 0) return '';
        if (seconds < 60) return `${Math.ceil(seconds)}s`;
        if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.ceil(seconds % 60);
            return `${mins}m ${secs}s`;
        }
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    };

    // Truncar nombre de archivo
    const truncateFileName = (name, maxLength = 20) => {
        if (!name || name.length <= maxLength) return name;
        const ext = name.split('.').pop();
        const nameWithoutExt = name.substring(0, name.length - ext.length - 1);
        const truncatedName = nameWithoutExt.substring(0, maxLength - ext.length - 4);
        return `${truncatedName}...${ext}`;
    };

    const handleClick = () => {
        // Navegar a la página de origen o a la principal
        navigate(uploadOriginPath || '/');
    };

    const handleCancel = (e) => {
        e.stopPropagation();
        cancelUpload();
    };

    if (!shouldShow) return null;

    return (
        <div 
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in cursor-pointer"
            onClick={handleClick}
        >
            <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-md bg-white/95 dark:bg-gray-800/95 border-primary-200 dark:border-primary-900/50 min-w-[280px] max-w-sm hover:shadow-xl transition-shadow">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                            <Upload size={16} className="text-primary-600" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                Subiendo archivo
                            </span>
                            {currentFile && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {truncateFileName(currentFile.name)}
                                </span>
                            )}
                        </div>
                    </div>
                    <button 
                        onClick={handleCancel}
                        className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500"
                        title="Cancelar subida"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                        className="bg-primary-600 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-primary-600">{progress}%</span>
                    <div className="flex items-center gap-2">
                        {uploadSpeed > 0 && (
                            <span>{formatSpeed(uploadSpeed)}</span>
                        )}
                        {eta && eta > 0 && (
                            <span>• {formatEta(eta)} restante</span>
                        )}
                    </div>
                </div>

                {/* Click hint */}
                <div className="text-xs text-center text-primary-600 font-medium pt-1 border-t border-gray-100 dark:border-gray-700">
                    Click para ver detalles
                </div>
            </div>
        </div>
    );
};

export default UploadProgressToast;
