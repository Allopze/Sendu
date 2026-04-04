import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';
import useUploadLimits from '../hooks/useUploadLimits';
import { UserPlus } from 'lucide-react';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const isValidPassword = (value) => {
    return value.length >= 8 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
};

const RegisterPage = () => {
    const [formData, setFormData] = useState({ email: '', username: '', password: '' });
    const [loading, setLoading] = useState(false);
    const { register } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const { isDark } = useTheme();
    const { settings } = useBranding();
    const limits = useUploadLimits();
    const emailVerificationRequired = settings.requiresEmailVerification !== false;
    const registeredLimit = limits.maxFileSize || 100;

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!isValidPassword(formData.password)) {
            toast.error('La contrasena debe tener al menos 8 caracteres, incluyendo letras y numeros');
            return;
        }

        setLoading(true);
        
        const res = await register(formData);
        setLoading(false);
        
        if (res.success) {
            toast.success(res.message || 'Cuenta creada correctamente');
            navigate('/login');
        } else {
            if (res.error?.includes('already') || res.error?.includes('existe') || res.error?.includes('registered')) {
                toast.error('Este email o usuario ya está registrado');
            } else if (res.error?.includes('password') || res.error?.includes('contraseña')) {
                toast.error('La contrasena debe tener al menos 8 caracteres, incluyendo letras y numeros');
            } else if (res.error?.includes('email') || res.error?.includes('correo')) {
                toast.error('Ingresa un email válido');
            } else {
                toast.error(res.error || 'Error en el registro');
            }
        }
    };

    return (
        <div className="w-full animate-enter">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto flex items-center justify-center mb-4 text-red-600">
                    <UserPlus size={48} />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Crear Cuenta
                </h2>
                <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {emailVerificationRequired
                        ? `Crea una cuenta para subir hasta ${registeredLimit}MB por archivo y verificar tu email.`
                        : `Crea una cuenta para subir hasta ${registeredLimit}MB por archivo. En este entorno no se requiere verificación por email.`}
                </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 mb-6">
                <Input
                    label="Email"
                    type="email"
                    placeholder="usuario@ejemplo.com…"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    required
                    disabled={loading}
                />
                <Input
                    label="Usuario"
                    type="text"
                    placeholder="tunombre…"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    name="username"
                    autoComplete="username"
                    spellCheck={false}
                    required
                    disabled={loading}
                />
                <Input
                    label="Contraseña"
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    disabled={loading}
                />
                
                <Button 
                    type="submit" 
                    className="w-full"
                    loading={loading}
                >
                    {loading ? 'Creando cuenta…' : 'Registrarse'}
                </Button>
            </form>

            {/* Footer */}
            <div className="text-center">
                <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    ¿Ya tienes cuenta?{' '}
                </span>
                <Link 
                    to="/login" 
                    className={`text-sm font-medium ${isDark ? 'text-white hover:text-red-400' : 'text-zinc-900 hover:text-red-600'}`}
                >
                    Inicia Sesión
                </Link>
            </div>
        </div>
    );
};

export default RegisterPage;
