import { FileIcon, Download, Calendar, HardDrive, AlertCircle } from 'lucide-react';

const FileInfo = ({ file, onDownload, error }) => {
    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="glass p-8 rounded-2xl max-w-md w-full mx-auto text-center animate-fade-in">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-100 dark:bg-primary-900/30 text-primary-600 rounded-2xl mb-6">
                <FileIcon size={40} />
            </div>

            <h2 className="text-2xl font-bold mb-2 break-all">{file.originalName}</h2>

            <div className="flex justify-center gap-6 text-sm text-gray-500 mb-8">
                <div className="flex items-center gap-1">
                    <HardDrive size={16} />
                    <span>{formatSize(file.size)}</span>
                </div>
                <div className="flex items-center gap-1">
                    <Calendar size={16} />
                    <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2 text-sm">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            <button
                onClick={onDownload}
                className="w-full py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
            >
                <Download size={20} />
                Descargar Archivo
            </button>
        </div>
    );
};

export default FileInfo;
