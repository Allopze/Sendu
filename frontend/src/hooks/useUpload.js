import { useState, useRef } from 'react';
import apiClient from '../api/client';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

const useUpload = () => {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('idle'); // idle | uploading | complete | error
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const abortControllerRef = useRef(null);

    const cancelUpload = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setStatus('idle');
        setProgress(0);
        setError(null);
        setResult(null);
    };

    const resetUpload = () => {
        setStatus('idle');
        setProgress(0);
        setError(null);
        setResult(null);
    };

    const uploadFile = async (file, options = {}) => {
        setStatus('uploading');
        setProgress(0);
        setError(null);
        abortControllerRef.current = new AbortController();

        try {
            // Get upload limits from server
            const limitsRes = await apiClient.getUploadLimits();
            const limits = limitsRes.ok ? await limitsRes.json() : { maxFileSize: 100, maxTotalSize: 500 };
            
            const maxFileSizeBytes = limits.maxFileSize * 1024 * 1024;
            
            // Validate file size on client side
            if (file.size > maxFileSizeBytes) {
                throw new Error(`El archivo excede el límite de ${limits.maxFileSize}MB`);
            }

            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

            // Init upload
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

            // Upload chunks
            for (let i = 0; i < totalChunks; i++) {
                // Check if upload was cancelled
                if (abortControllerRef.current?.signal.aborted) {
                    throw new Error('Subida cancelada');
                }
                
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                const chunkRes = await apiClient.uploadChunk(uploadId, i, chunk);
                if (!chunkRes.ok) throw new Error(`Error al subir fragmento ${i}`);

                setProgress(Math.round(((i + 1) / totalChunks) * 100));
            }

            // Complete upload
            const completeRes = await apiClient.completeUpload(uploadId);
            if (!completeRes.ok) {
                const errData = await completeRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Error al completar la subida');
            }

            const data = await completeRes.json();
            setResult(data);
            setStatus('complete');
            abortControllerRef.current = null;
            return data;

        } catch (err) {
            console.error(err);
            if (err.message !== 'Subida cancelada') {
                setError(err.message);
                setStatus('error');
            }
            abortControllerRef.current = null;
        }
    };

    return { progress, status, error, result, uploadFile, cancelUpload, resetUpload };
};

export default useUpload;
