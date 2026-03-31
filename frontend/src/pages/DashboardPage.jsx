import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import ConfirmModal from '../components/ui/ConfirmModal';
import { Loader2, FolderOpen, Download, HardDrive, Trash2, ExternalLink, Copy, Check, Clock, Lock, Calendar } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import FileItem from '../components/ui/FileItem';
import Button from '../components/ui/Button';

const DashboardPage = () => {
    const { isDark } = useTheme();
    const toast = useToast();
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ fileCount: 0, totalSize: 0, totalDownloads: 0 });
    const [deleteModal, setDeleteModal] = useState({ isOpen: false, fileId: null, fileName: '' });
    const [copiedId, setCopiedId] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const res = await apiClient.getUserFiles();
            if (res.ok) {
                const data = await res.json();
                setFiles(data.files);

                const totalSize = data.files.reduce((acc, file) => acc + file.size, 0);
                const totalDownloads = data.files.reduce((acc, file) => acc + file.downloadCount, 0);
                setStats({ fileCount: data.files.length, totalSize, totalDownloads });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
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

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
        });
    };

    const getExpirationStatus = (expiresAt) => {
        if (!expiresAt) return { text: 'Sin expiración', color: 'green', expired: false };
        
        const now = new Date();
        const expDate = new Date(expiresAt);
        const diffMs = expDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMs <= 0) {
            return { text: 'Expirado', color: 'red', expired: true };
        } else if (diffDays <= 1) {
            return { text: 'Expira hoy', color: 'orange', expired: false };
        } else if (diffDays <= 3) {
            return { text: `Expira en ${diffDays} días`, color: 'yellow', expired: false };
        } else {
            return { text: formatDate(expiresAt), color: 'green', expired: false };
        }
    };

    const handleDelete = (id, fileName) => {
        setDeleteModal({ isOpen: true, fileId: id, fileName });
    };

    const confirmDelete = async () => {
        try {
            const res = await apiClient.deleteFile(deleteModal.fileId);
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new Error(data.error || 'No se pudo eliminar el archivo');
            }

            toast.success('Archivo eliminado');
            fetchData();
        } catch (err) {
            toast.error(err.message || 'No se pudo eliminar el archivo');
        } finally {
            setDeleteModal({ isOpen: false, fileId: null, fileName: '' });
        }
    };

    const handleCopy = (fileId) => {
        const shareUrl = `${window.location.origin}/share/${fileId}`;
        navigator.clipboard.writeText(shareUrl);
        setCopiedId(fileId);
        toast.success('Enlace copiado');
        setTimeout(() => setCopiedId(null), 2000);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full w-full">
                <Loader2 className="animate-spin text-red-600" size={40} />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 mb-6">
                <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Historial
                </h1>
            </div>

            {/* Stats Cards */}
            <div className="flex-shrink-0 grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className={`rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${isDark ? 'bg-red-500/20' : 'bg-red-100'}`}>
                            <FolderOpen size={22} className="text-red-500" />
                        </div>
                        <div>
                            <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Archivos</p>
                            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                {stats.fileCount}
                            </p>
                        </div>
                    </div>
                </div>
                <div className={`rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${isDark ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                            <HardDrive size={22} className="text-blue-500" />
                        </div>
                        <div>
                            <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Almacenamiento</p>
                            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                {formatSize(stats.totalSize)}
                            </p>
                        </div>
                    </div>
                </div>
                <div className={`rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${isDark ? 'bg-green-500/20' : 'bg-green-100'}`}>
                            <Download size={22} className="text-green-500" />
                        </div>
                        <div>
                            <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Descargas</p>
                            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                {stats.totalDownloads}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Files List */}
            <div className={`flex-1 overflow-hidden flex flex-col rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                <h2 className={`flex-shrink-0 text-lg font-bold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Tus Archivos
                </h2>

                {files.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <div className={`p-4 rounded-full mx-auto w-fit mb-4 ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                                <FolderOpen size={32} className={isDark ? 'text-zinc-600' : 'text-zinc-400'} />
                            </div>
                            <p className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>
                                No tienes archivos subidos aún
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                        {files.map((file) => {
                            const expStatus = getExpirationStatus(file.expiresAt);
                            const colorMap = {
                                red: isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600',
                                orange: isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600',
                                yellow: isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700',
                                green: isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600'
                            };
                            
                            return (
                                <div 
                                    key={file.id}
                                    className={`p-4 rounded-xl transition-all ${
                                        expStatus.expired 
                                            ? isDark ? 'bg-red-900/20 border border-red-500/30' : 'bg-red-50 border border-red-200'
                                            : isDark ? 'bg-zinc-800/50 hover:bg-zinc-800' : 'bg-white hover:bg-zinc-50 border border-zinc-200'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1 min-w-0 mr-4">
                                            <FileItem 
                                                name={file.originalName}
                                                size={file.size}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleCopy(file.id)}
                                                className={`p-2 rounded-lg transition-colors ${
                                                    copiedId === file.id 
                                                        ? 'bg-green-500 text-white' 
                                                        : isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'
                                                }`}
                                                title="Copiar enlace"
                                            >
                                                {copiedId === file.id ? <Check size={16} /> : <Copy size={16} />}
                                            </button>
                                            <a
                                                href={`/share/${file.id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                                                title="Ver archivo"
                                            >
                                                <ExternalLink size={16} />
                                            </a>
                                            <button
                                                onClick={() => handleDelete(file.id, file.originalName)}
                                                className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                                                title="Eliminar"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* File metadata row */}
                                    <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-zinc-700/30">
                                        {/* Downloads */}
                                        <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg ${isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-600'}`}>
                                            <Download size={12} />
                                            {file.downloadCount} {file.downloadCount === 1 ? 'descarga' : 'descargas'}
                                        </span>
                                        
                                        {/* Expiration */}
                                        <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg ${colorMap[expStatus.color]}`}>
                                            <Clock size={12} />
                                            {expStatus.text}
                                        </span>
                                        
                                        {/* Password protected */}
                                        {file.hasPassword && (
                                            <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
                                                <Lock size={12} />
                                                Protegido
                                            </span>
                                        )}
                                        
                                        {/* Upload date */}
                                        <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg ${isDark ? 'bg-zinc-700/50 text-zinc-500' : 'bg-zinc-100 text-zinc-500'}`}>
                                            <Calendar size={12} />
                                            {formatDate(file.createdAt)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            <ConfirmModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, fileId: null, fileName: '' })}
                onConfirm={confirmDelete}
                title="¿Eliminar archivo?"
                message={`¿Estás seguro de que quieres eliminar "${deleteModal.fileName}"? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                variant="danger"
            />
        </div>
    );
};

export default DashboardPage;
