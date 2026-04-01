const normalizeString = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
};

const hasMeaningfulValue = (key, value) => {
    if (key === 'smtpSecure') {
        return normalizeString(value) !== '';
    }
    return normalizeString(value) !== '';
};

export const SMTP_ENV_KEY_MAP = {
    smtpHost: 'SMTP_HOST',
    smtpPort: 'SMTP_PORT',
    smtpSecure: 'SMTP_SECURE',
    smtpUser: 'SMTP_USER',
    smtpPass: 'SMTP_PASS',
    smtpFrom: 'SMTP_FROM',
};

export const getSmtpEnvironmentConfig = (env = process.env) => {
    const config = {};

    for (const [key, envKey] of Object.entries(SMTP_ENV_KEY_MAP)) {
        const value = normalizeString(env[envKey]);
        if (!value) {
            continue;
        }

        config[key] = key === 'smtpSecure'
            ? (value.toLowerCase() === 'true' ? 'true' : 'false')
            : value;
    }

    const hasBaseConfig = Boolean(config.smtpHost || config.smtpUser || config.smtpPass || config.smtpFrom);
    if (hasBaseConfig && !config.smtpPort) {
        config.smtpPort = '587';
    }

    if ((hasBaseConfig || config.smtpPort) && !config.smtpSecure) {
        config.smtpSecure = config.smtpPort === '465' ? 'true' : 'false';
    }

    return config;
};

export const mergeSmtpConfig = (baseConfig = {}, overrideConfig = {}) => {
    const merged = { ...baseConfig };

    for (const [key, rawValue] of Object.entries(overrideConfig)) {
        if (!hasMeaningfulValue(key, rawValue)) {
            continue;
        }

        const normalized = normalizeString(rawValue);
        merged[key] = key === 'smtpSecure'
            ? (normalized.toLowerCase() === 'true' ? 'true' : 'false')
            : normalized;
    }

    return merged;
};

export const mergeSmtpIntoSettings = (settingsMap = {}, envConfig = {}) => {
    const merged = { ...settingsMap };

    for (const key of ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFrom']) {
        if (!normalizeString(merged[key]) && normalizeString(envConfig[key])) {
            merged[key] = envConfig[key];
        }
    }

    merged.smtpPassConfigured = Boolean(merged.smtpPassConfigured || envConfig.smtpPass);

    const hasSettingsConfig = Boolean(
        normalizeString(settingsMap.smtpHost)
        || normalizeString(settingsMap.smtpUser)
        || normalizeString(settingsMap.smtpFrom)
        || settingsMap.smtpPassConfigured
    );
    const hasEnvConfig = Boolean(
        normalizeString(envConfig.smtpHost)
        || normalizeString(envConfig.smtpUser)
        || normalizeString(envConfig.smtpFrom)
        || normalizeString(envConfig.smtpPass)
    );

    merged.smtpConfigSource = hasSettingsConfig && hasEnvConfig
        ? 'mixed'
        : hasSettingsConfig
            ? 'settings'
            : hasEnvConfig
                ? 'environment'
                : 'none';

    return merged;
};