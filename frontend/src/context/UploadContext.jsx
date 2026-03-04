/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import apiClient, { UPLOAD_API_BASE } from '../api/client';

const UploadContext = createContext(null);

// Storage key para resume de uploads
const UPLOAD_STATE_PREFIX = 'sendu_upload_';

// Cache de límites para evitar llamadas repetidas
let limitsCache = null;
let limitsCacheTime = 0;
const LIMITS_CACHE_TTL = 60000; // 1 minuto

// Helper para obtener/guardar estado de upload en localStorage
const getUploadState = (uploadId) => {
    try {
        const data = localStorage.getItem(`${UPLOAD_STATE_PREFIX}${uploadId}`);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
};

const saveUploadState = (uploadId, state) => {
    try {
        localStorage.setItem(`${UPLOAD_STATE_PREFIX}${uploadId}`, JSON.stringify(state));
    } catch {
        // localStorage might be full or disabled
    }
};

const clearUploadState = (uploadId) => {
    try {
        localStorage.removeItem(`${UPLOAD_STATE_PREFIX}${uploadId}`);
    } catch {
        // Ignore
    }
};

// Limpiar estados de upload antiguos (más de 24 horas)
const cleanupOldUploadStates = () => {
    try {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key?.startsWith(UPLOAD_STATE_PREFIX)) {
                const state = JSON.parse(localStorage.getItem(key) || '{}');
                if (state.timestamp && now - state.timestamp > maxAge) {
                    localStorage.removeItem(key);
                }
            }
        }
    } catch {
        // Ignore
    }
};

// Obtener límites con caché (sincrónico si hay caché)
const getCachedLimits = () => {
    const now = Date.now();
    if (limitsCache && (now - limitsCacheTime) < LIMITS_CACHE_TTL) {
        return limitsCache;
    }
    return null;
};

// Precargar límites en background
const preloadLimits = async () => {
    try {
        const res = await apiClient.getUploadLimits();
        if (res.ok) {
            limitsCache = await res.json();
            limitsCacheTime = Date.now();
        }
    } catch {
        // Ignore
    }
};

// Obtener límites; si no hay caché, forzar una carga rápida
const loadLimits = async () => {
    const cached = getCachedLimits();
    if (cached) return cached;
    await preloadLimits();
    return getCachedLimits() || DEFAULT_LIMITS;
};

// Info de red del navegador (si está disponible)
const getConnectionInfo = () => {
    if (typeof navigator === 'undefined') return {};
    const nav = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!nav) return {};
    return {
        downlink: typeof nav.downlink === 'number' ? nav.downlink : null,
        effectiveType: nav.effectiveType || null,
        rtt: typeof nav.rtt === 'number' ? nav.rtt : null
    };
};

// Elegir chunk size considerando tamaño de archivo, límites y conexión
const calculateChunkSizeMB = (fileSizeMB, limits, connectionInfo = {}) => {
    const smallThreshold = parseInt(limits.smallFileThreshold) || 100;
    const mediumThreshold = parseInt(limits.mediumFileThreshold) || 1024;
    const smallChunk = parseInt(limits.smallFileChunkSize) || 16;
    const mediumChunk = parseInt(limits.mediumFileChunkSize) || 48;
    const largeChunk = parseInt(limits.largeFileChunkSize) || 96;
    const maxAllowed = Math.min(MAX_CHUNK_MB, parseInt(limits.maxChunkSize) || MAX_CHUNK_MB);
    
    let chunkSizeMB;
    if (limits.adaptiveChunkSizing !== 'false' && limits.adaptiveChunkSizing !== false) {
        if (fileSizeMB < smallThreshold) {
            chunkSizeMB = smallChunk;
        } else if (fileSizeMB < mediumThreshold) {
            chunkSizeMB = mediumChunk;
        } else {
            chunkSizeMB = largeChunk;
        }
    } else {
        chunkSizeMB = parseInt(limits.chunkSize) || mediumChunk;
    }

    // Ajuste según calidad de conexión
    const { downlink, effectiveType } = connectionInfo;
    if (downlink) {
        if (downlink >= 80) {
            chunkSizeMB = Math.max(chunkSizeMB, Math.min(96, maxAllowed));
        } else if (downlink >= 30) {
            chunkSizeMB = Math.max(chunkSizeMB, Math.min(64, maxAllowed));
        } else if (downlink >= 10) {
            chunkSizeMB = Math.max(chunkSizeMB, Math.min(48, maxAllowed));
        } else if (downlink < 5) {
            chunkSizeMB = Math.min(chunkSizeMB, 24);
        }
    }
    if (effectiveType) {
        if (effectiveType.includes('2g')) {
            chunkSizeMB = Math.min(chunkSizeMB, 8);
        } else if (effectiveType.includes('3g')) {
            chunkSizeMB = Math.min(chunkSizeMB, 16);
        }
    }

    return Math.max(4, Math.min(Math.round(chunkSizeMB), maxAllowed));
};

