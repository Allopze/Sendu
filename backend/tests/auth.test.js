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

// Test database setup
const testDbPath = path.join(__dirname, '..', '..', 'data', 'test.sqlite');
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

describe('Auth API', () => {
    beforeAll(async () => {
        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;
        app = serverModule.app;
        await startServer({ dbPathOverride: testDbPath, listen: false, enableSchedulers: false, enableJobs: true });
        db = serverModule.db;
    });

    afterAll(() => {
        restoreSmtpEnv();
        stopJobProcessor();
        if (db && db.close) {
            db.close();
        }
        // Clean up test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(() => {
        // Clear users table before each test
        db.exec('DELETE FROM files');
        db.exec('DELETE FROM users');
        db.exec("DELETE FROM settings WHERE key LIKE 'smtp%'");
        clearSmtpEnv();
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    username: 'testuser',
                    password: 'Password123'
                });

            expect(res.status).toBe(201);
            expect(res.body.message).toContain('Usuario registrado');
            expect(res.body.emailDeliveryEnabled).toBe(false);
            expect(res.body.requiresEmailVerification).toBe(false);
        });

        it('should not promote the first public registration to admin without bootstrap token', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'first@example.com',
                    username: 'firstuser',
                    password: 'Password123'
                });

            expect(res.status).toBe(201);

            const user = db.prepare('SELECT role FROM users WHERE email = ?').get('first@example.com');
            expect(user.role).toBe('user');
        });

        it('should auto-verify new users when SMTP is not configured', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'autoverified@example.com',
                    username: 'autoverified',
                    password: 'Password123'
                });

            expect(res.status).toBe(201);
            expect(res.body.message).toContain('ya puedes iniciar sesión');

            const user = db.prepare('SELECT isVerified, verificationToken FROM users WHERE email = ?').get('autoverified@example.com');
            expect(user.isVerified).toBe(1);
            expect(user.verificationToken).toBeNull();
        });

        it('should reject invalid email format', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'invalid-email',
                    username: 'testuser',
                    password: 'Password123'
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('email');
        });

        it('should reject short username', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    username: 'ab',
                    password: 'Password123'
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('usuario');
        });

        it('should reject weak password', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    username: 'testuser',
                    password: 'short'
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('contraseña');
        });

        it('should reject duplicate email', async () => {
            // Register first user
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    username: 'testuser1',
                    password: 'Password123'
                });

            // Try to register with same email
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    username: 'testuser2',
                    password: 'Password123'
                });

            expect(res.status).toBe(409);
            expect(res.body.error).toContain('existe');
        });

        it('should reject missing fields', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com'
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Faltan');
        });
    });

    describe('POST /api/auth/login', () => {
        beforeEach(async () => {
            // Create a test user
            const hashedPassword = await bcrypt.hash('Password123', 10);
            const stmt = db.prepare('INSERT INTO users (id, email, username, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?)');
            stmt.run(uuidv4(), 'test@example.com', 'testuser', hashedPassword, Date.now());
        });

        it('should login with valid email credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    login: 'test@example.com',
                    password: 'Password123'
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('Sesión');
            expect(res.body.user).toBeDefined();
        });

        it('should login with valid username credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    login: 'testuser',
                    password: 'Password123'
                });

            expect(res.status).toBe(200);
            expect(res.body.user.username).toBe('testuser');
        });

        it('should reject invalid password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    login: 'test@example.com',
                    password: 'WrongPassword123'
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('inválidas');
        });

        it('should reject non-existent user', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    login: 'nonexistent@example.com',
                    password: 'Password123'
                });

            expect(res.status).toBe(401);
        });

        it('should reject missing fields', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    login: 'test@example.com'
                });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/auth/me', () => {
        it('should return 401 when not authenticated', async () => {
            const res = await request(app)
                .get('/api/auth/me');

            expect(res.status).toBe(401);
        });

        it('should not expose internal file fields in /api/user/files', async () => {
            const userId = uuidv4();
            const accountPassword = 'Password123';
            const hashedPassword = await bcrypt.hash(accountPassword, 10);

            db.prepare('INSERT INTO users (id, email, username, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?)')
                .run(userId, 'owner@example.com', 'owneruser', hashedPassword, Date.now());

            db.prepare(`
                INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, passwordHash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), 'secret.txt', '/tmp/secret.txt', 'text/plain', 128, Date.now(), userId, await bcrypt.hash('Transfer123', 10));

            const agent = request.agent(app);
            const loginRes = await agent
                .post('/api/auth/login')
                .send({
                    login: 'owner@example.com',
                    password: accountPassword
                });

            expect(loginRes.status).toBe(200);

            const filesRes = await agent.get('/api/user/files');
            expect(filesRes.status).toBe(200);
            expect(filesRes.body.files).toHaveLength(1);
            expect(filesRes.body.files[0].hasPassword).toBe(true);
            expect(filesRes.body.files[0].passwordHash).toBeUndefined();
            expect(filesRes.body.files[0].serverPath).toBeUndefined();
        });
    });

    describe('email-dependent auth flows without SMTP', () => {
        it('should return 503 for forgot password when SMTP is unavailable', async () => {
            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: 'missing@example.com' });

            expect(res.status).toBe(503);
            expect(res.body.error).toContain('no está disponible');
        });

        it('should auto-verify an authenticated user when resending verification without SMTP', async () => {
            const hashedPassword = await bcrypt.hash('Password123', 10);
            const userId = uuidv4();
            db.prepare(`
                INSERT INTO users (id, email, username, passwordHash, isVerified, verificationToken, verificationTokenExpires, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId,
                'pending@example.com',
                'pendinguser',
                hashedPassword,
                0,
                'hashed-token',
                Date.now() + 60_000,
                Date.now()
            );

            const agent = request.agent(app);
            const loginRes = await agent
                .post('/api/auth/login')
                .send({ login: 'pending@example.com', password: 'Password123' });

            expect(loginRes.status).toBe(200);

            const csrfRes = await agent.get('/api/auth/me');
            const csrfToken = extractCsrfToken(csrfRes);

            const resendRes = await agent
                .post('/api/auth/resend-verification')
                .set('x-csrf-token', csrfToken)
                .send({});
            expect(resendRes.status).toBe(200);
            expect(resendRes.body.autoVerified).toBe(true);

            const user = db.prepare('SELECT isVerified, verificationToken FROM users WHERE id = ?').get(userId);
            expect(user.isVerified).toBe(1);
            expect(user.verificationToken).toBeNull();
        });

        it('should allow forgot password flow when SMTP is configured via environment', async () => {
            process.env.SMTP_HOST = 'smtp.example.com';
            process.env.SMTP_PORT = '587';
            process.env.SMTP_USER = 'mailer@example.com';
            process.env.SMTP_PASS = 'env-secret';
            process.env.SMTP_FROM = 'ops@example.com';

            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: 'missing@example.com' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('Si el email existe');
        });
    });

    describe('POST /api/auth/logout', () => {
        it('should logout successfully', async () => {
            const res = await request(app)
                .post('/api/auth/logout');

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('cerrada');
        });
    });
});
