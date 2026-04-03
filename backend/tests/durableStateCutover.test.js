import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
    exportSqliteDurableStateSnapshot,
    importDurableStateSnapshot,
    renderPostgresDurableStateImportSql,
} from '../lib/durableStateCutover.js';
import { SQLITE_DURABLE_STATE_GROUPS, ensureSqliteDurableStateObjects } from '../lib/durableStateSchema.js';

const buildDb = () => {
    const db = new Database(':memory:');
    ensureSqliteDurableStateObjects(db, [
        ...SQLITE_DURABLE_STATE_GROUPS.schemaMigrations,
        ...SQLITE_DURABLE_STATE_GROUPS.initialCore,
        ...SQLITE_DURABLE_STATE_GROUPS.filesIndexes,
        ...SQLITE_DURABLE_STATE_GROUPS.settingsAudit,
        ...SQLITE_DURABLE_STATE_GROUPS.durableStateExpansion,
    ]);
    return db;
};

const createFakePgClient = () => {
    const calls = [];
    return {
        calls,
        async query(text, values = []) {
            calls.push({ text, values });
            return { rows: [], rowCount: 0 };
        },
    };
};

describe('durableStateCutover', () => {
    it('exports a deterministic durable state snapshot from SQLite', () => {
        const db = buildDb();

        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('footerText', 'hola');
        db.prepare(`
            INSERT INTO users (id, email, username, passwordHash, role, isVerified, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('user-1', 'user@example.com', 'user', 'hash', 'admin', 1, 1000);
        db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('file-1', 'report.txt', '/tmp/report.txt', 'text/plain', 10, 1200, 'user-1');
        db.prepare(`
            INSERT INTO settings_audit_log (adminUserId, settingKey, oldValue, newValue, changedAt)
            VALUES (?, ?, ?, ?, ?)
        `).run('user-1', 'footerText', '', 'hola', 1300);
        db.prepare(`
            INSERT INTO download_tokens (token, file_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
        `).run('download-1', 'file-1', 5000, 1500);
        db.prepare(`
            INSERT INTO job_queue (id, type, payload, scheduled_at)
            VALUES (?, ?, ?, ?)
        `).run('job-1', 'email', '{}', 2000);
        db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('007_durable_state_expansion', 2000);

        const snapshot = exportSqliteDurableStateSnapshot({ db, exportedAt: 3000 });

        expect(snapshot.exportedAt).toBe(3000);
        expect(snapshot.counts).toMatchObject({
            settings: 1,
            users: 1,
            files: 1,
            settings_audit_log: 1,
            download_tokens: 1,
            job_queue: 1,
        });
        expect(snapshot.sourceMigrations).toEqual(['007_durable_state_expansion']);
        expect(snapshot.tables.settings[0]).toEqual({ key: 'footerText', value: 'hola' });

        db.close();
    });

    it('renders and imports a PostgreSQL cutover snapshot in table order', async () => {
        const snapshot = {
            tables: {
                settings: [{ key: 'footerText', value: 'hola' }],
                users: [{ id: 'user-1', email: 'user@example.com', username: 'user', passwordHash: 'hash', role: 'user', isVerified: 1, verificationToken: null, verificationTokenExpires: null, resetToken: null, resetTokenExpires: null, createdAt: 1000 }],
                files: [],
                reports: [],
                guest_uploads: [],
                upload_sessions: [],
                settings_audit_log: [{ id: 5, adminUserId: 'user-1', settingKey: 'footerText', oldValue: '', newValue: 'hola', changedAt: 1100 }],
                download_tokens: [],
                job_queue: [],
            },
        };
        const sql = renderPostgresDurableStateImportSql({ snapshot, schemaName: 'sendu' });

        expect(sql).toContain('BEGIN;');
        expect(sql).toContain('INSERT INTO "sendu"."settings"');
        expect(sql).toContain('INSERT INTO "sendu"."users"');
        expect(sql).toContain("SELECT setval(pg_get_serial_sequence('sendu.settings_audit_log', 'id'), 5, true);");
        expect(sql).toContain('COMMIT;');

        const client = createFakePgClient();
        await importDurableStateSnapshot({ client, snapshot, schemaName: 'sendu' });

        expect(client.calls[0].text).toBe('BEGIN');
        expect(client.calls.at(-1).text).toBe('COMMIT');
        expect(client.calls.some((call) => call.text.includes('INSERT INTO "sendu"."settings"'))).toBe(true);
        expect(client.calls.some((call) => call.text.includes('INSERT INTO "sendu"."users"'))).toBe(true);
        expect(client.calls.some((call) => call.text.includes('SELECT setval(pg_get_serial_sequence'))).toBe(true);
    });
});