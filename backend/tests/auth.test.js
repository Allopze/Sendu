import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test database setup
const testDbPath = path.join(__dirname, '..', 'test.sqlite');
let db;
let app;

// Create a minimal test app
const createTestApp = () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false }
    }));

    // Validation helpers (same as server.js)
    const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const isValidUsername = (username) => /^[a-zA-Z0-9_]{3,30}$/.test(username);
    const isValidPassword = (password) => password && password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);

    // Register endpoint
    testApp.post('/api/auth/register', async (req, res) => {
        const { email, username, password } = req.body;
        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Formato de email inválido' });
        }
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'El nombre de usuario debe tener 3-30 caracteres alfanuméricos' });
        }
        if (!isValidPassword(password)) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres, incluyendo letras y números' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = uuidv4();
            const stmt = db.prepare('INSERT INTO users (id, email, username, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?)');
            stmt.run(userId, email, username, hashedPassword, Date.now());
            res.status(201).json({ message: 'Usuario registrado' });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'El email o nombre de usuario ya existe' });
            }
            res.status(500).json({ error: 'Error interno' });
        }
    });

    // Login endpoint
    testApp.post('/api/auth/login', async (req, res) => {
        const { login, password } = req.body;
        if (!login || !password) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const stmt = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?');
        const user = stmt.get(login, login);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        req.session.userId = user.id;
        res.json({ message: 'Sesión iniciada', user: { id: user.id, username: user.username } });
    });

    // Me endpoint
    testApp.get('/api/auth/me', (req, res) => {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        const stmt = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?');
        const user = stmt.get(req.session.userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ user });
    });

    // Logout endpoint
    testApp.post('/api/auth/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ error: 'Error al cerrar sesión' });
            res.json({ message: 'Sesión cerrada' });
        });
    });

    return testApp;
};

describe('Auth API', () => {
    beforeAll(() => {
        // Create test database
        db = new Database(testDbPath);
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                passwordHash TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                isVerified INTEGER DEFAULT 0,
                createdAt INTEGER NOT NULL
            )
        `);
        app = createTestApp();
    });

    afterAll(() => {
        db.close();
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
            expect(res.body.message).toBe('Usuario registrado');
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
