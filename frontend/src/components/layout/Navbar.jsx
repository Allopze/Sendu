import { Link, useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { useTheme } from '../../context/ThemeContext';
import { useBranding } from '../../context/BrandingContext';
import { Sun, Moon, LogOut, User } from 'lucide-react';

const Navbar = () => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme, isDark } = useTheme();
    const { settings } = useBranding();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    // Get the appropriate logo based on theme
    const currentLogo = isDark ? settings.logoDark : settings.logoLight;
    const hasLogo = currentLogo && currentLogo.length > 0;

    return (
        <nav className="glass sticky top-0 z-50 px-6 py-2 flex justify-between items-center">
            <Link to="/" className="flex items-center gap-3">
                {hasLogo && (
                    <img src={currentLogo} alt="Logo" className="h-12 w-auto object-contain" />
                )}
                {settings.showName === 'true' && (
                    <div className="text-2xl font-[Poppins] tracking-tight">
                        <span className="text-[#222222] dark:text-[#e0e0e0] font-normal">Send</span>
                        <span className="text-[#fd3f31] font-bold">u</span>
                    </div>
                )}
                {!hasLogo && settings.showName !== 'true' && (
                    <div className="text-2xl font-[Poppins] tracking-tight">
                        <span className="text-[#222222] dark:text-[#e0e0e0] font-normal">Send</span>
                        <span className="text-[#fd3f31] font-bold">u</span>
                    </div>
                )}
            </Link>

            <div className="flex items-center gap-4">
                <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                </button>

                {user ? (
                    <div className="flex items-center gap-4">
                        {user.role === 'admin' ? (
                            <Link to="/admin" className="flex items-center gap-2 font-medium hover:text-primary-600 transition-colors">
                                <User size={20} />
                                <span className="hidden sm:inline">{user.username}</span>
                                <span className="hidden sm:inline text-gray-400">|</span>
                                <span className="hidden sm:inline">Admin</span>
                            </Link>
                        ) : (
                            <Link to="/dashboard" className="flex items-center gap-2 font-medium hover:text-primary-600 transition-colors">
                                <User size={20} />
                                <span className="hidden sm:inline">{user.username}</span>
                                <span className="hidden sm:inline text-gray-400">|</span>
                                <span className="hidden sm:inline">Panel</span>
                            </Link>
                        )}
                        <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-red-500">
                            <LogOut size={20} />
                            <span className="hidden sm:inline">Salir</span>
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-4">
                        <Link to="/login" className="font-medium hover:text-primary-600 transition-colors">
                            Iniciar Sesión
                        </Link>
                        <Link to="/register" className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium">
                            Registrarse
                        </Link>
                    </div>
                )}
            </div>
        </nav>
    );
};

export default Navbar;
