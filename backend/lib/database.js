/**
 * SQLite database wrapper using better-sqlite3 (native, durable)
 * 
 * Improvements:
 * - Real SQLite file with WAL for resilience
 * - Synchronous, reliable writes
 * - No periodic in-memory flush
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let dbInstance = null;
let dbPath = null;

function formatDirDiagnostic(dir) {
    const summary = {
        path: dir,
        exists: fs.existsSync(dir),
        writable: false,
    };

    if (!summary.exists) {
        return summary;
    }

    try {
        const stats = fs.statSync(dir);
        summary.mode = `0${(stats.mode & 0o777).toString(8)}`;
        summary.owner = `${stats.uid}:${stats.gid}`;
    } catch {}

    try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
        summary.writable = true;
    } catch {}

    return summary;
}

/**
 * Initialize the database
 * @param {string} filePath - Path to the SQLite database file
 * @returns {Promise<object>} Database instance (better-sqlite3)
 */
export async function initDatabase(filePath) {
    if (dbInstance) {
        return dbInstance;
    }

    dbPath = filePath;

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        const diagnostic = formatDirDiagnostic(dir);
        throw new Error(
            `Database directory is not writable for SQLite: ${JSON.stringify(diagnostic)} (${error.message})`,
            { cause: error }
        );
    }

    try {
        dbInstance = new Database(filePath);
    } catch (error) {
        const diagnostic = formatDirDiagnostic(dir);
        throw new Error(
            `Failed to open SQLite database at ${filePath}: ${JSON.stringify(diagnostic)} (${error.message})`,
            { cause: error }
        );
    }

    // Recommended pragmas for durability/perf balance
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('busy_timeout = 5000');

    return dbInstance;
}

/**
 * Save the database (no-op for better-sqlite3)
 */
export function saveDatabase() {
    // No-op: better-sqlite3 writes directly to disk
}

/**
 * Force an immediate save (no-op for better-sqlite3)
 */
export function forceSave() {
    // No-op
}

/**
 * Close the database
 */
export function closeDatabase() {
    if (dbInstance) {
        try { dbInstance.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        dbInstance.close();
    }
    dbInstance = null;
}

export { dbInstance as db };
