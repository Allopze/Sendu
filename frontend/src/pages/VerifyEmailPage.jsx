import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/ui/Button';

const VerifyEmailPage = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const toast = useToast();
    const { isDark } = useTheme();
    const hasVerified = useRef(false);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'already' | 'error'
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Prevent double execution in StrictMode or re-renders
        if (hasVerified.current || isProcessing) return;
        hasVerified.current = true;
        setIsProcessing(true);
        
        if (!token) {
            setStatus('error');
            setMessage('No se proporcion¢ token de verificaci¢n');
            toast.error('Token de verificaci¢n no v lido');
            setIsProcessing(false);
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
                        toast.info('Tu email ya estaba verificado');
                    } else {
                        setStatus('success');
                        setMessage('­Tu email ha sido verificado correctamente!');
                        toast.success('­Email verificado correctamente!');
                    }
                } else if (res.status === 429) {
                    // Rate limited - don't retry, just show error
                    setStatus('error');
                    setMessage('Demasiadas solicitudes. Por favor espera un momento e intenta de nuevo.');
                    toast.error('Demasiadas solicitudes');
                } else {
                    setStatus('error');
                    setMessage(data.error || 'Error al verificar email');
                    toast.error(data.error || 'Error al verificar email');
                }
            } catch (err) {
                console.error(err);
                setStatus('error');
                setMessage('Error de conexi¢n al verificar email');
                toast.error('Error de conexi¢n');
            } finally {
                setIsProcessing(false);
            }
        };

        verifyEmail();
    }, [token]);

    return (
        <div className="w-full animate-enter text-center">
            {status === 'verifying' && (
                <>
                    <Loader2 size={64} className="mx-auto text-red-600 animate-spin mb-4" />
                    <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                        Verificando email...
                    </h2>
                    <p className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>
                        Por favor espera mientras verificamos tu direcci¢n de email.
                    </p>
                </>
            )}

            {status === 'success' && (
                <>
                    <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-green-900/30' : 'bg-green-100'}`}>
                        <CheckCircle size={48} className="text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-green-600">­Verificaci¢n Exitosa!</h2>
                    <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{message}</p>
                    <p className={`text-sm mb-6 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                        Ya puedes acceder a todas las funciones de tu cuenta.
                    </p>
                    <Link to="/login">
                        <Button className="w-full">Iniciar Sesi¢n</Button>
                    </Link>
                </>
            )}

            {status === 'already' && (
                <>
                    <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-blue-900/30' : 'bg-blue-100'}`}>
                        <Mail size={48} className="text-blue-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-blue-600">Email Ya Verificado</h2>
                    <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{message}</p>
                    <Link to="/login">
                        <Button className="w-full">Iniciar Sesi¢n</Button>
                    </Link>
                </>
            )}

            {status === 'error' && (
                <>
                    <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-red-900/30' : 'bg-red-100'}`}>
                        <XCircle size={48} className="text-red-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-red-600">Error de Verificaci¢n</h2>
                    <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{message}</p>
                    <p className={`text-sm mb-6 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                        El enlace puede haber expirado o ser inv lido.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Link to="/login">
                            <Button variant="secondary" className="w-full">Iniciar Sesi¢n</Button>
                        </Link>
                        <Link to="/register">
                            <Button className="w-full">Registrarse</Button>
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
};

export default VerifyEmailPage;
