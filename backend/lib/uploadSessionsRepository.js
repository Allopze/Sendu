export const createUploadSessionsRepository = ({ db }) => {
    const createSessionStmt = db.prepare(`
        INSERT OR REPLACE INTO upload_sessions (uploadId, userId, ipFingerprint, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const findByUploadIdStmt = db.prepare(`
        SELECT uploadId, userId, ipFingerprint, status, fileId, createdAt, updatedAt, bytesReceived
        FROM upload_sessions
        WHERE uploadId = ?
    `);
    const countActiveByUserStmt = db.prepare(`
        SELECT COUNT(*) as count FROM upload_sessions
        WHERE userId = ? AND status IN ('initiated','processing')
    `);
    const countActiveStmt = db.prepare(`
        SELECT COUNT(*) as count FROM upload_sessions
        WHERE status IN ('initiated','processing')
    `);
    const countActiveByIpStmt = db.prepare(`
        SELECT COUNT(*) as count FROM upload_sessions
        WHERE ipFingerprint = ? AND status IN ('initiated','processing')
    `);
    const countStaleActiveBeforeStmt = db.prepare(`
        SELECT COUNT(*) as count FROM upload_sessions
        WHERE status IN ('initiated','processing') AND updatedAt < ?
    `);
    const sumActiveBytesByUserStmt = db.prepare(`
        SELECT COALESCE(SUM(bytesReceived), 0) as total
        FROM upload_sessions
        WHERE userId = ? AND status IN ('initiated','processing')
    `);
    const sumActiveBytesByIpStmt = db.prepare(`
        SELECT COALESCE(SUM(bytesReceived), 0) as total
        FROM upload_sessions
        WHERE ipFingerprint = ? AND status IN ('initiated','processing')
    `);
    const transitionToProcessingStmt = db.prepare(`
        UPDATE upload_sessions SET status = 'processing', updatedAt = ?
        WHERE uploadId = ? AND status IN ('initiated','failed')
    `);
    const updateStatusStmt = db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?');
    const updateBytesReceivedStmt = db.prepare('UPDATE upload_sessions SET bytesReceived = ?, updatedAt = ? WHERE uploadId = ?');
    const completeSessionStmt = db.prepare('UPDATE upload_sessions SET status = ?, fileId = ?, updatedAt = ? WHERE uploadId = ?');
    const deleteFinishedBeforeStmt = db.prepare(`
        DELETE FROM upload_sessions
        WHERE status IN ('completed','cancelled','failed') AND updatedAt < ?
    `);

    return {
        async createSession({ uploadId, userId = null, ipFingerprint = null, status = 'initiated', createdAt, updatedAt }) {
            return createSessionStmt.run(uploadId, userId, ipFingerprint, status, createdAt, updatedAt).changes || 0;
        },

        async findByUploadId(uploadId) {
            return findByUploadIdStmt.get(uploadId) || null;
        },

        async countActiveByUser(userId) {
            return countActiveByUserStmt.get(userId)?.count || 0;
        },

        async countActive() {
            return countActiveStmt.get()?.count || 0;
        },

        async countActiveByIp(ipFingerprint) {
            return countActiveByIpStmt.get(ipFingerprint)?.count || 0;
        },

        async countStaleActiveBefore(timestamp) {
            return countStaleActiveBeforeStmt.get(timestamp)?.count || 0;
        },

        async sumActiveBytesByUser(userId) {
            return sumActiveBytesByUserStmt.get(userId)?.total || 0;
        },

        async sumActiveBytesByIp(ipFingerprint) {
            return sumActiveBytesByIpStmt.get(ipFingerprint)?.total || 0;
        },

        async markProcessing(uploadId, updatedAt) {
            return transitionToProcessingStmt.run(updatedAt, uploadId).changes || 0;
        },

        async updateStatus(uploadId, status, updatedAt) {
            return updateStatusStmt.run(status, updatedAt, uploadId).changes || 0;
        },

        async updateBytesReceived(uploadId, bytesReceived, updatedAt) {
            return updateBytesReceivedStmt.run(bytesReceived, updatedAt, uploadId).changes || 0;
        },

        async markCompleted(uploadId, fileId, updatedAt) {
            return completeSessionStmt.run('completed', fileId, updatedAt, uploadId).changes || 0;
        },

        async deleteFinishedBefore(timestamp) {
            return deleteFinishedBeforeStmt.run(timestamp).changes || 0;
        },
    };
};

export default createUploadSessionsRepository;