import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
    generateFingerprint, 
    getIpFingerprint, 
    canGuestUpload, 
    recordGuestUpload, 
    getGuestUploadTotal 
} from '../lib/guestTracking.js';

// Mock request object
const createMockRequest = (ip = '192.168.1.1', userAgent = 'Mozilla/5.0', acceptLanguage = 'en-US') => ({
    ip,
    get: (header) => {
        if (header === 'user-agent') return userAgent;
        if (header === 'accept-language') return acceptLanguage;
        return '';
    },
    connection: { remoteAddress: ip }
});

describe('Guest Tracking Library', () => {
    describe('generateFingerprint', () => {
        it('should generate consistent fingerprint for same request data', () => {
            const req = createMockRequest();
            const fp1 = generateFingerprint(req);
            const fp2 = generateFingerprint(req);
            
            expect(fp1).toBe(fp2);
        });
        
        it('should generate different fingerprints for different IPs', () => {
            const req1 = createMockRequest('192.168.1.1');
            const req2 = createMockRequest('192.168.1.2');
            
            expect(generateFingerprint(req1)).not.toBe(generateFingerprint(req2));
        });
        
        it('should generate different fingerprints for different user agents', () => {
            const req1 = createMockRequest('192.168.1.1', 'Chrome');
            const req2 = createMockRequest('192.168.1.1', 'Firefox');
            
            expect(generateFingerprint(req1)).not.toBe(generateFingerprint(req2));
        });
        
        it('should return a valid SHA-256 hash', () => {
            const req = createMockRequest();
            const fingerprint = generateFingerprint(req);
            
            expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
        });
    });
    
    describe('getIpFingerprint', () => {
        it('should generate fingerprint based only on IP', () => {
            const req1 = createMockRequest('192.168.1.1', 'Chrome');
            const req2 = createMockRequest('192.168.1.1', 'Firefox');
            
            // Same IP should produce same fingerprint regardless of user agent
            expect(getIpFingerprint(req1)).toBe(getIpFingerprint(req2));
        });
        
        it('should differ for different IPs', () => {
            const req1 = createMockRequest('192.168.1.1');
            const req2 = createMockRequest('192.168.1.2');
            
            expect(getIpFingerprint(req1)).not.toBe(getIpFingerprint(req2));
        });
    });
    
    describe('canGuestUpload', () => {
        const fingerprint = 'test-fingerprint-unique-' + Date.now();
        const limitBytes = 5 * 1024 * 1024 * 1024; // 5GB
        
        it('should allow upload when under limit', () => {
            const uniqueFp = 'allow-test-' + Date.now();
            const result = canGuestUpload(uniqueFp, 1000, limitBytes);
            
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBeGreaterThan(0);
        });
        
        it('should deny upload when over limit', () => {
            const uniqueFp = 'deny-test-' + Date.now();
            const fileSize = limitBytes + 1;
            const result = canGuestUpload(uniqueFp, fileSize, limitBytes);
            
            expect(result.allowed).toBe(false);
            expect(result.message).toBeDefined();
        });
        
        it('should track cumulative uploads', () => {
            const uniqueFp = 'cumulative-test-' + Date.now();
            const smallLimit = 1000; // 1KB limit
            
            // Record some uploads
            recordGuestUpload(uniqueFp, 400);
            recordGuestUpload(uniqueFp, 400);
            
            // Total is now 800, trying to upload 300 more should fail
            const result = canGuestUpload(uniqueFp, 300, smallLimit);
            expect(result.allowed).toBe(false);
            
            // But 100 should still be allowed
            const result2 = canGuestUpload(uniqueFp, 100, smallLimit);
            expect(result2.allowed).toBe(true);
        });
    });
    
    describe('recordGuestUpload', () => {
        it('should track upload bytes', () => {
            const uniqueFp = 'record-test-' + Date.now();
            
            recordGuestUpload(uniqueFp, 1000);
            expect(getGuestUploadTotal(uniqueFp)).toBe(1000);
            
            recordGuestUpload(uniqueFp, 500);
            expect(getGuestUploadTotal(uniqueFp)).toBe(1500);
        });
    });
});
