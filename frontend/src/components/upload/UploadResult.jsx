import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

const UploadResult = ({ fileId }) => {
    const [copied, setCopied] = useState(false);
    const shareUrl = `${window.location.origin}/share/${fileId}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="glass p-8 rounded-2xl text-center mt-6 animate-fade-in">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-full mb-4">
                <Check size={32} />
            </div>
            <h3 className="text-2xl font-bold mb-2">¡Subida Completada!</h3>
            <p className="text-gray-500 mb-6">Tu archivo está listo para compartir.</p>

            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 mb-6">
                <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="bg-transparent flex-grow px-2 outline-none text-sm text-gray-600 dark:text-gray-300"
                />
                <button
                    onClick={handleCopy}
                    className="p-2 bg-white dark:bg-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                    {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                </button>
            </div>

            <div className="flex justify-center gap-4">
                <Link
                    to={`/share/${fileId}`}
                    className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors"
                >
                    <ExternalLink size={18} />
                    Ver Archivo
                </Link>
                <button
                    onClick={() => window.location.reload()}
                    className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                    Subir Otro
                </button>
            </div>
        </div>
    );
};

export default UploadResult;
