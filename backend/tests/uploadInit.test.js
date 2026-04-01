import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

process.env.NODE_ENV = 'test';
process.env.ALLOW_PUBLIC_REGISTRATION = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-upload.sqlite');
let db;
let app;
let startServer;
const SMTP_ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const originalSmtpEnv = Object.fromEntries(SMTP_ENV_KEYS.map((key) => [key, process.env[key]]));

const clearSmtpEnv = () => {
    for (const key of SMTP_ENV_KEYS) {
        delete process.env[key];
    }
};

const restoreSmtpEnv = () => {
    for (const key of SMTP_ENV_KEYS) {
        if (originalSmtpEnv[key] === undefined) {
            delete process.env[key];
            continue;
        }
        process.env[key] = originalSmtpEnv[key];
    }
};

const extractCsrfToken = (response) => {
    const cookies = response.headers['set-cookie'] || [];
    const csrfCookie = cookies.find((cookie) => cookie.startsWith('csrf-token='));
    if (!csrfCookie) return null;
    return csrfCookie.split(';')[0].split('=')[1] || null;
};

describe('Upload Init API', () => {
    beforeAll(async () => {
        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;
        app = serverModule.app;
        await startServer({ dbPathOverride: testDbPath, listen: false, enableSchedulers: false, enableJobs: false });
        db = serverModule.db;
    });

    afterAll(() => {
        restoreSmtpEnv();
        if (db && db.close) {
            db.close();
        }
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(() => {
        db.exec('DELETE FROM users');
        db.exec("DELETE FROM settings WHERE key LIKE 'smtp%'");
        clearSmtpEnv();
    });

    it('should reject upload init for unverified user', async () => {
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('Password123', 10);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?), (?, ?), (?, ?)')
            .run(
                'smtpHost', 'smtp.example.com',
                'smtpUser', 'noreply@example.com',
                'smtpPass', 'plain-test-secret'
            );
        db.prepare('INSERT INTO users (id, email, username, passwordHash, isVerified, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, 'u@example.com', 'user1', hashedPassword, 0, Date.now());

        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ login: 'u@example.com', password: 'Password123' });
        const csrfRes = await agent.get('/api/auth/me');
        const csrfToken = extractCsrfToken(csrfRes);

        const res = await agent.post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'test.txt',
                size: 1024,
                mimeType: 'text/plain',
                totalChunks: 1
            });

        expect(res.status).toBe(403);
    });

    it('should allow upload init for unverified user when SMTP is not configured', async () => {
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('Password123', 10);
        db.prepare('INSERT INTO users (id, email, username, passwordHash, isVerified, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, 'nosmtp@example.com', 'user-nosmtp', hashedPassword, 0, Date.now());

        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ login: 'nosmtp@example.com', password: 'Password123' });
        const csrfRes = await agent.get('/api/auth/me');
        const csrfToken = extractCsrfToken(csrfRes);

        const res = await agent.post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'test.txt',
                size: 1024,
                mimeType: 'text/plain',
                totalChunks: 1
            });

        expect(res.status).toBe(200);
        expect(res.body.uploadId).toBeDefined();
    });

    it('should allow upload init for verified user', async () => {
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('Password123', 10);
        db.prepare('INSERT INTO users (id, email, username, passwordHash, isVerified, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, 'v@example.com', 'user2', hashedPassword, 1, Date.now());

        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ login: 'v@example.com', password: 'Password123' });
        const csrfRes = await agent.get('/api/auth/me');
        const csrfToken = extractCsrfToken(csrfRes);

        const res = await agent.post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'test.txt',
                size: 1024,
                mimeType: 'text/plain',
                totalChunks: 1
            });

        expect(res.status).toBe(200);
        expect(res.body.uploadId).toBeDefined();
    });

    it('should reject upload init for unverified user when SMTP comes from environment', async () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = '587';
        process.env.SMTP_USER = 'mailer@example.com';
        process.env.SMTP_PASS = 'env-secret';
        process.env.SMTP_FROM = 'ops@example.com';

        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('Password123', 10);
        db.prepare('INSERT INTO users (id, email, username, passwordHash, isVerified, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, 'envsmtp@example.com', 'user-envsmtp', hashedPassword, 0, Date.now());

        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ login: 'envsmtp@example.com', password: 'Password123' });
        const csrfRes = await agent.get('/api/auth/me');
        const csrfToken = extractCsrfToken(csrfRes);

        const res = await agent.post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'test.txt',
                size: 1024,
                mimeType: 'text/plain',
                totalChunks: 1
            });

        expect(res.status).toBe(403);
    });
});
