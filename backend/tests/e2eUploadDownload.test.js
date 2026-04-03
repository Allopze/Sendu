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

    it('should ignore stale .uploading temp files when resuming a chunked upload', async () => {
        const content = Buffer.from('resume-check');
        const agent = request.agent(app);

        const csrfRes = await agent.get('/api/auth/me');
        let csrfToken = extractCsrfToken(csrfRes);

        const initRes = await agent
            .post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'resume.txt',
                size: content.length,
                mimeType: 'text/plain',
                totalChunks: 1,
                chunkSize: content.length
            });

        csrfToken = extractCsrfToken(initRes) || csrfToken;

        expect(initRes.status).toBe(200);
        const uploadId = initRes.body.uploadId;
        const uploadToken = initRes.body.uploadToken;
        const uploadChunkDir = path.join(uploadsDir, 'chunks', uploadId);

        fs.writeFileSync(path.join(uploadChunkDir, '0.stale.uploading'), content);

        const chunkRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', content, 'resume.txt');

        expect(chunkRes.status).toBe(200);

        const statusRes = await agent
            .get(`/api/upload/status/${uploadId}`)
            .set('x-upload-token', uploadToken);

        expect(statusRes.status).toBe(200);
        expect(statusRes.body.completedChunks).toEqual([0]);
    });

    it('should not contaminate bytesReceived when a chunk fails validation', async () => {
        const content = Buffer.from('quota-check');
        const agent = request.agent(app);

        const csrfRes = await agent.get('/api/auth/me');
        let csrfToken = extractCsrfToken(csrfRes);

        const initRes = await agent
            .post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'quota.txt',
                size: content.length,
                mimeType: 'text/plain',
                totalChunks: 1,
                chunkSize: content.length
            });

        csrfToken = extractCsrfToken(initRes) || csrfToken;

        expect(initRes.status).toBe(200);

        const uploadId = initRes.body.uploadId;
        const uploadToken = initRes.body.uploadToken;

        const invalidChunkRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=1`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', content, 'quota.txt');

        expect(invalidChunkRes.status).toBe(400);

        const uploadSession = db.prepare('SELECT bytesReceived FROM upload_sessions WHERE uploadId = ?').get(uploadId);
        expect(uploadSession.bytesReceived).toBe(0);

        const validChunkRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', content, 'quota.txt');

        expect(validChunkRes.status).toBe(200);

        const updatedSession = db.prepare('SELECT bytesReceived FROM upload_sessions WHERE uploadId = ?').get(uploadId);
        expect(updatedSession.bytesReceived).toBe(content.length);
    });

    it('should complete a multi-chunk upload and preserve progress across resumable status checks', async () => {
        const chunkA = Buffer.alloc(256 * 1024, 'a');
        const chunkB = Buffer.alloc(256 * 1024, 'b');
        const chunkC = Buffer.alloc(128 * 1024, 'c');
        const content = Buffer.concat([chunkA, chunkB, chunkC]);
        const agent = request.agent(app);

        const csrfRes = await agent.get('/api/auth/me');
        let csrfToken = extractCsrfToken(csrfRes);

        const initRes = await agent
            .post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'large.txt',
                size: content.length,
                mimeType: 'text/plain',
                totalChunks: 3,
                chunkSize: chunkA.length
            });

        expect(initRes.status).toBe(200);
        csrfToken = extractCsrfToken(initRes) || csrfToken;

        const uploadId = initRes.body.uploadId;
        const uploadToken = initRes.body.uploadToken;

        const firstChunkRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', chunkA, 'large.txt.part0');

        expect(firstChunkRes.status).toBe(200);

        const partialStatusRes = await agent
            .get(`/api/upload/status/${uploadId}`)
            .set('x-upload-token', uploadToken);

        expect(partialStatusRes.status).toBe(200);
        expect(partialStatusRes.body.completedChunks).toEqual([0]);

        const [secondChunkRes, thirdChunkRes] = await Promise.all([
            agent
                .post(`/api/upload/chunk?uploadId=${uploadId}&index=1`)
                .set('x-upload-token', uploadToken)
                .attach('chunk', chunkB, 'large.txt.part1'),
            agent
                .post(`/api/upload/chunk?uploadId=${uploadId}&index=2`)
                .set('x-upload-token', uploadToken)
                .attach('chunk', chunkC, 'large.txt.part2')
        ]);

        expect(secondChunkRes.status).toBe(200);
        expect(thirdChunkRes.status).toBe(200);

        const completeRes = await agent
            .post('/api/upload/complete')
            .set('x-csrf-token', csrfToken)
            .send({ uploadId });

        expect(completeRes.status).toBe(200);

        const downloadRes = await agent
            .get(`/api/download/${completeRes.body.fileId}`)
            .buffer(true)
            .parse((res, cb) => {
                const data = [];
                res.on('data', (chunk) => data.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(data)));
            });

        expect(downloadRes.status).toBe(200);
        expect(downloadRes.body.length).toBe(content.length);
        expect(downloadRes.body.equals(content)).toBe(true);
    });

    it('should complete a streaming ZIP upload using the declared final chunk and actual size', async () => {
        const zipHex = [
            '504b03041400000000000000000086a61036050000000500000006000000',
            '68692e74787468656c6c6f',
            '504b010214001400000000000000000086a610360500000005000000060000000000000000000000000000000000',
            '68692e747874',
            '504b0506000000000100010034000000290000000000'
        ].join('');
        const zipContent = Buffer.from(zipHex, 'hex');
        const firstChunk = zipContent.subarray(0, 64);
        const secondChunk = zipContent.subarray(64);
        const agent = request.agent(app);

        const csrfRes = await agent.get('/api/auth/me');
        let csrfToken = extractCsrfToken(csrfRes);

        const initRes = await agent
            .post('/api/upload/init')
            .set('x-csrf-token', csrfToken)
            .send({
                originalName: 'archivos.zip',
                size: zipContent.length + 128,
                mimeType: 'application/zip',
                totalChunks: 4,
                chunkSize: 64,
                streamingZip: true
            });

        expect(initRes.status).toBe(200);
        csrfToken = extractCsrfToken(initRes) || csrfToken;

        const uploadId = initRes.body.uploadId;
        const uploadToken = initRes.body.uploadToken;

        const firstUploadRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=0`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', firstChunk, 'archivos.zip.part0');

        const secondUploadRes = await agent
            .post(`/api/upload/chunk?uploadId=${uploadId}&index=1`)
            .set('x-upload-token', uploadToken)
            .attach('chunk', secondChunk, 'archivos.zip.part1');

        expect(firstUploadRes.status).toBe(200);
        expect(secondUploadRes.status).toBe(200);

        const completeRes = await agent
            .post('/api/upload/complete')
            .set('x-csrf-token', csrfToken)
            .send({
                uploadId,
                finalChunkIndex: 1,
                actualSize: zipContent.length
            });

        expect(completeRes.status).toBe(200);

        const downloadRes = await agent
            .get(`/api/download/${completeRes.body.fileId}`)
            .buffer(true)
            .parse((res, cb) => {
                const data = [];
                res.on('data', (chunk) => data.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(data)));
            });

        expect(downloadRes.status).toBe(200);
        expect(downloadRes.body.equals(zipContent)).toBe(true);
    });
});
