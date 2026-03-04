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

let db = null;

const ensureRateLimitTable = () => {
    if (!db) return;
    db.exec(`
        CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY,
            count INTEGER DEFAULT 0,
            reset_at INTEGER NOT NULL
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limits(reset_at)`);
};

/**
 * Initialize the persistent stores with database connection
 * @param {object} database - The database instance
 */
export function initPersistentStores(database) {
    db = database;
    createTables();

    // Start cleanup interval (every 5 minutes)
    setInterval(cleanupExpired, 5 * 60 * 1000);
}

/**
 * Create necessary tables for persistent stores
 */
function createTables() {
    // CSRF tokens table
    db.exec(`
        CREATE TABLE IF NOT EXISTS csrf_tokens (
            key TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_csrf_expires ON csrf_tokens(expires_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_csrf_session ON csrf_tokens(session_id)`);

    // Guest uploads tracking table
    db.exec(`
        CREATE TABLE IF NOT EXISTS guest_uploads (
            fingerprint TEXT PRIMARY KEY,
            totalBytes INTEGER DEFAULT 0,
            uploadCount INTEGER DEFAULT 0,
            lastUpload INTEGER,
            createdAt INTEGER NOT NULL
        )
    `);
    // Migrations: add missing columns for existing databases
    try {
        const tableInfo = db.prepare("PRAGMA table_info(guest_uploads)").all();
        const columns = new Set(tableInfo.map(col => col.name));
        if (!columns.has('totalBytes')) {
            logger.info('Migrating guest_uploads table: adding totalBytes column');
            db.exec('ALTER TABLE guest_uploads ADD COLUMN totalBytes INTEGER DEFAULT 0');
        }
        if (!columns.has('uploadCount')) {
            logger.info('Migrating guest_uploads table: adding uploadCount column');
            db.exec('ALTER TABLE guest_uploads ADD COLUMN uploadCount INTEGER DEFAULT 0');
        }
        if (!columns.has('lastUpload')) {
            logger.info('Migrating guest_uploads table: adding lastUpload column');
            db.exec('ALTER TABLE guest_uploads ADD COLUMN lastUpload INTEGER');
        }
        if (!columns.has('createdAt')) {
            logger.info('Migrating guest_uploads table: adding createdAt column');
            db.exec(`ALTER TABLE guest_uploads ADD COLUMN createdAt INTEGER NOT NULL DEFAULT ${Date.now()}`);
        }
    } catch (err) {
        logger.warn('Could not check guest_uploads migration', { error: err.message });
    }

    db.exec(`CREATE INDEX IF NOT EXISTS idx_guest_last_upload ON guest_uploads(lastUpload)`);

    // Download tokens table
    db.exec(`
        CREATE TABLE IF NOT EXISTS download_tokens (
            token TEXT PRIMARY KEY,
            file_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_download_expires ON download_tokens(expires_at)`);

    // Sessions table for express-session compatible store
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);

    logger.info('Persistent stores tables initialized');
}

/**
 * Cleanup expired entries from all stores
 */
