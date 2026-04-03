export const createFilesRepository = ({ db }) => {
    const findByIdStmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const countByUserStmt = db.prepare('SELECT COUNT(*) as total FROM files WHERE userId = ?');
    const listByUserStmt = db.prepare('SELECT * FROM files WHERE userId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?');
    const countAllStmt = db.prepare('SELECT COUNT(*) as total FROM files');
    const listAllStmt = db.prepare('SELECT * FROM files ORDER BY createdAt DESC LIMIT ? OFFSET ?');
    const listExpiredBeforeStmt = db.prepare('SELECT * FROM files WHERE expiresAt IS NOT NULL AND expiresAt < ?');
    const listMaxDownloadsReachedStmt = db.prepare('SELECT * FROM files WHERE maxDownloads IS NOT NULL AND downloadCount >= maxDownloads');
    const listStorageEntriesStmt = db.prepare('SELECT id, serverPath FROM files');
    const insertFileStmt = db.prepare(`
        INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, maxDownloads, passwordHash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteByIdStmt = db.prepare('DELETE FROM files WHERE id = ?');
    const incrementDownloadCountStmt = db.prepare('UPDATE files SET downloadCount = downloadCount + 1 WHERE id = ?');

    return {
        async findById(fileId) {
            return findByIdStmt.get(fileId) || null;
        },

        async countByUser(userId) {
            return countByUserStmt.get(userId)?.total || 0;
        },

        async listByUser(userId, { limit, offset }) {
            return listByUserStmt.all(userId, limit, offset);
        },

        async countAll() {
            return countAllStmt.get()?.total || 0;
        },

        async listAll({ limit, offset }) {
            return listAllStmt.all(limit, offset);
        },

        async listExpiredBefore(timestamp) {
            return listExpiredBeforeStmt.all(timestamp);
        },

        async listMaxDownloadsReached() {
            return listMaxDownloadsReachedStmt.all();
        },

        async listCleanupCandidates(timestamp) {
            const files = [
                ...listExpiredBeforeStmt.all(timestamp),
                ...listMaxDownloadsReachedStmt.all(),
            ];

            return files.filter((file, index, entries) => (
                index === entries.findIndex((entry) => entry.id === file.id)
            ));
        },

        async listStorageEntries() {
            return listStorageEntriesStmt.all();
        },

        async createFile({ id, originalName, serverPath, mimeType, size, createdAt, userId = null, expiresAt = null, maxDownloads = null, passwordHash = null }) {
            return insertFileStmt.run(
                id,
                originalName,
                serverPath,
                mimeType,
                size,
                createdAt,
                userId,
                expiresAt,
                maxDownloads,
                passwordHash,
            ).changes || 0;
        },

        async deleteById(fileId) {
            return deleteByIdStmt.run(fileId).changes || 0;
        },

        async incrementDownloadCount(fileId) {
            return incrementDownloadCountStmt.run(fileId).changes || 0;
        },
    };
};

export default createFilesRepository;