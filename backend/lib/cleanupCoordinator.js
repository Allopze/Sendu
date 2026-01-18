import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..', '..');

const dataDir = process.env.APP_DATA_PATH || process.env.DATA_PATH || path.join(rootDir, 'data');
const tempDir = process.env.APP_TEMP_PATH || path.join(rootDir, 'tmp');
const lockDir = process.env.CLEANUP_LOCK_DIR || tempDir || dataDir;
const LOCK_FILE = process.env.CLEANUP_LOCK_PATH || path.join(lockDir, '.cleanup.lock');
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes - if lock is older, assume stale

/**
 * Distributed cleanup coordinator
 * Uses a lock file mechanism to coordinate cleanup across multiple replicas
 */

/**
 * Try to acquire the cleanup lock
 * @returns {Promise<boolean>} True if lock acquired, false otherwise
 */
export const acquireCleanupLock = async () => {
    try {
        // Ensure lock directory exists (avoid read-only root)
        try {
            await fs.mkdir(path.dirname(LOCK_FILE), { recursive: true });
        } catch (err) {
            logger.error('Error ensuring cleanup lock directory', { error: err.message });
            return false;
        }

        // Check if lock file exists
        try {
            const stat = await fs.stat(LOCK_FILE);
            const lockAge = Date.now() - stat.mtimeMs;
            
            // If lock is old, it's stale - delete and try again
            if (lockAge > LOCK_TIMEOUT) {
                logger.warn('Stale cleanup lock detected, removing', { lockAge });
                await fs.unlink(LOCK_FILE);
            } else {
                // Lock is held by another process
                return false;
            }
        } catch (err) {
            // Lock file doesn't exist, we can proceed
            if (err.code !== 'ENOENT') throw err;
        }
        
        // Create lock file with process info
        const lockData = JSON.stringify({
            pid: process.pid,
            hostname: process.env.HOSTNAME || 'unknown',
            timestamp: Date.now()
        });
        
        await fs.writeFile(LOCK_FILE, lockData, { flag: 'wx' }); // 'wx' fails if file exists
        return true;
    } catch (err) {
        if (err.code === 'EEXIST') {
            // Another process got the lock
            return false;
        }
        logger.error('Error acquiring cleanup lock', { error: err.message });
        return false;
    }
};

/**
 * Release the cleanup lock
 * @returns {Promise<void>}
 */
export const releaseCleanupLock = async () => {
    try {
        await fs.unlink(LOCK_FILE);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error('Error releasing cleanup lock', { error: err.message });
        }
    }
};

/**
 * Update the lock timestamp to prevent it from appearing stale
 * @returns {Promise<void>}
 */
export const touchCleanupLock = async () => {
    try {
        const now = new Date();
        await fs.utimes(LOCK_FILE, now, now);
    } catch (err) {
        logger.error('Error updating cleanup lock', { error: err.message });
    }
};

/**
 * Run cleanup with distributed locking
 * @param {Function} cleanupFn - The cleanup function to run
 * @returns {Promise<boolean>} True if cleanup ran, false if skipped (locked)
 */
export const runWithLock = async (cleanupFn) => {
    const acquired = await acquireCleanupLock();
    
    if (!acquired) {
        logger.debug('Cleanup skipped - lock held by another process');
        return false;
    }
    
    try {
        await cleanupFn();
        return true;
    } finally {
        await releaseCleanupLock();
    }
};

/**
 * Calculate next cleanup time with jitter to prevent thundering herd
 * @param {number} baseInterval - Base interval in milliseconds
 * @returns {number} Interval with jitter
 */
export const getCleanupIntervalWithJitter = (baseInterval) => {
    // Add random jitter of ±10% to prevent all replicas running at the same time
    const jitter = baseInterval * 0.1 * (Math.random() - 0.5) * 2;
    return Math.max(baseInterval + jitter, 60000); // At least 1 minute
};

export default {
    acquireCleanupLock,
    releaseCleanupLock,
    touchCleanupLock,
    runWithLock,
    getCleanupIntervalWithJitter
};
