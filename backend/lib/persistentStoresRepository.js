export const createPersistentStoresRepository = ({ db, logger }) => {
    let rateLimitTableReady = false;

    const ensureCoreTables = () => {
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

        db.exec(`
            CREATE TABLE IF NOT EXISTS guest_uploads (
                fingerprint TEXT PRIMARY KEY,
                totalBytes INTEGER DEFAULT 0,
                uploadCount INTEGER DEFAULT 0,
                lastUpload INTEGER,
                createdAt INTEGER NOT NULL
            )
        `);

        try {
            const tableInfo = db.prepare('PRAGMA table_info(guest_uploads)').all();
            const columns = new Set(tableInfo.map((column) => column.name));
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

        db.exec('CREATE INDEX IF NOT EXISTS idx_guest_last_upload ON guest_uploads(lastUpload)');

        db.exec(`
            CREATE TABLE IF NOT EXISTS download_tokens (
                token TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_download_expires ON download_tokens(expires_at)');

        db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

        logger.info('Persistent stores tables initialized');
    };

    const ensureRateLimitTable = () => {
        if (rateLimitTableReady) {
            return;
        }

        db.exec(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                key TEXT PRIMARY KEY,
                count INTEGER DEFAULT 0,
                reset_at INTEGER NOT NULL
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limits(reset_at)');
        rateLimitTableReady = true;
    };

    ensureCoreTables();
    ensureRateLimitTable();

    const cleanupExpiredCsrfStmt = db.prepare('DELETE FROM csrf_tokens WHERE expires_at < ?');
    const cleanupExpiredDownloadTokensStmt = db.prepare('DELETE FROM download_tokens WHERE expires_at < ?');
    const cleanupExpiredSessionsStmt = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
    const cleanupOldGuestUploadsStmt = db.prepare('DELETE FROM guest_uploads WHERE lastUpload < ?');
    const upsertCsrfTokenStmt = db.prepare(`
        INSERT OR REPLACE INTO csrf_tokens (key, session_id, expires_at)
        VALUES (?, ?, ?)
    `);
    const consumeCsrfTokenStmt = db.prepare(`
        DELETE FROM csrf_tokens
        WHERE key = ?
          AND session_id = ?
          AND expires_at > ?
    `);
    const clearCsrfTokensBySessionStmt = db.prepare('DELETE FROM csrf_tokens WHERE session_id = ?');
    const getGuestUploadTotalStmt = db.prepare('SELECT totalBytes FROM guest_uploads WHERE fingerprint = ?');
    const getGuestUploadRowStmt = db.prepare('SELECT * FROM guest_uploads WHERE fingerprint = ?');
    const updateGuestUploadStmt = db.prepare(`
        UPDATE guest_uploads
        SET totalBytes = totalBytes + ?, uploadCount = uploadCount + 1, lastUpload = ?
        WHERE fingerprint = ?
    `);
    const insertGuestUploadStmt = db.prepare(`
        INSERT INTO guest_uploads (fingerprint, totalBytes, uploadCount, lastUpload, createdAt)
        VALUES (?, ?, 1, ?, ?)
    `);
    const createDownloadTokenStmt = db.prepare(`
        INSERT INTO download_tokens (token, file_id, expires_at)
        VALUES (?, ?, ?)
    `);
    const consumeDownloadTokenStmt = db.prepare(
        'DELETE FROM download_tokens WHERE token = ? AND file_id = ? AND expires_at > ? RETURNING *'
    );
    const getSessionStmt = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?');
    const upsertSessionStmt = db.prepare(`
        INSERT OR REPLACE INTO sessions (sid, sess, expires_at)
        VALUES (?, ?, ?)
    `);
    const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    const touchSessionStmt = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    const clearSessionsStmt = db.prepare('DELETE FROM sessions');
    const countActiveSessionsStmt = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?');
    const listActiveSessionsStmt = db.prepare('SELECT sid, sess FROM sessions WHERE expires_at > ?');
    const cleanupExpiredRateLimitsStmt = db.prepare('DELETE FROM rate_limits WHERE reset_at < ?');
    const getRateLimitEntryStmt = db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?');
    const upsertRateLimitEntryStmt = db.prepare(`
        INSERT OR REPLACE INTO rate_limits (key, count, reset_at)
        VALUES (?, ?, ?)
    `);
    const incrementRateLimitStmt = db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?');
    const decrementRateLimitStmt = db.prepare('UPDATE rate_limits SET count = MAX(0, count - 1) WHERE key = ?');
    const deleteRateLimitEntryStmt = db.prepare('DELETE FROM rate_limits WHERE key = ?');
    const deleteRateLimitsByPrefixStmt = db.prepare('DELETE FROM rate_limits WHERE key LIKE ?');
    const deleteAllRateLimitsStmt = db.prepare('DELETE FROM rate_limits');

    const recordGuestUploadTxn = db.transaction((fingerprint, bytes, now) => {
        const existing = getGuestUploadRowStmt.get(fingerprint);
        if (existing) {
            updateGuestUploadStmt.run(bytes, now, fingerprint);
            return {
                totalBytes: (existing.totalBytes || 0) + bytes,
                existed: true,
            };
        }

        insertGuestUploadStmt.run(fingerprint, bytes, now, now);
        return {
            totalBytes: bytes,
            existed: false,
        };
    });

    return {
        cleanupExpired(now, oneDayAgo) {
            return {
                csrf: cleanupExpiredCsrfStmt.run(now).changes || 0,
                downloads: cleanupExpiredDownloadTokensStmt.run(now).changes || 0,
                sessions: cleanupExpiredSessionsStmt.run(now).changes || 0,
                guests: cleanupOldGuestUploadsStmt.run(oneDayAgo).changes || 0,
            };
        },

        storeCsrfToken(key, sessionId, expiresAt) {
            return upsertCsrfTokenStmt.run(key, sessionId, expiresAt).changes || 0;
        },

        consumeCsrfToken(key, sessionId, now) {
            return consumeCsrfTokenStmt.run(key, sessionId, now).changes || 0;
        },

        clearCsrfTokensForSession(sessionId) {
            return clearCsrfTokensBySessionStmt.run(sessionId).changes || 0;
        },

        getGuestUploadTotal(fingerprint) {
            return getGuestUploadTotalStmt.get(fingerprint)?.totalBytes || 0;
        },

        recordGuestUpload(fingerprint, bytes, now) {
            return recordGuestUploadTxn(fingerprint, bytes, now);
        },

        storeDownloadToken(token, fileId, expiresAt) {
            return createDownloadTokenStmt.run(token, fileId, expiresAt).changes || 0;
        },

        consumeDownloadToken(token, fileId, now) {
            return !!consumeDownloadTokenStmt.get(token, fileId, now);
        },

        getSession(sid) {
            return getSessionStmt.get(sid) || null;
        },

        setSession(sid, sessionJson, expiresAt) {
            return upsertSessionStmt.run(sid, sessionJson, expiresAt).changes || 0;
        },

        deleteSession(sid) {
            return deleteSessionStmt.run(sid).changes || 0;
        },

        touchSession(sid, expiresAt) {
            return touchSessionStmt.run(expiresAt, sid).changes || 0;
        },

        clearSessions() {
            return clearSessionsStmt.run().changes || 0;
        },

        countActiveSessions(now) {
            return countActiveSessionsStmt.get(now)?.count || 0;
        },

        listActiveSessions(now) {
            return listActiveSessionsStmt.all(now);
        },

        clearExpiredRateLimits(now) {
            return cleanupExpiredRateLimitsStmt.run(now).changes || 0;
        },

        getRateLimitEntry(key) {
            return getRateLimitEntryStmt.get(key) || null;
        },

        setRateLimitEntry(key, count, resetAt) {
            return upsertRateLimitEntryStmt.run(key, count, resetAt).changes || 0;
        },

        incrementRateLimit(key) {
            return incrementRateLimitStmt.run(key).changes || 0;
        },

        decrementRateLimit(key) {
            return decrementRateLimitStmt.run(key).changes || 0;
        },

        deleteRateLimitEntry(key) {
            return deleteRateLimitEntryStmt.run(key).changes || 0;
        },

        resetRateLimits(prefix = null) {
            if (prefix) {
                return deleteRateLimitsByPrefixStmt.run(`${prefix}:%`).changes || 0;
            }
            return deleteAllRateLimitsStmt.run().changes || 0;
        },
    };
};

export default createPersistentStoresRepository;