// Concurrencia adaptativa según conexión
const calculateConcurrency = (limits, connectionInfo = {}) => {
    let concurrency = parseInt(limits.maxConcurrentUploads) || 6;
    const { downlink, effectiveType } = connectionInfo;
    
    if (downlink) {
        if (downlink >= 80) {
            concurrency = Math.max(concurrency, 8);
        } else if (downlink >= 30) {
            concurrency = Math.max(concurrency, 7);
        } else if (downlink < 5) {
            concurrency = Math.min(concurrency, 3);
        }
    }
    if (effectiveType) {
        if (effectiveType.includes('2g')) {
            concurrency = 1;
        } else if (effectiveType.includes('3g')) {
            concurrency = Math.min(concurrency, 2);
        }
    }

    return Math.max(1, Math.min(concurrency, 10));
};

// Timeout dinámico en función del tamaño del chunk
const getChunkTimeoutMs = (chunkSizeMB) => {
    const perMbBudgetMs = 4000;
    const dynamicTimeout = chunkSizeMB * perMbBudgetMs;
    const MAX_TIMEOUT_MS = 5 * 60 * 1000;
    return Math.min(MAX_TIMEOUT_MS, Math.max(CHUNK_TIMEOUT_BASE_MS, dynamicTimeout));
};

// Valores por defecto (sincronizados con backend)
const DEFAULT_LIMITS = {
    effectiveMaxFileSize: 100,
    chunkSize: 20,
    maxConcurrentUploads: 6,
    adaptiveChunkSizing: true,
    smallFileThreshold: 100,
    mediumFileThreshold: 1024,
    smallFileChunkSize: 16,
    mediumFileChunkSize: 48,
    largeFileChunkSize: 96
};

// Throttle para actualizaciones de progreso
const PROGRESS_THROTTLE_MS = 16;
const MAX_CHUNK_MB = 128;
const CHUNK_TIMEOUT_BASE_MS = 120000;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 1000;

