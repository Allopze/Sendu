import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createPersistentStoresRepository } from '../lib/persistentStoresRepository.js';

const buildRepository = () => {
    const db = new Database(':memory:');
    const logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    };
    const repository = createPersistentStoresRepository({ db, logger });
    return { db, repository };
};

describe('persistentStoresRepository', () => {
    it('stores and consumes single-use csrf and download tokens', () => {
        const { db, repository } = buildRepository();

        expect(repository.storeCsrfToken('sess-1:token-1', 'sess-1', 2000)).toBe(1);
        expect(repository.consumeCsrfToken('sess-1:token-1', 'sess-1', 1000)).toBe(1);
        expect(repository.consumeCsrfToken('sess-1:token-1', 'sess-1', 1000)).toBe(0);

        expect(repository.storeDownloadToken('download-1', 'file-1', 3000)).toBe(1);
        expect(repository.consumeDownloadToken('download-1', 'file-1', 1000)).toBe(true);
        expect(repository.consumeDownloadToken('download-1', 'file-1', 1000)).toBe(false);

        db.close();
    });

    it('tracks guest uploads, sessions, rate limits and cleanup', () => {
        const { db, repository } = buildRepository();

        expect(repository.getGuestUploadTotal('guest-1')).toBe(0);
        expect(repository.recordGuestUpload('guest-1', 512, 1000)).toEqual({
            totalBytes: 512,
            existed: false,
        });
        expect(repository.recordGuestUpload('guest-1', 256, 1500)).toEqual({
            totalBytes: 768,
            existed: true,
        });
        expect(repository.getGuestUploadTotal('guest-1')).toBe(768);

        expect(repository.setSession('sid-1', JSON.stringify({ userId: 'user-1' }), 5000)).toBe(1);
        expect(repository.setSession('sid-2', JSON.stringify({ userId: 'user-2' }), 800)).toBe(1);
        expect(repository.countActiveSessions(1000)).toBe(1);
        expect(repository.listActiveSessions(1000)).toEqual([
            { sid: 'sid-1', sess: JSON.stringify({ userId: 'user-1' }) },
        ]);
        expect(repository.touchSession('sid-1', 7000)).toBe(1);
        expect(repository.getSession('sid-1')).toEqual({
            sess: JSON.stringify({ userId: 'user-1' }),
            expires_at: 7000,
        });

        expect(repository.getRateLimitEntry('auth:ip-1')).toBeNull();
        expect(repository.setRateLimitEntry('auth:ip-1', 1, 4000)).toBe(1);
        expect(repository.incrementRateLimit('auth:ip-1')).toBe(1);
        expect(repository.getRateLimitEntry('auth:ip-1')).toEqual({ count: 2, reset_at: 4000 });
        expect(repository.decrementRateLimit('auth:ip-1')).toBe(1);
        expect(repository.getRateLimitEntry('auth:ip-1')).toEqual({ count: 1, reset_at: 4000 });

        expect(repository.cleanupExpired(1000, 2000)).toEqual({
            csrf: 0,
            downloads: 0,
            sessions: 1,
            guests: 1,
        });
        expect(repository.getSession('sid-2')).toBeNull();
        expect(repository.getGuestUploadTotal('guest-1')).toBe(0);

        expect(repository.resetRateLimits('auth')).toBe(1);
        expect(repository.getRateLimitEntry('auth:ip-1')).toBeNull();

        db.close();
    });
});