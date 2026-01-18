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

// Test database setup
const testDbPath = path.join(__dirname, '..', '..', 'data', 'test.sqlite');
let db;
let app;
let startServer;

describe('Auth API', () => {
    beforeAll(async () => {
        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;
        app = serverModule.app;
        await startServer({ dbPathOverride: testDbPath, listen: false, enableSchedulers: false, enableJobs: true });
        db = serverModule.db;
    });

    afterAll(() => {
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
        db.exec('DELETE FROM users');
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
