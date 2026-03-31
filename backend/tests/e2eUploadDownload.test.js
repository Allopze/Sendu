import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.ALLOW_PUBLIC_REGISTRATION = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testRoot = path.join(__dirname, '..', '..', 'tmp', 'e2e-upload');
const uploadsDir = path.join(testRoot, 'uploads');
const tempDir = path.join(testRoot, 'tmp');
const dataDir = path.join(testRoot, 'data');
const testDbPath = path.join(dataDir, 'test-e2e.sqlite');

process.env.APP_UPLOADS_PATH = uploadsDir;
process.env.APP_TEMP_PATH = tempDir;
process.env.APP_DATA_PATH = dataDir;

let db;
let app;
let startServer;

const extractCsrfToken = (response) => {
    const cookies = response.headers['set-cookie'] || [];
    const csrfCookie = cookies.find((cookie) => cookie.startsWith('csrf-token='));
    if (!csrfCookie) return null;
    return csrfCookie.split(';')[0].split('=')[1] || null;
};

describe('E2E Upload/Download', () => {
    beforeAll(async () => {
        fs.mkdirSync(uploadsDir, { recursive: true });
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(dataDir, { recursive: true });

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
        if (fs.existsSync(testRoot)) {
            fs.rmSync(testRoot, { recursive: true, force: true });
        }
    });

    it('should upload a small file and download it', async () => {
        const content = Buffer.from('hello sendu');
        const agent = request.agent(app);

        const csrfRes = await agent.get('/api/auth/me');
        let csrfToken = extractCsrfToken(csrfRes);

        const initRes = await agent
            .post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'hello.txt',
                size: content.length,
                mimeType: 'text/plain',
                totalChunks: 1
            });

        csrfToken = extractCsrfToken(initRes) || csrfToken;

        expect(initRes.status).toBe(200);
        expect(initRes.body.uploadId).toBeDefined();
        expect(initRes.body.uploadToken).toBeDefined();

        const uploadId = initRes.body.uploadId;
        const uploadToken = initRes.body.uploadToken;

        const forbiddenChunkRes = await request(app)
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .attach('chunk', content, 'hello.txt');

        expect(forbiddenChunkRes.status).toBe(403);

        const chunkRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', content, 'hello.txt');

        expect(chunkRes.status).toBe(200);

        const statusRes = await agent
            .get(`/api/upload/status/${uploadId}`)
            .set('x-upload-token', uploadToken);

        expect(statusRes.status).toBe(200);
        expect(statusRes.body.completedChunks).toEqual([0]);
        expect(statusRes.body.totalChunks).toBe(1);
        expect(statusRes.body.status).toBe('initiated');

        const completeRes = await agent
            .post('/api/upload/complete')
            .set('x-csrf-token', csrfToken)
            .send({ uploadId });

        expect(completeRes.status).toBe(200);
        expect(completeRes.body.fileId).toBeDefined();

        const fileId = completeRes.body.fileId;

        const downloadRes = await agent
            .get(`/api/download/${fileId}`)
            .buffer(true)
            .parse((res, cb) => {
                const data = [];
                res.on('data', (chunk) => data.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(data)));
            });

        expect(downloadRes.status).toBe(200);
        expect(Buffer.isBuffer(downloadRes.body)).toBe(true);
        expect(downloadRes.body.toString('utf8')).toBe(content.toString('utf8'));
    });
});
