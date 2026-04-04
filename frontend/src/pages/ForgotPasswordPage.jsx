import { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { useBranding } from '../context/BrandingContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const ForgotPasswordPage = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const toast = useToast();
    const { isDark } = useTheme();
    const { settings } = useBranding();
    const passwordResetEnabled = settings.passwordResetEnabled !== false;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!passwordResetEnabled) {
            toast.error('La recuperación por email no está disponible en este entorno');
            return;
        }
        setLoading(true);

        try {
            const res = await apiClient.forgotPassword(email);
            const data = await res.json();
            
            if (res.ok) {
                setSent(true);
                toast.success('Se ha enviado el enlace de recuperación');
            } else {
                toast.error(data.error || 'Error al procesar la solicitud');
            }
        } catch (err) {
            console.error(err);
            toast.error('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <div className="w-full animate-enter text-center">
                <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${
                    isDark ? 'bg-green-900/30' : 'bg-green-100'
                }`}>
                    <CheckCircle size={48} className="text-green-600" />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    ¡Revisa tu Email!
                </h2>
                <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Si existe una cuenta con el email <strong>{email}</strong>, recibirás un enlace para restablecer tu contraseña.
                </p>
                <p className={`text-sm mb-6 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    El enlace expirará en 1 hora. Revisa también tu carpeta de spam.
                </p>
                <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-red-500 hover:underline"
                >
                    <ArrowLeft size={18} />
                    Volver al inicio de sesión
                </Link>
            </div>
        );
    }

    if (!passwordResetEnabled) {
        return (
            <div className="w-full animate-enter text-center">
                <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${
                    isDark ? 'bg-amber-900/30' : 'bg-amber-100'
                }`}>
                    <Mail size={48} className="text-amber-600" />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Recuperación no disponible
                </h2>
                <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Este entorno no tiene SMTP configurado, así que no puede enviar enlaces de recuperación por email.
                </p>
                <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-red-500 hover:underline"
                >
                    <ArrowLeft size={18} />
                    Volver al inicio de sesión
                </Link>
            </div>
        );
    }

    return (
        <div className="w-full animate-enter">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto flex items-center justify-center mb-4 text-red-600">
                    <Mail size={48} />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    ¿Olvidaste tu contraseña?
                </h2>
                <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
                </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 mb-6">
                <Input
                    label="Email"
                    type="email"
                    placeholder="tu@email.com…"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    required
                />
                <Button 
                    type="submit" 
                    className="w-full"
                    loading={loading}
                >
                    {loading ? 'Enviando…' : 'Enviar Enlace de Recuperación'}
                </Button>
            </form>

            {/* Footer */}
            <div className="text-center">
                <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-red-500 hover:underline text-sm"
                >
                    <ArrowLeft size={16} />
                    Volver al inicio de sesión
                </Link>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
