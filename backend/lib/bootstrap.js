export const initializeDatabaseDefaults = ({
    db,
    runMigrations,
    saveDatabase,
    logger,
    getSettingsRepository,
}) => {
    runMigrations(db);

    const ensureDefaults = async () => {
        const settingsRepository = getSettingsRepository();
        const defaultSettings = [
            { key: 'maxConcurrentUploads', value: '6' },
            { key: 'adminBootstrapCompleted', value: 'false' },
        ];

        const existingRows = await settingsRepository.listByKeys(defaultSettings.map((entry) => entry.key));
        const existingKeys = new Set(existingRows.map((row) => row.key));
        const missingSettings = defaultSettings.filter((entry) => !existingKeys.has(entry.key));

        if (missingSettings.length > 0) {
            await settingsRepository.upsertMany(missingSettings);
        }
    };
    return ensureDefaults().then(() => {
        logger.info('Database initialized');
        saveDatabase();
    });
};

export const seedDefaultBrandingSettings = ({
    getSettingsRepository,
    getDefaultBrandingSettings,
}) => {
    const defaults = getDefaultBrandingSettings();

    const seedBranding = async () => {
        const settingsRepository = getSettingsRepository();
        const nonEmptyDefaults = Object.entries(defaults)
            .filter(([, value]) => Boolean(value))
            .map(([key, value]) => ({ key, value }));

        if (nonEmptyDefaults.length === 0) {
            return;
        }

        const existingRows = await settingsRepository.listByKeys(nonEmptyDefaults.map((entry) => entry.key));
        const occupiedKeys = new Set(existingRows.filter((row) => row.value).map((row) => row.key));
        const missingDefaults = nonEmptyDefaults.filter((entry) => !occupiedKeys.has(entry.key));

        if (missingDefaults.length > 0) {
            await settingsRepository.upsertMany(missingDefaults);
        }
    };

    return seedBranding();
};

export const logDatabaseStats = ({
    getUsersRepository,
    getSettingsRepository,
    logger,
}) => {
    const logStats = async () => {
        const adminStats = await getUsersRepository().getAdminStats();
        const settingsCount = await getSettingsRepository().countAll();
        logger.info(`Database loaded: ${adminStats.userCount} users, ${settingsCount} settings`);
    };

    return logStats();
};
