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

describe('Upload Init API', () => {
    beforeAll(async () => {
        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;
        app = serverModule.app;
        await startServer({ dbPathOverride: testDbPath, listen: false, enableSchedulers: false, enableJobs: false });
        db = serverModule.db;
    });

    afterAll(() => {
        if (db && db.close) {
            db.close();
        }
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(() => {
        db.exec('DELETE FROM users');
    });

    it('should reject upload init for unverified user', async () => {
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('Password123', 10);
        db.prepare('INSERT INTO users (id, email, username, passwordHash, isVerified, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, 'u@example.com', 'user1', hashedPassword, 0, Date.now());

        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ login: 'u@example.com', password: 'Password123' });

        const res = await agent.post('/api/upload/init').send({
            originalName: 'test.txt',
            size: 1024,
            mimeType: 'text/plain',
            totalChunks: 1
        });

        expect(res.status).toBe(403);
    });

    it('should allow upload init for verified user', async () => {
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('Password123', 10);
        db.prepare('INSERT INTO users (id, email, username, passwordHash, isVerified, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, 'v@example.com', 'user2', hashedPassword, 1, Date.now());

        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ login: 'v@example.com', password: 'Password123' });

        const res = await agent.post('/api/upload/init').send({
            originalName: 'test.txt',
            size: 1024,
            mimeType: 'text/plain',
            totalChunks: 1
        });

        expect(res.status).toBe(200);
        expect(res.body.uploadId).toBeDefined();
    });
});
