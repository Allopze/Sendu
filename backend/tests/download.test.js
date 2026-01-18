import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

process.env.NODE_ENV = 'test';
process.env.ALLOW_PUBLIC_REGISTRATION = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..', '..');
const testDbPath = path.join(rootDir, 'data', 'test.sqlite');
const uploadsDir = path.join(rootDir, 'uploads');

let app;
let db;
let startServer;

describe('Download flow', () => {
    beforeAll(async () => {
        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;
        app = serverModule.app;
        await startServer({ dbPathOverride: testDbPath, listen: false, enableSchedulers: false, enableJobs: true });
        db = serverModule.db;
        await fs.mkdir(uploadsDir, { recursive: true });
    });

    afterAll(async () => {
        if (db && db.close) {
            db.close();
        }
        try {
            await fs.unlink(testDbPath);
        } catch {}
    });

    it('should issue download token via cookie and allow download', async () => {
        const fileId = uuidv4();
        const filePath = path.join(uploadsDir, fileId);
        const password = 'Password123';
        const passwordHash = await bcrypt.hash(password, 10);

        await fs.writeFile(filePath, 'test-content');

        db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, passwordHash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(fileId, 'test.txt', filePath, 'text/plain', 12, Date.now(), null, null, passwordHash);

        const agent = request.agent(app);

        const validateRes = await agent
            .post(`/api/download/${fileId}/validate`)
            .send({ password });

        expect(validateRes.status).toBe(200);

        const downloadRes = await agent.get(`/api/download/${fileId}`);
        expect(downloadRes.status).toBe(200);

        await fs.unlink(filePath);
    });

    it('should report readiness when DB and storage are available', async () => {
        const res = await request(app).get('/api/health/ready');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});
