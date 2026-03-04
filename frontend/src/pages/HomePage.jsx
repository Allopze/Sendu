import { useState, useRef, useEffect } from 'react';
import { RefreshCw, AlertCircle, Clock, Lock, Eye, EyeOff, X, Upload, Check, Copy, ExternalLink, Plus, FolderOpen, Loader2, File as FileIcon, Folder, Trash2, Archive, Image, FileText, FileVideo, FileAudio, FileCode, FileArchive, FileSpreadsheet, Presentation, FileJson, FilePlus, FolderPlus } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';
import { useUploadContext } from '../context/UploadContext';
import useAuth from '../hooks/useAuth';
import apiClient from '../api/client';
import Button from '../components/ui/Button';
import BoxIcon from '../components/ui/BoxIcon';
import FileItem from '../components/ui/FileItem';
import InfoModal from '../components/ui/InfoModal';
import JSZip from 'jszip';

// Límite máximo de archivos que se pueden seleccionar
const MAX_FILES_LIMIT = 1000;

const HomePage = () => {
    const { isDark } = useTheme();
    const { settings: brandingSettings } = useBranding();
    const { user } = useAuth();
    const location = useLocation();
    const [file, setFile] = useState(null);
    const [pendingFiles, setPendingFiles] = useState([]); // Array de {file, path}
    const [options, setOptions] = useState({ expires: '7', password: '' });
    const [isDragging, setIsDragging] = useState(false);
    const [usePassword, setUsePassword] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [limits, setLimits] = useState({ maxFileSize: 100, effectiveMaxFileSize: 100, isLoggedIn: false });
    const [copied, setCopied] = useState(false);
    const [isZipping, setIsZipping] = useState(false);
    const [zipProgress, setZipProgress] = useState(0);
    const [showFileLimitModal, setShowFileLimitModal] = useState(false);
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);
    
    const { 
        progress, 
        status, 
        error, 
        result, 
        uploadSpeed, 
        eta, 
        currentFile,
        uploadFile, 
        cancelUpload, 
        resetUpload 
    } = useUploadContext();

    // Sincronizar archivo con el contexto global cuando hay una subida activa
    useEffect(() => {
        if (currentFile && status === 'uploading' && !file) {
            setFile(currentFile);
        }
    }, [currentFile, status, file]);

    useEffect(() => {
        apiClient.getUploadLimits()
            .then(res => res.json())
            .then(data => setLimits(data))
            .catch(err => console.error('Error loading limits:', err));
    }, []);

    const formatMaxSize = (mb) => {
        if (mb >= 1024) {
            return `${(mb / 1024).toFixed(0)} GB`;
        }
        return `${mb} MB`;
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

    const formatSpeed = (bytesPerSec) => {
        if (bytesPerSec <= 0) return '';
        if (bytesPerSec >= 1024 * 1024) {
            return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
        }
        if (bytesPerSec >= 1024) {
            return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
        }
        return `${bytesPerSec.toFixed(0)} B/s`;
    };

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

    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
        let password = '';
        for (let i = 0; i < 16; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setOptions({ ...options, password });
        setShowPassword(true);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    // Función recursiva para obtener archivos de un directorio (DataTransferItem)
    const getFilesFromEntry = async (entry, path = '') => {
        const files = [];
        
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve));
            files.push({ file, path: path + file.name });
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const entries = await new Promise((resolve) => {
                const allEntries = [];
                const readEntries = () => {
                    dirReader.readEntries((results) => {
                        if (results.length === 0) {
                            resolve(allEntries);
                        } else {
                            allEntries.push(...results);
                            readEntries();
                        }
                    });
                };
                readEntries();
            });
            
            for (const childEntry of entries) {
                const childFiles = await getFilesFromEntry(childEntry, path + entry.name + '/');
                files.push(...childFiles);
            }
        }
        
        return files;
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        
        const items = e.dataTransfer.items;
        const newFiles = [];
        
        if (items) {
            // Usar DataTransferItemList para soportar carpetas
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry?.();
                if (entry) {
                    entries.push(entry);
                }
            }
            
            for (const entry of entries) {
                const files = await getFilesFromEntry(entry);
                newFiles.push(...files);
            }
        } else if (e.dataTransfer.files) {
            // Fallback para navegadores sin soporte de carpetas
            for (const file of e.dataTransfer.files) {
                newFiles.push({ file, path: file.name });
            }
        }
        
        if (newFiles.length > 0) {
            // Verificar límite de archivos
            const totalFiles = pendingFiles.length + newFiles.length;
            if (totalFiles > MAX_FILES_LIMIT) {
                setShowFileLimitModal(true);
                return;
            }
            setPendingFiles(prev => [...prev, ...newFiles]);
        }
    };

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files).map(file => ({
                file,
                path: file.name
            }));
            // Verificar límite de archivos
            const totalFiles = pendingFiles.length + newFiles.length;
            if (totalFiles > MAX_FILES_LIMIT) {
                setShowFileLimitModal(true);
                e.target.value = '';
                return;
            }
            setPendingFiles(prev => [...prev, ...newFiles]);
            e.target.value = '';
        }
    };

    const handleFolderSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files).map(file => ({
                file,
                // webkitRelativePath contiene la ruta relativa incluyendo el nombre de la carpeta
                path: file.webkitRelativePath || file.name
            }));
            // Verificar límite de archivos
            const totalFiles = pendingFiles.length + newFiles.length;
            if (totalFiles > MAX_FILES_LIMIT) {
                setShowFileLimitModal(true);
                e.target.value = '';
                return;
            }
            setPendingFiles(prev => [...prev, ...newFiles]);
            e.target.value = '';
        }
    };

    const handleRemoveFile = (index) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleClearFiles = () => {
        setPendingFiles([]);
        setOptions({ expires: '7', password: '' });
        setUsePassword(false);
    };

    // Crear ZIP de múltiples archivos
    const createZipFromFiles = async (files) => {
        const zip = new JSZip();
        
        for (let i = 0; i < files.length; i++) {
            const { file, path } = files[i];
            zip.file(path, file);
            setZipProgress(Math.round(((i + 1) / files.length) * 50)); // Primera mitad del progreso
        }
        
        const blob = await zip.generateAsync({ 
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        }, (metadata) => {
            setZipProgress(50 + Math.round(metadata.percent / 2)); // Segunda mitad del progreso
        });
        
        // Determinar nombre del ZIP
        let zipName = 'archivos.zip';
        if (files.length === 1) {
            // Si es un solo archivo, usar su nombre
            zipName = files[0].file.name;
        } else {
            // Si hay carpeta raíz común, usar ese nombre
            const paths = files.map(f => f.path);
            const firstPath = paths[0];
            if (firstPath.includes('/')) {
                const rootFolder = firstPath.split('/')[0];
                if (paths.every(p => p.startsWith(rootFolder + '/'))) {
                    zipName = rootFolder + '.zip';
                }
            }
        }
        
        return new File([blob], zipName, { type: 'application/zip' });
    };

    const handleStartUpload = async () => {
        if (pendingFiles.length === 0) return;
        
        let fileToUpload;
        
        if (pendingFiles.length === 1 && !pendingFiles[0].path.includes('/')) {
            // Un solo archivo sin carpeta - subir directamente
            fileToUpload = pendingFiles[0].file;
        } else {
            // Múltiples archivos o carpetas - crear ZIP
            setIsZipping(true);
            setZipProgress(0);
            try {
                fileToUpload = await createZipFromFiles(pendingFiles);
            } catch (err) {
                console.error('Error creating ZIP:', err);
                setIsZipping(false);
                return;
            }
            setIsZipping(false);
        }
        
        setFile(fileToUpload);
        uploadFile(fileToUpload, options, location.pathname);
    };

    const handleCancel = () => {
        cancelUpload();
        setFile(null);
    };

    const handleReset = () => {
        resetUpload();
        setFile(null);
        setPendingFiles([]);
        setOptions({ expires: '7', password: '' });
        setUsePassword(false);
    };

    const handleCopy = () => {
        const shareUrl = `${window.location.origin}/share/${result?.fileId}`;
        navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const maxLimit = formatMaxSize(limits.effectiveMaxFileSize || 100);

    // Componente para renderizar el icono de dropzone (customizado o null si no hay)
    const DropzoneIcon = ({ size = 100, className = '' }) => {
        const [imgError, setImgError] = useState(false);
        const [lastIcon, setLastIcon] = useState(brandingSettings.dropzoneIcon);
        
        // Reset error when icon changes
        if (brandingSettings.dropzoneIcon !== lastIcon) {
            setLastIcon(brandingSettings.dropzoneIcon);
            setImgError(false);
        }
        
        // Si no hay icono configurado, no mostrar nada
        if (!brandingSettings.dropzoneIcon) {
            return null;
        }
        
        // Si hay error cargando la imagen, no mostrar nada
        if (imgError) {
            return null;
        }
        
        return (
            <img 
                src={brandingSettings.dropzoneIcon} 
                alt="" 
                className={className}
                style={{ width: size, height: size, objectFit: 'contain' }}
                onError={() => setImgError(true)}
            />
        );
    };

    // Función para obtener icono según extensión del archivo
    const getFileIcon = (filename) => {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        
        // Imágenes
        if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'avif'].includes(ext)) {
            return { icon: Image, color: isDark ? 'text-pink-400' : 'text-pink-500' };
        }
        // Videos
        if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) {
            return { icon: FileVideo, color: isDark ? 'text-purple-400' : 'text-purple-500' };
        }
        // Audio
        if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'].includes(ext)) {
            return { icon: FileAudio, color: isDark ? 'text-green-400' : 'text-green-500' };
        }
        // Documentos de texto
        if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md'].includes(ext)) {
            return { icon: FileText, color: isDark ? 'text-blue-400' : 'text-blue-500' };
        }
        // Hojas de cálculo
        if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
            return { icon: FileSpreadsheet, color: isDark ? 'text-emerald-400' : 'text-emerald-500' };
        }
        // Presentaciones
        if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) {
            return { icon: Presentation, color: isDark ? 'text-orange-400' : 'text-orange-500' };
        }
        // Código
        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp', 'h', 'php', 'rb', 'go', 'rs', 'swift', 'kt'].includes(ext)) {
            return { icon: FileCode, color: isDark ? 'text-cyan-400' : 'text-cyan-500' };
        }
        // JSON y config
        if (['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'config'].includes(ext)) {
            return { icon: FileJson, color: isDark ? 'text-yellow-400' : 'text-yellow-500' };
        }
        // Archivos comprimidos
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) {
            return { icon: FileArchive, color: isDark ? 'text-amber-400' : 'text-amber-500' };
        }
        // Ejecutables
        if (['exe', 'msi', 'dmg', 'app', 'deb', 'rpm', 'apk'].includes(ext)) {
            return { icon: FileIcon, color: isDark ? 'text-red-400' : 'text-red-500' };
        }
        
        // Default
        return { icon: FileIcon, color: isDark ? 'text-zinc-400' : 'text-zinc-500' };
    };

    // Calcular tamaño total de archivos pendientes
    const totalPendingSize = pendingFiles.reduce((acc, f) => acc + f.file.size, 0);
    
    // Obtener estructura de carpetas para mostrar
    const getFolderStructure = () => {
        const folders = new Set();
        pendingFiles.forEach(f => {
            const parts = f.path.split('/');
            if (parts.length > 1) {
                folders.add(parts[0]);
            }
        });
        return Array.from(folders);
    };

    // Upload View (with pending files)
    const renderUploadView = () => (
        <div className="flex flex-col h-full animate-enter">
            {/* Drag & Drop Area */}
            <div 
                className={`
                    relative rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center p-8 cursor-pointer mb-4
                    ${pendingFiles.length > 0 ? 'flex-none h-32' : 'flex-1'}
                    ${isDragging 
                        ? 'border-red-500 bg-red-500/5 scale-[1.01]' 
                        : isDark ? 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/50' : 'border-zinc-300 hover:border-zinc-400 bg-zinc-50/50'}
                `}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => pendingFiles.length === 0 && fileInputRef.current?.click()}
            >
                {pendingFiles.length === 0 ? (
                    // Drop Zone vacío
                    <>
                        {brandingSettings.dropzoneIcon && (
                            <div className={`absolute top-[10%] transition-transform duration-500 animate-float ${isDragging ? 'scale-110' : ''}`}>
                                <DropzoneIcon size={250} />
                            </div>
                        )}
                        <div className={brandingSettings.dropzoneIcon ? "absolute bottom-[25%] text-center" : "text-center"}>
                            <h2 className={`text-xl font-semibold mb-2 ${isDark ? 'text-white' : 'text-zinc-800'}`}>
                                Arrastra archivos o carpetas aquí
                            </h2>
                            <div className="text-center">
                                <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    Soporte hasta <span className={`font-bold ${isDark ? 'text-white' : 'text-zinc-700'}`}>{maxLimit}</span>.
                                </p>
                                {!user && (
                                    <Link 
                                        to="/register"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-xs text-red-500 hover:underline mt-1 inline-block"
                                    >
                                        Regístrate para subir más
                                    </Link>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    // Drop zone compacto para agregar más
                    <div className="text-center">
                        <Upload size={24} className={`mx-auto mb-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`} />
                        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            Arrastra más archivos o carpetas aquí
                        </p>
                    </div>
                )}
                <input 
                    type="file" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect}
                    multiple
                />
                <input 
                    type="file" 
                    className="hidden" 
                    ref={folderInputRef} 
                    onChange={handleFolderSelect}
                    webkitdirectory="true"
                    directory="true"
                    mozdirectory="true"
                    multiple
                />
            </div>

            {/* Lista de archivos seleccionados */}
            {pendingFiles.length > 0 && (
                <div className="flex-1 flex flex-col min-h-0 mb-4 animate-enter">
                    {/* Header con info */}
                    <div className={`flex items-center justify-between mb-3 px-1 gap-4 flex-wrap`}>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-sm font-medium whitespace-nowrap ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                                {pendingFiles.length} {pendingFiles.length === 1 ? 'archivo' : 'archivos'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-200 text-zinc-600'}`}>
                                {formatSize(totalPendingSize)}
                            </span>
                            {pendingFiles.length > 1 && (
                                <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                                    Se creará ZIP
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3 flex-shrink-0">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all hover:scale-105 active:scale-95 whitespace-nowrap ${
                                    isDark 
                                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:border-blue-400' 
                                        : 'border-blue-400 bg-blue-50 text-blue-600 hover:bg-blue-100'
                                }`}
                            >
                                <FilePlus size={14} />
                                Archivos
                            </button>
                            <button
                                onClick={() => folderInputRef.current?.click()}
                                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all hover:scale-105 active:scale-95 whitespace-nowrap ${
                                    isDark 
                                        ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 hover:border-yellow-400' 
                                        : 'border-yellow-500 bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                                }`}
                            >
                                <FolderPlus size={14} />
                                Carpeta
                            </button>
                            <div className={`w-px ${isDark ? 'bg-zinc-700' : 'bg-zinc-300'}`}></div>
                            <button
                                onClick={handleClearFiles}
                                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all hover:scale-105 active:scale-95 whitespace-nowrap ${
                                    isDark 
                                        ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-400' 
                                        : 'border-red-400 bg-red-50 text-red-600 hover:bg-red-100'
                                }`}
                            >
                                <Trash2 size={14} />
                                Limpiar
                            </button>
                        </div>
                    </div>

                    {/* Lista scrolleable */}
                    <div className={`flex-1 overflow-y-auto rounded-xl border ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50/50'}`}>
                        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {pendingFiles.map((item, index) => {
                                const { icon: FileIcon, color } = getFileIcon(item.file.name);
                                return (
                                    <div 
                                        key={index}
                                        className={`flex items-center gap-3 px-4 py-2.5 group ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-zinc-100/50'}`}
                                    >
                                        <FileIcon size={16} className={`flex-shrink-0 ${color}`} />
                                        <span className={`flex-1 text-sm truncate ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`} title={item.path}>
                                            {item.path}
                                        </span>
                                        <span className={`text-xs flex-shrink-0 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                            {formatSize(item.file.size)}
                                        </span>
                                        <button
                                            onClick={() => handleRemoveFile(index)}
                                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-red-400 transition-all"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Options */}
            {pendingFiles.length > 0 && (
                <div className="space-y-4 mb-4 animate-enter">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1">
                            <label className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                EXPIRACIÓN
                            </label>
                            <select 
                                value={options.expires}
                                onChange={(e) => setOptions({ ...options, expires: e.target.value })}
                                className={`
                                    w-full p-3 rounded-xl outline-none border transition-colors appearance-none cursor-pointer
                                    ${isDark ? 'bg-zinc-800/50 border-zinc-700 text-zinc-200 focus:border-red-500' : 'bg-zinc-50 border-zinc-200 text-zinc-700 focus:border-red-500'}
                                `}
                            >
                                <option value="1">1 Día</option>
                                <option value="3">3 Días</option>
                                <option value="7">7 Días</option>
                                <option value="15">15 Días</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                CONTRASEÑA
                            </label>
                            <div className="relative">
                                <input 
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="(Opcional)"
                                    value={options.password}
                                    onChange={(e) => {
                                        setOptions({ ...options, password: e.target.value });
                                        if (e.target.value && !usePassword) setUsePassword(true);
                                    }}
                                    className={`
                                        w-full p-3 pr-20 rounded-xl outline-none border transition-all
                                        ${isDark ? 'bg-zinc-800/50 border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:border-red-500' : 'bg-zinc-50 border-zinc-200 text-zinc-700 placeholder-zinc-400 focus:border-red-500'}
                                    `}
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                                    {options.password && (
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="p-1.5 text-zinc-400 hover:text-zinc-600"
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={generatePassword}
                                        className="p-1.5 text-zinc-400 hover:text-zinc-600"
                                        title="Generar contraseña"
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Button */}
            <div className="mt-auto pt-2">
                <Button 
                    onClick={handleStartUpload} 
                    disabled={pendingFiles.length === 0 || isZipping}
                    className="w-full"
                >
                    {isZipping ? (
                        <>
                            <Loader2 size={18} className="animate-spin mr-2" />
                            Comprimiendo... {zipProgress}%
                        </>
                    ) : (
                        `Transferir ${pendingFiles.length > 0 ? (pendingFiles.length === 1 ? 'Archivo' : `${pendingFiles.length} Archivos`) : 'Archivos'}`
                    )}
                </Button>
            </div>
        </div>
    );

    // Uploading View
    const renderUploadingView = () => {
        const uploadedBytes = Math.round((progress / 100) * (file?.size || 0));
        
        // Truncar nombre de archivo si es muy largo
        const truncateFileName = (name, maxLength = 40) => {
            if (!name || name.length <= maxLength) return name;
            const ext = name.split('.').pop();
            const nameWithoutExt = name.slice(0, -(ext.length + 1));
            const truncatedName = nameWithoutExt.slice(0, maxLength - ext.length - 4) + '...';
            return `${truncatedName}.${ext}`;
        };
        
        return (
            <div className="flex flex-col h-full animate-enter">
                {/* Área visual superior con icono */}
                <div className={`flex-1 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-8 mb-6 ${
                    isDark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-300 bg-zinc-50/50'
                }`}>
                    {/* Icono de branding o animación de subida */}
                    {brandingSettings.dropzoneIcon ? (
                        <div className="mb-6 animate-pulse">
                            <DropzoneIcon size={120} />
                        </div>
                    ) : (
                        <div className="mb-6">
                            <div className={`w-24 h-24 rounded-2xl flex items-center justify-center ${isDark ? 'bg-red-500/20' : 'bg-red-100'}`}>
                                <Upload size={48} className="text-red-500 animate-bounce" />
                            </div>
                        </div>
                    )}
                    
                    {/* Título y progreso */}
                    <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-800'}`}>
                        {status === 'preparing' ? 'Preparando...' : `Subiendo ${progress}%`}
                    </h2>
                    
                    {/* Nombre del archivo */}
                    <p className={`text-sm mb-6 text-center max-w-full px-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`} title={file?.name}>
                        {truncateFileName(file?.name)}
                    </p>
                    
                    {/* Barra de progreso */}
                    <div className={`w-full max-w-md h-3 rounded-full overflow-hidden mb-4 ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                        {progress === 0 ? (
                            <div className="h-full bg-red-600 animate-indeterminate"></div>
                        ) : (
                            <div 
                                className="h-full bg-red-600 transition-all duration-100 ease-out relative"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                            </div>
                        )}
                    </div>
                    
                    {/* Stats */}
                    <div className="flex justify-between w-full max-w-md text-xs gap-4">
                        <span className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>
                            {formatSpeed(uploadSpeed)}
                        </span>
                        <span className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>
                            {formatSize(uploadedBytes)} / {formatSize(file?.size || 0)}
                        </span>
                        <span className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>
                            {eta ? `~ ${formatEta(eta)}` : ''}
                        </span>
                    </div>
                </div>

                {/* Botón Cancelar */}
                <button 
                    onClick={handleCancel}
                    className="w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                >
                    <X size={18} />
                    Cancelar
                </button>
            </div>
        );
    };

    // Success View
    const renderSuccessView = () => {
        const shareUrl = `${window.location.origin}/share/${result?.fileId}`;
        
        // Truncar nombre de archivo
        const truncateFileName = (name, maxLength = 35) => {
            if (!name || name.length <= maxLength) return name;
            const ext = name.split('.').pop();
            const nameWithoutExt = name.slice(0, -(ext.length + 1));
            const truncatedName = nameWithoutExt.slice(0, maxLength - ext.length - 4) + '...';
            return `${truncatedName}.${ext}`;
        };
        
        // Calcular fecha de expiración
        const getExpirationText = () => {
            const days = parseInt(options.expires) || 7;
            const expDate = new Date();
            expDate.setDate(expDate.getDate() + days);
            return expDate.toLocaleDateString('es-ES', { 
                day: 'numeric', 
                month: 'long', 
                year: 'numeric' 
            });
        };
        
        return (
            <div className="flex flex-col h-full animate-enter">
                {/* Área visual superior */}
                <div className={`flex-1 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-8 mb-6 ${
                    isDark ? 'border-green-500/30 bg-green-900/10' : 'border-green-300 bg-green-50/50'
                }`}>
                    {/* Icono de branding o BoxIcon */}
                    <div className="relative mb-6">
                        <div className="absolute inset-0 bg-green-500 blur-3xl opacity-20 rounded-full"></div>
                        {brandingSettings.dropzoneIcon ? (
                            <DropzoneIcon size={180} />
                        ) : (
                            <BoxIcon size={180} animated success />
                        )}
                    </div>
                    
                    <h2 className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-800'}`}>
                        ¡Listo!
                    </h2>
                    <p className={`text-center mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        Tu archivo ha sido encriptado y está listo para compartir.
                    </p>
                    
                    {/* Info del archivo */}
                    <div className={`flex flex-wrap justify-center gap-3 text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                            📄 {truncateFileName(file?.name)}
                        </span>
                        <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                            <Clock size={12} />
                            Expira: {getExpirationText()}
                        </span>
                        {options.password && (
                            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
                                <Lock size={12} />
                                Protegido
                            </span>
                        )}
                    </div>
                </div>
                
                {/* URL para compartir */}
                <div className={`w-full p-1 pl-4 rounded-xl flex items-center justify-between mb-4 transition-all duration-300 ${
                    isDark ? 'bg-zinc-900 border border-zinc-700' : 'bg-zinc-50 border border-zinc-200'
                } ${copied ? 'ring-2 ring-green-500' : ''}`}>
                    <span className={`text-sm truncate mr-4 ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                        {shareUrl}
                    </span>
                    <button 
                        onClick={handleCopy}
                        className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 flex-shrink-0 ${
                            copied ? 'bg-green-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'
                        }`}
                    >
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {copied ? 'Copiado' : 'Copiar'}
                    </button>
                </div>
                
                {/* Botones de acción */}
                <div className="grid grid-cols-2 gap-3">
                    <Link
                        to={`/share/${result?.fileId}`}
                        className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors ${
                            isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                        }`}
                    >
                        <ExternalLink size={18} />
                        Ver archivo
                    </Link>
                    <button 
                        onClick={handleReset}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
                    >
                        <Plus size={18} />
                        Nuevo envío
                    </button>
                    {user && (
                        <Link
                            to="/dashboard"
                            className={`col-span-2 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors ${
                                isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                            }`}
                        >
                            <FolderOpen size={18} />
                            Mis envíos
                        </Link>
                    )}
                </div>
            </div>
        );
    };

    // Error View
    const renderErrorView = () => (
        <div className="flex flex-col items-center justify-center h-full py-10 animate-enter">
            <div className={`p-6 rounded-full mb-6 ${isDark ? 'bg-red-900/30' : 'bg-red-100'}`}>
                <AlertCircle size={48} className="text-red-500" />
            </div>
            <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-800'}`}>
                Error en la subida
            </h2>
            <p className={`text-center mb-8 max-w-md ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {error}
            </p>
            <Button onClick={handleReset} icon={RefreshCw}>
                Intentar de nuevo
            </Button>
        </div>
    );

    // Zipping View (creando ZIP)
    const renderZippingView = () => (
        <div className="flex flex-col h-full animate-enter">
            <div className={`flex-1 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-8 mb-6 ${
                isDark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-300 bg-zinc-50/50'
            }`}>
                <div className="mb-6">
                    <div className={`w-24 h-24 rounded-2xl flex items-center justify-center ${isDark ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                        <Loader2 size={48} className="text-blue-500 animate-spin" />
                    </div>
                </div>
                
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-800'}`}>
                    Comprimiendo archivos...
                </h2>
                
                <p className={`text-sm mb-6 text-center ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {pendingFiles.length} archivos
                </p>
                
                <div className={`w-full max-w-md h-3 rounded-full overflow-hidden mb-4 ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                    <div 
                        className="h-full bg-blue-600 transition-all duration-100 ease-out"
                        style={{ width: `${zipProgress}%` }}
                    />
                </div>
                
                <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {zipProgress}%
                </span>
            </div>
        </div>
    );

    return (
        <>
            <div className="h-full w-full flex flex-col">
                {isZipping && renderZippingView()}
                {!isZipping && status === 'idle' && renderUploadView()}
                {!isZipping && (status === 'uploading' || status === 'preparing') && renderUploadingView()}
                {!isZipping && status === 'complete' && result && renderSuccessView()}
                {!isZipping && status === 'error' && renderErrorView()}
            </div>

            {/* Modal de límite de archivos */}
            <InfoModal
                isOpen={showFileLimitModal}
                onClose={() => setShowFileLimitModal(false)}
                title="Límite de archivos alcanzado"
                variant="warning"
                icon={Archive}
                message={
                    <div className="space-y-3">
                        <p>
                            Has seleccionado más de <strong>{MAX_FILES_LIMIT.toLocaleString()}</strong> archivos.
                        </p>
                        <p>
                            Para subir tantos archivos, te recomendamos <strong>comprimirlos primero</strong> en un archivo ZIP o RAR desde tu computadora y luego subir ese único archivo.
                        </p>
                        <p className="text-xs opacity-75">
                            Esto mejorará la velocidad de subida y evitará problemas de memoria en el navegador.
                        </p>
                    </div>
                }
                buttonText="Entendido"
            />
        </>
    );
};

export default HomePage;
