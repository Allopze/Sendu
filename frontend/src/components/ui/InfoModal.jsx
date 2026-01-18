import { useEffect, useRef } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

/**
 * InfoModal - Modal informativo reutilizable
 * 
 * @param {boolean} isOpen - Si el modal está abierto
 * @param {function} onClose - Función para cerrar el modal
 * @param {string} title - Título del modal
 * @param {string|React.ReactNode} message - Mensaje o contenido del modal
 * @param {string} buttonText - Texto del botón (default: "Entendido")
 * @param {string} variant - Variante: "info" | "warning" | "error" (default: "info")
 * @param {React.ReactNode} icon - Icono personalizado (opcional)
 */
const InfoModal = ({ 
    isOpen, 
    onClose, 
    title = 'Información', 
    message,
    buttonText = 'Entendido',
    variant = 'info',
    icon: CustomIcon
}) => {
    const { isDark } = useTheme();
    const modalRef = useRef(null);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    // Focus trap
    useEffect(() => {
        if (isOpen && modalRef.current) {
            modalRef.current.focus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const variantStyles = {
        info: {
            icon: isDark ? 'text-blue-400 bg-blue-500/20' : 'text-blue-600 bg-blue-100',
            button: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
        },
        warning: {
            icon: isDark ? 'text-amber-400 bg-amber-500/20' : 'text-amber-600 bg-amber-100',
            button: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
        },
        error: {
            icon: isDark ? 'text-red-400 bg-red-500/20' : 'text-red-600 bg-red-100',
            button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
        }
    };

    const IconComponent = CustomIcon || (variant === 'info' ? Info : AlertCircle);

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-enter"
            onClick={onClose}
        >
            <div 
                ref={modalRef}
                tabIndex={-1}
                className={`rounded-3xl shadow-2xl max-w-md w-full p-6 transform transition-all ${
                    isDark ? 'bg-[#1a1a1a] border border-white/10' : 'bg-white border border-zinc-100'
                }`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${variantStyles[variant].icon}`}>
                        <IconComponent size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                            {title}
                        </h3>
                        <div className={`mt-2 text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            {typeof message === 'string' ? (
                                <p className="break-words">{message}</p>
                            ) : (
                                message
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-1 rounded-lg transition-colors ${
                            isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
                        }`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Action */}
                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onClose}
                        className={`px-6 py-2.5 text-sm font-medium text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${variantStyles[variant].button}`}
                    >
                        {buttonText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InfoModal;
