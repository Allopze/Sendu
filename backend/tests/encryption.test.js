import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted, getEncryptionFormat } from '../lib/encryption.js';

const buildLegacyCiphertext = (text) => {
    const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-secret';
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
};

describe('Encryption Module', () => {
    const testData = 'my-secret-password';

    describe('encrypt', () => {
        it('should encrypt a string', () => {
            const encrypted = encrypt(testData);
            expect(encrypted).toBeDefined();
            expect(encrypted).not.toBe(testData);
            expect(encrypted).toContain(':');
            expect(getEncryptionFormat(encrypted)).toBe('aes-256-gcm');
        });

        it('should return empty string for empty input', () => {
            expect(encrypt('')).toBe('');
            expect(encrypt(null)).toBe(null);
            expect(encrypt(undefined)).toBe(undefined);
        });

        it('should produce different output each time (random IV)', () => {
            const encrypted1 = encrypt(testData);
            const encrypted2 = encrypt(testData);
            expect(encrypted1).not.toBe(encrypted2);
        });
    });

    describe('decrypt', () => {
        it('should decrypt an encrypted string', () => {
            const encrypted = encrypt(testData);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(testData);
        });

        it('should decrypt legacy AES-CBC payloads for migration compatibility', () => {
            const encrypted = buildLegacyCiphertext(testData);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(testData);
            expect(getEncryptionFormat(encrypted)).toBe('aes-256-cbc-legacy');
        });

        it('should return original for non-encrypted data', () => {
            const plainText = 'not-encrypted';
            expect(decrypt(plainText)).toBe(plainText);
        });

        it('should fail closed for corrupted AES-GCM payloads', () => {
            const encrypted = encrypt(testData);
            const [prefix, iv, authTag, ciphertext] = encrypted.split(':');
            const corruptedPayload = `${prefix}:${iv}:${authTag}:${ciphertext.slice(0, -2)}aa`;
            expect(() => decrypt(corruptedPayload)).toThrow(/Failed to decrypt sensitive value/);
        });

        it('should handle empty input', () => {
            expect(decrypt('')).toBe('');
            expect(decrypt(null)).toBe(null);
        });
    });

    describe('isEncrypted', () => {
        it('should return true for encrypted data', () => {
            const encrypted = encrypt(testData);
            expect(isEncrypted(encrypted)).toBe(true);
        });

        it('should return true for legacy encrypted data', () => {
            const encrypted = buildLegacyCiphertext(testData);
            expect(isEncrypted(encrypted)).toBe(true);
        });

        it('should return false for plain text', () => {
            expect(isEncrypted('plain-text')).toBe(false);
            expect(isEncrypted('short:text')).toBe(false); // IV too short
        });

        it('should return false for invalid input', () => {
            expect(isEncrypted('')).toBe(false);
            expect(isEncrypted(null)).toBe(false);
            expect(isEncrypted(undefined)).toBe(false);
            expect(isEncrypted(123)).toBe(false);
        });
    });

    describe('Integration', () => {
        it('should correctly round-trip various data types', () => {
            const testCases = [
                'simple-password',
                'password with spaces',
                'pässwörd-with-ünicödé',
                'password123!@#$%^&*()',
                'a'.repeat(1000) // Long password
            ];

            for (const original of testCases) {
                const encrypted = encrypt(original);
                const decrypted = decrypt(encrypted);
                expect(decrypted).toBe(original);
            }
        });
    });
});
