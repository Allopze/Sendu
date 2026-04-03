import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

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

const sortByKey = (rows) => [...rows].sort((left, right) => left.key.localeCompare(right.key));

describe('settingsRepository', () => {
    it('lists all settings and selected keys asynchronously', async () => {
        const db = buildDb();
        const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        insert.run('footerText', 'hola');
        insert.run('logoLight', '/branding/logo-light.svg');
        insert.run('chunkSize', '20');

        const repository = createSettingsRepository({ db });

        await expect(repository.getValue('footerText')).resolves.toBe('hola');
        await expect(repository.getValue('missing')).resolves.toBeNull();

        const allSettings = sortByKey(await repository.listAll());
        expect(allSettings).toEqual([
            { key: 'chunkSize', value: '20' },
            { key: 'footerText', value: 'hola' },
            { key: 'logoLight', value: '/branding/logo-light.svg' },
        ]);
        await expect(repository.countAll()).resolves.toBe(3);

        const selectedSettings = sortByKey(await repository.listByKeys(['logoLight', 'footerText']));
        expect(selectedSettings).toEqual([
            { key: 'footerText', value: 'hola' },
            { key: 'logoLight', value: '/branding/logo-light.svg' },
        ]);

        db.close();
    });

    it('upserts and deletes settings through async methods', async () => {
        const db = buildDb();
        const repository = createSettingsRepository({ db });

        await repository.upsert('footerText', 'primer valor');
        await repository.upsertMany([
            { key: 'logoDark', value: '/branding/logo-dark.svg' },
            { key: 'favicon', value: '/branding/favicon.ico' },
        ]);

        await expect(repository.getValue('footerText')).resolves.toBe('primer valor');
        await expect(repository.getValue('logoDark')).resolves.toBe('/branding/logo-dark.svg');

        await repository.upsert('footerText', 'valor actualizado');
        await expect(repository.getValue('footerText')).resolves.toBe('valor actualizado');

        await repository.delete('logoDark');
        await repository.deleteMany(['favicon']);

        await expect(repository.getValue('logoDark')).resolves.toBeNull();
        await expect(repository.getValue('favicon')).resolves.toBeNull();

        db.close();
    });

    it('returns paginated audit entries with admin usernames', async () => {
        const db = buildDb();
        db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run('admin-1', 'ops');
        db.prepare(`
            INSERT INTO settings_audit_log (adminUserId, settingKey, oldValue, newValue, changedAt)
            VALUES (?, ?, ?, ?, ?)
        `).run('admin-1', 'footerText', '', 'uno', 1000);
        db.prepare(`
            INSERT INTO settings_audit_log (adminUserId, settingKey, oldValue, newValue, changedAt)
            VALUES (?, ?, ?, ?, ?)
        `).run('admin-1', 'logoLight', '/old.svg', '/new.svg', 2000);

        const repository = createSettingsRepository({ db });
        const auditPage = await repository.listAudit({ page: 2, limit: 1 });

        expect(auditPage.pagination).toEqual({
            page: 2,
            limit: 1,
            total: 2,
            totalPages: 2,
        });
        expect(auditPage.entries).toHaveLength(1);
        expect(auditPage.entries[0]).toMatchObject({
            adminUserId: 'admin-1',
            adminUsername: 'ops',
            settingKey: 'footerText',
            newValue: 'uno',
            changedAt: 1000,
        });

        db.close();
    });

    it('applies audited setting changes atomically', async () => {
        const db = buildDb();
        const repository = createSettingsRepository({ db });

        const changedKeys = await repository.applyChangesWithAudit({
            adminUserId: 'admin-1',
            changedAt: 3000,
            changes: [
                {
                    key: 'footerText',
                    value: 'nuevo pie',
                    oldValue: '',
                    newValue: 'nuevo pie',
                },
                {
                    key: 'logoLight',
                    value: '/branding/new.svg',
                    oldValue: '/branding/old.svg',
                    newValue: '/branding/new.svg',
                },
            ],
        });

        expect(changedKeys).toEqual(['footerText', 'logoLight']);
        await expect(repository.getValue('footerText')).resolves.toBe('nuevo pie');
        await expect(repository.getValue('logoLight')).resolves.toBe('/branding/new.svg');

        const auditRows = db.prepare(`
            SELECT settingKey, oldValue, newValue, changedAt
            FROM settings_audit_log
            ORDER BY id ASC
        `).all();

        expect(auditRows).toEqual([
            {
                settingKey: 'footerText',
                oldValue: '',
                newValue: 'nuevo pie',
                changedAt: 3000,
            },
            {
                settingKey: 'logoLight',
                oldValue: '/branding/old.svg',
                newValue: '/branding/new.svg',
                changedAt: 3000,
            },
        ]);

        db.close();
    });
});