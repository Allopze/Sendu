import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useAuth from '../hooks/useAuth';

const LoginPage = () => {
    const [formData, setFormData] = useState({ login: '', password: '' });
    const [error, setError] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        const res = await login(formData);
        if (res.success) {
            if (res.user.role === 'admin') {
                navigate('/admin');
            } else {
                navigate('/dashboard');
            }
        } else {
            setError(res.error || 'Error al iniciar sesión');
        }
    };

    return (
        <div className="max-w-md mx-auto mt-20">
            <div className="glass p-8 rounded-2xl">
                <h2 className="text-3xl font-bold mb-6 text-center">Bienvenido de nuevo</h2>
                {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Email o Usuario</label>
                        <input
                            type="text"
                            className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            value={formData.login}
                            onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Contraseña</label>
                        <input
                            type="password"
                            className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            required
                        />
                        <div className="flex justify-end mt-1">
                            <Link to="/forgot-password" className="text-xs text-primary-600 hover:underline">
                                ¿Olvidaste tu contraseña?
                            </Link>
                        </div>
                    </div>
                    <button type="submit" className="w-full py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 font-bold transition-all transform hover:scale-[1.02]">
                        Iniciar Sesión
                    </button>
                </form>
                <p className="mt-6 text-center text-sm text-gray-500">
                    ¿No tienes cuenta? <Link to="/register" className="text-primary-600 hover:underline">Regístrate</Link>
                </p>
            </div>
        </div>
    );
};

export default LoginPage;
