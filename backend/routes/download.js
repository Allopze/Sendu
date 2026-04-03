export const registerDownloadRoutes = ({
    app,
    getFilesRepository,
    metrics,
    logger,
    downloadValidateLimiter,
    createDownloadToken,
    validateDownloadToken,
    bcrypt,
    requestUsesSecureCookies,
    isProduction,
}) => {
    const filesRepository = () => getFilesRepository();

    const sendTrackedDownload = (req, res, file) => {
        metrics.increment('download_start', 1);

        res.download(file.serverPath, file.originalName, (err) => {
            if (err) {
                const isClientAbort = err.code === 'ECONNABORTED' || err.message?.includes('Request aborted');
                if (isClientAbort) {
                    metrics.increment('download_abort', 1);
                    logger.warn('Download aborted by client', { fileId: file.id, error: err.message });
                    return;
                }

                metrics.increment('download_fail', 1);

                if (err.code === 'ENOENT') {
                    logger.error('Download file missing on disk', { fileId: file.id, serverPath: file.serverPath });
                    if (!res.headersSent) {
                        return res.status(404).json({ error: 'Archivo no disponible' });
                    }
                    return;
                }

                logger.error('Download failed', { fileId: file.id, error: err.message, code: err.code });
                if (!res.headersSent) {
                    return res.status(500).json({ error: 'Error al descargar archivo' });
                }
                return;
            }

            filesRepository().incrementDownloadCount(file.id)
                .then(() => {
                    metrics.increment('download_complete', 1);
                })
                .catch((updateErr) => {
                    logger.error('Download counter update failed', { fileId: file.id, error: updateErr.message });
                });
        });
    };

    app.get('/api/meta/:id', async (req, res) => {
        const { id } = req.params;
        const file = await filesRepository().findById(id);

        if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

        if (file.expiresAt && Date.now() > file.expiresAt) {
            return res.status(410).json({ error: 'El archivo ha expirado' });
        }

        if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
            return res.status(410).json({ error: 'Límite de descargas alcanzado' });
        }

        const isOwner = req.session.userId && req.session.userId === file.userId;
        const hasPassword = !!file.passwordHash;

        res.json({
            id: file.id,
            originalName: file.originalName,
            size: file.size,
            mimeType: file.mimeType,
            createdAt: file.createdAt,
            expiresAt: file.expiresAt,
            hasPassword,
            isOwner
        });
    });

    app.post('/api/download/:id/validate', downloadValidateLimiter, async (req, res) => {
        const { id } = req.params;
        const { password } = req.body;

        const file = await filesRepository().findById(id);

        if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

        if (file.expiresAt && Date.now() > file.expiresAt) {
            return res.status(410).json({ error: 'El archivo ha expirado' });
        }

        if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
            return res.status(410).json({ error: 'Límite de descargas alcanzado' });
        }

        if (!file.passwordHash) {
            return res.status(400).json({ error: 'Este archivo no requiere contraseña' });
        }

        if (!password) return res.status(401).json({ error: 'Contraseña requerida' });
        const match = await bcrypt.compare(password, file.passwordHash);
        if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const token = createDownloadToken(id, 5 * 60 * 1000);

        res.cookie('sendu_download_token', token, {
            httpOnly: true,
            secure: requestUsesSecureCookies(req),
            sameSite: isProduction ? 'strict' : 'lax',
            maxAge: 5 * 60 * 1000,
            path: `/api/download/${id}`
        });

        res.json({ message: 'Token generado' });
    });

    app.get('/api/download/:id', async (req, res) => {
        const { id } = req.params;
        const authHeader = req.get('authorization');
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
        const token = req.cookies?.sendu_download_token || req.get('x-download-token') || bearerToken || null;

        const file = await filesRepository().findById(id);

        if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

        if (file.expiresAt && Date.now() > file.expiresAt) {
            return res.status(410).json({ error: 'El archivo ha expirado' });
        }

        if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
            return res.status(410).json({ error: 'Límite de descargas alcanzado' });
        }

        if (file.passwordHash) {
            if (!token) {
                return res.status(401).json({ error: 'Se requiere autenticación para este archivo' });
            }

            if (!validateDownloadToken(token, id)) {
                return res.status(401).json({ error: 'Token inválido o expirado' });
            }
        }

        res.clearCookie('sendu_download_token', {
            path: `/api/download/${id}`
        });

        sendTrackedDownload(req, res, file);
    });

    app.post('/api/download/:id', downloadValidateLimiter, async (req, res) => {
        const { id } = req.params;
        const { password } = req.body;

        const file = await filesRepository().findById(id);

        if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

        if (file.expiresAt && Date.now() > file.expiresAt) {
            return res.status(410).json({ error: 'El archivo ha expirado' });
        }

        if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
            return res.status(410).json({ error: 'Límite de descargas alcanzado' });
        }

        if (file.passwordHash) {
            if (!password) return res.status(401).json({ error: 'Contraseña requerida' });
            const match = await bcrypt.compare(password, file.passwordHash);
            if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        sendTrackedDownload(req, res, file);
    });
};

export default registerDownloadRoutes;