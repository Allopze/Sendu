import { useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

const Toast = ({ message, type = 'success', onClose, duration = 3000 }) => {
    useEffect(() => {
        if (duration) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [onClose, duration]);

    return (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-in">
            <div className={`flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border backdrop-blur-md ${type === 'success'
                    ? 'bg-white/90 dark:bg-gray-800/90 border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400'
                    : 'bg-white/90 dark:bg-gray-800/90 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400'
                }`}>
                {type === 'success' ? <CheckCircle size={24} /> : <XCircle size={24} />}
                <p className="font-bold">{message}</p>
                <button onClick={onClose} className="ml-4 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};

export default Toast;
