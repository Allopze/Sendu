import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';
import { User } from 'lucide-react';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const LoginPage = () => {
    const [formData, setFormData] = useState({ login: '', password: '' });
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const { isDark } = useTheme();
    const { settings } = useBranding();
    const passwordResetEnabled = settings.passwordResetEnabled !== false;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        
        const res = await login(formData);
        setLoading(false);
        
        if (res.success) {
            toast.success(`¡Bienvenido, ${res.user.username}!`);
            if (res.user.role === 'admin') {
                navigate('/admin');
            } else {
                navigate('/dashboard');
            }
        } else {
            if (res.error?.includes('not found') || res.error?.includes('no encontrado') || res.error?.includes('Invalid')) {
                toast.error('Usuario o contraseña incorrectos');
            } else if (res.error?.includes('verified') || res.error?.includes('verificar')) {
                toast.warning('Debes verificar tu email antes de iniciar sesión');
            } else {
                toast.error(res.error || 'Error al iniciar sesión');
            }
        }
    };

    return (
        <div className="w-full animate-enter">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto flex items-center justify-center mb-4 text-red-600">
                    <User size={48} />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Bienvenido
                </h2>
                <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    Ingresa para gestionar tus archivos.
                </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 mb-6">
                <Input
                    label="Email o Usuario"
                    type="text"
                    placeholder="usuario@ejemplo.com…"
                    value={formData.login}
                    onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                    name="login"
                    autoComplete="username"
                    spellCheck={false}
                    required
                    disabled={loading}
                />
                <div>
                    <Input
                        label="Contraseña"
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                        disabled={loading}
                    />
                    <div className="flex justify-end mt-1">
                        {passwordResetEnabled ? (
                            <Link to="/forgot-password" className="text-xs text-red-500 hover:underline">
                                ¿Olvidaste tu contraseña?
                            </Link>
                        ) : (
                            <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                Recuperación por email no disponible
                            </span>
                        )}
                    </div>
                </div>
                
                <Button 
                    type="submit" 
                    className="w-full"
                    loading={loading}
                >
                    {loading ? 'Iniciando sesión…' : 'Iniciar Sesión'}
                </Button>
            </form>

            {/* Footer */}
            <div className="text-center">
                <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    ¿No tienes cuenta?{' '}
                </span>
                <Link 
                    to="/register" 
                    className={`text-sm font-medium ${isDark ? 'text-white hover:text-red-400' : 'text-zinc-900 hover:text-red-600'}`}
                >
                    Regístrate
                </Link>
            </div>
        </div>
    );
};

export default LoginPage;
