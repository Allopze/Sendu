import { FileIcon, X } from 'lucide-react';

const UploadProgress = ({ file, progress, onCancel }) => {
    return (
        <div className="glass p-6 rounded-xl mt-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-xl text-primary-600">
                        <FileIcon size={24} />
                    </div>
                    <div>
                        <p className="font-medium truncate max-w-[200px] sm:max-w-xs">{file.name}</p>
                        <p className="text-xs text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                </div>
                <button onClick={onCancel} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500">
                    <X size={20} />
                </button>
            </div>

            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div
                    className="bg-primary-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{progress}% Subido</span>
                <span>Subiendo...</span>
            </div>
        </div>
    );
};

export default UploadProgress;
