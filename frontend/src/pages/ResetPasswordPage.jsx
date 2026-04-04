import { useState, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { Lock, Loader2, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const isValidPassword = (value) => {
    return value.length >= 8 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
};

const ResetPasswordPage = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    const toast = useToast();
    const { isDark } = useTheme();
    
    const [validating, setValidating] = useState(true);
    const [valid, setValid] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!token) {
            setValidating(false);
            setError('No se proporcionó token de recuperación');
            return;
        }

        const validateToken = async () => {
            try {
                const res = await apiClient.validateResetToken(token);
                const data = await res.json();
                
                if (data.valid) {
                    setValid(true);
                    setUsername(data.username);
                } else {
                    setError(data.error || 'Token inválido o expirado');
                }
            } catch (err) {
                console.error(err);
                setError('Error al validar el token');
            } finally {
                setValidating(false);
            }
        };

        validateToken();
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            toast.error('Las contraseñas no coinciden');
            return;
        }

        if (!isValidPassword(password)) {
            toast.error('La contrasena debe tener al menos 8 caracteres, incluyendo letras y numeros');
            return;
        }

        setLoading(true);

        try {
            const res = await apiClient.resetPassword(token, password);
            const data = await res.json();
            
            if (res.ok && data.success) {
                setSuccess(true);
                toast.success('¡Contraseña actualizada correctamente!');
                setTimeout(() => navigate('/login'), 3000);
            } else {
                toast.error(data.error || 'Error al restablecer contraseña');
            }
        } catch (err) {
            console.error(err);
            toast.error('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    if (validating) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full text-center">
                <Loader2 size={48} className="text-red-600 animate-spin mb-4" />
                <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Validando enlace...
                </h2>
            </div>
        );
    }

    if (success) {
        return (
            <div className="w-full animate-enter text-center">
                <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-green-900/30' : 'bg-green-100'}`}>
                    <CheckCircle size={48} className="text-green-600" />
                </div>
                <h2 className="text-2xl font-bold mb-2 text-green-600">¡Contraseña Actualizada!</h2>
                <p className={`mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Tu contraseña ha sido restablecida correctamente.
                </p>
                <p className={`text-sm mb-6 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    Serás redirigido al inicio de sesión en unos segundos...
                </p>
                <Link to="/login">
                    <Button className="w-full">Iniciar Sesión Ahora</Button>
                </Link>
            </div>
        );
    }

    if (!valid) {
        return (
            <div className="w-full animate-enter text-center">
                <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-red-900/30' : 'bg-red-100'}`}>
                    <XCircle size={48} className="text-red-600" />
                </div>
                <h2 className="text-2xl font-bold mb-2 text-red-600">Enlace Inválido</h2>
                <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{error}</p>
                <p className={`text-sm mb-6 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    El enlace de recuperación puede haber expirado o ya fue utilizado.
                </p>
                <Link to="/forgot-password">
                    <Button className="w-full">Solicitar Nuevo Enlace</Button>
                </Link>
            </div>
        );
    }

    return (
        <div className="w-full animate-enter">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto flex items-center justify-center mb-4 text-red-600">
                    <Lock size={48} />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Nueva Contraseña
                </h2>
                <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    Hola <strong>{username}</strong>, introduce tu nueva contraseña.
                </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 mb-6">
                <div className="relative">
                    <Input
                        label="Nueva Contraseña"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Minimo 8 caracteres, letras y numeros"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className={`absolute right-3 top-8 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}
                    >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>
                <Input
                    label="Confirmar Contraseña"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Repite la contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                />
                
                <Button 
                    type="submit" 
                    className="w-full"
                    loading={loading}
                >
                    {loading ? 'Actualizando...' : 'Restablecer Contraseña'}
                </Button>
            </form>
        </div>
    );
};

export default ResetPasswordPage;
