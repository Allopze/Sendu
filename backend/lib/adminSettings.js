const SETTINGS_AUDIT_REDACTED = '[REDACTED]';

export const SENSITIVE_SETTINGS_KEYS = new Set(['smtpPass']);

export const ALLOWED_SETTINGS_KEYS = new Set([
    'logoLight', 'logoDark', 'logoLightEmail', 'logoDarkEmail',
    'favicon', 'dropzoneIcon', 'footerText',
    'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom',
    'maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize', 'chunkSize',
    'maxConcurrentUploads', 'chunkRateLimit', 'adaptiveChunkSizing',
    'smallFileThreshold', 'mediumFileThreshold', 'smallFileChunkSize',
    'mediumFileChunkSize', 'largeFileChunkSize', 'emailTemplates',
    'defaultRetentionDays'
]);

const STRING_MAX_LENGTHS = {
    logoLight: 2048,
    logoDark: 2048,
    logoLightEmail: 2048,
    logoDarkEmail: 2048,
    favicon: 2048,
    dropzoneIcon: 2048,
    footerText: 500,
    smtpHost: 255,
    smtpUser: 320,
    smtpPass: 2048,
    smtpFrom: 320,
    emailTemplates: 200000,
};

const INTEGER_LIMITS = {
    smtpPort: { min: 1, max: 65535 },
    maxFileSize: { min: 1, max: 102400 },
    maxTotalSize: { min: 1, max: 102400 },
    guestUploadLimit: { min: 1, max: 102400 },
    guestMaxFileSize: { min: 1, max: 102400 },
    chunkSize: { min: 1, max: 200 },
    maxConcurrentUploads: { min: 1, max: 100 },
    chunkRateLimit: { min: 1, max: 50000 },
    smallFileThreshold: { min: 1, max: 102400 },
    mediumFileThreshold: { min: 1, max: 102400 },
    smallFileChunkSize: { min: 1, max: 200 },
    mediumFileChunkSize: { min: 1, max: 200 },
    largeFileChunkSize: { min: 1, max: 200 },
    defaultRetentionDays: { min: 1, max: 365 },
};

const BOOLEAN_SETTINGS = new Set(['smtpSecure', 'adaptiveChunkSizing']);

const trimToString = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
};

const normalizeInteger = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
};

const isBlank = (value) => trimToString(value) === '';

const isBooleanLike = (value) => {
    if (typeof value === 'boolean') {
        return true;
    }

    const normalized = trimToString(value).toLowerCase();
    return normalized === '' || normalized === 'true' || normalized === 'false';
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const serializeTemplates = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return '';
    }
    return JSON.stringify(value);
};

export const stringifySettingValue = (key, value) => {
    if (key === 'emailTemplates') {
        return serializeTemplates(value);
    }
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
};

export const sanitizeSettingAuditValue = (key, value) => {
    if (SENSITIVE_SETTINGS_KEYS.has(key)) {
        return value ? SETTINGS_AUDIT_REDACTED : '';
    }
    const normalized = value === undefined || value === null ? '' : String(value);
    const MAX_AUDIT_VALUE_LEN = 2000;
    if (normalized.length > MAX_AUDIT_VALUE_LEN) {
        return `${normalized.slice(0, MAX_AUDIT_VALUE_LEN)}...[truncated]`;
    }
    return normalized;
};

export const serializeAdminSettings = (settingsRows) => {
    const settingsMap = {};

    for (const setting of settingsRows) {
        if (SENSITIVE_SETTINGS_KEYS.has(setting.key)) {
            settingsMap[setting.key] = '';
            settingsMap.smtpPassConfigured = Boolean(setting.value);
            continue;
        }

        settingsMap[setting.key] = setting.value;
    }

    if (settingsMap.smtpPassConfigured === undefined) {
        settingsMap.smtpPassConfigured = false;
    }

    return settingsMap;
};

