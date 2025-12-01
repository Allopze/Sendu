import { FileIcon, Download, Trash2, Calendar, HardDrive } from 'lucide-react';
import { Link } from 'react-router-dom';

const FileCard = ({ file, onDelete }) => {
    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="glass p-5 rounded-xl hover:shadow-lg transition-all duration-300 group">
            <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-xl text-primary-600">
                    <FileIcon size={24} />
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link
                        to={`/share/${file.id}`}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl text-gray-500 hover:text-primary-600 transition-colors"
                        title="Download Page"
                    >
                        <Download size={18} />
                    </Link>
                    <button
                        onClick={() => onDelete(file.id)}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl text-gray-500 hover:text-red-600 transition-colors"
                        title="Delete File"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>

            <h3 className="font-bold truncate mb-1" title={file.originalName}>{file.originalName}</h3>

            <div className="flex justify-between items-end mt-4 text-xs text-gray-500">
                <div>
                    <div className="flex items-center gap-1 mb-1">
                        <HardDrive size={12} />
                        <span>{formatSize(file.size)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Calendar size={12} />
                        <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                    </div>
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg text-gray-600 dark:text-gray-400">
                    {file.downloadCount} Downloads
                </div>
            </div>
        </div>
    );
};

export default FileCard;