export const UploadProvider = ({ children }) => {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('idle'); // idle | uploading | complete | error
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [uploadSpeed, setUploadSpeed] = useState(0);
    const [eta, setEta] = useState(null);
    const [currentFile, setCurrentFile] = useState(null);
    const [uploadOriginPath, setUploadOriginPath] = useState('/');
    
    const abortControllerRef = useRef(null);
    const uploadIdRef = useRef(null);
    const speedSamplesRef = useRef([]);
    const lastProgressUpdateRef = useRef({ time: Date.now(), bytes: 0 });
    const lastProgressSetRef = useRef(0);

    // Inicializar y precargar límites
    useEffect(() => {
        cleanupOldUploadStates();
        preloadLimits();
    }, []);

    // Clean up on page unload/refresh
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (uploadIdRef.current && status === 'uploading') {
                // Mostrar confirmación antes de cerrar
                e.preventDefault();
                e.returnValue = 'Tienes una subida en progreso. ¿Seguro que quieres salir?';
                return e.returnValue;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [status]);

    // Calcular velocidad de subida y ETA
    const updateSpeedAndEta = useCallback((bytesUploaded, totalBytes) => {
        if (bytesUploaded < totalBytes * 0.0005) {
            return;
        }
        
        const now = Date.now();
        const elapsed = now - lastProgressUpdateRef.current.time;
        const bytesDiff = bytesUploaded - lastProgressUpdateRef.current.bytes;
        
        if (elapsed >= 150 && bytesDiff > 0) {
            const currentSpeed = (bytesDiff / elapsed) * 1000;
            
            if (currentSpeed < 1024 || currentSpeed > 10 * 1024 * 1024 * 1024) {
                lastProgressUpdateRef.current = { time: now, bytes: bytesUploaded };
                return;
            }
            
            speedSamplesRef.current.push(currentSpeed);
            
            if (speedSamplesRef.current.length > 20) {
                speedSamplesRef.current.shift();
            }
            
            let weightedSum = 0;
            let weightTotal = 0;
            speedSamplesRef.current.forEach((speed, index) => {
                const weight = index + 1;
                weightedSum += speed * weight;
                weightTotal += weight;
            });
            const avgSpeed = weightedSum / weightTotal;
            
            setUploadSpeed(avgSpeed);
            
            const remaining = totalBytes - bytesUploaded;
            if (avgSpeed > 0) {
                setEta(Math.ceil(remaining / avgSpeed));
            }
            
            lastProgressUpdateRef.current = { time: now, bytes: bytesUploaded };
        }
    }, []);

    // Actualizar progreso con throttling
    const updateProgress = useCallback((newProgress) => {
        const normalized = Math.max(0, Math.min(100, newProgress));
        const clamped = normalized > 0 && normalized < 1 ? 1 : normalized;
        const now = Date.now();
        if (clamped === 100 || now - lastProgressSetRef.current >= PROGRESS_THROTTLE_MS) {
            setProgress(clamped);
            lastProgressSetRef.current = now;
        }
    }, []);

    const cancelUpload = useCallback(async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        if (uploadIdRef.current) {
            try {
                await apiClient.cancelUpload(uploadIdRef.current);
                clearUploadState(uploadIdRef.current);
            } catch {
                // Ignore errors during cleanup
            }
            uploadIdRef.current = null;
        }
        setStatus('idle');
        setProgress(0);
        setError(null);
        setResult(null);
        setUploadSpeed(0);
        setEta(null);
        setCurrentFile(null);
        speedSamplesRef.current = [];
    }, []);

    const resetUpload = useCallback(() => {
        setStatus('idle');
        setProgress(0);
        setError(null);
        setResult(null);
        setUploadSpeed(0);
        setEta(null);
        setCurrentFile(null);
        speedSamplesRef.current = [];
    }, []);

    // Upload de chunk individual con progreso granular usando XMLHttpRequest
    const uploadChunkWithProgress = useCallback((uploadId, chunkIndex, chunk, chunkTimeoutMs, signal, onProgress) => {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.timeout = chunkTimeoutMs;
            
            const abortHandler = () => {
                xhr.abort();
                reject(new Error('Subida cancelada'));
            };
            signal?.addEventListener('abort', abortHandler);

            xhr.upload.onloadstart = () => {
                if (onProgress) {
                    onProgress(0, chunk.size || 0);
                }
            };
            
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(e.loaded, e.total);
                }
            };
            
            xhr.onload = () => {
                signal?.removeEventListener('abort', abortHandler);
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({ ok: true });
                } else {
                    reject(new Error(`Error al subir fragmento ${chunkIndex}: HTTP ${xhr.status}`));
                }
            };
            
            xhr.onerror = () => {
                signal?.removeEventListener('abort', abortHandler);
                reject(new Error(`Error de red al subir fragmento ${chunkIndex}`));
            };
            
            xhr.ontimeout = () => {
                signal?.removeEventListener('abort', abortHandler);
                reject(new Error(`Timeout al subir fragmento ${chunkIndex}`));
            };
            
            const formData = new FormData();
            formData.append('chunk', chunk);
            
            xhr.open('POST', `${UPLOAD_API_BASE}/upload/chunk?uploadId=${uploadId}&index=${chunkIndex}`);
            xhr.withCredentials = true;
            xhr.send(formData);
        });
    }, []);

    // Sanitize error messages
    const sanitizeErrorMessage = (message) => {
        if (!message) return 'Error desconocido';
        
        if (message.includes('ENOENT') || message.includes('no such file')) {
            return 'Sesión de subida expirada o cancelada';
        }
        if (message.includes('EACCES') || message.includes('permission denied')) {
            return 'Error de permisos en el servidor';
        }
        if (message.includes('ENOSPC') || message.includes('no space')) {
            return 'Sin espacio en el servidor';
        }
        if (message.match(/[A-Z]:\\|\\uploads\\|\/uploads\//i)) {
            return 'Error interno del servidor';
        }
        
        return message;
    };

    // Wrapper con reintentos automáticos
    const uploadChunkWithRetry = useCallback(async (uploadId, chunkIndex, chunk, chunkTimeoutMs, signal, onProgress) => {
        let lastError;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (signal?.aborted) {
                    throw new Error('Subida cancelada');
                }
                
                return await uploadChunkWithProgress(uploadId, chunkIndex, chunk, chunkTimeoutMs, signal, onProgress);
            } catch (error) {
                lastError = error;
                
                if (error.message === 'Subida cancelada') {
                    throw error;
                }
                
                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
                    console.warn(`Chunk ${chunkIndex} falló (intento ${attempt}/${MAX_RETRIES}), reintentando en ${delay}ms...`, error.message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        const userMessage = sanitizeErrorMessage(lastError?.message);
        throw new Error(`Error al subir fragmento ${chunkIndex + 1}: ${userMessage}`);
    }, [uploadChunkWithProgress]);

    const uploadFile = useCallback(async (file, options = {}, originPath = '/') => {
        setStatus('uploading');
        setProgress(0);
        setError(null);
        setUploadSpeed(0);
        setEta(null);
        setCurrentFile(file);
        setUploadOriginPath(originPath);
        speedSamplesRef.current = [];
        lastProgressUpdateRef.current = { time: Date.now(), bytes: 0 };
        lastProgressSetRef.current = 0;
        abortControllerRef.current = new AbortController();

        try {
            const limits = await loadLimits();
            const connectionInfo = getConnectionInfo();
            
            const fileSizeMB = file.size / (1024 * 1024);
            const chunkSizeMB = calculateChunkSizeMB(fileSizeMB, limits, connectionInfo);
            const chunkTimeoutMs = getChunkTimeoutMs(chunkSizeMB);
            const chunkSize = chunkSizeMB * 1024 * 1024;
            const maxConcurrentUploads = calculateConcurrency(limits, connectionInfo);
            const maxFileSizeLimit = limits.effectiveMaxFileSize || limits.maxFileSize || DEFAULT_LIMITS.effectiveMaxFileSize;
            const maxFileSizeBytes = maxFileSizeLimit * 1024 * 1024;
            
            if (file.size > maxFileSizeBytes) {
                const message = limits.isLoggedIn 
                    ? `El archivo excede el límite de ${maxFileSizeLimit}MB`
                    : `El archivo excede el límite de ${maxFileSizeLimit}MB para invitados. Inicia sesión para subir archivos más grandes.`;
                throw new Error(message);
            }

            const totalChunks = Math.ceil(file.size / chunkSize);

            const initRes = await apiClient.initUpload({
                originalName: file.name,
                size: file.size,
                mimeType: file.type,
                totalChunks,
                ...options
            });

            if (!initRes.ok) {
                const errData = await initRes.json();
                throw new Error(errData.error || 'Error al iniciar la subida');
            }
            const { uploadId } = await initRes.json();
            uploadIdRef.current = uploadId;
            
            saveUploadState(uploadId, {
                fileName: file.name,
                fileSize: file.size,
                totalChunks,
                completedChunks: [],
                timestamp: Date.now()
            });

            const completedChunks = new Set();
            let completedBytes = 0;
            const inProgressBytes = new Map();

            const uploadChunk = async (chunkIndex) => {
                if (abortControllerRef.current?.signal.aborted) {
                    throw new Error('Subida cancelada');
                }
                
                if (completedChunks.has(chunkIndex)) {
                    return;
                }
                
                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                const chunkBytes = end - start;

                await uploadChunkWithRetry(
                    uploadId, 
                    chunkIndex, 
                    chunk, 
                    chunkTimeoutMs,
                    abortControllerRef.current?.signal,
                    (loaded) => {
                        inProgressBytes.set(chunkIndex, loaded);
                        
                        let currentBytesUploaded = completedBytes;
                        for (const bytes of inProgressBytes.values()) {
                            currentBytesUploaded += bytes;
                        }
                        currentBytesUploaded = Math.min(currentBytesUploaded, file.size);
                        
                        updateSpeedAndEta(currentBytesUploaded, file.size);
                        
                        const newProgress = Math.round((currentBytesUploaded / file.size) * 100);
                        updateProgress(newProgress);
                    }
                );
                
                completedChunks.add(chunkIndex);
                completedBytes += chunkBytes;
                inProgressBytes.delete(chunkIndex);
                
                const uploadState = getUploadState(uploadId);
                if (uploadState) {
                    uploadState.completedChunks = Array.from(completedChunks);
                    uploadState.timestamp = Date.now();
                    saveUploadState(uploadId, uploadState);
                }
            };

            const runWithConcurrency = async (items, fn, limit) => {
                const results = [];
                const executing = new Set();
                
                for (const item of items) {
                    const promise = fn(item).then(() => {
                        executing.delete(promise);
                    });
                    executing.add(promise);
                    results.push(promise);
                    
                    if (executing.size >= limit) {
                        await Promise.race(executing);
                    }
                }
                
                return Promise.all(results);
            };

            const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
            await runWithConcurrency(chunkIndices, uploadChunk, maxConcurrentUploads);

            const completeRes = await apiClient.completeUpload(uploadId);
            if (!completeRes.ok) {
                const errData = await completeRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Error al completar la subida');
            }

            clearUploadState(uploadId);

            const data = await completeRes.json();
            setResult(data);
            setStatus('complete');
            setProgress(100);
            abortControllerRef.current = null;
            uploadIdRef.current = null;
            return data;

        } catch (err) {
            console.error(err);
            if (err.message === 'Subida cancelada' || abortControllerRef.current?.signal?.aborted) {
                return;
            }
            const userMessage = sanitizeErrorMessage(err.message);
            setError(userMessage);
            setStatus('error');
            abortControllerRef.current = null;
        }
    }, [uploadChunkWithRetry, updateSpeedAndEta, updateProgress]);

    // Verificar si hay una subida activa
    const isUploading = status === 'uploading';

    return (
        <UploadContext.Provider value={{
            // Estado
            progress,
            status,
            error,
            result,
            uploadSpeed,
            eta,
            currentFile,
            uploadOriginPath,
            isUploading,
            // Acciones
            uploadFile,
            cancelUpload,
            resetUpload
        }}>
            {children}
        </UploadContext.Provider>
    );
};

export const useUploadContext = () => {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error('useUploadContext must be used within an UploadProvider');
    }
    return context;
};

export default UploadContext;
