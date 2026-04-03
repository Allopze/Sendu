/**
 * Persistent stores using SQLite
 * Replaces in-memory Maps for CSRF tokens, guest tracking, download tokens, and sessions
 * 
 * Benefits:
 * - Data persists across server restarts
 * - Works with multiple replicas (shared database)
 * - Automatic expiration cleanup
 */
import crypto from 'crypto';
import logger from './logger.js';
import { createPersistentStoresRepository } from './persistentStoresRepository.js';

let db = null;
let persistentStoresRepository = null;

/**
 * Initialize the persistent stores with database connection
 * @param {object} database - The database instance
 */
export function initPersistentStores(database) {
    db = database;
    persistentStoresRepository = createPersistentStoresRepository({ db, logger });

    // Start cleanup interval (every 5 minutes)
    setInterval(cleanupExpired, 5 * 60 * 1000);
}

/**
 * Cleanup expired entries from all stores
 */
function cleanupExpired() {
    const now = Date.now();
    try {
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const cleanupResult = persistentStoresRepository.cleanupExpired(now, oneDayAgo);

        const totalCleaned = cleanupResult.csrf + cleanupResult.downloads + cleanupResult.sessions + cleanupResult.guests;

        if (totalCleaned > 0) {
            logger.debug('Cleaned up expired persistent store entries', {
                csrf: cleanupResult.csrf,
                downloads: cleanupResult.downloads,
                sessions: cleanupResult.sessions,
                guests: cleanupResult.guests
            });
        }
    } catch (err) {
        logger.error('Error cleaning up persistent stores', { error: err.message });
    }
}

// ============================================
// CSRF Token Store
// ============================================

/**
 * Generate and store a CSRF token
 * @param {string} sessionId - The session ID
 * @returns {string} The generated token
 */
export function generateCsrfToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour
    const key = `${sessionId}:${token}`;

    try {
        persistentStoresRepository.storeCsrfToken(key, sessionId, expiresAt);
    } catch (err) {
        logger.error('Error storing CSRF token', { error: err.message });
    }

    return token;
}

/**
 * Validate and consume a CSRF token (atomic operation to prevent race conditions)
 * @param {string} sessionId - The session ID
 * @param {string} token - The token to validate
 * @returns {boolean} Whether the token is valid
 */
export function validateCsrfToken(sessionId, token) {
    const key = `${sessionId}:${token}`;
    const now = Date.now();

    try {
        return persistentStoresRepository.consumeCsrfToken(key, sessionId, now) > 0;
    } catch (err) {
        logger.error('Error validating CSRF token', { error: err.message });
        return false;
    }
}

/**
 * Clear all CSRF tokens for a session (on logout)
 * @param {string} sessionId - The session ID
 */
export function clearCsrfTokensForSession(sessionId) {
    try {
        persistentStoresRepository.clearCsrfTokensForSession(sessionId);
    } catch (err) {
        logger.error('Error clearing CSRF tokens', { error: err.message });
    }
}

// ============================================
// Guest Upload Tracking Store
// ============================================

/**
 * Get total uploaded bytes for a guest fingerprint
 * @param {string} fingerprint - The guest fingerprint
 * @returns {number} Total bytes uploaded
 */
export function getGuestUploadTotal(fingerprint) {
    try {
        return persistentStoresRepository.getGuestUploadTotal(fingerprint);
    } catch (err) {
        logger.error('Error getting guest upload total', { error: err.message });
        return 0;
    }
}

/**
 * Record an upload for a guest user
 * @param {string} fingerprint - The guest fingerprint
 * @param {number} bytes - Number of bytes uploaded
 */
export function recordGuestUploadPersistent(fingerprint, bytes) {
    try {
        const now = Date.now();
        const result = persistentStoresRepository.recordGuestUpload(fingerprint, bytes, now);

        logger.info('Guest upload recorded', {
            fingerprint: fingerprint.substring(0, 8) + '...',
            bytes,
            totalBytes: result.totalBytes
        });
    } catch (err) {
        logger.error('Error recording guest upload', { error: err.message });
    }
}

/**
 * Check if guest can upload a file of given size
 * @param {string} fingerprint - The guest fingerprint
 * @param {number} fileSize - Size of file to upload
 * @param {number} limitBytes - Upload limit in bytes
 * @returns {{ allowed: boolean, remaining: number, message?: string }}
 */
export function canGuestUploadPersistent(fingerprint, fileSize, limitBytes) {
    const currentTotal = getGuestUploadTotal(fingerprint);
    const remaining = Math.max(0, limitBytes - currentTotal);

    if (fileSize > remaining) {
        const usedMB = Math.round(currentTotal / (1024 * 1024));
        const limitMB = Math.round(limitBytes / (1024 * 1024));

        return {
            allowed: false,
            remaining,
            message: `Has alcanzado el límite de subida para invitados (${usedMB}MB de ${limitMB}MB usados). Crea una cuenta para subir más archivos.`
        };
    }

    return { allowed: true, remaining };
}

// ============================================
// Download Token Store
// ============================================

/**
 * Create a temporary download token
 * @param {string} fileId - The file ID
 * @param {number} ttlMs - Time to live in milliseconds (default 5 minutes)
 * @returns {string} The generated token
 */
export function createDownloadToken(fileId, ttlMs = 5 * 60 * 1000) {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + ttlMs;

    try {
        persistentStoresRepository.storeDownloadToken(token, fileId, expiresAt);
    } catch (err) {
        logger.error('Error creating download token', { error: err.message });
    }

    return token;
}

