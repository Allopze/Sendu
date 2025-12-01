import { useState, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { Lock, Loader2, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';

const ResetPasswordPage = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    
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
            setError('Las contraseñas no coinciden');
            return;
        }

        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        setLoading(true);

        try {
            const res = await apiClient.resetPassword(token, password);
            const data = await res.json();
            
            if (res.ok && data.success) {
                setSuccess(true);
                setTimeout(() => navigate('/login'), 3000);
            } else {
                setError(data.error || 'Error al restablecer contraseña');
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    if (validating) {
        return (
            <div className="max-w-md mx-auto mt-20">
                <div className="glass p-8 rounded-2xl text-center">
                    <Loader2 size={48} className="mx-auto text-primary-600 animate-spin mb-4" />
                    <h2 className="text-xl font-bold">Validando enlace...</h2>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="max-w-md mx-auto mt-20">
                <div className="glass p-8 rounded-2xl text-center">
                    <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                        <CheckCircle size={48} className="text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-green-600">¡Contraseña Actualizada!</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        Tu contraseña ha sido restablecida correctamente.
                    </p>
                    <p className="text-sm text-gray-500 mb-6">
                        Serás redirigido al inicio de sesión en unos segundos...
                    </p>
                    <Link
                        to="/login"
                        className="inline-block px-6 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all"
                    >
                        Iniciar Sesión Ahora
                    </Link>
                </div>
            </div>
        );
    }

    if (!valid) {
        return (
            <div className="max-w-md mx-auto mt-20">
                <div className="glass p-8 rounded-2xl text-center">
                    <div className="w-20 h-20 mx-auto bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                        <XCircle size={48} className="text-red-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-red-600">Enlace Inválido</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
                    <p className="text-sm text-gray-500 mb-6">
                        El enlace de recuperación puede haber expirado o ya fue utilizado.
                    </p>
                    <Link
                        to="/forgot-password"
                        className="inline-block px-6 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all"
                    >
                        Solicitar Nuevo Enlace
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-md mx-auto mt-20">
            <div className="glass p-8 rounded-2xl">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 mx-auto bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mb-4">
                        <Lock size={32} className="text-primary-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Nueva Contraseña</h2>
                    <p className="text-gray-500">
                        Hola <strong>{username}</strong>, introduce tu nueva contraseña.
                    </p>
                </div>

                {error && (
                    <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Nueva Contraseña</label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="w-full px-4 py-2 pr-12 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Mínimo 6 caracteres"
                                required
                                minLength={6}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                            >
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Confirmar Contraseña</label>
                        <input
                            type={showPassword ? 'text' : 'password'}
                            className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Repite la contraseña"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                Actualizando...
                            </>
                        ) : (
                            'Restablecer Contraseña'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ResetPasswordPage;
