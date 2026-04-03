/**
 * Simple, versioned migrations runner (SQLite)
 */
import logger from './logger.js';
import { encrypt, decrypt, getEncryptionFormat } from './encryption.js';
import { migrateSensitiveSettingsToCurrentEncryption } from './adminSettings.js';
import { createMigrationsRepository } from './migrationsRepository.js';
import { SQLITE_DURABLE_STATE_GROUPS, ensureSqliteDurableStateObjects } from './durableStateSchema.js';

const migrations = [
    {
        id: '001_initial_schema',
        up: (db) => {
            ensureSqliteDurableStateObjects(db, SQLITE_DURABLE_STATE_GROUPS.initialCore);
        }
    },
    {
        id: '002_users_verification_expires',
        up: (db, { migrationsRepository }) => {
            try {
                const hasColumn = migrationsRepository.tableHasColumn('users', 'verificationTokenExpires');
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
        up: (db, { migrationsRepository }) => {
            try {
                const hasColumn = migrationsRepository.tableHasColumn('upload_sessions', 'bytesReceived');
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
            ensureSqliteDurableStateObjects(db, SQLITE_DURABLE_STATE_GROUPS.filesIndexes);
        }
    },
    {
        id: '005_settings_audit_log',
        up: (db) => {
            ensureSqliteDurableStateObjects(db, SQLITE_DURABLE_STATE_GROUPS.settingsAudit);
        }
    },
    {
        id: '006_sensitive_settings_gcm',
        up: (db) => {
            migrateSensitiveSettingsToCurrentEncryption({
                db,
                encrypt,
                decrypt,
                getEncryptionFormat,
                logger,
            });
        }
    },
    {
        id: '007_durable_state_expansion',
        up: (db) => {
            ensureSqliteDurableStateObjects(db, SQLITE_DURABLE_STATE_GROUPS.durableStateExpansion);
        }
    }
];

export const runMigrations = (db) => {
    const migrationsRepository = createMigrationsRepository({ db });
    migrationsRepository.ensureSchemaMigrationsTable();

    for (const migration of migrations) {
        if (migrationsRepository.hasMigration(migration.id)) continue;
        try {
            migration.up(db, { migrationsRepository });
            migrationsRepository.recordMigration(migration.id);
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
