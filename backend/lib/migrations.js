/**
 * Simple, versioned migrations runner (SQLite)
 */
import logger from './logger.js';

const ensureMigrationsTable = (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )
    `);
};

const hasMigration = (db, id) => {
    const row = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(id);
    return !!row;
};

const recordMigration = (db, id) => {
    db.prepare('INSERT OR REPLACE INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(id, Date.now());
};

const migrations = [
    {
        id: '001_initial_schema',
        up: (db) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    username TEXT UNIQUE NOT NULL,
                    passwordHash TEXT NOT NULL,
                    role TEXT DEFAULT 'user',
                    isVerified INTEGER DEFAULT 0,
                    verificationToken TEXT,
                    verificationTokenExpires INTEGER,
                    resetToken TEXT,
                    resetTokenExpires INTEGER,
                    createdAt INTEGER NOT NULL
                );
            `);

            db.exec(`
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    originalName TEXT NOT NULL,
                    serverPath TEXT NOT NULL,
                    mimeType TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    createdAt INTEGER NOT NULL,
                    expiresAt INTEGER,
                    maxDownloads INTEGER,
                    downloadCount INTEGER DEFAULT 0,
                    passwordHash TEXT,
                    userId TEXT,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );
            `);

            db.exec(`
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            `);

            db.exec(`
                CREATE TABLE IF NOT EXISTS reports (
                    id TEXT PRIMARY KEY,
                    fileId TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    createdAt INTEGER NOT NULL,
                    status TEXT DEFAULT 'pending',
                    FOREIGN KEY (fileId) REFERENCES files(id)
                );
            `);

            db.exec(`
                CREATE TABLE IF NOT EXISTS guest_uploads (
                    fingerprint TEXT PRIMARY KEY,
                    totalBytes INTEGER DEFAULT 0,
                    uploadCount INTEGER DEFAULT 0,
                    lastUpload INTEGER,
                    createdAt INTEGER NOT NULL
                );
            `);

            db.exec(`
                CREATE TABLE IF NOT EXISTS upload_sessions (
                    uploadId TEXT PRIMARY KEY,
                    userId TEXT,
                    ipFingerprint TEXT,
                    status TEXT DEFAULT 'initiated',
                    fileId TEXT,
                    bytesReceived INTEGER DEFAULT 0,
                    createdAt INTEGER NOT NULL,
                    updatedAt INTEGER NOT NULL
                );
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status)`);
        }
    },
    {
        id: '002_users_verification_expires',
        up: (db) => {
            try {
                const tableInfo = db.prepare('PRAGMA table_info(users)').all();
                const hasColumn = tableInfo.some(col => col.name === 'verificationTokenExpires');
                if (!hasColumn) {
                    db.exec('ALTER TABLE users ADD COLUMN verificationTokenExpires INTEGER');
                }
            } catch (err) {
                logger.warn('Migration 002 failed', { error: err.message });
            }
        }
    },
    {
        id: '003_upload_sessions_bytes_received',
        up: (db) => {
            try {
                const tableInfo = db.prepare('PRAGMA table_info(upload_sessions)').all();
                const hasColumn = tableInfo.some(col => col.name === 'bytesReceived');
                if (!hasColumn) {
                    db.exec('ALTER TABLE upload_sessions ADD COLUMN bytesReceived INTEGER DEFAULT 0');
                }
            } catch (err) {
                logger.warn('Migration 003 failed', { error: err.message });
            }
        },
    },
    {
        id: '004_files_indexes',
        up: (db) => {
            // Improve query performance for user files and cleanup
            db.exec(`CREATE INDEX IF NOT EXISTS idx_files_userId ON files(userId)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_files_expiresAt ON files(expiresAt)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_files_createdAt ON files(createdAt)`);
        }
    }
];

export const runMigrations = (db) => {
    ensureMigrationsTable(db);
    for (const migration of migrations) {
        if (hasMigration(db, migration.id)) continue;
        try {
            migration.up(db);
            recordMigration(db, migration.id);
            logger.info(`Migration applied: ${migration.id}`);
        } catch (err) {
            logger.error('Migration failed', { id: migration.id, error: err.message });
            throw err;
        }
    }
};

export default {
    runMigrations
};
