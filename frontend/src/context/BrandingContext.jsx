import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';

const BrandingContext = createContext(null);

const BRANDING_STORAGE_KEY = 'sendu_branding';

// Obtener branding guardado en localStorage para evitar flash
const getSavedBranding = () => {
    try {
        const saved = localStorage.getItem(BRANDING_STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch {
        // Ignore errors
    }
    return null;
};

// Guardar branding en localStorage
const saveBranding = (settings) => {
    try {
        localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Ignore errors
    }
};

const defaultSettings = {
    logoLight: '',
    logoDark: '',
    favicon: '',
    dropzoneIcon: '',
    footerText: ''
};

export const BrandingProvider = ({ children }) => {
    // Usar branding guardado como estado inicial para evitar flash
    const savedBranding = getSavedBranding();
    const [settings, setSettings] = useState(savedBranding || defaultSettings);
    const [loading, setLoading] = useState(!savedBranding); // No loading si hay datos guardados

    const fetchSettings = useCallback(async () => {
        try {
            const res = await apiClient.getPublicSettings();
            if (res.ok) {
                const data = await res.json();
                setSettings(data);
                saveBranding(data); // Guardar para la próxima vez
                
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
        setSettings(prev => {
            const updated = { ...prev, ...newSettings };
            saveBranding(updated); // También guardar actualizaciones locales
            return updated;
        });
        
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
