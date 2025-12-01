import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';

const BrandingContext = createContext(null);

export const BrandingProvider = ({ children }) => {
    const [settings, setSettings] = useState({
        showName: 'true',
        logoLight: '',
        logoDark: '',
        favicon: '',
        footerText: ''
    });
    const [loading, setLoading] = useState(true);

    const fetchSettings = useCallback(async () => {
        try {
            const res = await apiClient.getPublicSettings();
            if (res.ok) {
                const data = await res.json();
                setSettings(data);
                
                // Update favicon dynamically
                if (data.favicon) {
                    const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
                    link.rel = 'icon';
                    link.href = data.favicon;
                    document.head.appendChild(link);
                }
            }
        } catch (err) {
            console.error('Error fetching branding settings:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    // Allow components to update settings locally (for immediate UI feedback)
    const updateSettings = useCallback((newSettings) => {
        setSettings(prev => ({ ...prev, ...newSettings }));
        
        // Update favicon if changed
        if (newSettings.favicon !== undefined) {
            const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
            link.rel = 'icon';
            link.href = newSettings.favicon || '/favicon.svg';
            document.head.appendChild(link);
        }
    }, []);

    return (
        <BrandingContext.Provider value={{ settings, loading, updateSettings, refreshSettings: fetchSettings }}>
            {children}
        </BrandingContext.Provider>
    );
};

export const useBranding = () => {
    const context = useContext(BrandingContext);
    if (!context) {
        throw new Error('useBranding must be used within a BrandingProvider');
    }
    return context;
};

export default BrandingContext;
