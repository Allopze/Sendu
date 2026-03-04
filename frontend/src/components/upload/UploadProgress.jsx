import { FileIcon, X, Loader2, Zap, Clock } from 'lucide-react';

const UploadProgress = ({ file, progress, onCancel, uploadSpeed = 0, eta = null, status = 'uploading' }) => {
    // Formatear velocidad de subida
    const formatSpeed = (bytesPerSec) => {
        if (bytesPerSec <= 0) return '';
        if (bytesPerSec >= 1024 * 1024 * 1024) {
            return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
        }
        if (bytesPerSec >= 1024 * 1024) {
            return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
        }
        if (bytesPerSec >= 1024) {
            return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
        }
        return `${bytesPerSec.toFixed(0)} B/s`;
    };

    // Formatear tiempo restante
    const formatEta = (seconds) => {
        if (!seconds || seconds <= 0) return '';
        if (seconds < 60) {
            return `${Math.ceil(seconds)}s`;
        }
        if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.ceil(seconds % 60);
            return `${mins}m ${secs}s`;
        }
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    };

    const getProgressText = () => {
        if (status === 'preparing') {
            return 'Preparando...';
        }
        if (progress === 0) {
            return 'Iniciando...';
        }
        if (progress < 100) {
            return `Subiendo... ${progress}%`;
        }
        return 'Procesando...';
    };

    const formatSize = (bytes) => {
        if (bytes >= 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
        if (bytes >= 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }
        if (bytes >= 1024) {
            return `${(bytes / 1024).toFixed(2)} KB`;
        }
        return `${bytes} B`;
    };

    // Calcular bytes subidos
    const uploadedBytes = Math.round((progress / 100) * file.size);

    return (
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-3xl shadow-2xl overflow-hidden transition-all duration-300">
            <div className="p-10 flex flex-col items-center justify-center text-center">
                {/* Icono animado */}
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 relative">
                    <FileIcon size={40} strokeWidth={1.5} />
                    <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg">
                        <Loader2 size={18} className="text-primary-600 animate-spin" />
                    </div>
                </div>

                {/* Info del archivo */}
                <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-2 break-all max-w-full px-4">
                    {file.name}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                    {formatSize(uploadedBytes)} / {formatSize(file.size)}
                </p>

                {/* Barra de progreso */}
                <div className="w-full max-w-md mb-4">
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                        {progress === 0 ? (
                            /* Barra indeterminada mientras se inicia */
                            <div className="h-3 rounded-full bg-gradient-to-r from-primary-600 to-primary-500 animate-indeterminate"></div>
                        ) : (
                            <div
                                className="bg-gradient-to-r from-primary-600 to-primary-500 h-3 rounded-full transition-all duration-150 ease-out relative"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                            </div>
                        )}
                    </div>
                    <div className="flex justify-between mt-3 text-sm">
                        <span className="text-gray-600 dark:text-gray-400 font-medium">{getProgressText()}</span>
                        <span className="text-primary-600 dark:text-primary-400 font-bold">{progress}%</span>
                    </div>
                </div>

                {/* Estadísticas de velocidad y tiempo */}
                {(uploadSpeed > 0 || eta) && (
                    <div className="flex items-center gap-6 mb-4 text-sm">
                        {uploadSpeed > 0 && (
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                <Zap size={14} className="text-yellow-500" />
                                <span className="font-medium">{formatSpeed(uploadSpeed)}</span>
                            </div>
                        )}
                        {eta && eta > 0 && (
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                <Clock size={14} className="text-blue-500" />
                                <span className="font-medium">{formatEta(eta)} restante</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Botón cancelar */}
                <button 
                    onClick={onCancel} 
                    className="flex items-center gap-2 px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all text-sm font-medium mt-4"
                >
                    <X size={16} />
                    Cancelar subida
                </button>
            </div>
        </div>
    );
};

export default UploadProgress;
