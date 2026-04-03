import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createJobQueueRepository } from '../lib/jobQueueRepository.js';

const buildRepository = () => {
    const db = new Database(':memory:');
    const repository = createJobQueueRepository({ db });
    return { db, repository };
};

describe('jobQueueRepository', () => {
    it('acquires the highest priority pending job and increments attempts', async () => {
        const { db, repository } = buildRepository();

        await repository.enqueueJob({
            id: 'job-low',
            type: 'email',
            payload: JSON.stringify({ to: 'low@example.com' }),
            priority: 1,
            maxRetries: 3,
            scheduledAt: 100,
        });
        await repository.enqueueJob({
            id: 'job-high',
            type: 'email',
            payload: JSON.stringify({ to: 'high@example.com' }),
            priority: 10,
            maxRetries: 3,
            scheduledAt: 200,
        });

        const job = await repository.acquireNextAvailableJob({
            workerId: 'worker-1',
            now: 500,
            lockUntil: 1500,
        });

        expect(job).toMatchObject({
            id: 'job-high',
            status: 'processing',
            attempts: 1,
            payload: { to: 'high@example.com' },
        });

        const stored = db.prepare('SELECT status, attempts, locked_by FROM job_queue WHERE id = ?').get('job-high');
        expect(stored).toEqual({
            status: 'processing',
            attempts: 1,
            locked_by: 'worker-1',
        });

        db.close();
    });

    it('reports stats, retries dead jobs, cancels pending jobs and cleans finished jobs', async () => {
        const { db, repository } = buildRepository();

        db.prepare(`
            INSERT INTO job_queue (id, type, payload, status, priority, attempts, max_retries, scheduled_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('dead-1', 'email', '{}', 'dead', 0, 3, 3, 100, 200);
        db.prepare(`
            INSERT INTO job_queue (id, type, payload, status, priority, attempts, max_retries, scheduled_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run('pending-1', 'cleanup_files', '{}', 'pending', 0, 0, 3, 100);
        db.prepare(`
            INSERT INTO job_queue (id, type, payload, status, priority, attempts, max_retries, scheduled_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('completed-1', 'email', '{}', 'completed', 0, 1, 3, 100, 50);

        const beforeRetry = await repository.getQueueStats();
        expect(beforeRetry).toEqual({
            byStatus: { completed: 1, dead: 1, pending: 1 },
            byType: { cleanup_files: 1 },
            total: 3,
        });

        await expect(repository.cancelPendingJob('pending-1')).resolves.toBe(1);
        await expect(repository.retryDeadJobs('email', 999)).resolves.toBe(1);
        await expect(repository.cleanupFinishedBefore(100)).resolves.toBe(1);

        const rows = db.prepare('SELECT id, status, attempts, scheduled_at FROM job_queue ORDER BY id ASC').all();
        expect(rows).toEqual([
            {
                id: 'dead-1',
                status: 'pending',
                attempts: 0,
                scheduled_at: 999,
            },
        ]);

        db.close();
    });
});