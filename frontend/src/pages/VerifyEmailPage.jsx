import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';

const VerifyEmailPage = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    
    const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'already' | 'error'
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setMessage('No se proporcionó token de verificación');
            return;
        }

        const verifyEmail = async () => {
            try {
                const res = await apiClient.verifyEmail(token);
                const data = await res.json();
                
                if (res.ok) {
                    if (data.alreadyVerified) {
                        setStatus('already');
                        setMessage('Tu email ya estaba verificado');
                    } else {
                        setStatus('success');
                        setMessage('¡Tu email ha sido verificado correctamente!');
                    }
                } else {
                    setStatus('error');
                    setMessage(data.error || 'Error al verificar email');
                }
            } catch (err) {
                console.error(err);
                setStatus('error');
                setMessage('Error de conexión al verificar email');
            }
        };

        verifyEmail();
    }, [token]);

    return (
        <div className="max-w-md mx-auto mt-20">
            <div className="glass p-8 rounded-2xl text-center">
                {status === 'verifying' && (
                    <>
                        <Loader2 size={64} className="mx-auto text-primary-600 animate-spin mb-4" />
                        <h2 className="text-2xl font-bold mb-2">Verificando email...</h2>
                        <p className="text-gray-500">Por favor espera mientras verificamos tu dirección de email.</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle size={48} className="text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2 text-green-600">¡Verificación Exitosa!</h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
                        <p className="text-sm text-gray-500 mb-6">Ya puedes acceder a todas las funciones de tu cuenta.</p>
                        <Link
                            to="/login"
                            className="inline-block px-6 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all"
                        >
                            Iniciar Sesión
                        </Link>
                    </>
                )}

                {status === 'already' && (
                    <>
                        <div className="w-20 h-20 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                            <Mail size={48} className="text-blue-600" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2 text-blue-600">Email Ya Verificado</h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
                        <Link
                            to="/login"
                            className="inline-block px-6 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all"
                        >
                            Iniciar Sesión
                        </Link>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div className="w-20 h-20 mx-auto bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                            <XCircle size={48} className="text-red-600" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2 text-red-600">Error de Verificación</h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
                        <p className="text-sm text-gray-500 mb-6">
                            El enlace puede haber expirado o ser inválido. Puedes solicitar un nuevo email de verificación desde tu cuenta.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <Link
                                to="/login"
                                className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition-all"
                            >
                                Iniciar Sesión
                            </Link>
                            <Link
                                to="/register"
                                className="px-6 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all"
                            >
                                Registrarse
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default VerifyEmailPage;
