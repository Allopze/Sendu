import { useState } from 'react';
import { Check, Copy, ExternalLink, Plus, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

const UploadResult = ({ fileId }) => {
    const [copied, setCopied] = useState(false);
    const { user } = useAuth();
    const shareUrl = `${window.location.origin}/share/${fileId}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-3xl shadow-2xl overflow-hidden transition-all duration-300 animate-fade-in">
            <div className="p-10 flex flex-col items-center justify-center text-center">
                {/* Icono de éxito */}
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg shadow-green-500/30">
                    <Check size={48} strokeWidth={2.5} />
                </div>
                
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">¡Subida Completada!</h3>
                <p className="text-gray-500 dark:text-gray-400 mb-8">Tu archivo está listo para compartir</p>

                {/* Input con enlace */}
                <div className="w-full max-w-lg flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 mb-8">
                    <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        className="bg-transparent flex-grow px-3 py-2 outline-none text-sm text-gray-600 dark:text-gray-300 font-medium"
                    />
                    <button
                        onClick={handleCopy}
                        className={`px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
                            copied 
                                ? 'bg-green-500 text-white' 
                                : 'bg-primary-600 hover:bg-primary-700 text-white'
                        }`}
                    >
                        {copied ? (
                            <>
                                <Check size={18} />
                                ¡Copiado!
                            </>
                        ) : (
                            <>
                                <Copy size={18} />
                                Copiar
                            </>
                        )}
                    </button>
                </div>

                {/* Botones de acción */}
                <div className="flex flex-wrap justify-center gap-4">
                    <Link
                        to={`/share/${fileId}`}
                        className="flex items-center gap-2 px-6 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                    >
                        <ExternalLink size={18} />
                        Ver archivo
                    </Link>
                    <button
                        onClick={() => window.location.reload()}
                        className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors font-medium"
                    >
                        <Plus size={18} />
                        Crear otro envío
                    </button>
                    {user && (
                        <Link
                            to="/dashboard"
                            className="flex items-center gap-2 px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
                        >
                            <FolderOpen size={18} />
                            Ver mis envíos
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UploadResult;
