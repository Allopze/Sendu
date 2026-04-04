/**
 * Runtime settings cache
 *
 * In-memory cache for frequently accessed settings (SMTP, upload limits,
 * branding) that avoids hitting the database on every request.  The cache
 * is invalidated when settings are updated via the admin panel.
 */
import logger from './logger.js';

/**
 * Create a runtime settings cache bound to a settings repository getter.
 *
 * @param {object} opts
 * @param {Function} opts.getSettingsRepository – lazy getter (DB may not be ready yet)
 * @param {boolean} opts.isTest – disable TTL in test mode
 * @returns cache API
 */
export const createRuntimeSettingsCache = ({ getSettingsRepository, isTest = false }) => {
    const RUNTIME_SETTINGS_KEYS = [
        'largeFileChunkSize',
        'maxFileSize',
        'maxTotalSize',
        'guestUploadLimit',
        'guestMaxFileSize',
        'chunkRateLimit',
        'maxConcurrentUploads',
        'smtpHost',
        'smtpPort',
        'smtpSecure',
        'smtpUser',
        'smtpPass',
        'smtpFrom',
        'emailTemplates',
        'logoDarkEmail',
        'logoDark',
        'logoLightEmail',
        'logoLight',
    ];

    const REFRESH_TTL_MS = isTest ? 0 : 30000;

    let state = {
        values: new Map(),
        refreshedAt: 0,
        dirty: true,
        refreshPromise: null,
    };

    const reset = () => {
        state = {
            values: new Map(),
            refreshedAt: 0,
            dirty: true,
            refreshPromise: null,
        };
    };

    const markStale = () => {
        state.dirty = true;
        state.refreshedAt = 0;
    };

    const getValue = (key, defaultValue = null) => {
        if (!state.values.has(key)) {
            return defaultValue;
        }
        return state.values.get(key);
    };

    const refresh = async ({ force = false } = {}) => {
        let db;
        try {
            // getSettingsRepository throws if db is not ready
            getSettingsRepository();
            db = true;
        } catch {
            db = false;
        }

        if (!db) {
            return state.values;
        }

        const now = Date.now();
        if (!force && !state.dirty && (now - state.refreshedAt) < REFRESH_TTL_MS) {
            return state.values;
        }

        if (state.refreshPromise) {
            return state.refreshPromise;
        }

        state.refreshPromise = (async () => {
            const rows = await getSettingsRepository().listByKeys(RUNTIME_SETTINGS_KEYS);
            const nextValues = new Map();
            rows.forEach((row) => {
                nextValues.set(row.key, row.value);
            });
            state.values = nextValues;
            state.refreshedAt = Date.now();
            state.dirty = false;
            return state.values;
        })()
            .catch((err) => {
                logger.warn('Runtime settings cache refresh failed', { error: err.message });
                throw err;
            })
            .finally(() => {
                state.refreshPromise = null;
            });

        return state.refreshPromise;
    };

    /** Express middleware that ensures the cache is warm */
    const ensureLoaded = async (_req, _res, next) => {
        try {
            await refresh();
        } catch { }
        next();
    };

    /** Invalidate + immediate background refresh */
    const invalidate = () => {
        markStale();
        refresh({ force: true }).catch(() => { });
    };

    return {
        RUNTIME_SETTINGS_KEYS,
        reset,
        markStale,
        getValue,
        refresh,
        ensureLoaded,
        invalidate,
    };
};
