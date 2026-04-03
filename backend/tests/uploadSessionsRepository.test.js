import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createUploadSessionsRepository } from '../lib/uploadSessionsRepository.js';

const buildDb = () => {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE upload_sessions (
            uploadId TEXT PRIMARY KEY,
            userId TEXT,
            ipFingerprint TEXT,
            status TEXT NOT NULL,
            fileId TEXT,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            bytesReceived INTEGER DEFAULT 0
        );
    `);

    return db;
};

describe('uploadSessionsRepository', () => {
    it('creates sessions and reports active counts and byte totals', async () => {
        const db = buildDb();
        const repository = createUploadSessionsRepository({ db });

        await repository.createSession({ uploadId: 'upload-1', userId: 'user-1', createdAt: 1000, updatedAt: 1000 });
        await repository.createSession({ uploadId: 'upload-2', userId: 'user-1', createdAt: 1000, updatedAt: 1000 });
        await repository.createSession({ uploadId: 'upload-3', ipFingerprint: 'ip-1', status: 'processing', createdAt: 1000, updatedAt: 1000 });

        await repository.updateBytesReceived('upload-1', 10, 1100);
        await repository.updateBytesReceived('upload-2', 25, 1200);
        await repository.updateBytesReceived('upload-3', 7, 1300);

        await expect(repository.findByUploadId('upload-1')).resolves.toMatchObject({
            uploadId: 'upload-1',
            userId: 'user-1',
            status: 'initiated',
            bytesReceived: 10,
        });
        await expect(repository.countActiveByUser('user-1')).resolves.toBe(2);
        await expect(repository.countActiveByIp('ip-1')).resolves.toBe(1);
        await expect(repository.sumActiveBytesByUser('user-1')).resolves.toBe(35);
        await expect(repository.sumActiveBytesByIp('ip-1')).resolves.toBe(7);

        db.close();
    });

    it('transitions sessions through processing, failure, and completion', async () => {
        const db = buildDb();
        const repository = createUploadSessionsRepository({ db });

        await repository.createSession({ uploadId: 'upload-9', userId: 'user-9', createdAt: 1000, updatedAt: 1000 });

        await expect(repository.markProcessing('upload-9', 1100)).resolves.toBe(1);
        await expect(repository.markProcessing('upload-9', 1200)).resolves.toBe(0);
        await expect(repository.updateStatus('upload-9', 'failed', 1300)).resolves.toBe(1);
        await expect(repository.markProcessing('upload-9', 1400)).resolves.toBe(1);
        await expect(repository.markCompleted('upload-9', 'file-9', 1500)).resolves.toBe(1);
        await expect(repository.findByUploadId('upload-9')).resolves.toMatchObject({
            status: 'completed',
            fileId: 'file-9',
        });
        await expect(repository.countActiveByUser('user-9')).resolves.toBe(0);

        db.close();
    });

    it('counts stale active sessions and deletes old terminal sessions', async () => {
        const db = buildDb();
        const repository = createUploadSessionsRepository({ db });

        await repository.createSession({ uploadId: 'active-stale', userId: 'user-1', status: 'initiated', createdAt: 1000, updatedAt: 1000 });
        await repository.createSession({ uploadId: 'active-fresh', userId: 'user-1', status: 'processing', createdAt: 1000, updatedAt: 4000 });
        await repository.createSession({ uploadId: 'completed-old', userId: 'user-2', status: 'completed', createdAt: 1000, updatedAt: 1200 });
        await repository.createSession({ uploadId: 'failed-old', ipFingerprint: 'ip-1', status: 'failed', createdAt: 1000, updatedAt: 1500 });
        await repository.createSession({ uploadId: 'cancelled-fresh', ipFingerprint: 'ip-2', status: 'cancelled', createdAt: 1000, updatedAt: 5000 });

        await expect(repository.countActive()).resolves.toBe(2);
        await expect(repository.countStaleActiveBefore(2000)).resolves.toBe(1);
        await expect(repository.deleteFinishedBefore(2000)).resolves.toBe(2);
        await expect(repository.findByUploadId('completed-old')).resolves.toBeNull();
        await expect(repository.findByUploadId('failed-old')).resolves.toBeNull();
        await expect(repository.findByUploadId('cancelled-fresh')).resolves.toMatchObject({ status: 'cancelled' });

        db.close();
    });
});