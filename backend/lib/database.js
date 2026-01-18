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

    dbInstance = new Database(filePath);

    // Recommended pragmas for durability/perf balance
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('foreign_keys = ON');

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
        dbInstance.close();
    }
    dbInstance = null;
}

export { dbInstance as db };
