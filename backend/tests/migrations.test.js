import crypto from 'crypto';
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

import { decrypt, getEncryptionFormat } from '../lib/encryption.js';
import { runMigrations } from '../lib/migrations.js';

const buildLegacyCiphertext = (text) => {
    const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-secret';
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
};

const recordMigration = (db, id) => {
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
};

const buildPreMigrationDb = () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );

        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE settings_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            adminUserId TEXT NOT NULL,
            settingKey TEXT NOT NULL,
            oldValue TEXT,
            newValue TEXT,
            changedAt INTEGER NOT NULL
        );
    `);

    ['001_initial_schema', '002_users_verification_expires', '003_upload_sessions_bytes_received', '004_files_indexes', '005_settings_audit_log']
        .forEach((id) => recordMigration(db, id));

    return db;
};

describe('schema migrations', () => {
    it('migrates legacy AES-CBC sensitive settings to AES-GCM in one shot', () => {
        const db = buildPreMigrationDb();
        const legacyValue = buildLegacyCiphertext('smtp-secret');
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('smtpPass', legacyValue);

        runMigrations(db);

        const migrated = db.prepare('SELECT value FROM settings WHERE key = ?').get('smtpPass');
        expect(getEncryptionFormat(migrated.value)).toBe('aes-256-gcm');
        expect(decrypt(migrated.value)).toBe('smtp-secret');

        const recordedMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('006_sensitive_settings_gcm');
        expect(recordedMigration?.id).toBe('006_sensitive_settings_gcm');

        db.close();
    });

    it('encrypts plaintext sensitive settings during the one-shot migration', () => {
        const db = buildPreMigrationDb();
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('smtpPass', 'plain-text-secret');

        runMigrations(db);

        const migrated = db.prepare('SELECT value FROM settings WHERE key = ?').get('smtpPass');
        expect(getEncryptionFormat(migrated.value)).toBe('aes-256-gcm');
        expect(decrypt(migrated.value)).toBe('plain-text-secret');

        db.close();
    });
});