function cleanupExpired() {
    const now = Date.now();
    try {
        // Cleanup CSRF tokens
        const csrfResult = db.prepare('DELETE FROM csrf_tokens WHERE expires_at < ?').run(now);

        // Cleanup download tokens
        const downloadResult = db.prepare('DELETE FROM download_tokens WHERE expires_at < ?').run(now);

        // Cleanup sessions
        const sessionResult = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

        // Cleanup guest uploads older than 24 hours
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const guestResult = db.prepare('DELETE FROM guest_uploads WHERE lastUpload < ?').run(oneDayAgo);

        const totalCleaned = (csrfResult?.changes || 0) + (downloadResult?.changes || 0) +
            (sessionResult?.changes || 0) + (guestResult?.changes || 0);

        if (totalCleaned > 0) {
            logger.debug('Cleaned up expired persistent store entries', {
                csrf: csrfResult?.changes || 0,
                downloads: downloadResult?.changes || 0,
                sessions: sessionResult?.changes || 0,
                guests: guestResult?.changes || 0
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
        db.prepare(`
            INSERT OR REPLACE INTO csrf_tokens (key, session_id, expires_at) 
            VALUES (?, ?, ?)
        `).run(key, sessionId, expiresAt);
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
        // Atomic delete with conditions - only deletes if token exists, is not expired, and matches session
        // This prevents race conditions where two requests could validate the same token
        const result = db.prepare(`
            DELETE FROM csrf_tokens 
            WHERE key = ? 
              AND session_id = ? 
              AND expires_at > ?
        `).run(key, sessionId, now);

        // If a row was deleted, the token was valid
        return result.changes > 0;
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
        db.prepare('DELETE FROM csrf_tokens WHERE session_id = ?').run(sessionId);
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
        const row = db.prepare('SELECT totalBytes FROM guest_uploads WHERE fingerprint = ?').get(fingerprint);
        return row?.totalBytes || 0;
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
        const existing = db.prepare('SELECT * FROM guest_uploads WHERE fingerprint = ?').get(fingerprint);
        const now = Date.now();

        if (existing) {
            db.prepare(`
                UPDATE guest_uploads 
                SET totalBytes = totalBytes + ?, uploadCount = uploadCount + 1, lastUpload = ?
                WHERE fingerprint = ?
            `).run(bytes, now, fingerprint);
        } else {
            db.prepare(`
                INSERT INTO guest_uploads (fingerprint, totalBytes, uploadCount, lastUpload, createdAt)
                VALUES (?, ?, 1, ?, ?)
            `).run(fingerprint, bytes, now, now);
        }

        logger.info('Guest upload recorded', {
            fingerprint: fingerprint.substring(0, 8) + '...',
            bytes,
            totalBytes: (existing?.totalBytes || 0) + bytes
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
        db.prepare(`
            INSERT INTO download_tokens (token, file_id, expires_at) 
            VALUES (?, ?, ?)
        `).run(token, fileId, expiresAt);
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
        // Atomic single-use validation: DELETE + return in one statement
        // Prevents race conditions where two requests could reuse the same token
        const row = db.prepare(
            'DELETE FROM download_tokens WHERE token = ? AND file_id = ? AND expires_at > ? RETURNING *'
        ).get(token, fileId, Date.now());

        return !!row;
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
                const row = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?').get(sid);

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

                db.prepare(`
                    INSERT OR REPLACE INTO sessions (sid, sess, expires_at) 
                    VALUES (?, ?, ?)
                `).run(sid, sessJson, expiresAt);

                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        destroy(sid, callback) {
            try {
                db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        touch(sid, sess, callback) {
            try {
                const maxAge = sess.cookie?.maxAge || (30 * 24 * 60 * 60 * 1000);
                const expiresAt = Date.now() + maxAge;

                db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        clear(callback) {
            try {
                db.prepare('DELETE FROM sessions').run();
                callback(null);
            } catch (err) {
                callback(err);
            }
        }

        length(callback) {
            try {
                const row = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?').get(Date.now());
                callback(null, row.count);
            } catch (err) {
                callback(err);
            }
        }

        all(callback) {
            try {
                const rows = db.prepare('SELECT sid, sess FROM sessions WHERE expires_at > ?').all(Date.now());
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
    let tablesReady = false;
    const ensureTables = () => {
        if (tablesReady || !db) return;
        ensureRateLimitTable();
        tablesReady = true;
    };
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
            ensureTables();
            // Cleanup expired entries on init
            db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(Date.now());
        },

        increment: async (key) => {
            const now = Date.now();
            const keyValue = keyPrefix ? `${keyPrefix}:${normalizeKey(key)}` : normalizeKey(key);
            if (!db) {
                return { totalHits: 1, resetTime: new Date(now + windowMs) };
            }
            ensureTables();

            try {
                const existing = db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(keyValue);

                if (!existing || now > existing.reset_at) {
                    // Entry doesn't exist or expired - create new
                    const resetAt = now + windowMs;
                    db.prepare(`
                        INSERT OR REPLACE INTO rate_limits (key, count, reset_at) 
                        VALUES (?, 1, ?)
                    `).run(keyValue, resetAt);
                    return { totalHits: 1, resetTime: new Date(resetAt) };
                }

                // Increment existing
                db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(keyValue);

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
                ensureTables();
                const keyValue = keyPrefix ? `${keyPrefix}:${normalizeKey(key)}` : normalizeKey(key);
                db.prepare('UPDATE rate_limits SET count = MAX(0, count - 1) WHERE key = ?').run(keyValue);
            } catch (err) {
                logger.error('Rate limit decrement error', { error: err.message });
            }
        },

        resetKey: async (key) => {
            try {
                if (!db) return;
                ensureTables();
                const keyValue = keyPrefix ? `${keyPrefix}:${normalizeKey(key)}` : normalizeKey(key);
                db.prepare('DELETE FROM rate_limits WHERE key = ?').run(keyValue);
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
    ensureRateLimitTable();
    if (prefix) {
        const result = db.prepare('DELETE FROM rate_limits WHERE key LIKE ?').run(`${prefix}:%`);
        return result.changes || 0;
    }
    const result = db.prepare('DELETE FROM rate_limits').run();
    return result.changes || 0;
}
