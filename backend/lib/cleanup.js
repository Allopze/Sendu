/**
 * Cleanup module
 *
 * Periodic cleanup jobs for expired files, orphaned chunks,
 * stale upload sessions, and disk‑space monitoring.
 *
 * Extracted from server.js to reduce file size and improve testability.
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import checkDiskSpace from 'check-disk-space';
import logger from './logger.js';
import { metrics } from './metrics.js';
import { runWithLock, getCleanupIntervalWithJitter } from './cleanupCoordinator.js';

// ── Cleanup functions ───────────────────────────────────────

export const cleanupExpiredFiles = async ({ getFilesRepository }) => {
    const now = Date.now();
    const uniqueFiles = await getFilesRepository().listCleanupCandidates(now);

    if (uniqueFiles.length === 0) return;

    logger.info(`Cleanup: Found ${uniqueFiles.length} expired files to delete`);

    for (const file of uniqueFiles) {
        try {
            try {
                await fsPromises.unlink(file.serverPath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    logger.warn('Cleanup: File not found on disk', { fileId: file.id });
                }
            }
            await getFilesRepository().deleteById(file.id);
            logger.info(`Cleanup: Deleted file ${file.id} (${file.originalName})`);
        } catch (err) {
            logger.error('Cleanup error', { fileId: file.id, error: err.message });
        }
    }
};

export const cleanupUploadSessions = async ({ getUploadSessionsRepository }) => {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    try {
        await getUploadSessionsRepository().deleteFinishedBefore(cutoff);
    } catch (err) {
        logger.warn('Cleanup upload sessions failed', { error: err.message });
    }
};

export const reconcileOrphanedFiles = async ({ getFilesRepository, UPLOAD_DIR }) => {
    try {
        const dbFiles = await getFilesRepository().listStorageEntries();
        const dbPathSet = new Set(dbFiles.map(f => f.serverPath));

        const entries = await fsPromises.readdir(UPLOAD_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) continue;
            const filePath = path.join(UPLOAD_DIR, entry.name);
            if (!dbPathSet.has(filePath)) {
                try {
                    await fsPromises.unlink(filePath);
                    logger.info('Reconcile: deleted orphaned file', { file: entry.name });
                } catch (err) {
                    logger.warn('Reconcile: failed to delete orphaned file', { file: entry.name, error: err.message });
                }
            }
        }

        for (const file of dbFiles) {
            if (!fs.existsSync(file.serverPath)) {
                await getFilesRepository().deleteById(file.id);
                logger.warn('Reconcile: removed DB entry for missing file', { fileId: file.id });
            }
        }
    } catch (err) {
        logger.error('Reconcile orphaned files failed', { error: err.message });
    }
};

export const cleanupOrphanedChunks = async (CHUNKS_DIR, maxAgeMs = 24 * 60 * 60 * 1000) => {
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;

    if (!fs.existsSync(CHUNKS_DIR)) {
        fs.mkdirSync(CHUNKS_DIR, { recursive: true });
        return { deletedCount: 0, freedBytes: 0 };
    }

    try {
        const chunkDirs = await fsPromises.readdir(CHUNKS_DIR);

        for (const dir of chunkDirs) {
            const chunkPath = path.join(CHUNKS_DIR, dir);

            try {
                const stat = await fsPromises.stat(chunkPath);
                if (!stat.isDirectory()) continue;

                let lastActivity = stat.mtimeMs;
                const files = await fsPromises.readdir(chunkPath);
                for (const file of files) {
                    try {
                        const fileStat = await fsPromises.stat(path.join(chunkPath, file));
                        if (fileStat.mtimeMs > lastActivity) {
                            lastActivity = fileStat.mtimeMs;
                        }
                    } catch { }
                }

                const timeSinceLastActivity = now - lastActivity;
                if (timeSinceLastActivity > maxAgeMs) {
                    for (const file of files) {
                        try {
                            const fileStat = await fsPromises.stat(path.join(chunkPath, file));
                            freedBytes += fileStat.size;
                        } catch { }
                    }

                    await fsPromises.rm(chunkPath, { recursive: true, force: true });
                    deletedCount++;
                    logger.info(`Cleanup: Deleted orphaned chunk folder ${dir} (inactive for ${Math.round(timeSinceLastActivity / 60000)} minutes)`);
                }
            } catch (err) {
                logger.warn('Error processing chunk folder', { dir, error: err.message });
            }
        }
    } catch (err) {
        logger.error('Error reading chunks directory', { error: err.message });
    }

    return { deletedCount, freedBytes };
};

// ── Disk space monitor ──────────────────────────────────────

export const monitorDiskSpace = async (UPLOAD_DIR, DISK_WARN_PERCENT = 10, DISK_WARN_GB = 5) => {
    try {
        const { free, size } = await checkDiskSpace(UPLOAD_DIR);
        const freePercent = size > 0 ? Math.round((free / size) * 100) : 0;
        const freeGb = Math.round(free / (1024 * 1024 * 1024));
        if (freePercent <= DISK_WARN_PERCENT || freeGb <= DISK_WARN_GB) {
            metrics.increment('disk_low', 1);
            logger.warn('Low disk space detected', { freePercent, freeGb, path: UPLOAD_DIR });
        }
    } catch (err) {
        logger.warn('Disk space monitor failed', { error: err.message });
    }
};

// ── Scheduler ───────────────────────────────────────────────

/**
 * Start all cleanup schedulers.
 * Returns a teardown function that clears the intervals.
 */
