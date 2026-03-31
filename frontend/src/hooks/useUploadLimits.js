import { useEffect, useState } from 'react';
import apiClient from '../api/client';

const DEFAULT_LIMITS = {
    maxFileSize: 100,
    effectiveMaxFileSize: 100,
    guestMaxFileSize: 50,
    guestUploadLimit: 5120,
    isLoggedIn: false,
    guestRemaining: null
};

const useUploadLimits = () => {
    const [limits, setLimits] = useState(DEFAULT_LIMITS);

    useEffect(() => {
        let cancelled = false;

        const loadLimits = async () => {
            try {
                const res = await apiClient.getUploadLimits();
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) {
                    setLimits(prev => ({ ...prev, ...data }));
                }
            } catch {
                // Keep defaults on network errors
            }
        };

        loadLimits();
        return () => {
            cancelled = true;
        };
    }, []);

    return limits;
};

export default useUploadLimits;
