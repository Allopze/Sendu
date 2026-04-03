export const registerPublicSettingsRoutes = ({
    app,
    asyncHandler,
    getSettingsRepository,
    getDefaultBrandingSettings,
    isEmailDeliveryEnabled,
    getMaxChunkSizeFromSettingsSync,
    generateFingerprint,
    getIpFingerprint,
    canGuestUpload,
}) => {
    app.get('/api/settings/public', asyncHandler(async (req, res) => {
        const keys = ['logoLight', 'logoDark', 'favicon', 'dropzoneIcon', 'footerText'];
        const settings = await getSettingsRepository().listByKeys(keys);

        const defaultBranding = getDefaultBrandingSettings();
        const emailDeliveryEnabled = isEmailDeliveryEnabled();
        const settingsMap = {
            logoLight: defaultBranding.logoLight,
            logoDark: defaultBranding.logoDark,
            favicon: defaultBranding.favicon,
            dropzoneIcon: defaultBranding.dropzoneIcon,
            footerText: '',
            emailDeliveryEnabled,
            requiresEmailVerification: emailDeliveryEnabled,
            passwordResetEnabled: emailDeliveryEnabled
        };

        settings.forEach((setting) => {
            settingsMap[setting.key] = setting.value;
        });

        res.json(settingsMap);
    }));

    app.get('/api/settings/limits', asyncHandler(async (req, res) => {
        const keys = [
            'maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize',
            'chunkSize', 'maxConcurrentUploads',
            'adaptiveChunkSizing', 'smallFileThreshold', 'mediumFileThreshold',
            'smallFileChunkSize', 'mediumFileChunkSize', 'largeFileChunkSize',
            'chunkRateLimit'
        ];
        const settings = await getSettingsRepository().listByKeys(keys);

        const settingsMap = {
            maxFileSize: 100,
            maxTotalSize: 500,
            guestUploadLimit: 5120,
            guestMaxFileSize: 50,
            chunkSize: 20,
            maxConcurrentUploads: 6,
            adaptiveChunkSizing: true,
            smallFileThreshold: 100,
            mediumFileThreshold: 1024,
            smallFileChunkSize: 16,
            mediumFileChunkSize: 48,
            largeFileChunkSize: 96,
            chunkRateLimit: 1000
        };

        settings.forEach((setting) => {
            if (setting.key === 'adaptiveChunkSizing') {
                settingsMap[setting.key] = setting.value === 'true' || setting.value === true;
            } else {
                settingsMap[setting.key] = parseInt(setting.value, 10) || settingsMap[setting.key];
            }
        });

        const isLoggedIn = !!req.session.userId;
        settingsMap.effectiveMaxFileSize = isLoggedIn ? settingsMap.maxFileSize : settingsMap.guestMaxFileSize;
        settingsMap.isLoggedIn = isLoggedIn;
        settingsMap.maxChunkSize = Math.round(getMaxChunkSizeFromSettingsSync() / (1024 * 1024));

        if (!isLoggedIn) {
            const fingerprint = generateFingerprint(req);
            const ipFingerprint = getIpFingerprint(req);
            const guestLimitBytes = settingsMap.guestUploadLimit * 1024 * 1024;

            const fingerprintCheck = canGuestUpload(fingerprint, 0, guestLimitBytes);
            const ipCheck = canGuestUpload(ipFingerprint, 0, guestLimitBytes);

            settingsMap.guestRemaining = Math.min(fingerprintCheck.remaining, ipCheck.remaining);
        }

        res.json(settingsMap);
    }));
};
