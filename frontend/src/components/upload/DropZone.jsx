import { useRef, useState, useEffect } from 'react';
import { Upload, Clock, Lock, X, Eye, EyeOff, RefreshCw, FileText, FileImage, FileVideo, FileAudio, FileArchive, FileCode } from 'lucide-react';
import clsx from 'clsx';
import apiClient from '../../api/client';

const DropZone = ({ onFileSelect, options, setOptions, selectedFile, onClearFile }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [limits, setLimits] = useState({ maxFileSize: 100, effectiveMaxFileSize: 100, isLoggedIn: false });
    const [showPassword, setShowPassword] = useState(false);
    const [usePassword, setUsePassword] = useState(Boolean(options.password));
    const inputRef = useRef(null);

    useEffect(() => {
        apiClient.getUploadLimits()
            .then(res => res.json())
            .then(data => setLimits(data))
            .catch(err => console.error('Error loading limits:', err));
    }, []);

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

    const formatMaxSize = (mb) => {
        if (mb >= 1024) {
            return `${(mb / 1024).toFixed(1)} GB`;
        }
        return `${mb} MB`;
    };

    const getExpirationDate = (days) => {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(days));
        return date.toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
        });
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

    const renderFileIcon = (fileName, props) => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'];
        const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
        const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
        const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'json', 'xml'];

        if (imageExts.includes(ext)) return <FileImage {...props} />;
        if (videoExts.includes(ext)) return <FileVideo {...props} />;
        if (audioExts.includes(ext)) return <FileAudio {...props} />;
        if (archiveExts.includes(ext)) return <FileArchive {...props} />;
        if (codeExts.includes(ext)) return <FileCode {...props} />;
        return <FileText {...props} />;
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onClearFile();
            setTimeout(() => onFileSelect(e.dataTransfer.files[0]), 0);
        }
    };

    const handleClick = () => {
        inputRef.current.click();
    };

    const handleChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            onFileSelect(e.target.files[0]);
            e.target.value = '';
        }
    };

    const handlePasswordToggle = (checked) => {
        setUsePassword(checked);
        if (!checked) {
            setOptions({ ...options, password: '' });
            setShowPassword(false);
        }
    };

    // Vista de archivo seleccionado (confirmación antes de subir)
    if (selectedFile) {
        return (
            <div className="flex flex-col h-full animate-enter">
                {/* Zona de drop compacta */}
                <div 
                    className={clsx(
                        'relative rounded-2xl border-2 border-dashed transition-all duration-500 ease-out cursor-pointer mb-6',
                        isDragging 
                            ? 'border-primary-500 bg-primary-500/5 dark:bg-primary-500/10' 
                            : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 bg-gray-50/50 dark:bg-gray-800/30'
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleClick}
                >
                    <div className="flex items-center gap-4 p-4">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 flex-shrink-0">
                            {renderFileIcon(selectedFile.name, { size: 28, strokeWidth: 1.5 })}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">Listo para subir</span>
                            </div>
                            <h3 className="text-base font-bold text-gray-800 dark:text-white truncate">
                                {selectedFile.name}
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {formatSize(selectedFile.size)}
                            </p>
                        </div>
                        
                        <button 
                            onClick={(e) => { e.stopPropagation(); onClearFile(); }}
                            className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    
                    <input
                        type="file"
                        ref={inputRef}
                        className="hidden"
                        onChange={handleChange}
                    />
                </div>

                {/* Opciones de subida */}
                <div className="space-y-5 animate-fade-in">
                    {/* Expiración - Segmented Control */}
                    <div>
                        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                            <Clock size={14} /> Expiración
                        </label>
                        <div className="flex flex-wrap gap-2 p-1.5 bg-gray-100 dark:bg-gray-800 rounded-2xl">
                            {[
                                { value: '1', label: '1 día' },
                                { value: '3', label: '3 días' },
                                { value: '7', label: '1 semana' },
                                { value: '15', label: '15 días' },
                            ].map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setOptions({ ...options, expires: opt.value })}
                                    className={clsx(
                                        'flex-1 min-w-[70px] px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                                        options.expires === opt.value
                                            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Se eliminará el {getExpirationDate(options.expires)}
                        </p>
                    </div>

                    {/* Contraseña - Toggle + Input */}
                    <div>
                        <label className="flex items-center gap-3 cursor-pointer group mb-3">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    checked={usePassword}
                                    onChange={(e) => handlePasswordToggle(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Lock size={14} className="text-gray-500" />
                                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Contraseña</span>
                            </div>
                        </label>
                        
                        {usePassword && (
                            <div className="animate-fade-in space-y-2">
                                <div className="flex gap-2">
                                    <div className="relative flex-grow">
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Ingresa una contraseña..."
                                            className="w-full px-4 py-3 pr-12 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
                                            value={options.password}
                                            onChange={(e) => setOptions({ ...options, password: e.target.value })}
                                            autoComplete="new-password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={generatePassword}
                                        className="px-3 py-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 text-gray-600 dark:text-gray-300"
                                        title="Generar contraseña segura"
                                    >
                                        <RefreshCw size={18} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Botón de subir - Siempre al final */}
                <div className="mt-auto pt-6">
                    <button
                        type="button"
                        onClick={() => onFileSelect(selectedFile, true)}
                        className="w-full px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white rounded-2xl font-bold shadow-lg shadow-primary-600/30 transition-all transform hover:scale-[1.01] active:scale-[0.99] text-lg flex items-center justify-center gap-3"
                    >
                        <Upload size={22} />
                        Subir Archivo
                    </button>
                </div>
            </div>
        );
    }

    // Vista inicial - Zona de drop que ocupa todo el espacio
    return (
        <div className="flex flex-col h-full">
            <div 
                className={clsx(
                    'relative flex-1 rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center cursor-pointer',
                    isDragging 
                        ? 'border-primary-500 bg-primary-500/5 dark:bg-primary-500/10 scale-[1.01]' 
                        : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 bg-gray-50/50 dark:bg-gray-800/30'
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleClick}
            >
                {/* Overlay de drag */}
                <div className={clsx(
                    'absolute inset-0 bg-primary-500/10 dark:bg-primary-500/20 flex items-center justify-center transition-opacity duration-200 pointer-events-none z-10 rounded-2xl',
                    isDragging ? 'opacity-100' : 'opacity-0'
                )}>
                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary-500 text-white flex items-center justify-center animate-bounce">
                            <Upload size={40} />
                        </div>
                        <p className="text-xl font-bold text-primary-600 dark:text-primary-400">Suelta el archivo aquí</p>
                    </div>
                </div>

                <div className={clsx(
                    "w-24 h-24 flex items-center justify-center mb-6 transition-all duration-300",
                    isDragging 
                        ? "scale-110 text-primary-500 drop-shadow-lg" 
                        : "text-gray-400 dark:text-gray-500"
                )}>
                    <Upload size={64} strokeWidth={1.5} />
                </div>
                
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
                    Arrastra tus archivos aquí
                </h2>
                
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                    Soporte hasta <span className="font-semibold text-gray-700 dark:text-gray-300">{formatMaxSize(limits.effectiveMaxFileSize)}</span>
                </p>
                
                <button 
                    type="button"
                    className="px-8 py-3 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white rounded-2xl font-bold shadow-lg shadow-primary-600/30 transition-all transform hover:scale-105 active:scale-95"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClick();
                    }}
                >
                    Seleccionar Archivo
                </button>
                
                <input
                    type="file"
                    ref={inputRef}
                    className="hidden"
                    onChange={handleChange}
                />
            </div>
        </div>
    );
};

export default DropZone;
