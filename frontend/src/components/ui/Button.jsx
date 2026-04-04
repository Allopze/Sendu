import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const Button = forwardRef(({ 
  children, 
  variant = 'primary', 
  className = '', 
  onClick, 
  icon: Icon, 
  disabled,
  loading,
  size = 'default',
  type = 'button',
  ...props
}, ref) => {
  const baseStyle = "relative overflow-hidden font-medium transition-all duration-200 active:scale-[0.97] rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const sizeStyles = {
    default: "px-6 py-4",
    sm: "px-4 py-2 text-sm",
    lg: "px-8 py-5 text-lg",
    icon: "p-2 aspect-square w-10 h-10"
  };

  const variants = {
    primary: "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20",
    secondary: "bg-transparent border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200",
    ghost: "bg-transparent hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400",
    danger: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-transparent",
    success: "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/20",
  };

  return (
    <button 
      ref={ref}
      type={type}
      onClick={onClick} 
      disabled={disabled || loading} 
      className={`${baseStyle} ${sizeStyles[size === 'icon' ? 'icon' : size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 16 : 20} className="animate-spin" />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 16 : 20} />
      ) : null}
      {children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
