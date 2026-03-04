import { describe, it, expect } from 'vitest';
import { hashToken, generateSecureToken } from '../lib/tokenHash.js';

describe('Token Hash Library', () => {
    describe('hashToken', () => {
        it('should hash a token consistently', () => {
            const token = 'test-token-12345';
            const hash1 = hashToken(token);
            const hash2 = hashToken(token);
            
            expect(hash1).toBe(hash2);
        });
        
        it('should return different hashes for different tokens', () => {
            const hash1 = hashToken('token1');
            const hash2 = hashToken('token2');
            
            expect(hash1).not.toBe(hash2);
        });
        
        it('should return null for null input', () => {
            expect(hashToken(null)).toBeNull();
        });
        
        it('should return undefined for undefined input', () => {
            expect(hashToken(undefined)).toBeNull();
        });
        
        it('should return a hex string of 64 characters (SHA-256)', () => {
            const hash = hashToken('any-token');
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });
    });
    
    describe('generateSecureToken', () => {
        it('should generate a token and its hash', () => {
            const { token, hash } = generateSecureToken();
            
            expect(token).toBeDefined();
            expect(hash).toBeDefined();
            expect(typeof token).toBe('string');
            expect(typeof hash).toBe('string');
        });
        
        it('should generate tokens of 64 hex characters', () => {
            const { token } = generateSecureToken();
            expect(token).toMatch(/^[a-f0-9]{64}$/);
        });
        
        it('should generate unique tokens each time', () => {
            const { token: token1 } = generateSecureToken();
            const { token: token2 } = generateSecureToken();
            
            expect(token1).not.toBe(token2);
        });
        
        it('should generate hash that matches the token', () => {
            const { token, hash } = generateSecureToken();
            const computedHash = hashToken(token);
            
            expect(hash).toBe(computedHash);
        });
    });
});
