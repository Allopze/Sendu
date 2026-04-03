import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

import {
    applyAdminSettings,
    migrateSensitiveSettingsToCurrentEncryption,
    serializeAdminSettings,
    stringifySettingValue,
    validateAdminSettingsPayload,
} from '../lib/adminSettings.js';
import { createSettingsRepository } from '../lib/settingsRepository.js';

const buildDb = () => {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL
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

    return db;
};

describe('adminSettings helpers', () => {
    it('redacts sensitive settings when serializing admin settings', () => {
        const serialized = serializeAdminSettings([
            { key: 'smtpHost', value: 'smtp.example.com' },
            { key: 'smtpPass', value: 'super-secret' },
        ]);

        expect(serialized.smtpHost).toBe('smtp.example.com');
        expect(serialized.smtpPass).toBe('');
        expect(serialized.smtpPassConfigured).toBe(true);
    });

    it('serializes object email templates as JSON', () => {
        const value = stringifySettingValue('emailTemplates', { welcome: { subject: 'Hola' } });
        expect(JSON.parse(value)).toEqual({ welcome: { subject: 'Hola' } });
    });

    it('rejects invalid settings payloads with detailed validation errors', () => {
        const validationError = validateAdminSettingsPayload({
            smtpPort: '99999',
            mediumFileThreshold: '5',
            smallFileThreshold: '10',
            smtpFrom: 'not-an-email',
        });

        expect(validationError).toContain('smtpPort debe ser un entero entre 1 y 65535');
        expect(validationError).toContain('mediumFileThreshold no puede ser menor que smallFileThreshold');
        expect(validationError).toContain('smtpFrom debe ser un email valido');
    });

    it('accepts valid payloads', () => {
        const validationError = validateAdminSettingsPayload({
            smtpPort: '587',
            smtpSecure: 'false',
            smtpFrom: 'ops@example.com',
            maxFileSize: '100',
            maxTotalSize: '500',
            guestUploadLimit: '5120',
            guestMaxFileSize: '100',
            smallFileThreshold: '100',
            mediumFileThreshold: '1024',
            smallFileChunkSize: '10',
            mediumFileChunkSize: '50',
            largeFileChunkSize: '100',
            emailTemplates: JSON.stringify({ welcome: { subject: 'Hola' } }),
        });

        expect(validationError).toBeNull();
    });

    it('applies admin settings through settingsRepository and redacts sensitive audit values', async () => {
        const db = buildDb();
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?), (?, ?)')
            .run('footerText', 'anterior', 'smtpPass', 'enc:v1');

        const settingsRepository = createSettingsRepository({ db });
        const changedKeys = await applyAdminSettings({
            settingsRepository,
            settings: {
                footerText: 'actualizado',
                smtpPass: 'nuevo-secreto',
            },
            adminUserId: 'admin-1',
            safeCompare: (left, right) => left === right,
            encrypt: (value) => `enc:${value}`,
            decrypt: (value) => value.replace(/^enc:/, ''),
            isEncrypted: (value) => typeof value === 'string' && value.startsWith('enc:'),
            getEncryptionFormat: (value) => (typeof value === 'string' && value.startsWith('enc:') ? 'aes-256-gcm' : null),
        });

        expect(changedKeys).toEqual(['footerText', 'smtpPass']);
        await expect(settingsRepository.getValue('footerText')).resolves.toBe('actualizado');
        await expect(settingsRepository.getValue('smtpPass')).resolves.toBe('enc:nuevo-secreto');

        const auditRows = db.prepare(`
            SELECT settingKey, oldValue, newValue
            FROM settings_audit_log
            ORDER BY id ASC
        `).all();

        expect(auditRows).toEqual([
            {
                settingKey: 'footerText',
                oldValue: 'anterior',
                newValue: 'actualizado',
            },
            {
                settingKey: 'smtpPass',
                oldValue: '[REDACTED]',
                newValue: '[REDACTED]',
            },
        ]);

        db.close();
    });

    it('migrates sensitive settings through settingsRepository without direct helper SQL', async () => {
        const db = buildDb();
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('smtpPass', 'legacy-secret');

        const settingsRepository = createSettingsRepository({ db });
        const migratedKeys = await migrateSensitiveSettingsToCurrentEncryption({
            settingsRepository,
            encrypt: (value) => `enc:${value}`,
            decrypt: (value) => value.replace(/^enc:/, ''),
            getEncryptionFormat: (value) => (typeof value === 'string' && value.startsWith('enc:') ? 'aes-256-gcm' : null),
            logger: { info: () => {} },
        });

        expect(migratedKeys).toEqual(['smtpPass']);
        await expect(settingsRepository.getValue('smtpPass')).resolves.toBe('enc:legacy-secret');

        db.close();
    });
});