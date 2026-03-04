import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../lib/encryption.js';

describe('Encryption Module', () => {
    const testData = 'my-secret-password';

    describe('encrypt', () => {
        it('should encrypt a string', () => {
            const encrypted = encrypt(testData);
            expect(encrypted).toBeDefined();
            expect(encrypted).not.toBe(testData);
            expect(encrypted).toContain(':'); // IV:encrypted format
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

        it('should return original for non-encrypted data', () => {
            const plainText = 'not-encrypted';
            expect(decrypt(plainText)).toBe(plainText);
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
