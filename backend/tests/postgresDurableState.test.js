import { describe, expect, it } from 'vitest';

import {
    createPostgresMigrationsRepository,
    renderPostgresDurableStateSchema,
    runPostgresDurableStateMigrations,
} from '../lib/postgresDurableState.js';

const createFakePgClient = () => {
    const appliedMigrations = new Map();
    const calls = [];

    return {
        calls,
        async query(text, values = []) {
            calls.push({ text, values });

            if (text.includes('SELECT 1 AS found FROM') && text.includes('schema_migrations')) {
                return {
                    rows: appliedMigrations.has(values[0]) ? [{ found: 1 }] : [],
                    rowCount: appliedMigrations.has(values[0]) ? 1 : 0,
                };
            }

            if (text.includes('INSERT INTO') && text.includes('schema_migrations')) {
                appliedMigrations.set(values[0], values[1]);
                return { rows: [], rowCount: 1 };
            }

            return { rows: [], rowCount: 0 };
        },
    };
};

describe('postgresDurableState', () => {
    it('renders a PostgreSQL durable schema with the expected tables', () => {
        const sql = renderPostgresDurableStateSchema({ schemaName: 'sendu' });

        expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "sendu"');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS "sendu".users');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS "sendu".settings_audit_log');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS "sendu".job_queue');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS "sendu".download_tokens');
    });

    it('runs and records PostgreSQL durable migrations only once', async () => {
        const client = createFakePgClient();
        const logger = { info: () => {}, error: () => {} };

        const repository = createPostgresMigrationsRepository({ client, schemaName: 'sendu' });
        await repository.ensureSchemaMigrationsTable();
        await runPostgresDurableStateMigrations({ client, schemaName: 'sendu', logger });
        const firstRunCalls = client.calls.length;

        await runPostgresDurableStateMigrations({ client, schemaName: 'sendu', logger });

        expect(client.calls.some((call) => call.text === 'BEGIN')).toBe(true);
        expect(client.calls.some((call) => call.text === 'COMMIT')).toBe(true);
        expect(client.calls.length).toBeGreaterThan(firstRunCalls);
        expect(
            client.calls.filter((call) => call.text.includes('INSERT INTO') && call.text.includes('schema_migrations')).length
        ).toBe(1);
    });
});