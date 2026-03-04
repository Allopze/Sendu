import { useState } from 'react';
import { Lock, FileIcon, HardDrive, Calendar } from 'lucide-react';

const PasswordForm = ({ file, onSubmit, error }) => {
    const [password, setPassword] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(password);
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="glass p-8 rounded-2xl max-w-md w-full mx-auto text-center animate-fade-in">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 rounded-full mb-6">
                <Lock size={32} />
            </div>

            <h2 className="text-2xl font-bold mb-2">Protegido con Contraseña</h2>
            
            {file && (
                <div className="mb-4">
                    <p className="text-lg font-medium break-all mb-2">{file.originalName}</p>
                    <div className="flex justify-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                            <HardDrive size={14} />
                            <span>{formatSize(file.size)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Calendar size={14} />
                            <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
            )}
            
            <p className="text-gray-500 mb-6">Este archivo está protegido con contraseña.</p>

            {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
                <input
                    type="password"
                    placeholder="Introduce la contraseña"
                    className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-center"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                />
                <button
                    type="submit"
                    className="w-full py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all transform hover:scale-[1.02]"
                >
                    Desbloquear y Descargar
                </button>
            </form>
        </div>
    );
};

export default PasswordForm;
