import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock crypto module for consistent testing
vi.mock('crypto', async () => {
    const actual = await vi.importActual('crypto');
    return {
        ...actual,
        randomBytes: vi.fn((size) => actual.randomBytes(size))
    };
});

import { generateToken, validateToken } from '../lib/csrf.js';

describe('CSRF Module', () => {
    const mockSessionId = 'test-session-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generateToken', () => {
        it('should generate a token string', () => {
            const token = generateToken(mockSessionId);
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.length).toBe(64); // 32 bytes = 64 hex chars
        });

        it('should generate unique tokens', () => {
            const token1 = generateToken(mockSessionId);
            const token2 = generateToken(mockSessionId);
            expect(token1).not.toBe(token2);
        });
    });

    describe('validateToken', () => {
        it('should validate a valid token', () => {
            const token = generateToken(mockSessionId);
            const isValid = validateToken(mockSessionId, token);
            expect(isValid).toBe(true);
        });

        it('should reject an invalid token', () => {
            const isValid = validateToken(mockSessionId, 'invalid-token');
            expect(isValid).toBe(false);
        });

        it('should reject token with wrong session', () => {
            const token = generateToken(mockSessionId);
            const isValid = validateToken('different-session', token);
            expect(isValid).toBe(false);
        });

        it('should reject token after single use (token consumed)', () => {
            const token = generateToken(mockSessionId);
            
            // First validation should succeed
            expect(validateToken(mockSessionId, token)).toBe(true);
            
            // Second validation should fail (token consumed)
            expect(validateToken(mockSessionId, token)).toBe(false);
        });

        it('should reject empty token', () => {
            expect(validateToken(mockSessionId, '')).toBe(false);
            expect(validateToken(mockSessionId, null)).toBe(false);
            expect(validateToken(mockSessionId, undefined)).toBe(false);
        });
    });

    describe('Integration', () => {
        it('should handle multiple sessions independently', () => {
            const session1 = 'session-1';
            const session2 = 'session-2';

            const token1 = generateToken(session1);
            const token2 = generateToken(session2);

            // Each token should only work with its session
            expect(validateToken(session1, token1)).toBe(true);
            expect(validateToken(session2, token2)).toBe(true);

            // Tokens should not be interchangeable
            const token1New = generateToken(session1);
            const token2New = generateToken(session2);
            expect(validateToken(session1, token2New)).toBe(false);
            expect(validateToken(session2, token1New)).toBe(false);
        });
    });
});
