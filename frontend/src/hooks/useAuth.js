import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../api/client';

const useAuth = () => {
    const { user, setUser, loading, checkAuth } = useContext(AuthContext);

    const login = async (credentials) => {
        const res = await apiClient.login(credentials);
        if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            return { success: true, user: data.user };
        }
        const err = await res.json();
        return { success: false, error: err.error };
    };

    const logout = async () => {
        await apiClient.logout();
        setUser(null);
    };

    const register = async (data) => {
        const res = await apiClient.register(data);
        if (res.ok) {
            const payload = await res.json();
            return { success: true, ...payload };
        }
        const err = await res.json();
        return { success: false, error: err.error };
    };

    return {
        user,
        loading,
        login,
        logout,
        register,
        checkAuth,
        isAdmin: user?.role === 'admin'
    };
};

export default useAuth;
