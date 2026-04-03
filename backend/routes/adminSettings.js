import path from 'path';

export const registerAdminSettingsRoutes = ({
    app,
    requireAdmin,
    asyncHandler,
    getSettingsRepository,
    logger,
    resetRateLimits,
    applyAdminSettings,
    serializeAdminSettings,
    validateAdminSettingsPayload,
    invalidateSettingsCache,
    safeCompare,
    encrypt,
    decrypt,
    isEncrypted,
    getEncryptionFormat,
    mergeSmtpIntoSettings,
    getSmtpEnvironmentConfig,
    multer,
    BRANDING_DIR,
    PUBLIC_ORIGIN,
    enqueueBrandingConversion,
    fsPromises,
    handleMulterError,
    isEmailDeliveryEnabled,
    createSmtpTransporter,
    sendEmail,
}) => {
    app.get('/api/admin/settings', requireAdmin, asyncHandler(async (req, res) => {
        const settings = await getSettingsRepository().listAll();
        const serializedSettings = serializeAdminSettings(settings);
        res.json(mergeSmtpIntoSettings(serializedSettings, getSmtpEnvironmentConfig()));
    }));

    app.get('/api/admin/settings/audit', requireAdmin, asyncHandler(async (req, res) => {
        const auditReport = await getSettingsRepository().listAudit({
            page: req.query.page,
            limit: req.query.limit,
        });

        res.json(auditReport);
    }));

    app.post('/api/admin/rate-limits/reset', requireAdmin, (req, res) => {
        const { prefix } = req.body || {};
        if (prefix && !/^[a-z0-9_-]+$/i.test(prefix)) {
            return res.status(400).json({ error: 'Prefijo inválido' });
        }
        const normalizedPrefix = prefix === 'all' ? null : prefix || null;
        const deleted = resetRateLimits(normalizedPrefix);
        res.json({ message: 'Rate limits reiniciados', deleted, prefix: normalizedPrefix || 'all' });
    });

    app.post('/api/admin/settings', requireAdmin, asyncHandler(async (req, res) => {
        const settingsRepository = getSettingsRepository();
        const settings = req.body;
        const validationError = validateAdminSettingsPayload(settings);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        try {
            const changedKeys = await applyAdminSettings({
                settingsRepository,
                settings,
                adminUserId: req.session.userId || 'unknown',
                safeCompare,
                encrypt,
                decrypt,
                isEncrypted,
                getEncryptionFormat,
            });

            if (changedKeys.length > 0) {
                invalidateSettingsCache(changedKeys);
            }

            res.json({
                message: changedKeys.length > 0 ? 'Configuracion actualizada' : 'Sin cambios',
                changedKeys
            });
        } catch (err) {
            logger.error('Error al actualizar configuración', { error: err.message });
            res.status(500).json({ error: 'Error al actualizar configuración' });
        }
    }));

    const BRANDING_TYPES = new Set(['logoLight', 'logoDark', 'favicon', 'dropzoneIcon']);
    const BRANDING_MIME_EXT = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/svg+xml': '.svg',
        'image/x-icon': '.ico',
        'image/vnd.microsoft.icon': '.ico'
    };

    const validateBrandingType = (req, res, next) => {
        const type = req.query.type;
        if (!BRANDING_TYPES.has(type)) {
            return res.status(400).json({ error: 'Tipo inválido. Debe ser logoLight, logoDark, favicon o dropzoneIcon' });
        }
        req.brandingType = type;
        next();
    };

    const brandingUpload = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, BRANDING_DIR),
            filename: (req, file, cb) => {
                const ext = BRANDING_MIME_EXT[file.mimetype];
                if (!ext) {
                    return cb(new Error('Tipo de archivo inválido. Solo se permiten PNG, JPG, SVG e ICO.'));
                }
                cb(null, `${req.brandingType}${ext}`);
            }
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
            if (BRANDING_MIME_EXT[file.mimetype]) {
                cb(null, true);
            } else {
                cb(new Error('Tipo de archivo inválido. Solo se permiten PNG, JPG, SVG e ICO.'));
            }
        }
    });

    app.post('/api/admin/branding/upload', requireAdmin, validateBrandingType, brandingUpload.single('file'), handleMulterError, asyncHandler(async (req, res) => {
        const settingsRepository = getSettingsRepository();
        const type = req.brandingType;

        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }

        const timestamp = Date.now();

        if (req.file.mimetype === 'image/svg+xml' && (type === 'logoLight' || type === 'logoDark')) {
            const svgPath = path.join(BRANDING_DIR, req.file.filename);
            const pngFilename = `${type}-email.png`;
            const pngPath = path.join(BRANDING_DIR, pngFilename);

            await enqueueBrandingConversion(svgPath, pngPath, {
                format: 'png',
                height: 80,
            });

            const pngRelativePath = `/branding/${pngFilename}?t=${timestamp}`;
            const pngUrl = PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}${pngRelativePath}` : pngRelativePath;
            const emailLogoKey = type === 'logoLight' ? 'logoLightEmail' : 'logoDarkEmail';
            await settingsRepository.upsert(emailLogoKey, pngUrl);

            logger.info(`Queued PNG conversion for emails: ${pngFilename}`);
        }

        const relativePath = `/branding/${req.file.filename}?t=${timestamp}`;
        await settingsRepository.upsert(type, relativePath);

        invalidateSettingsCache([type, type === 'logoLight' ? 'logoLightEmail' : type === 'logoDark' ? 'logoDarkEmail' : null].filter(Boolean));
        res.json({ message: 'Archivo subido', url: relativePath });
    }));

    app.delete('/api/admin/branding/:type', requireAdmin, asyncHandler(async (req, res) => {
        const settingsRepository = getSettingsRepository();
        const { type } = req.params;
        if (!['logoLight', 'logoDark', 'favicon', 'dropzoneIcon'].includes(type)) {
            return res.status(400).json({ error: 'Tipo inválido' });
        }

        const files = await fsPromises.readdir(BRANDING_DIR);
        const filesToDelete = files.filter((file) => file.startsWith(type));
        for (const file of filesToDelete) {
            await fsPromises.unlink(path.join(BRANDING_DIR, file));
        }

        await settingsRepository.delete(type);
        if (type === 'logoLight' || type === 'logoDark') {
            const emailKey = type === 'logoLight' ? 'logoLightEmail' : 'logoDarkEmail';
            await settingsRepository.delete(emailKey);
            invalidateSettingsCache([type, emailKey]);
        } else {
            invalidateSettingsCache([type]);
        }

        res.json({ message: 'Recurso de marca eliminado' });
    }));

    app.post('/api/admin/smtp/test', requireAdmin, async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Se requiere una dirección de email' });
        }

        try {
            if (!isEmailDeliveryEnabled()) {
                return res.status(400).json({ error: 'Configuración SMTP incompleta. Guarda la configuración primero.' });
            }

            const transporter = createSmtpTransporter();
            await transporter.verify();

            const result = await sendEmail(
                email,
                'Sendu - Email de Prueba',
                'Este es un email de prueba desde Sendu. Si recibes este mensaje, la configuración SMTP está funcionando correctamente.',
                '<h1>Sendu - Email de Prueba</h1><p>Si recibes este mensaje, la configuración SMTP está funcionando correctamente.</p>'
            );

            if (result.mock) {
                return res.json({ message: 'Email enviado (modo simulación)', mock: true });
            }

            res.json({ message: 'Email de prueba enviado correctamente', messageId: result.messageId });
        } catch (err) {
            logger.error('SMTP Test Error', { error: err.message });
            res.status(500).json({ error: `Error SMTP: ${err.message}` });
        }
    });
};

export default registerAdminSettingsRoutes;
