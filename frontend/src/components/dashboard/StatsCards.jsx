import { HardDrive, FileText, DownloadCloud } from 'lucide-react';

const StatsCards = ({ stats }) => {
    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="glass p-6 rounded-xl flex items-center gap-4">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl">
                    <FileText size={24} />
                </div>
                <div>
                    <p className="text-sm text-gray-500">Archivos Totales</p>
                    <p className="text-2xl font-bold">{stats.fileCount}</p>
                </div>
            </div>

            <div className="glass p-6 rounded-xl flex items-center gap-4">
                <div className="p-3 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-xl">
                    <HardDrive size={24} />
                </div>
                <div>
                    <p className="text-sm text-gray-500">Almacenamiento Usado</p>
                    <p className="text-2xl font-bold">{formatSize(stats.totalSize)}</p>
                </div>
            </div>

            <div className="glass p-6 rounded-xl flex items-center gap-4">
                <div className="p-3 bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded-xl">
                    <DownloadCloud size={24} />
                </div>
                <div>
                    <p className="text-sm text-gray-500">Descargas Totales</p>
                    <p className="text-2xl font-bold">{stats.totalDownloads || 0}</p>
                </div>
            </div>
        </div>
    );
};

export default StatsCards;