export const validateAdminSettingsPayload = (settings) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return 'Payload de configuracion invalido';
    }

    const unknownKeys = Object.keys(settings).filter((key) => !ALLOWED_SETTINGS_KEYS.has(key));
    if (unknownKeys.length > 0) {
        return `Claves de configuración no permitidas: ${unknownKeys.join(', ')}`;
    }

    const errors = [];

    for (const [key, rawValue] of Object.entries(settings)) {
        if (BOOLEAN_SETTINGS.has(key) && !isBooleanLike(rawValue)) {
            errors.push(`${key} debe ser true o false`);
            continue;
        }

        if (Object.hasOwn(INTEGER_LIMITS, key) && !isBlank(rawValue)) {
            const numericValue = normalizeInteger(rawValue);
            const { min, max } = INTEGER_LIMITS[key];
            if (numericValue === null || numericValue < min || numericValue > max) {
                errors.push(`${key} debe ser un entero entre ${min} y ${max}`);
            }
            continue;
        }

        if (Object.hasOwn(STRING_MAX_LENGTHS, key)) {
            const value = key === 'emailTemplates'
                ? serializeTemplates(rawValue)
                : stringifySettingValue(key, rawValue);

            if (value.length > STRING_MAX_LENGTHS[key]) {
                errors.push(`${key} excede la longitud maxima permitida`);
                continue;
            }

            if (key === 'smtpFrom' && value && !isValidEmail(value)) {
                errors.push('smtpFrom debe ser un email valido');
            }

            if (key === 'emailTemplates' && value) {
                try {
                    const parsed = JSON.parse(value);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        errors.push('emailTemplates debe ser un objeto JSON valido');
                    }
                } catch {
                    errors.push('emailTemplates debe ser un JSON valido');
                }
            }
        }
    }

    const smallFileThreshold = normalizeInteger(settings.smallFileThreshold);
    const mediumFileThreshold = normalizeInteger(settings.mediumFileThreshold);
    if (smallFileThreshold !== null && mediumFileThreshold !== null && mediumFileThreshold < smallFileThreshold) {
        errors.push('mediumFileThreshold no puede ser menor que smallFileThreshold');
    }

    const smallChunkSize = normalizeInteger(settings.smallFileChunkSize);
    const mediumChunkSize = normalizeInteger(settings.mediumFileChunkSize);
    const largeChunkSize = normalizeInteger(settings.largeFileChunkSize);
    if (smallChunkSize !== null && mediumChunkSize !== null && mediumChunkSize < smallChunkSize) {
        errors.push('mediumFileChunkSize no puede ser menor que smallFileChunkSize');
    }
    if (mediumChunkSize !== null && largeChunkSize !== null && largeChunkSize < mediumChunkSize) {
        errors.push('largeFileChunkSize no puede ser menor que mediumFileChunkSize');
    }

    const maxFileSize = normalizeInteger(settings.maxFileSize);
    const maxTotalSize = normalizeInteger(settings.maxTotalSize);
    if (maxFileSize !== null && maxTotalSize !== null && maxTotalSize < maxFileSize) {
        errors.push('maxTotalSize no puede ser menor que maxFileSize');
    }

    const guestUploadLimit = normalizeInteger(settings.guestUploadLimit);
    const guestMaxFileSize = normalizeInteger(settings.guestMaxFileSize);
    if (guestUploadLimit !== null && guestMaxFileSize !== null && guestUploadLimit < guestMaxFileSize) {
        errors.push('guestUploadLimit no puede ser menor que guestMaxFileSize');
    }

    if (errors.length === 0) {
        return null;
    }

    return errors.join('; ');
};

export const applyAdminSettings = ({
    db,
    settings,
    adminUserId,
    safeCompare,
    encrypt,
    decrypt,
    isEncrypted,
}) => {
    const getCurrentStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const upsertStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const auditStmt = db.prepare(`
        INSERT INTO settings_audit_log (adminUserId, settingKey, oldValue, newValue, changedAt)
        VALUES (?, ?, ?, ?, ?)
    `);

    const applySettings = db.transaction((incomingSettings, currentAdminUserId) => {
        const now = Date.now();
        const changedKeys = [];

        for (const [key, rawValue] of Object.entries(incomingSettings)) {
            const existingValue = getCurrentStmt.get(key)?.value ?? null;
            let finalValue = null;

            if (SENSITIVE_SETTINGS_KEYS.has(key)) {
                const submittedSecret = trimToString(rawValue);

                if (!submittedSecret) {
                    continue;
                }

                const existingSecret = existingValue
                    ? (isEncrypted(existingValue) ? decrypt(existingValue) : existingValue)
                    : '';

                if (existingSecret && safeCompare(existingSecret, submittedSecret)) {
                    continue;
                }

                finalValue = isEncrypted(submittedSecret) ? submittedSecret : encrypt(submittedSecret);
            } else {
                finalValue = stringifySettingValue(key, rawValue);
                if (existingValue === finalValue) {
                    continue;
                }
            }

            upsertStmt.run(key, finalValue);
            auditStmt.run(
                currentAdminUserId,
                key,
                sanitizeSettingAuditValue(key, existingValue),
                sanitizeSettingAuditValue(key, finalValue),
                now
            );
            changedKeys.push(key);
        }

        return changedKeys;
    });

    return applySettings(settings, adminUserId);
};