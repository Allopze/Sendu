import path from 'path';

const UPLOAD_ID_REGEX = /^[a-f0-9-]{36}$/i;

export const registerUploadRoutes = ({
    app,
    asyncHandler,
    getSettingsRepository,
    getUsersRepository,
    getUploadSessionsRepository,
    getFilesRepository,
    fs,
    fsPromises,
    pathModule = path,
    crypto,
    bcrypt,
    uuidv4,
    logger,
    metrics,
    checkDiskSpace,
    fileTypeFromFile,
    antivirus,
    invalidateUploadCache,
    validateMimeType,
    getUploadLimits,
    getMaxConcurrentUploads,
    isEmailDeliveryEnabled,
    generateFingerprint,
    getIpFingerprint,
    canGuestUpload,
    recordGuestUpload,
    createUploadSessionToken,
    validateUploadSessionToken,
    UPLOAD_DIR,
    CHUNKS_DIR,
}) => {
    const isValidUploadId = (value) => UPLOAD_ID_REGEX.test(value);
    const usersRepository = () => getUsersRepository();
    const uploadSessionsRepository = () => getUploadSessionsRepository();
    const filesRepository = () => getFilesRepository();
    const markUploadSessionStatus = (uploadId, status, updatedAt = Date.now()) => (
        uploadSessionsRepository().updateStatus(uploadId, status, updatedAt)
    );
    const markUploadSessionFailed = (uploadId, updatedAt = Date.now()) => (
        markUploadSessionStatus(uploadId, 'failed', updatedAt)
    );
    const markUploadSessionCancelled = (uploadId, updatedAt = Date.now()) => (
        markUploadSessionStatus(uploadId, 'cancelled', updatedAt)
    );

    app.post('/api/upload/init', asyncHandler(async (req, res) => {
        const { originalName, size, mimeType, totalChunks, checksum, chunkSize, streamingZip = false } = req.body;

        if (!originalName || typeof originalName !== 'string') {
            return res.status(400).json({ error: 'Nombre de archivo requerido' });
        }
        if (!size || typeof size !== 'number' || size <= 0) {
            return res.status(400).json({ error: 'Tamaño de archivo inválido' });
        }
        if (!totalChunks || typeof totalChunks !== 'number' || totalChunks <= 0) {
            return res.status(400).json({ error: 'Número de chunks inválido' });
        }
        if (chunkSize !== undefined && (typeof chunkSize !== 'number' || chunkSize <= 0 || chunkSize > 200 * 1024 * 1024)) {
            return res.status(400).json({ error: 'Tamaño de chunk inválido' });
        }

        const sanitizedName = pathModule.basename(originalName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
            return res.status(400).json({ error: 'Nombre de archivo inválido' });
        }

        const mimeValidation = validateMimeType(mimeType, sanitizedName);
        if (!mimeValidation.valid) {
            return res.status(400).json({ error: mimeValidation.reason });
        }

        const limits = getUploadLimits();
        const isLoggedIn = !!req.session.userId;

        if (isLoggedIn) {
            const userRow = await usersRepository().findUploadActorById(req.session.userId);
            if (!userRow) {
                return res.status(401).json({ error: 'No autenticado' });
            }
            if (isEmailDeliveryEnabled() && !userRow.isVerified && userRow.role !== 'admin') {
                return res.status(403).json({ error: 'Verifica tu email para subir archivos' });
            }
        }

        let guestFingerprint = null;
        let ipFingerprint = null;
        const effectiveMaxFileSize = isLoggedIn ? limits.maxFileSize : limits.guestMaxFileSize;
        const maxFileSizeBytes = effectiveMaxFileSize * 1024 * 1024;

        if (size > maxFileSizeBytes) {
            const message = isLoggedIn
                ? `El archivo excede el límite de ${effectiveMaxFileSize}MB`
                : `El archivo excede el límite de ${effectiveMaxFileSize}MB para invitados. Inicia sesión para subir archivos más grandes.`;
            return res.status(400).json({ error: message });
        }

        if (req.session.userId) {
            const maxTotalSizeBytes = limits.maxTotalSize * 1024 * 1024;
            const totalSize = await usersRepository().getOwnedFileTotalSize(req.session.userId);

            if (totalSize + size > maxTotalSizeBytes) {
                const usedMB = Math.round(totalSize / (1024 * 1024));
                return res.status(400).json({
                    error: `Has alcanzado tu límite de almacenamiento (${usedMB}MB de ${limits.maxTotalSize}MB usados). Elimina algunos archivos para subir más.`,
                    quotaExceeded: true,
                    used: totalSize,
                    limit: maxTotalSizeBytes
                });
            }
        }

        if (!req.session.userId) {
            guestFingerprint = generateFingerprint(req);
            ipFingerprint = getIpFingerprint(req);
            const guestLimitBytes = limits.guestUploadLimit * 1024 * 1024;

            const check1 = canGuestUpload(guestFingerprint, size, guestLimitBytes);
            const check2 = canGuestUpload(ipFingerprint, size, guestLimitBytes);

            if (!check1.allowed || !check2.allowed) {
                return res.status(429).json({
                    error: check1.message || check2.message,
                    remaining: Math.min(check1.remaining, check2.remaining),
                    limitReached: true
                });
            }
        }

        if (!ipFingerprint) {
            ipFingerprint = getIpFingerprint(req);
        }

        const maxConcurrent = getMaxConcurrentUploads();
        if (isLoggedIn) {
            const count = await uploadSessionsRepository().countActiveByUser(req.session.userId);
            if (count >= maxConcurrent) {
                return res.status(429).json({ error: `Límite de uploads concurrentes (${maxConcurrent}) alcanzado.` });
            }
        }

        const ipCount = await uploadSessionsRepository().countActiveByIp(ipFingerprint);
        if (ipCount >= maxConcurrent) {
            return res.status(429).json({ error: `Límite de uploads concurrentes (${maxConcurrent}) alcanzado.` });
        }

        const uploadId = uuidv4();
        const uploadPath = pathModule.join(CHUNKS_DIR, uploadId);

        let validatedExpires = null;
        if (req.body.expires !== undefined && req.body.expires !== null && req.body.expires !== '') {
            const expiresValue = parseInt(req.body.expires, 10);
            if (Number.isNaN(expiresValue) || expiresValue < 1 || expiresValue > 365) {
                return res.status(400).json({ error: 'El valor de expiración debe ser entre 1 y 365 días' });
            }
            validatedExpires = expiresValue;
        }

        let validatedMaxDownloads = null;
        if (req.body.maxDownloads !== undefined && req.body.maxDownloads !== null && req.body.maxDownloads !== '') {
            const maxDownloadsValue = parseInt(req.body.maxDownloads, 10);
            if (Number.isNaN(maxDownloadsValue) || maxDownloadsValue < 1 || maxDownloadsValue > 10000) {
                return res.status(400).json({ error: 'El límite de descargas debe ser entre 1 y 10000' });
            }
            validatedMaxDownloads = maxDownloadsValue;
        }

        let passwordHash = null;
        if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim()) {
            passwordHash = await bcrypt.hash(req.body.password.trim(), 12);
        }

        let validatedChecksum = null;
        if (checksum && typeof checksum === 'string') {
            if (/^[a-f0-9]{64}$/i.test(checksum)) {
                validatedChecksum = checksum.toLowerCase();
            } else {
                return res.status(400).json({ error: 'Formato de checksum inválido (se espera SHA-256 hex)' });
            }
        }

        await fsPromises.mkdir(uploadPath, { recursive: true });
        await fsPromises.writeFile(pathModule.join(uploadPath, 'meta.json'), JSON.stringify({
            originalName: sanitizedName,
            size,
            mimeType,
            totalChunks,
            chunkSize: chunkSize || null,
            userId: req.session.userId || null,
            fingerprint: req.session.userId ? null : guestFingerprint,
            ipFingerprint: req.session.userId ? null : ipFingerprint,
            createdAt: Date.now(),
            expires: validatedExpires,
            maxDownloads: validatedMaxDownloads,
            passwordHash,
            checksum: validatedChecksum,
            streamingZip: Boolean(streamingZip),
        }));

        const now = Date.now();
        await uploadSessionsRepository().createSession({
            uploadId,
            userId: req.session.userId || null,
            ipFingerprint,
            status: 'initiated',
            createdAt: now,
            updatedAt: now,
        });

        const uploadToken = createUploadSessionToken({
            uploadId,
            userId: req.session.userId || null,
            ipFingerprint,
        });

        metrics.increment('upload_init', 1);
        res.json({ uploadId, uploadToken });
    }));

    app.get('/api/upload/status/:uploadId', asyncHandler(async (req, res) => {
        const { uploadId } = req.params;
        metrics.increment('upload_resume_probe', 1);

        if (!isValidUploadId(uploadId)) {
            return res.status(400).json({ error: 'ID de subida inválido' });
        }

        const sessionRow = await uploadSessionsRepository().findByUploadId(uploadId);

        if (!sessionRow) {
            return res.status(404).json({ error: 'Sesión de subida no encontrada' });
        }

        const uploadToken = req.get('x-upload-token') || req.query.uploadToken;
        if (!validateUploadSessionToken({
            uploadId,
            token: uploadToken,
            userId: sessionRow.userId || null,
            ipFingerprint: sessionRow.ipFingerprint || null,
        })) {
            return res.status(403).json({ error: 'No autorizado para esta sesión de subida' });
        }

        const uploadPath = pathModule.join(CHUNKS_DIR, uploadId);

        let meta = null;
        try {
            const metaContent = await fsPromises.readFile(pathModule.join(uploadPath, 'meta.json'), 'utf8');
            meta = JSON.parse(metaContent);
        } catch (err) {
            if (sessionRow.status !== 'completed') {
                return res.status(404).json({ error: 'Metadatos de la sesión no disponibles' });
            }
        }

        let completedChunks = [];
        let uploadedBytes = 0;
        if (meta) {
            try {
                const entries = await fsPromises.readdir(uploadPath);
                for (const entry of entries) {
                    const match = entry.match(/^(\d+)\.part$/);
                    if (!match) continue;

                    const chunkIndex = parseInt(match[1], 10);
                    if (Number.isNaN(chunkIndex)) continue;

                    try {
                        const chunkPath = pathModule.join(uploadPath, entry);
                        const stat = await fsPromises.stat(chunkPath);
                        const configuredChunkSize = Number.isFinite(meta.chunkSize) && meta.chunkSize > 0
                            ? meta.chunkSize
                            : Math.ceil(meta.size / Math.max(meta.totalChunks || 1, 1));
                        const expectedSize = chunkIndex === (meta.totalChunks - 1)
                            ? Math.max(0, meta.size - (configuredChunkSize * chunkIndex))
                            : configuredChunkSize;

                        if (meta.streamingZip || stat.size === expectedSize) {
                            completedChunks.push(chunkIndex);
                            uploadedBytes += stat.size;
                            continue;
                        }

                        logger.warn('Ignoring partial chunk during resume probe', {
                            uploadId,
                            chunkIndex,
                            expectedSize,
                            actualSize: stat.size
                        });
                    } catch {
                        // Ignore races with cleanup/resume
                    }
                }
                completedChunks.sort((a, b) => a - b);
            } catch {
                // Ignore listing races; rely on DB bytes below
            }
        }

        if (completedChunks.length > 0) {
            metrics.increment('upload_resume_available', 1);
        }

        res.json({
            uploadId,
            status: sessionRow.status,
            fileId: sessionRow.fileId || null,
            createdAt: sessionRow.createdAt,
            updatedAt: sessionRow.updatedAt,
            bytesReceived: uploadedBytes || sessionRow.bytesReceived || 0,
            completedChunks,
            totalChunks: meta?.totalChunks ?? null,
            size: meta?.size ?? null,
            originalName: meta?.originalName ?? null,
            mimeType: meta?.mimeType ?? null,
            streamingZip: Boolean(meta?.streamingZip),
        });
    }));

    app.post('/api/upload/complete', asyncHandler(async (req, res) => {
        const { uploadId, finalChunkIndex = null, actualSize = null } = req.body || {};

        if (!uploadId) {
            return res.status(400).json({ error: 'Se requiere el ID de subida' });
        }
        if (!isValidUploadId(uploadId)) {
            return res.status(400).json({ error: 'ID de subida inválido' });
        }

        invalidateUploadCache(uploadId);

        const sessionRow = await uploadSessionsRepository().findByUploadId(uploadId);
        if (!sessionRow || sessionRow.status === 'cancelled') {
            return res.status(404).json({ error: 'Sesión de subida no encontrada' });
        }

        if (sessionRow.userId) {
            if (!req.session.userId || req.session.userId !== sessionRow.userId) {
                return res.status(403).json({ error: 'No autorizado para completar esta subida' });
            }
        } else {
            const requestFingerprint = getIpFingerprint(req);
            if (!sessionRow.ipFingerprint || sessionRow.ipFingerprint !== requestFingerprint) {
                return res.status(403).json({ error: 'No autorizado para completar esta subida' });
            }
        }

        if (sessionRow.status === 'completed' && sessionRow.fileId) {
            return res.json({ fileId: sessionRow.fileId, message: 'Subida completada' });
        }
        if (sessionRow.status === 'processing') {
            return res.status(409).json({ error: 'Subida en proceso, intenta de nuevo' });
        }

        const statusUpdateChanges = await uploadSessionsRepository().markProcessing(uploadId, Date.now());
        if (statusUpdateChanges === 0) {
            return res.status(409).json({ error: 'Subida en proceso, intenta de nuevo' });
        }

        const uploadPath = pathModule.join(CHUNKS_DIR, uploadId);

        try {
            await fsPromises.access(uploadPath);
        } catch {
            await markUploadSessionFailed(uploadId);
            return res.status(404).json({ error: 'Sesión de subida no encontrada' });
        }

        let meta;
        try {
            const metaContent = await fsPromises.readFile(pathModule.join(uploadPath, 'meta.json'), 'utf8');
            meta = JSON.parse(metaContent);
        } catch {
            await markUploadSessionFailed(uploadId);
            return res.status(400).json({ error: 'Sesión de subida inválida: faltan metadatos' });
        }

        const isStreamingZip = Boolean(meta.streamingZip);
        const expectedFinalChunkIndex = isStreamingZip ? finalChunkIndex : (meta.totalChunks - 1);
        const expectedFinalSize = isStreamingZip ? actualSize : meta.size;

        if (isStreamingZip) {
            if (!Number.isInteger(expectedFinalChunkIndex) || expectedFinalChunkIndex < 0 || expectedFinalChunkIndex >= meta.totalChunks) {
                await markUploadSessionFailed(uploadId);
                return res.status(400).json({ error: 'Índice final de chunk inválido para la subida en streaming' });
            }
            if (!Number.isFinite(expectedFinalSize) || expectedFinalSize <= 0 || expectedFinalSize > meta.size) {
                await markUploadSessionFailed(uploadId);
                return res.status(400).json({ error: 'Tamaño final inválido para la subida en streaming' });
            }
        }

        try {
            const { free } = await checkDiskSpace(UPLOAD_DIR);
            const safetyBytes = 50 * 1024 * 1024;
            if (free < expectedFinalSize + safetyBytes) {
                await markUploadSessionFailed(uploadId);
                return res.status(507).json({ error: 'Espacio insuficiente en el servidor' });
            }
        } catch (err) {
            logger.warn('Disk space check failed', { error: err.message });
        }

        const finalFileId = uuidv4();
        const finalPath = pathModule.join(UPLOAD_DIR, finalFileId);
        const tempPath = pathModule.join(UPLOAD_DIR, `${finalFileId}.tmp`);

        try {
            for (let i = 0; i <= expectedFinalChunkIndex; i += 1) {
                const chunkPath = pathModule.join(uploadPath, `${i}.part`);
                try {
                    await fsPromises.access(chunkPath);
                } catch {
                    throw new Error(`Missing chunk ${i}`);
                }
            }

            const writeStream = fs.createWriteStream(tempPath);
            for (let i = 0; i <= expectedFinalChunkIndex; i += 1) {
                const chunkPath = pathModule.join(uploadPath, `${i}.part`);
                await new Promise((resolve, reject) => {
                    const readStream = fs.createReadStream(chunkPath);
                    readStream.on('error', reject);
                    readStream.on('end', resolve);
                    readStream.pipe(writeStream, { end: false });
                });
            }

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                writeStream.end();
            });

            await fsPromises.rm(uploadPath, { recursive: true, force: true });

            let expiresAt = null;
            if (meta.expires) {
                expiresAt = Date.now() + (meta.expires * 24 * 60 * 60 * 1000);
            } else {
                const defaultRetention = await getSettingsRepository().getValue('defaultRetentionDays');
                if (defaultRetention) {
                    const days = parseInt(defaultRetention, 10);
                    if (days > 0 && days <= 365) {
                        expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
                    }
                }
            }

            const passwordHash = meta.passwordHash || null;

            const finalStats = await fsPromises.stat(tempPath);
            if (finalStats.size !== expectedFinalSize) {
                logger.warn('File size mismatch', {
                    expected: expectedFinalSize,
                    actual: finalStats.size,
                    uploadId
                });
                await fsPromises.unlink(tempPath);
                await markUploadSessionFailed(uploadId);
                return res.status(400).json({
                    error: 'El tamaño del archivo no coincide con lo esperado. Por favor, intenta de nuevo.'
                });
            }

            if (meta.checksum) {
                const hash = crypto.createHash('sha256');
                const stream = fs.createReadStream(tempPath);
                await new Promise((resolve, reject) => {
                    stream.on('data', (chunk) => hash.update(chunk));
                    stream.on('end', resolve);
                    stream.on('error', reject);
                });
                const computed = hash.digest('hex');
                if (computed !== meta.checksum) {
                    logger.warn('Checksum mismatch', { expected: meta.checksum, actual: computed, uploadId });
                    await fsPromises.unlink(tempPath);
                    await markUploadSessionFailed(uploadId);
                    return res.status(400).json({
                        error: 'El checksum del archivo no coincide. El archivo puede estar corrupto.'
                    });
                }
            }

            let detectedMime = meta.mimeType;
            try {
                const detected = await fileTypeFromFile(tempPath);
                if (detected?.mime) {
                    detectedMime = detected.mime;
                }
            } catch {}

            const mimeValidation = validateMimeType(detectedMime, meta.originalName);
            if (!mimeValidation.valid) {
                await fsPromises.unlink(tempPath);
                await markUploadSessionFailed(uploadId);
                return res.status(400).json({ error: mimeValidation.reason });
            }

            try {
                const avResult = await antivirus.scanFile(tempPath);
                if (avResult.enabled && !avResult.clean) {
                    await fsPromises.unlink(tempPath);
                    await markUploadSessionFailed(uploadId);
                    return res.status(400).json({ error: 'Archivo detectado como malicioso' });
                }
            } catch {
                if (antivirus.isEnabled()) {
                    await fsPromises.unlink(tempPath);
                    await markUploadSessionFailed(uploadId);
                    return res.status(503).json({ error: 'Escaneo antivirus no disponible' });
                }
            }

            await fsPromises.rename(tempPath, finalPath);

            const persistedSize = finalStats.size;
            try {
                await filesRepository().createFile({
                    id: finalFileId,
                    originalName: meta.originalName,
                    serverPath: finalPath,
                    mimeType: detectedMime || meta.mimeType,
                    size: persistedSize,
                    createdAt: Date.now(),
                    userId: meta.userId,
                    expiresAt,
                    maxDownloads: meta.maxDownloads || null,
                    passwordHash,
                });
            } catch (err) {
                try { await fsPromises.unlink(finalPath); } catch {}
                throw err;
            }

            await uploadSessionsRepository().markCompleted(uploadId, finalFileId, Date.now());

            if (!meta.userId && meta.fingerprint) {
                recordGuestUpload(meta.fingerprint, persistedSize);
                if (meta.ipFingerprint && meta.ipFingerprint !== meta.fingerprint) {
                    recordGuestUpload(meta.ipFingerprint, persistedSize);
                }
            }

            metrics.increment('upload_complete', 1);
            metrics.increment('upload_complete_bytes', persistedSize || 0);
            res.json({ fileId: finalFileId, message: 'Subida completada' });
        } catch (err) {
            logger.error('Error al completar subida', { error: err.message });
            try {
                await fsPromises.rm(uploadPath, { recursive: true, force: true });
            } catch {}
            try {
                await fsPromises.unlink(tempPath);
            } catch {}
            await markUploadSessionFailed(uploadId);
            res.status(500).json({ error: err.message || 'Error al completar la subida' });
        }
    }));

    app.post('/api/upload/cancel', asyncHandler(async (req, res) => {
        const { uploadId } = req.body || {};

        if (!uploadId) {
            return res.status(400).json({ error: 'Se requiere el ID de subida' });
        }
        if (!isValidUploadId(uploadId)) {
            return res.status(400).json({ error: 'ID de subida inválido' });
        }

        invalidateUploadCache(uploadId);

        const sessionRow = await uploadSessionsRepository().findByUploadId(uploadId);
        if (!sessionRow) {
            return res.status(404).json({ error: 'Sesion de subida no encontrada' });
        }

        if (sessionRow.userId) {
            if (!req.session.userId || req.session.userId !== sessionRow.userId) {
                return res.status(403).json({ error: 'No autorizado para cancelar esta subida' });
            }
        } else {
            const requestFingerprint = getIpFingerprint(req);
            if (!sessionRow.ipFingerprint || sessionRow.ipFingerprint !== requestFingerprint) {
                return res.status(403).json({ error: 'No autorizado para cancelar esta subida' });
            }
        }

        const uploadPath = pathModule.join(CHUNKS_DIR, uploadId);

        try {
            // Mark the session as cancelled first so in-flight chunk requests
            // stop accepting new data before we remove the chunk directory.
            await markUploadSessionCancelled(uploadId);
            await fsPromises.rm(uploadPath, { recursive: true, force: true });
            logger.info('Upload cancelled and cleaned up', { uploadId });
            metrics.increment('upload_cancel', 1);
            res.json({ message: 'Subida cancelada' });
        } catch (err) {
            if (err.code === 'ENOENT') {
                await markUploadSessionCancelled(uploadId);
                metrics.increment('upload_cancel', 1);
                return res.json({ message: 'Subida cancelada' });
            }
            logger.error('Error cancelling upload', { uploadId, error: err.message });
            res.status(500).json({ error: 'Error al cancelar la subida' });
        }
    }));
};

export default registerUploadRoutes;
