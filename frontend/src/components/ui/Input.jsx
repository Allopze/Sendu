import { forwardRef } from 'react';
import { useTheme } from '../../context/ThemeContext';

const Input = forwardRef(({ 
  label, 
  type = "text", 
  placeholder, 
  error,
  className = '',
  ...props 
}, ref) => {
  const { isDark } = useTheme();
  
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
          {label}
        </label>
      )}
      <input 
        ref={ref}
        type={type} 
        placeholder={placeholder}
        className={`
          w-full p-3 rounded-xl outline-none border transition-all
          ${isDark 
            ? 'bg-zinc-800/50 border-zinc-700 text-zinc-200 focus:border-red-500 focus:bg-zinc-800 placeholder:text-zinc-600' 
            : 'bg-zinc-50 border-zinc-200 text-zinc-700 focus:border-red-500 focus:bg-white placeholder:text-zinc-400'
          }
          ${error ? 'border-red-500' : ''}
          ${className}
        `}
        {...props}
      />
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
