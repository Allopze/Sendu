import { forwardRef, useId } from 'react';
import { useTheme } from '../../context/ThemeContext';

const Input = forwardRef(({ 
  label, 
  type = "text", 
  placeholder, 
  error,
  id,
  className = '',
  ...props 
}, ref) => {
  const { isDark } = useTheme();
  const generatedId = useId();
  const inputId = id || generatedId;
  
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label
          htmlFor={inputId}
          className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}
        >
          {label}
        </label>
      )}
      <input 
        ref={ref}
        id={inputId}
        type={type} 
        placeholder={placeholder}
        className={`
          w-full p-3 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60
          ${isDark 
            ? 'bg-zinc-800/50 border-zinc-700 text-zinc-200 focus-visible:border-red-500 focus-visible:bg-zinc-800 placeholder:text-zinc-600' 
            : 'bg-zinc-50 border-zinc-200 text-zinc-700 focus-visible:border-red-500 focus-visible:bg-white placeholder:text-zinc-400'
          }
          ${error ? 'border-red-500' : ''}
          ${className}
        `}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
