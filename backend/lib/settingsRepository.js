const createSelectByKeysFactory = (db) => {
    const cache = new Map();

    return (keys) => {
        const count = Array.isArray(keys) ? keys.length : 0;
        if (count === 0) {
            return null;
        }

        if (!cache.has(count)) {
            cache.set(
                count,
                db.prepare(`SELECT key, value FROM settings WHERE key IN (${Array.from({ length: count }, () => '?').join(', ')})`)
            );
        }

        return cache.get(count);
    };
};

export const createSettingsRepository = ({ db }) => {
    const listAllStmt = db.prepare('SELECT key, value FROM settings');
    const countAllStmt = db.prepare('SELECT COUNT(*) as count FROM settings');
    const getValueStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const upsertStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');
    const insertAuditStmt = db.prepare(`
        INSERT INTO settings_audit_log (adminUserId, settingKey, oldValue, newValue, changedAt)
        VALUES (?, ?, ?, ?, ?)
    `);
    const getSelectByKeysStmt = createSelectByKeysFactory(db);
    let countAuditStmt = null;
    let listAuditStmt = null;

    const getCountAuditStmt = () => {
        if (!countAuditStmt) {
            countAuditStmt = db.prepare('SELECT COUNT(*) as total FROM settings_audit_log');
        }

        return countAuditStmt;
    };

    const getListAuditStmt = () => {
        if (!listAuditStmt) {
            listAuditStmt = db.prepare(`
                SELECT
                    l.id,
                    l.adminUserId,
                    u.username AS adminUsername,
                    l.settingKey,
                    l.oldValue,
                    l.newValue,
                    l.changedAt
                FROM settings_audit_log l
                LEFT JOIN users u ON u.id = l.adminUserId
                ORDER BY l.changedAt DESC
                LIMIT ? OFFSET ?
            `);
        }

        return listAuditStmt;
    };

    const upsertManyTxn = db.transaction((entries) => {
        let changes = 0;

        for (const entry of entries) {
            if (!entry || typeof entry.key !== 'string') {
                continue;
            }

            const result = upsertStmt.run(entry.key, entry.value);
            changes += result.changes || 0;
        }

        return changes;
    });

    const deleteManyTxn = db.transaction((keys) => {
        let changes = 0;

        for (const key of keys) {
            if (typeof key !== 'string' || key.length === 0) {
                continue;
            }

            const result = deleteStmt.run(key);
            changes += result.changes || 0;
        }

        return changes;
    });

    const applyChangesWithAuditTxn = db.transaction((changes, adminUserId, changedAt) => {
        const changedKeys = [];

        for (const change of changes) {
            if (!change || typeof change.key !== 'string' || change.key.length === 0) {
                continue;
            }

            upsertStmt.run(change.key, change.value);
            insertAuditStmt.run(
                adminUserId,
                change.key,
                change.oldValue ?? '',
                change.newValue ?? '',
                changedAt
            );
            changedKeys.push(change.key);
        }

        return changedKeys;
    });

    const listByKeysSync = (keys) => {
        if (!Array.isArray(keys) || keys.length === 0) {
            return [];
        }

        return getSelectByKeysStmt(keys).all(...keys);
    };

    const upsertManySync = (entries) => {
        if (!Array.isArray(entries) || entries.length === 0) {
            return 0;
        }

        return upsertManyTxn(entries);
    };

    return {
        async listAll() {
            return listAllStmt.all();
        },

        async countAll() {
            return countAllStmt.get()?.count || 0;
        },

        async listByKeys(keys) {
            return listByKeysSync(keys);
        },

        listByKeysSync,

        async getValue(key) {
            if (typeof key !== 'string' || key.length === 0) {
                return null;
            }

            return getValueStmt.get(key)?.value ?? null;
        },

        async upsert(key, value) {
            if (typeof key !== 'string' || key.length === 0) {
                return 0;
            }

            return upsertStmt.run(key, value).changes || 0;
        },

        async upsertMany(entries) {
            return upsertManySync(entries);
        },

        upsertManySync,

        async delete(key) {
            if (typeof key !== 'string' || key.length === 0) {
                return 0;
            }

            return deleteStmt.run(key).changes || 0;
        },

        async deleteMany(keys) {
            if (!Array.isArray(keys) || keys.length === 0) {
                return 0;
            }

            return deleteManyTxn(keys);
        },

        async applyChangesWithAudit({ changes, adminUserId, changedAt = Date.now() } = {}) {
            if (!Array.isArray(changes) || changes.length === 0) {
                return [];
            }

            if (typeof adminUserId !== 'string' || adminUserId.length === 0) {
                throw new Error('adminUserId is required to audit settings changes');
            }

            return applyChangesWithAuditTxn(changes, adminUserId, changedAt);
        },

        async listAudit({ page = 1, limit = 20 } = {}) {
            const normalizedPage = Math.max(1, parseInt(page, 10) || 1);
            const normalizedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
            const offset = (normalizedPage - 1) * normalizedLimit;
            const total = getCountAuditStmt().get()?.total || 0;
            const entries = getListAuditStmt().all(normalizedLimit, offset);

            return {
                entries,
                pagination: {
                    page: normalizedPage,
                    limit: normalizedLimit,
                    total,
                    totalPages: Math.ceil(total / normalizedLimit)
                }
            };
        },
    };
};

export default createSettingsRepository;