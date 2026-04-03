import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createFilesRepository } from '../lib/filesRepository.js';

const buildDb = () => {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE files (
            id TEXT PRIMARY KEY,
            originalName TEXT NOT NULL,
            serverPath TEXT NOT NULL,
            mimeType TEXT,
            size INTEGER NOT NULL,
            createdAt INTEGER NOT NULL,
            userId TEXT,
            expiresAt INTEGER,
            maxDownloads INTEGER,
            passwordHash TEXT,
            downloadCount INTEGER DEFAULT 0
        );
    `);

    return db;
};

describe('filesRepository', () => {
    it('creates files and reads them back asynchronously', async () => {
        const db = buildDb();
        const repository = createFilesRepository({ db });

        await expect(repository.createFile({
            id: 'file-1',
            originalName: 'report.pdf',
            serverPath: '/tmp/report.pdf',
            mimeType: 'application/pdf',
            size: 1234,
            createdAt: 1000,
            userId: 'user-1',
            expiresAt: 5000,
            maxDownloads: 3,
            passwordHash: 'hash-1',
        })).resolves.toBe(1);

        await expect(repository.findById('file-1')).resolves.toMatchObject({
            id: 'file-1',
            originalName: 'report.pdf',
            userId: 'user-1',
            downloadCount: 0,
        });

        await expect(repository.incrementDownloadCount('file-1')).resolves.toBe(1);
        await expect(repository.findById('file-1')).resolves.toMatchObject({
            downloadCount: 1,
            maxDownloads: 3,
        });

        db.close();
    });

    it('returns paginated user and admin listings and deletes files', async () => {
        const db = buildDb();
        const repository = createFilesRepository({ db });
        const insert = db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, maxDownloads, passwordHash, downloadCount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insert.run('file-1', 'one.txt', '/tmp/one.txt', 'text/plain', 10, 1000, 'user-1', null, null, null, 0);
        insert.run('file-2', 'two.txt', '/tmp/two.txt', 'text/plain', 20, 2000, 'user-1', null, null, 'hash-2', 2);
        insert.run('file-3', 'three.txt', '/tmp/three.txt', 'text/plain', 30, 3000, 'user-2', null, null, null, 0);

        await expect(repository.countByUser('user-1')).resolves.toBe(2);
        await expect(repository.countAll()).resolves.toBe(3);

        await expect(repository.listByUser('user-1', { limit: 10, offset: 0 })).resolves.toEqual([
            expect.objectContaining({ id: 'file-2', userId: 'user-1' }),
            expect.objectContaining({ id: 'file-1', userId: 'user-1' }),
        ]);
        await expect(repository.listAll({ limit: 2, offset: 1 })).resolves.toEqual([
            expect.objectContaining({ id: 'file-2' }),
            expect.objectContaining({ id: 'file-1' }),
        ]);

        await expect(repository.deleteById('file-2')).resolves.toBe(1);
        await expect(repository.findById('file-2')).resolves.toBeNull();
        await expect(repository.countAll()).resolves.toBe(2);

        db.close();
    });

    it('returns cleanup candidates without duplicates and exposes storage entries', async () => {
        const db = buildDb();
        const repository = createFilesRepository({ db });
        const insert = db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, maxDownloads, passwordHash, downloadCount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insert.run('expired-file', 'expired.txt', '/tmp/expired.txt', 'text/plain', 10, 1000, 'user-1', 1500, null, null, 0);
        insert.run('max-download-file', 'max.txt', '/tmp/max.txt', 'text/plain', 20, 2000, 'user-1', null, 2, null, 2);
        insert.run('both-file', 'both.txt', '/tmp/both.txt', 'text/plain', 30, 3000, 'user-2', 1500, 1, null, 1);
        insert.run('active-file', 'active.txt', '/tmp/active.txt', 'text/plain', 40, 4000, 'user-2', 999999, 5, null, 0);

        const expiredIds = (await repository.listExpiredBefore(2000)).map((file) => file.id).sort();
        const maxDownloadIds = (await repository.listMaxDownloadsReached()).map((file) => file.id).sort();
        const cleanupCandidateIds = (await repository.listCleanupCandidates(2000)).map((file) => file.id).sort();
        const storageEntries = await repository.listStorageEntries();

        expect(expiredIds).toEqual(['both-file', 'expired-file']);
        expect(maxDownloadIds).toEqual(['both-file', 'max-download-file']);
        expect(cleanupCandidateIds).toEqual(['both-file', 'expired-file', 'max-download-file']);
        expect(storageEntries).toEqual(expect.arrayContaining([
            { id: 'expired-file', serverPath: '/tmp/expired.txt' },
            { id: 'max-download-file', serverPath: '/tmp/max.txt' },
            { id: 'both-file', serverPath: '/tmp/both.txt' },
            { id: 'active-file', serverPath: '/tmp/active.txt' },
        ]));
        expect(storageEntries).toHaveLength(4);

        db.close();
    });
});