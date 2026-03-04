import { useTheme } from '../../context/ThemeContext';

const Toggle = ({ checked, onChange, disabled = false }) => {
  const { isDark } = useTheme();
  
  return (
    <button 
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`
        w-12 h-6 rounded-full p-1 transition-colors duration-300
        ${checked ? 'bg-red-600' : isDark ? 'bg-zinc-700' : 'bg-zinc-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <div className={`
        w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 
        ${checked ? 'translate-x-6' : 'translate-x-0'}
      `} />
    </button>
  );
};

export default Toggle;
