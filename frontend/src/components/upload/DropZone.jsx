import { useRef, useState, useEffect } from 'react';
import { Upload, Clock, Lock } from 'lucide-react';
import clsx from 'clsx';
import apiClient from '../../api/client';

const DropZone = ({ onFileSelect, options, setOptions }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [limits, setLimits] = useState({ maxFileSize: 100, maxTotalSize: 500 });
    const inputRef = useRef(null);

    useEffect(() => {
        apiClient.getUploadLimits()
            .then(res => res.json())
            .then(data => setLimits(data))
            .catch(err => console.error('Error loading limits:', err));
    }, []);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleClick = () => {
        inputRef.current.click();
    };

    const handleChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            onFileSelect(e.target.files[0]);
        }
    };

    return (
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-md border border-white/20 dark:border-gray-700/50 rounded-2xl shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:border-primary-500/30">
            <div
                className={clsx(
                    'p-12 flex flex-col items-center justify-center text-center cursor-pointer min-h-[400px] transition-colors duration-300',
                    isDragging
                        ? 'bg-primary-50 dark:bg-primary-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleClick}
            >
                <div className={clsx(
                    "w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-transform duration-300",
                    isDragging ? "scale-110 bg-primary-100 dark:bg-primary-900/30 text-primary-600" : "bg-primary-50 dark:bg-gray-800 text-primary-500"
                )}>
                    <Upload size={40} />
                </div>
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
                    Haz clic o arrastra un archivo
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-8 text-lg">
                    Tamaño máximo: {limits.maxFileSize >= 1024 ? `${(limits.maxFileSize / 1024).toFixed(1)}GB` : `${limits.maxFileSize}MB`}
                </p>
                <button className="px-8 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold shadow-lg shadow-primary-600/30 transition-all transform hover:scale-105 active:scale-95">
                    Seleccionar Archivo
                </button>
                <input
                    type="file"
                    ref={inputRef}
                    className="hidden"
                    onChange={handleChange}
                />
            </div>

            {/* Upload Options */}
            <form className="border-t border-gray-200 dark:border-gray-700 p-8 bg-gray-50/50 dark:bg-gray-900/30" onSubmit={(e) => e.preventDefault()}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                            <Clock size={18} className="text-primary-500" /> Expiración
                        </label>
                        <select
                            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                            value={options.expires}
                            onChange={(e) => setOptions({ ...options, expires: e.target.value })}
                        >
                            <option value="1">1 Día</option>
                            <option value="3">3 Días</option>
                            <option value="7">1 Semana</option>
                            <option value="15">15 Días</option>
                        </select>
                    </div>
                    <div>
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                            <Lock size={18} className="text-primary-500" /> Contraseña (Opcional)
                        </label>
                        <input
                            type="password"
                            placeholder="Proteger archivo..."
                            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                            value={options.password}
                            onChange={(e) => setOptions({ ...options, password: e.target.value })}
                            autoComplete="new-password"
                        />
                    </div>
                </div>
            </form>
        </div>
    );
};

export default DropZone;
