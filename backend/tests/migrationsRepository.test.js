import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createMigrationsRepository } from '../lib/migrationsRepository.js';

const buildRepository = () => {
    const db = new Database(':memory:');
    const repository = createMigrationsRepository({ db });
    return { db, repository };
};

describe('migrationsRepository', () => {
    it('ensures and records schema migrations synchronously', () => {
        const { db, repository } = buildRepository();

        repository.ensureSchemaMigrationsTable();
        expect(repository.hasMigration('001_initial_schema')).toBe(false);
        expect(repository.recordMigration('001_initial_schema', 1000)).toBe(1);
        expect(repository.hasMigration('001_initial_schema')).toBe(true);

        db.close();
    });

    it('inspects table columns and rejects unsafe identifiers', () => {
        const { db, repository } = buildRepository();

        db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL)');

        expect(repository.listTableColumns('users').map((column) => column.name)).toEqual(['id', 'email']);
        expect(repository.tableHasColumn('users', 'email')).toBe(true);
        expect(repository.tableHasColumn('users', 'missing')).toBe(false);
        expect(() => repository.listTableColumns('users; DROP TABLE users')).toThrow('Invalid SQLite identifier');

        db.close();
    });
});