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

        const initRes = await request(app)
            .post('/api/upload/init')
            .send({
                originalName: 'hello.txt',
                size: content.length,
                mimeType: 'text/plain',
                totalChunks: 1
            });

        expect(initRes.status).toBe(200);
        expect(initRes.body.uploadId).toBeDefined();

        const uploadId = initRes.body.uploadId;

        const chunkRes = await request(app)
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .attach('chunk', content, 'hello.txt');

        expect(chunkRes.status).toBe(200);

        const completeRes = await request(app)
            .post('/api/upload/complete')
            .send({ uploadId });

        expect(completeRes.status).toBe(200);
        expect(completeRes.body.fileId).toBeDefined();

        const fileId = completeRes.body.fileId;

        const downloadRes = await request(app)
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
