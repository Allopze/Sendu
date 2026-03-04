import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Tooltip({ children, text, position = 'top' }) {
    const [show, setShow] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef(null);

    useEffect(() => {
        if (show && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const tooltipOffset = 8;
            
            let top, left;
            
            switch (position) {
                case 'bottom':
                    top = rect.bottom + tooltipOffset;
                    left = rect.left + rect.width / 2;
                    break;
                case 'left':
                    top = rect.top + rect.height / 2;
                    left = rect.left - tooltipOffset;
                    break;
                case 'right':
                    top = rect.top + rect.height / 2;
                    left = rect.right + tooltipOffset;
                    break;
                case 'top':
                default:
                    top = rect.top - tooltipOffset;
                    left = rect.left + rect.width / 2;
                    break;
            }
            
            setCoords({ top, left });
        }
    }, [show, position]);

    const getTransformClasses = () => {
        switch (position) {
            case 'bottom':
                return '-translate-x-1/2';
            case 'left':
                return '-translate-x-full -translate-y-1/2';
            case 'right':
                return '-translate-y-1/2';
            case 'top':
            default:
                return '-translate-x-1/2 -translate-y-full';
        }
    };

    const arrowClasses = {
        top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900 dark:border-t-gray-700 border-x-transparent border-b-transparent',
        bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 dark:border-b-gray-700 border-x-transparent border-t-transparent',
        left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900 dark:border-l-gray-700 border-y-transparent border-r-transparent',
        right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900 dark:border-r-gray-700 border-y-transparent border-l-transparent'
    };

    return (
        <>
            <div 
                ref={triggerRef}
                className="inline-flex"
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
            >
                {children}
            </div>
            {show && createPortal(
                <div 
                    className={`fixed z-[200] pointer-events-none ${getTransformClasses()}`}
                    style={{ top: coords.top, left: coords.left }}
                >
                    <div className="relative">
                        <div className="px-2.5 py-1.5 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg whitespace-nowrap animate-fade-in">
                            {text}
                        </div>
                        <div className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`} />
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
