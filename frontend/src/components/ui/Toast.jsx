import { useEffect } from 'react';
import { CheckCircle, XCircle, X, AlertCircle, Info } from 'lucide-react';

const Toast = ({ message, type = 'success', onClose, duration = 4000 }) => {
    useEffect(() => {
        if (duration) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [onClose, duration]);

    const getStyles = () => {
        switch (type) {
            case 'success':
                return 'border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400';
            case 'error':
                return 'border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400';
            case 'warning':
                return 'border-yellow-200 dark:border-yellow-900/50 text-yellow-700 dark:text-yellow-400';
            case 'info':
                return 'border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-400';
            default:
                return 'border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400';
        }
    };

    const getIcon = () => {
        switch (type) {
            case 'success':
                return <CheckCircle size={22} className="flex-shrink-0" />;
            case 'error':
                return <XCircle size={22} className="flex-shrink-0" />;
            case 'warning':
                return <AlertCircle size={22} className="flex-shrink-0" />;
            case 'info':
                return <Info size={22} className="flex-shrink-0" />;
            default:
                return <CheckCircle size={22} className="flex-shrink-0" />;
        }
    };

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div
                className={`flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border backdrop-blur-md bg-white/90 dark:bg-gray-800/90 min-w-[280px] max-w-md ${getStyles()}`}
                role={type === 'error' ? 'alert' : 'status'}
            >
                {getIcon()}
                <p className="font-medium text-sm flex-1">{message}</p>
                <button
                    onClick={onClose}
                    className="flex-shrink-0 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    aria-label="Cerrar notificación"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};

export default Toast;
