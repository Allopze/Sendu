import { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Mail, ArrowLeft, Loader2, CheckCircle } from 'lucide-react';

const ForgotPasswordPage = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await apiClient.forgotPassword(email);
            const data = await res.json();
            
            if (res.ok) {
                setSent(true);
            } else {
                setError(data.error || 'Error al procesar la solicitud');
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <div className="max-w-md mx-auto mt-20">
                <div className="glass p-8 rounded-2xl text-center">
                    <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                        <CheckCircle size={48} className="text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">¡Revisa tu Email!</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        Si existe una cuenta con el email <strong>{email}</strong>, recibirás un enlace para restablecer tu contraseña.
                    </p>
                    <p className="text-sm text-gray-500 mb-6">
                        El enlace expirará en 1 hora. Revisa también tu carpeta de spam.
                    </p>
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 text-primary-600 hover:underline"
                    >
                        <ArrowLeft size={18} />
                        Volver al inicio de sesión
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
                        <Mail size={32} className="text-primary-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">¿Olvidaste tu contraseña?</h2>
                    <p className="text-gray-500">
                        Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
                    </p>
                </div>

                {error && (
                    <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <input
                            type="email"
                            className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="tu@email.com"
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
                                Enviando...
                            </>
                        ) : (
                            'Enviar Enlace de Recuperación'
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 text-primary-600 hover:underline text-sm"
                    >
                        <ArrowLeft size={16} />
                        Volver al inicio de sesión
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
