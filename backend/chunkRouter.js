/**
 * Router optimizado para subida de chunks
 * 
 * Este router bypasea middleware innecesario para máximo rendimiento:
 * - Sin helmet (no necesario para uploads de chunks)
 * - Sin compression (los chunks ya están comprimidos o son binarios)
 * - Sin session (usa uploadId como token)
 * - Sin CSRF (usa uploadId para validación)
 * - Sin httpLogger (evita I/O de consola que bloquea)
 * - Solo multer + validación mínima
 * 
 * Mejoras v1.1:
 * - Logging de chunks para depuración de problemas de subida
 * - Mejor manejo de errores con mensajes descriptivos
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fsPromises from 'fs/promises';
import fs from 'fs';
import checkDiskSpace from 'check-disk-space';
import { getCachedUpload, setCachedUpload } from './lib/uploadCache.js';
import { metrics } from './lib/metrics.js';
import logger from './lib/logger.js';
import { validateUploadSessionToken } from './lib/uploadSessionToken.js';

/**
 * Crear el router de chunks optimizado
 * @param {object} options - { CHUNKS_DIR, TEMP_DIR, getMaxChunkSize, getUploadSessionsRepository, isProduction }
 */
export const createChunkRouter = (options) => {
    const { CHUNKS_DIR, TEMP_DIR, getMaxChunkSize, getUploadLimits, getUploadSessionsRepository, isProduction, maxUploadAgeMs = 24 * 60 * 60 * 1000 } = options;
    
    const router = express.Router();
    const uploadSessionsRepository = () => getUploadSessionsRepository();
    
    // Multer configurado para chunks
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            const { uploadId } = req.query;
            if (!uploadId || !/^[a-f0-9-]{36}$/i.test(uploadId)) {
                return cb(new Error('ID de subida inválido'));
            }
            const uploadPath = path.join(CHUNKS_DIR, uploadId);
            fs.mkdir(uploadPath, { recursive: true }, (err) => {
                if (err) return cb(err);
                cb(null, uploadPath);
            });
        },
        filename: (req, file, cb) => {
            const { index } = req.query;
            const chunkIndex = parseInt(index, 10);
            if (isNaN(chunkIndex) || chunkIndex < 0) {
                return cb(new Error('Índice de fragmento inválido'));
            }
            req.chunkFinalName = `${chunkIndex}.part`;
            cb(null, `${chunkIndex}.${Date.now()}-${Math.random().toString(16).slice(2)}.uploading`);
        }
    });

    const upload = multer({
        storage,
        limits: {
            fileSize: 200 * 1024 * 1024 // 200MB max para soportar chunks grandes
        }
    });
    
    // Middleware de error de multer (inline, sin logging extra)
    const handleMulterError = (err, req, res, next) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'El fragmento excede el tamaño máximo permitido' });
            }
            return res.status(400).json({ error: `Error de subida: ${err.message}` });
        }
        if (err) {
            return res.status(500).json({ error: 'Error interno durante la subida' });
        }
        next();
    };
    
    // Obtener o cachear meta de un upload
    const getUploadMeta = async (uploadId) => {
        // Intentar obtener de caché
        const cached = getCachedUpload(uploadId);
        if (cached) {
            return cached;
        }
        
        // Leer de disco y cachear
        const metaPath = path.join(CHUNKS_DIR, uploadId, 'meta.json');
        const metaContent = await fsPromises.readFile(metaPath, 'utf8');
        const meta = JSON.parse(metaContent);
        
        // Obtener maxChunkSize de la configuración
        const maxChunkSize = getMaxChunkSize();
        
        const cacheData = { meta, maxChunkSize };
        setCachedUpload(uploadId, cacheData);
        
        return cacheData;
    };
    
    const getDirectorySize = async (dirPath) => {
        let total = 0;
        const entries = await fsPromises.readdir(dirPath);
        for (const entry of entries) {
            if (entry === 'meta.json' || entry.endsWith('.uploading')) continue;
            const filePath = path.join(dirPath, entry);
            try {
                const stat = await fsPromises.stat(filePath);
                if (stat.isFile()) {
                    total += stat.size;
                }
            } catch {}
        }
        return total;
    };

    const preflight = (req, res, next) => {
        const { uploadId, index } = req.query;
        if (!uploadId || !/^[a-f0-9-]{36}$/i.test(uploadId)) {
            return res.status(400).json({ error: 'ID de subida inválido' });
        }
        const chunkIndex = parseInt(index, 10);
        if (isNaN(chunkIndex) || chunkIndex < 0) {
            return res.status(400).json({ error: 'Índice de fragmento inválido' });
        }
        const chunkPath = path.join(CHUNKS_DIR, uploadId, `${chunkIndex}.part`);
        try {
            if (fs.existsSync(chunkPath)) {
                const stat = fs.statSync(chunkPath);
                req.existingChunkSize = stat.size;
            }
        } catch {}
        next();
    };

    // Ruta POST /chunk (sin prefijo, se monta en /api/upload/chunk)
    router.post('/', preflight, upload.single('chunk'), handleMulterError, async (req, res) => {
        const { uploadId, index } = req.query;
        const startTime = Date.now();
        
        // Validación rápida sin logging
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó el fragmento' });
        }
        
        // Validar formato de uploadId
        if (!uploadId || !/^[a-f0-9-]{36}$/i.test(uploadId)) {
            try { await fsPromises.unlink(req.file.path); } catch {}
            return res.status(400).json({ error: 'ID de subida inválido' });
        }
        
        const chunkIndex = parseInt(index, 10);
        if (isNaN(chunkIndex) || chunkIndex < 0) {
            try { await fsPromises.unlink(req.file.path); } catch {}
            return res.status(400).json({ error: 'Índice de fragmento inválido' });
        }
        
        const chunkSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
        
        try {
            // Obtener meta (cacheado)
            const { meta, maxChunkSize } = await getUploadMeta(uploadId);
            const uploadPath = path.join(CHUNKS_DIR, uploadId);
            const tempChunkPath = req.file.path;
            const finalChunkPath = path.join(uploadPath, req.chunkFinalName || `${chunkIndex}.part`);

            // Validar índice dentro de rango antes de tocar contadores persistidos
            if (chunkIndex >= meta.totalChunks) {
                try { await fsPromises.unlink(tempChunkPath); } catch {}
                metrics.increment('upload_chunk_client_error', 1);
                return res.status(400).json({ error: 'Índice de fragmento fuera de rango' });
            }

            // Validar tamaño del chunk antes de tocar contadores persistidos
            const isLastChunk = chunkIndex === meta.totalChunks - 1;
            if (!isLastChunk && req.file.size > maxChunkSize * 1.1) {
                try { await fsPromises.unlink(tempChunkPath); } catch {}
                metrics.increment('upload_chunk_client_error', 1);
                return res.status(400).json({ error: 'Fragmento excede el tamaño máximo permitido' });
            }

            const authoritativeBytesBefore = await getDirectorySize(uploadPath);
            const delta = (req.file.size || 0) - (req.existingChunkSize || 0);
            const projectedBytes = authoritativeBytesBefore + delta;

            // Validate upload session state (repository-backed)
            const session = await uploadSessionsRepository().findByUploadId(uploadId);
            if (!session) {
                try { await fsPromises.unlink(req.file.path); } catch {}
                metrics.increment('upload_chunk_client_error', 1);
                return res.status(404).json({ error: 'Sesión de subida no encontrada' });
            }
            const uploadToken = req.get('x-upload-token') || req.query.uploadToken;
            if (!validateUploadSessionToken({
                uploadId,
                token: uploadToken,
                userId: session.userId || null,
                ipFingerprint: session.ipFingerprint || null,
            })) {
                try { await fsPromises.unlink(req.file.path); } catch {}
                metrics.increment('upload_chunk_client_error', 1);
                return res.status(403).json({ error: 'No autorizado para esta sesión de subida' });
            }
            if (session.status === 'cancelled' || session.status === 'completed') {
                try { await fsPromises.unlink(req.file.path); } catch {}
                metrics.increment('upload_chunk_client_error', 1);
                return res.status(409).json({ error: 'Sesión de subida no disponible' });
            }
            if (Date.now() - session.createdAt > maxUploadAgeMs) {
                try { await fsPromises.unlink(req.file.path); } catch {}
                metrics.increment('upload_chunk_client_error', 1);
                return res.status(410).json({ error: 'Sesión de subida expirada' });
            }

            // Enforce in-progress quota per user/IP
            if (typeof getUploadLimits === 'function') {
                const limits = getUploadLimits();
                const guestLimitBytes = limits.guestUploadLimit * 1024 * 1024;
                const userLimitBytes = limits.maxTotalSize * 1024 * 1024;
                const currentSessionBytes = Number(session.bytesReceived) || 0;

                if (session.userId) {
                    const total = await uploadSessionsRepository().sumActiveBytesByUser(session.userId);
                    const projectedUserTotal = Math.max(0, total - currentSessionBytes + projectedBytes);
                    if (projectedUserTotal > userLimitBytes) {
                        try { await fsPromises.unlink(req.file.path); } catch {}
                        metrics.increment('upload_chunk_client_error', 1);
                        return res.status(429).json({ error: 'Límite de subida en progreso excedido' });
                    }
                } else if (session.ipFingerprint) {
                    const total = await uploadSessionsRepository().sumActiveBytesByIp(session.ipFingerprint);
                    const projectedGuestTotal = Math.max(0, total - currentSessionBytes + projectedBytes);
                    if (projectedGuestTotal > guestLimitBytes) {
                        try { await fsPromises.unlink(req.file.path); } catch {}
                        metrics.increment('upload_chunk_client_error', 1);
                        return res.status(429).json({ error: 'Límite de subida en progreso excedido' });
                    }
                }
            }

            // Disk space safety check (post-write, best-effort)
            try {
                const { free } = await checkDiskSpace(CHUNKS_DIR);
                const safetyBytes = 100 * 1024 * 1024; // 100MB safety buffer
                if (free < req.file.size + safetyBytes) {
                    try { await fsPromises.unlink(tempChunkPath); } catch {}
                    metrics.increment('upload_chunk_server_error', 1);
                    return res.status(507).json({ error: 'Espacio insuficiente en el servidor' });
                }
            } catch {}

            // Enforce total size per uploadId (prevent disk abuse)
            try {
                const maxAllowed = Math.ceil(meta.size * 1.1); // allow small overhead
                if (projectedBytes > maxAllowed) {
                    try { await fsPromises.unlink(tempChunkPath); } catch {}
                    metrics.increment('upload_chunk_client_error', 1);
                    return res.status(400).json({ error: 'Tamaño total de subida excedido' });
                }
            } catch {}

            try {
                await fsPromises.rename(tempChunkPath, finalChunkPath);
            } catch (renameError) {
                try { await fsPromises.unlink(tempChunkPath); } catch {}
                throw renameError;
            }

            const authoritativeBytes = await getDirectorySize(uploadPath);
            await uploadSessionsRepository().updateBytesReceived(uploadId, authoritativeBytes, Date.now());
            
            const duration = Date.now() - startTime;
            
            // Log solo para chunks significativos o en desarrollo (evita spam en prod)
            if (!isProduction || chunkIndex === 0 || chunkIndex === meta.totalChunks - 1 || duration > 5000) {
                logger.debug('Chunk uploaded', {
                    uploadId: uploadId.substring(0, 8) + '...',
                    chunk: `${chunkIndex + 1}/${meta.totalChunks}`,
                    size: `${chunkSizeMB}MB`,
                    duration: `${duration}ms`,
                    throughput: duration > 0 ? `${((req.file.size / 1024 / 1024) / (duration / 1000)).toFixed(2)}MB/s` : 'N/A'
                });
            }
            
            // Metrics
            metrics.increment('upload_chunks', 1);
            metrics.increment('upload_chunk_bytes', req.file.size || 0);

            res.json({ message: 'Fragmento subido' });
            
        } catch (err) {
            // Limpiar archivo temporal
            try { await fsPromises.unlink(req.file.path); } catch {}
            
            if (err.code === 'ENOENT') {
                logger.warn('Upload session not found', { uploadId: uploadId.substring(0, 8) + '...', chunkIndex });
                return res.status(404).json({ error: 'Sesión de subida no encontrada' });
            }
            
            // Loguear errores inesperados
            logger.error('Chunk upload error', { 
                uploadId: uploadId.substring(0, 8) + '...', 
                chunkIndex,
                error: err.message,
                duration: `${Date.now() - startTime}ms`
            });
            metrics.increment('upload_chunk_server_error', 1);
            return res.status(500).json({ error: 'Error al procesar el fragmento' });
        }
    });
    
    return router;
};

export default createChunkRouter;
