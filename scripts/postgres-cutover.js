#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

import { exportSqliteDurableStateSnapshot, importDurableStateSnapshot, renderPostgresDurableStateImportSql } from '../backend/lib/durableStateCutover.js';
import { renderPostgresDurableStateSchema, runPostgresDurableStateMigrations } from '../backend/lib/postgresDurableState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const defaultSqlitePath = path.join(rootDir, 'data', 'db.sqlite');
const defaultArtifactsDir = path.join(rootDir, 'tmp', 'postgres-cutover');

const ensureArtifactsDir = async () => {
    await fs.mkdir(defaultArtifactsDir, { recursive: true });
};

const readSnapshot = async (snapshotPath) => JSON.parse(await fs.readFile(snapshotPath, 'utf8'));

const command = process.argv[2];

const printUsage = () => {
    console.error('Usage:');
    console.error('  node scripts/postgres-cutover.js export [snapshotPath] [sqlitePath]');
    console.error('  node scripts/postgres-cutover.js render-schema [outputPath] [schemaName]');
    console.error('  node scripts/postgres-cutover.js render-sql <snapshotPath> [outputPath] [schemaName]');
    console.error('  node scripts/postgres-cutover.js execute <snapshotPath> [schemaName]');
};

const run = async () => {
    await ensureArtifactsDir();

    if (command === 'export') {
        const snapshotPath = process.argv[3] || path.join(defaultArtifactsDir, 'durable-state-snapshot.json');
        const sqlitePath = process.argv[4] || defaultSqlitePath;
        const db = new Database(sqlitePath, { readonly: true });
        try {
            const snapshot = exportSqliteDurableStateSnapshot({ db });
            await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
            console.log(`Durable state snapshot written to ${snapshotPath}`);
        } finally {
            db.close();
        }
        return;
    }

    if (command === 'render-schema') {
        const outputPath = process.argv[3] || path.join(defaultArtifactsDir, 'postgres-durable-schema.sql');
        const schemaName = process.argv[4] || process.env.POSTGRES_SCHEMA || 'public';
        await fs.writeFile(outputPath, renderPostgresDurableStateSchema({ schemaName }));
        console.log(`PostgreSQL durable schema written to ${outputPath}`);
        return;
    }

    if (command === 'render-sql') {
        const snapshotPath = process.argv[3];
        if (!snapshotPath) {
            printUsage();
            process.exit(1);
        }

        const outputPath = process.argv[4] || path.join(defaultArtifactsDir, 'postgres-durable-import.sql');
        const schemaName = process.argv[5] || process.env.POSTGRES_SCHEMA || 'public';
        const snapshot = await readSnapshot(snapshotPath);
        await fs.writeFile(outputPath, renderPostgresDurableStateImportSql({ snapshot, schemaName }));
        console.log(`PostgreSQL import SQL written to ${outputPath}`);
        return;
    }

    if (command === 'execute') {
        const snapshotPath = process.argv[3];
        if (!snapshotPath) {
            printUsage();
            process.exit(1);
        }

        if (!process.env.POSTGRES_URL) {
            console.error('POSTGRES_URL is required for execute mode');
            process.exit(1);
        }

        const schemaName = process.argv[4] || process.env.POSTGRES_SCHEMA || 'public';
        const snapshot = await readSnapshot(snapshotPath);

        let Client;
        try {
            ({ Client } = await import('pg'));
        } catch (err) {
            console.error('The pg package is required for execute mode. Install it with: npm install pg');
            throw err;
        }

        const client = new Client({ connectionString: process.env.POSTGRES_URL });
        await client.connect();
        try {
            await runPostgresDurableStateMigrations({ client, schemaName, logger: console });
            await importDurableStateSnapshot({ client, snapshot, schemaName });
            console.log('PostgreSQL durable state cutover import completed');
        } finally {
            await client.end();
        }
        return;
    }

    printUsage();
    process.exit(1);
};

run().catch((err) => {
    console.error('PostgreSQL cutover command failed:', err.message);
    process.exit(1);
});