export const startCleanupSchedulers = ({
    db,
    getFilesRepository,
    getUploadSessionsRepository,
    UPLOAD_DIR,
    CHUNKS_DIR,
    CHUNK_CLEANUP_MAX_AGE_HOURS = 24,
    CLEANUP_INTERVAL = 60 * 60 * 1000,
    CHUNK_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000,
    DISK_CHECK_INTERVAL = 5 * 60 * 1000,
    DISK_WARN_PERCENT = 10,
    DISK_WARN_GB = 5,
}) => {
    const runCleanup = async () => {
        if (!db) return;
        const ran = await runWithLock(async () => {
            await cleanupExpiredFiles({ getFilesRepository });
            await cleanupUploadSessions({ getUploadSessionsRepository });
            await reconcileOrphanedFiles({ getFilesRepository, UPLOAD_DIR });
        });
        if (ran) {
            logger.debug('Cleanup completed successfully');
        }
    };

    const maxAgeMs = Math.max(1, Math.min(720, CHUNK_CLEANUP_MAX_AGE_HOURS)) * 60 * 60 * 1000;

    const runChunkCleanup = async () => {
        if (!db) return;
        const ran = await runWithLock(async () => {
            await cleanupOrphanedChunks(CHUNKS_DIR, maxAgeMs);
        });
        if (ran) {
            logger.debug('Chunk cleanup completed successfully');
        }
    };

    const scheduleNextCleanup = () => {
        const interval = getCleanupIntervalWithJitter(CLEANUP_INTERVAL);
        setTimeout(async () => {
            await runCleanup();
            scheduleNextCleanup();
        }, interval);
    };

    const scheduleNextChunkCleanup = () => {
        const interval = getCleanupIntervalWithJitter(CHUNK_CLEANUP_INTERVAL);
        setTimeout(async () => {
            await runChunkCleanup();
            scheduleNextChunkCleanup();
        }, interval);
    };

    // Run immediately, then schedule
    runCleanup();
    scheduleNextCleanup();
    runChunkCleanup();
    scheduleNextChunkCleanup();
    monitorDiskSpace(UPLOAD_DIR, DISK_WARN_PERCENT, DISK_WARN_GB);
    const diskInterval = setInterval(() => monitorDiskSpace(UPLOAD_DIR, DISK_WARN_PERCENT, DISK_WARN_GB), DISK_CHECK_INTERVAL);

    return () => {
        clearInterval(diskInterval);
    };
};
