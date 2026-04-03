import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createUsersRepository } from '../lib/usersRepository.js';

const buildDb = () => {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            username TEXT NOT NULL,
            passwordHash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            isVerified INTEGER DEFAULT 0,
            verificationToken TEXT,
            verificationTokenExpires INTEGER,
            resetToken TEXT,
            resetTokenExpires INTEGER,
            createdAt INTEGER NOT NULL
        );

        CREATE TABLE files (
            id TEXT PRIMARY KEY,
            userId TEXT,
            serverPath TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0
        );
    `);

    return db;
};

describe('usersRepository', () => {
    it('registers users asynchronously and handles bootstrap promotion', async () => {
        const db = buildDb();
        const repository = createUsersRepository({ db });

        await expect(repository.registerUser({
            userId: 'user-1',
            email: 'admin@example.com',
            username: 'admin1',
            passwordHash: 'hash-1',
            verificationRequired: true,
            verificationTokenHash: 'verify-hash',
            verificationTokenExpires: 5000,
            createdAt: 1000,
            allowPublicRegistration: false,
            bootstrapTokenAccepted: true,
        })).resolves.toEqual({ bootstrapRequested: true });

        expect(db.prepare('SELECT role, isVerified FROM users WHERE id = ?').get('user-1')).toEqual({
            role: 'admin',
            isVerified: 0,
        });
        expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('adminBootstrapCompleted')).toEqual({ value: 'true' });

        await expect(repository.registerUser({
            userId: 'user-2',
            email: 'blocked@example.com',
            username: 'blocked',
            passwordHash: 'hash-2',
            verificationRequired: false,
            verificationTokenHash: null,
            verificationTokenExpires: null,
            createdAt: 2000,
            allowPublicRegistration: false,
            bootstrapTokenAccepted: false,
        })).rejects.toMatchObject({ status: 403, message: 'Registro publico deshabilitado' });

        db.close();
    });

    it('supports login lookup and verification or reset token lifecycle', async () => {
        const db = buildDb();
        const repository = createUsersRepository({ db });
        db.prepare(`
            INSERT INTO users (id, email, username, passwordHash, role, isVerified, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('user-1', 'alpha@example.com', 'alpha', 'hash-1', 'user', 0, 1000);

        await expect(repository.findByLogin('alpha@example.com')).resolves.toMatchObject({ id: 'user-1' });
        await expect(repository.findByLogin('alpha')).resolves.toMatchObject({ id: 'user-1' });
        await expect(repository.findByEmail('alpha@example.com')).resolves.toMatchObject({ username: 'alpha' });

        await repository.setVerificationToken('user-1', 'verify-token', 6000);
        await expect(repository.findByVerificationToken('verify-token')).resolves.toMatchObject({ id: 'user-1', isVerified: 0 });
        await expect(repository.listUsersWithVerificationTokens()).resolves.toEqual([
            expect.objectContaining({ id: 'user-1', verificationToken: 'verify-token' }),
        ]);

        await repository.markVerified('user-1');
        await expect(repository.findById('user-1')).resolves.toMatchObject({
            isVerified: 1,
            verificationToken: null,
            verificationTokenExpires: null,
        });

        await repository.setResetToken('user-1', 'reset-token', 7000);
        await expect(repository.findByResetToken('reset-token')).resolves.toMatchObject({ id: 'user-1' });

        await repository.updatePasswordAndClearReset('user-1', 'hash-2');
        await expect(repository.findById('user-1')).resolves.toMatchObject({
            passwordHash: 'hash-2',
            resetToken: null,
            resetTokenExpires: null,
        });

        db.close();
    });

    it('aggregates admin data and updates user or file ownership data', async () => {
        const db = buildDb();
        const repository = createUsersRepository({ db });

        db.prepare(`
            INSERT INTO users (id, email, username, passwordHash, role, isVerified, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('user-1', 'owner@example.com', 'owner', 'hash-1', 'user', 1, 1000);
        db.prepare(`
            INSERT INTO users (id, email, username, passwordHash, role, isVerified, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('user-2', 'viewer@example.com', 'viewer', 'hash-2', 'admin', 0, 2000);
        db.prepare('INSERT INTO files (id, userId, serverPath, size) VALUES (?, ?, ?, ?)').run('file-1', 'user-1', '/tmp/one', 10);
        db.prepare('INSERT INTO files (id, userId, serverPath, size) VALUES (?, ?, ?, ?)').run('file-2', 'user-1', '/tmp/two', 25);

        await expect(repository.findAuthUserById('user-1')).resolves.toMatchObject({
            id: 'user-1',
            username: 'owner',
            email: 'owner@example.com',
        });
        await expect(repository.findByUsername('owner')).resolves.toMatchObject({ id: 'user-1' });
        await expect(repository.findUploadActorById('user-1')).resolves.toEqual({ isVerified: 1, role: 'user' });
        await expect(repository.getAdminStats()).resolves.toEqual({ userCount: 2, fileCount: 2, totalSize: 35 });
        await expect(repository.listUsers()).resolves.toHaveLength(2);
        await expect(repository.getOwnedFileTotalSize('user-1')).resolves.toBe(35);
        await expect(repository.listOwnedFiles('user-1')).resolves.toHaveLength(2);
        await expect(repository.getRoleById('user-1')).resolves.toBe('user');
        await expect(repository.setRoleByUsername('owner', 'admin')).resolves.toBe(1);
        await expect(repository.getRoleById('user-1')).resolves.toBe('admin');

        await expect(repository.toggleRole('user-1')).resolves.toBe('user');
        await expect(repository.toggleVerified('user-1')).resolves.toBe(0);
        await expect(repository.updateIdentity('user-1', 'renamed@example.com', 'renamed')).resolves.toBe(1);
        await expect(repository.updatePasswordHash('user-1', 'hash-3')).resolves.toBe(1);
        await expect(repository.findById('user-1')).resolves.toMatchObject({
            email: 'renamed@example.com',
            username: 'renamed',
            passwordHash: 'hash-3',
            role: 'user',
            isVerified: 0,
        });

        await expect(repository.deleteUserAndOwnedFiles('user-1')).resolves.toBe(1);
        expect(db.prepare('SELECT COUNT(*) as count FROM users WHERE id = ?').get('user-1')).toEqual({ count: 0 });
        expect(db.prepare('SELECT COUNT(*) as count FROM files WHERE userId = ?').get('user-1')).toEqual({ count: 0 });

        db.close();
    });
});