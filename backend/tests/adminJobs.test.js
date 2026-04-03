import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { stopJobProcessor } from '../lib/jobQueue.js';

process.env.NODE_ENV = 'test';
process.env.ALLOW_PUBLIC_REGISTRATION = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-admin-jobs.sqlite');
let db;
let app;
let startServer;

const PASSWORD = 'Password123';

const createUser = async ({ role = 'user', email, username }) => {
    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(PASSWORD, 10);
    db.prepare(`
        INSERT INTO users (id, email, username, passwordHash, role, isVerified, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, username, hashedPassword, role, 1, Date.now());
    return { id, email, username, role };
};

const loginAs = async (email) => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ login: email, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    return agent;
};

const insertJob = ({ id, type, status = 'pending', priority = 0, scheduledAt, payload = {}, attempts = 0 }) => {
    const jobId = id || `job_${uuidv4()}`;
    const now = Date.now();

    db.prepare(`
        INSERT INTO job_queue (id, type, payload, status, priority, attempts, max_retries, scheduled_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        jobId,
        type,
        JSON.stringify(payload),
        status,
        priority,
        attempts,
        3,
        scheduledAt ?? now,
        now
    );

    return jobId;
};

describe('Admin Jobs API', () => {
    beforeAll(async () => {
        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;
        app = serverModule.app;
        await startServer({ dbPathOverride: testDbPath, listen: false, enableSchedulers: false, enableJobs: true });
        db = serverModule.db;
    });

    afterAll(() => {
        stopJobProcessor();
        if (db && db.close) {
            db.close();
        }
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(() => {
        db.exec('DELETE FROM job_queue');
        db.exec('DELETE FROM users');
    });

    it('returns 401 when not authenticated', async () => {
        const res = await request(app).get('/api/admin/jobs/pending');

        expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
        await createUser({ role: 'user', email: 'user@example.com', username: 'user1' });
        const agent = await loginAs('user@example.com');

        const res = await agent.get('/api/admin/jobs/pending');

        expect(res.status).toBe(403);
    });

    it('returns pending jobs filtered by type with limit and priority order', async () => {
        await createUser({ role: 'admin', email: 'admin@example.com', username: 'admin1' });
        const agent = await loginAs('admin@example.com');

        const base = Date.now();
        const emailTopEarly = insertJob({
            type: 'email',
            priority: 9,
            scheduledAt: base + 100,
            payload: { to: 'early@example.com' }
        });
        const emailTopLate = insertJob({
            type: 'email',
            priority: 9,
            scheduledAt: base + 200,
            payload: { to: 'late@example.com' }
        });
        insertJob({
            type: 'email',
            priority: 2,
            scheduledAt: base + 50,
            payload: { to: 'low@example.com' }
        });
        insertJob({
            type: 'cleanup_files',
            priority: 99,
            scheduledAt: base + 1,
            payload: { olderThanDays: 7 }
        });
        insertJob({
            type: 'email',
            status: 'dead',
            priority: 999,
            scheduledAt: base - 100,
            payload: { to: 'dead@example.com' }
        });

        const res = await agent
            .get('/api/admin/jobs/pending')
            .query({ type: 'email', limit: 2 });

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.jobs)).toBe(true);
        expect(res.body.jobs).toHaveLength(2);
        expect(res.body.jobs.every((job) => job.type === 'email')).toBe(true);
        expect(res.body.jobs.map((job) => job.id)).toEqual([emailTopEarly, emailTopLate]);
    });

    it('returns combined pending jobs when type=all sorted across job types', async () => {
        await createUser({ role: 'admin', email: 'admin2@example.com', username: 'admin2' });
        const agent = await loginAs('admin2@example.com');

        const base = Date.now();
        const cleanupTop = insertJob({
            type: 'cleanup_files',
            priority: 10,
            scheduledAt: base + 300,
            payload: { olderThanDays: 30 }
        });
        const emailSecond = insertJob({
            type: 'email',
            priority: 8,
            scheduledAt: base + 400,
            payload: { to: 'notify@example.com' }
        });
        insertJob({
            type: 'branding_convert',
            priority: 3,
            scheduledAt: base + 500,
            payload: { file: 'logo.png' }
        });

        const res = await agent
            .get('/api/admin/jobs/pending')
            .query({ type: 'all', limit: 2 });

        expect(res.status).toBe(200);
        expect(res.body.jobs).toHaveLength(2);
        expect(res.body.jobs.map((job) => job.id)).toEqual([cleanupTop, emailSecond]);
    });

    it('returns 400 for invalid job type', async () => {
        await createUser({ role: 'admin', email: 'admin3@example.com', username: 'admin3' });
        const agent = await loginAs('admin3@example.com');

        const res = await agent
            .get('/api/admin/jobs/pending')
            .query({ type: 'invalid_type' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Tipo de job invalido');
    });

    it('returns 401 for exported metrics without admin session or token', async () => {
        const res = await request(app).get('/metrics');

        expect(res.status).toBe(401);
        expect(res.text).toBe('unauthorized\n');
    });

    it('allows exported metrics with an admin session', async () => {
        await createUser({ role: 'admin', email: 'admin4@example.com', username: 'admin4' });
        const agent = await loginAs('admin4@example.com');

        const res = await agent.get('/metrics');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.text).toContain('sendu_health');
    });
});
