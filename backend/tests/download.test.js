import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { stopJobProcessor } from '../lib/jobQueue.js';

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
        stopJobProcessor();
        if (db && db.close) {
            db.close();
        }
        try {
            await fs.unlink(testDbPath);
        } catch {}
    });

    beforeEach(() => {
        db.exec('DELETE FROM files');
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

        const fileRow = db.prepare('SELECT downloadCount FROM files WHERE id = ?').get(fileId);
        expect(fileRow.downloadCount).toBe(1);

        await fs.unlink(filePath);
    });

    it('should not increment downloadCount when the file is missing on disk', async () => {
        const fileId = uuidv4();
        const missingPath = path.join(uploadsDir, `${fileId}-missing`);

        db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, passwordHash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(fileId, 'missing.txt', missingPath, 'text/plain', 12, Date.now(), null, null, null);

        const res = await request(app).get(`/api/download/${fileId}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('no disponible');

        const fileRow = db.prepare('SELECT downloadCount FROM files WHERE id = ?').get(fileId);
        expect(fileRow.downloadCount).toBe(0);
    });

    it('should report readiness when DB and storage are available', async () => {
        const res = await request(app).get('/api/health/ready');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });

    it('should include requestId in not found responses for correlation', async () => {
        const res = await request(app).get('/api/does-not-exist');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Ruta no encontrada');
        expect(typeof res.body.requestId).toBe('string');
        expect(res.body.requestId.length).toBeGreaterThan(0);
        expect(typeof res.headers['x-request-id']).toBe('string');
    });
});
