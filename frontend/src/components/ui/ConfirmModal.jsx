import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

/**
 * ConfirmModal - Modal de confirmación reutilizable
 * 
 * @param {boolean} isOpen - Si el modal está abierto
 * @param {function} onClose - Función para cerrar el modal
 * @param {function} onConfirm - Función al confirmar
 * @param {string} title - Título del modal
 * @param {string} message - Mensaje de confirmación
 * @param {string} confirmText - Texto del botón de confirmar (default: "Confirmar")
 * @param {string} cancelText - Texto del botón de cancelar (default: "Cancelar")
 * @param {string} variant - Variante del botón: "danger" | "warning" | "primary" (default: "danger")
 */
const ConfirmModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = '¿Estás seguro?', 
    message = 'Esta acción no se puede deshacer.',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger'
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
        danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
        warning: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
        primary: 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    };

    const iconColors = {
        danger: isDark ? 'text-red-400 bg-red-500/20' : 'text-red-600 bg-red-100',
        warning: isDark ? 'text-amber-400 bg-amber-500/20' : 'text-amber-600 bg-amber-100',
        primary: isDark ? 'text-red-400 bg-red-500/20' : 'text-red-600 bg-red-100'
    };

    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

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
                    <div className={`p-3 rounded-full ${iconColors[variant]}`}>
                        <AlertTriangle size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                            {title}
                        </h3>
                        <p className={`mt-2 text-sm break-words overflow-hidden ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            {message}
                        </p>
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

                {/* Actions */}
                <div className="mt-6 flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
                            isDark ? 'text-zinc-300 bg-zinc-800 hover:bg-zinc-700' : 'text-zinc-700 bg-zinc-100 hover:bg-zinc-200'
                        }`}
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${variantStyles[variant]}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
