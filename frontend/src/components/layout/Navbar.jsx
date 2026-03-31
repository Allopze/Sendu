import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { useTheme } from '../../context/ThemeContext';
import { useBranding } from '../../context/BrandingContext';
import { useToast } from '../../context/ToastContext';
import { Sun, Moon, LogOut, ChevronDown, FolderOpen, Shield } from 'lucide-react';

const Navbar = () => {
    const { user, logout } = useAuth();
    const { toggleTheme, isDark } = useTheme();
    const { settings } = useBranding();
    const navigate = useNavigate();
    const toast = useToast();
    const [isUserMenuOpen, setUserMenuOpen] = useState(false);

    const handleLogout = async () => {
        await logout();
        toast.success('Sesión cerrada correctamente');
        setUserMenuOpen(false);
        navigate('/login');
    };

    // Get the appropriate logo based on theme
    const currentLogo = isDark ? settings.logoDark : settings.logoLight;
    const hasLogo = currentLogo && currentLogo.length > 0;

    // Get user initials for avatar
    const getInitials = (name) => {
        if (!name) return 'U';
        return name.charAt(0).toUpperCase();
    };

    return (
        <nav className="sticky top-0 z-50 w-full p-4 md:p-6 flex justify-between items-center" aria-label="Principal">
            {/* Logo */}
            <Link
                to="/"
                className="flex items-center gap-3 cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
                aria-label="Ir a la página principal"
            >
                {hasLogo ? (
                    <img src={currentLogo} alt="Logo" className="h-10 w-auto object-contain" />
                ) : (
                    <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
                        <div className="w-4 h-4 bg-white rounded-sm opacity-90"></div>
                    </div>
                )}
            </Link>
            


            {/* Right Side */}
            <div className="flex gap-3 items-center">
                {/* Theme Toggle */}
                <button 
                    onClick={toggleTheme} 
                    className={`p-2 rounded-full transition-colors ${isDark ? 'hover:bg-white/10 text-zinc-400' : 'hover:bg-black/5 text-zinc-600'}`}
                    aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
                >
                    {isDark ? <Sun size={20} /> : <Moon size={20} />}
                </button>

                {user ? (
                    <div className="relative">
                        <button 
                            onClick={() => setUserMenuOpen(!isUserMenuOpen)} 
                            className={`flex items-center gap-2 p-1 pr-3 rounded-full border border-transparent transition-all ${
                                isDark 
                                    ? 'hover:border-zinc-700 bg-zinc-800/50' 
                                    : 'hover:border-zinc-300 bg-zinc-100'
                            }`}
                            aria-haspopup="menu"
                            aria-expanded={isUserMenuOpen}
                            aria-label={`Abrir menú de usuario de ${user.username}`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                                user.role === 'admin' ? 'bg-red-600' : 'bg-zinc-700'
                            }`}>
                                {getInitials(user.username)}
                            </div>
                            <span className={`text-sm font-medium hidden sm:block ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>
                                {user.username}
                            </span>
                            <ChevronDown size={14} className="text-zinc-500" />
                        </button>

                        {isUserMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                                <div className={`absolute right-0 mt-2 w-48 py-2 rounded-xl shadow-xl border animate-enter origin-top-right z-50 ${
                                    isDark ? 'bg-[#1a1a1a] border-zinc-800' : 'bg-white border-zinc-200'
                                }`} role="menu" aria-label="Menú de usuario">
                                    {/* Mis Archivos - for all logged in users */}
                                    <Link 
                                        to="/dashboard"
                                        onClick={() => setUserMenuOpen(false)}
                                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                                            isDark ? 'hover:bg-zinc-800 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-800'
                                        }`}
                                        role="menuitem"
                                    >
                                        <FolderOpen size={16} /> Mis Archivos
                                    </Link>
                                    
                                    {user.role === 'admin' && (
                                        <Link 
                                            to="/admin"
                                            onClick={() => setUserMenuOpen(false)}
                                            className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                                                isDark ? 'hover:bg-zinc-800 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-800'
                                            }`}
                                            role="menuitem"
                                        >
                                            <Shield size={16} /> Panel Admin
                                        </Link>
                                    )}
                                    
                                    <div className={`my-1 border-t ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`} />
                                    
                                    <button 
                                        onClick={handleLogout} 
                                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-red-500 ${
                                            isDark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'
                                        }`}
                                        role="menuitem"
                                    >
                                        <LogOut size={16} /> Cerrar Sesión
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        <Link
                            to="/login"
                            className={`text-sm font-medium hidden sm:block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 ${isDark ? 'text-zinc-300 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'}`}
                        >
                            Iniciar Sesión
                        </Link>
                        <Link
                            to="/register"
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
                        >
                            Registrarse
                        </Link>
                    </>
                )}
            </div>
        </nav>
    );
};

export default Navbar;
