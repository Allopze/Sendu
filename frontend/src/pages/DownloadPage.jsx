import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { Loader2, AlertCircle, Download, Lock, ArrowRight } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import FileItem from '../components/ui/FileItem';

const DownloadPage = () => {
    const { id } = useParams();
    const { isDark } = useTheme();
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState(null);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        const fetchMeta = async () => {
            try {
                const res = await apiClient.getFileMeta(id);
                if (res.ok) {
                    const data = await res.json();
                    setFile(data);
                } else {
                    const err = await res.json();
                    setError(err.error || 'Archivo no encontrado');
                }
            } catch (err) {
                setError('Error al cargar información del archivo');
            } finally {
                setLoading(false);
            }
        };

        fetchMeta();
    }, [id]);

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

    const getExpiryDays = () => {
        if (!file?.expiresAt) return null;
        const now = new Date();
        const expiry = new Date(file.expiresAt);
        const days = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        return days > 0 ? days : 0;
    };

    const handleDownload = async (e) => {
        e?.preventDefault();
        setPasswordError(null);
        setDownloading(true);
        
        if (file.hasPassword && password) {
            try {
                const res = await apiClient.validateDownload(id, password);
                if (!res.ok) {
                    const err = await res.json();
                    setPasswordError(err.error || 'Contraseña incorrecta');
                    setDownloading(false);
                    return;
                }
                await res.json();
                triggerDownload(`/api/download/${id}`);
            } catch (err) {
                console.error('Download error:', err);
                setPasswordError('Error en la descarga: ' + err.message);
                setDownloading(false);
            }
        } else if (!file.hasPassword) {
            triggerDownload(`/api/download/${id}`);
        }
    };

    const triggerDownload = (url) => {
        // Usar un link temporal para descargar
        const link = document.createElement('a');
        link.href = url;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Quitar el estado de loading después de un breve momento
        setTimeout(() => {
            setDownloading(false);
        }, 1500);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full w-full">
                <Loader2 className="animate-spin text-red-600" size={48} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center animate-enter">
                <div className={`p-6 rounded-full mx-auto mb-6 w-fit ${isDark ? 'bg-red-900/30' : 'bg-red-100'}`}>
                    <AlertCircle size={48} className="text-red-500" />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    ¡Vaya!
                </h2>
                <p className={`${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>{error}</p>
            </div>
        );
    }

    const expiryDays = getExpiryDays();

    return (
        <div className="flex flex-col h-full animate-enter">
            {/* Header */}
            <div className="flex flex-col items-center text-center mb-8">
                <div className={`p-6 rounded-full mb-6 ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                    <Download size={48} className="text-red-600" />
                </div>
                <h1 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Alguien te ha enviado archivos
                </h1>
                <p className={`${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {formatSize(file.size)} │ {expiryDays !== null && `Expira en ${expiryDays} día${expiryDays !== 1 ? 's' : ''}`}
                </p>
            </div>

            {/* File Info */}
            <div className={`rounded-2xl p-4 mb-6 ${isDark ? 'bg-zinc-800/30' : 'bg-zinc-50'}`}>
                <FileItem 
                    name={file.originalName}
                    size={file.size}
                />
            </div>

            {/* Password Form or Download Button */}
            {file.hasPassword ? (
                <form onSubmit={handleDownload} className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                        <Lock size={16} className="text-red-500" />
                        <span className={`text-sm font-medium ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                            Este archivo está protegido con contraseña
                        </span>
                    </div>
                    <Input
                        type="password"
                        placeholder="Introduce la contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        error={passwordError}
                        required
                    />
                    <Button 
                        type="submit" 
                        className="w-full group"
                        loading={downloading}
                        disabled={!password}
                    >
                        Descargar
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </Button>
                </form>
            ) : (
                <Button 
                    onClick={handleDownload} 
                    className="w-full group"
                    loading={downloading}
                >
                    Descargar Archivo
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Button>
            )}
        </div>
    );
};

export default DownloadPage;