/**
 * Validate and consume a download token
 * @param {string} token - The token to validate
 * @param {string} fileId - The expected file ID
 * @returns {boolean} Whether the token is valid
 */
export function validateDownloadToken(token, fileId) {
    try {
        return persistentStoresRepository.consumeDownloadToken(token, fileId, Date.now());
    } catch (err) {
        logger.error('Error validating download token', { error: err.message });
        return false;
    }
}

// ============================================
// Session Store (express-session compatible)
// ============================================

/**
 * Create an express-session compatible SQLite store
 * @param {object} session - The express-session module
 * @returns {object} The store instance
 */
export function createSqliteSessionStore(session) {
    const Store = session.Store;

    class SqliteStore extends Store {
        constructor(options = {}) {
            super(options);
        }

        get(sid, callback) {
            try {
                const row = persistentStoresRepository.getSession(sid);

                if (!row) {
                    return callback(null, null);
                }

                if (Date.now() > row.expires_at) {
                    this.destroy(sid, () => { });
                    return callback(null, null);
                }

                const sess = JSON.parse(row.sess);
                callback(null, sess);
            } catch (err) {
                callback(err);
            }
        }

        set(sid, sess, callback) {
            try {
                const maxAge = sess.cookie?.maxAge || (30 * 24 * 60 * 60 * 1000); // Default 30 days
                const expiresAt = Date.now() + maxAge;
                const sessJson = JSON.stringify(sess);

                persistentStoresRepository.setSession(sid, sessJson, expiresAt);

                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        destroy(sid, callback) {
            try {
                persistentStoresRepository.deleteSession(sid);
                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        touch(sid, sess, callback) {
            try {
                const maxAge = sess.cookie?.maxAge || (30 * 24 * 60 * 60 * 1000);
                const expiresAt = Date.now() + maxAge;

                persistentStoresRepository.touchSession(sid, expiresAt);
                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        clear(callback) {
            try {
                persistentStoresRepository.clearSessions();
                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        length(callback) {
            try {
                callback(null, persistentStoresRepository.countActiveSessions(Date.now()));
            } catch (err) {
                callback(err);
            }
        }

        all(callback) {
            try {
                const rows = persistentStoresRepository.listActiveSessions(Date.now());
                const sessions = {};
                for (const row of rows) {
                    sessions[row.sid] = JSON.parse(row.sess);
                }
                callback(null, sessions);
            } catch (err) {
                callback(err);
            }
        }
    }

    return SqliteStore;
}

// ============================================
// Rate Limit Store (express-rate-limit compatible)
// ============================================

/**
 * Create an express-rate-limit compatible SQLite store
 * @returns {object} The store instance
 */
export function createRateLimitStore(windowMs = 60000, options = {}) {
    const keyPrefix = options.keyPrefix ? String(options.keyPrefix) : '';
    const normalizeKey = (key) => {
        if (typeof key === 'string') return key;
        if (key === null || key === undefined) return 'unknown';
        try {
            return JSON.stringify(key);
        } catch {
            return String(key);
        }
    };

    return {
        init: async () => {
            if (!db) return;
            // Cleanup expired entries on init
            persistentStoresRepository.clearExpiredRateLimits(Date.now());
        },

        increment: async (key) => {
            const now = Date.now();
            const keyValue = keyPrefix ? `${keyPrefix}:${normalizeKey(key)}` : normalizeKey(key);
            if (!db) {
                return { totalHits: 1, resetTime: new Date(now + windowMs) };
            }

            try {
                const existing = persistentStoresRepository.getRateLimitEntry(keyValue);

                if (!existing || now > existing.reset_at) {
                    // Entry doesn't exist or expired - create new
                    const resetAt = now + windowMs;
                    persistentStoresRepository.setRateLimitEntry(keyValue, 1, resetAt);
                    return { totalHits: 1, resetTime: new Date(resetAt) };
                }

                // Increment existing
                persistentStoresRepository.incrementRateLimit(keyValue);

                return {
                    totalHits: existing.count + 1,
                    resetTime: new Date(existing.reset_at)
                };
            } catch (err) {
                logger.error('Rate limit increment error', { error: err.message });
                return { totalHits: 1, resetTime: new Date(now + windowMs) };
            }
        },

        decrement: async (key) => {
            try {
                if (!db) return;
                const keyValue = keyPrefix ? `${keyPrefix}:${normalizeKey(key)}` : normalizeKey(key);
                persistentStoresRepository.decrementRateLimit(keyValue);
            } catch (err) {
                logger.error('Rate limit decrement error', { error: err.message });
            }
        },

        resetKey: async (key) => {
            try {
                if (!db) return;
                const keyValue = keyPrefix ? `${keyPrefix}:${normalizeKey(key)}` : normalizeKey(key);
                persistentStoresRepository.deleteRateLimitEntry(keyValue);
            } catch (err) {
                logger.error('Rate limit reset error', { error: err.message });
            }
        },

        shutdown: async () => {
            // No cleanup needed for SQLite
        }
    };
}

// ============================================
// Rate Limit Admin Utilities
// ============================================

/**
 * Reset rate limits by prefix or all
 * @param {string|null} prefix - Optional key prefix (e.g., 'auth')
 * @returns {number} Deleted rows count
 */
export function resetRateLimits(prefix = null) {
    if (!db) return 0;
    return persistentStoresRepository.resetRateLimits(prefix);
}
