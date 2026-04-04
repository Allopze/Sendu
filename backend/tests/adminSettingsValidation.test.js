import { describe, it, expect } from 'vitest';
import { validateAdminSettingsPayload } from '../lib/adminSettings.js';

describe('Admin Settings Validation — hardened edge cases', () => {
    // ── SMTP format validation ──────────────────────────────────

    it('should reject smtpHost with protocol prefix', () => {
        const err = validateAdminSettingsPayload({ smtpHost: 'https://smtp.example.com' });
        expect(err).toContain('hostname o IP');
    });

    it('should reject smtpHost with spaces', () => {
        const err = validateAdminSettingsPayload({ smtpHost: 'smtp example.com' });
        expect(err).toContain('hostname o IP');
    });

    it('should accept valid smtpHost hostnames', () => {
        expect(validateAdminSettingsPayload({ smtpHost: 'smtp.example.com' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpHost: 'mail.server-01.example.com' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpHost: '192.168.1.1' })).toBeNull();
    });

    it('should reject smtpUser with spaces', () => {
        const err = validateAdminSettingsPayload({ smtpUser: 'user name', smtpHost: 'smtp.example.com' });
        expect(err).toContain('espacios');
    });

    it('should accept valid smtpUser values', () => {
        expect(validateAdminSettingsPayload({ smtpUser: 'noreply@example.com', smtpHost: 'smtp.example.com' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpUser: 'API_KEY', smtpHost: 'smtp.example.com' })).toBeNull();
    });

    // ── Cross-field SMTP coherence ──────────────────────────────

    it('should reject smtpUser without smtpHost', () => {
        const err = validateAdminSettingsPayload({ smtpUser: 'noreply@example.com' });
        expect(err).toContain('smtpHost');
    });

    it('should accept smtpHost alone (pass/user might already be stored)', () => {
        expect(validateAdminSettingsPayload({ smtpHost: 'smtp.example.com' })).toBeNull();
    });

    // ── Integer range hardening ─────────────────────────────────

    it('should reject fractional numbers for integer settings', () => {
        const err = validateAdminSettingsPayload({ maxFileSize: '10.5' });
        expect(err).toContain('entero');
    });

    it('should reject scientific notation for integer settings', () => {
        const err = validateAdminSettingsPayload({ smtpPort: '5e2' });
        expect(err).toContain('entero');
    });

    it('should reject zero for settings with min=1', () => {
        const err = validateAdminSettingsPayload({ maxFileSize: '0' });
        expect(err).toContain('entre 1');
    });

    it('should reject negative numbers', () => {
        const err = validateAdminSettingsPayload({ maxConcurrentUploads: '-5' });
        expect(err).toContain('entre 1');
    });

    it('should reject values above maximum', () => {
        const err = validateAdminSettingsPayload({ smtpPort: '70000' });
        expect(err).toContain('65535');
    });

    it('should accept boundary values (min and max)', () => {
        expect(validateAdminSettingsPayload({ smtpPort: '1' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpPort: '65535' })).toBeNull();
        expect(validateAdminSettingsPayload({ maxFileSize: '1' })).toBeNull();
        expect(validateAdminSettingsPayload({ maxFileSize: '102400' })).toBeNull();
    });

    // ── String length limits ────────────────────────────────────

    it('should reject smtpFrom exceeding max length', () => {
        const longEmail = 'a'.repeat(310) + '@example.com';
        const err = validateAdminSettingsPayload({ smtpFrom: longEmail });
        expect(err).toContain('longitud');
    });

    it('should reject footerText exceeding 500 chars', () => {
        const err = validateAdminSettingsPayload({ footerText: 'X'.repeat(501) });
        expect(err).toContain('longitud');
    });

    // ── Cross-field numeric coherence ───────────────────────────

    it('should reject maxTotalSize < maxFileSize', () => {
        const err = validateAdminSettingsPayload({ maxFileSize: '500', maxTotalSize: '100' });
        expect(err).toContain('maxTotalSize no puede ser menor que maxFileSize');
    });

    it('should reject largeFileChunkSize < mediumFileChunkSize', () => {
        const err = validateAdminSettingsPayload({ mediumFileChunkSize: '50', largeFileChunkSize: '10' });
        expect(err).toContain('largeFileChunkSize no puede ser menor que mediumFileChunkSize');
    });

    // ── Unknown keys ────────────────────────────────────────────

    it('should reject unknown settings keys', () => {
        const err = validateAdminSettingsPayload({ dangerousKey: 'value' });
        expect(err).toContain('no permitidas');
    });

    // ── Invalid payload types ───────────────────────────────────

    it('should reject null payload', () => {
        expect(validateAdminSettingsPayload(null)).toContain('invalido');
    });

    it('should reject array payload', () => {
        expect(validateAdminSettingsPayload([1, 2])).toContain('invalido');
    });

    // ── Boolean settings ────────────────────────────────────────

    it('should reject non-boolean smtpSecure', () => {
        const err = validateAdminSettingsPayload({ smtpSecure: 'maybe' });
        expect(err).toContain('true o false');
    });

    it('should accept boolean-like smtpSecure', () => {
        expect(validateAdminSettingsPayload({ smtpSecure: 'true' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpSecure: 'false' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpSecure: true })).toBeNull();
    });

    // ── emailTemplates ──────────────────────────────────────────

    it('should reject invalid JSON for emailTemplates', () => {
        const err = validateAdminSettingsPayload({ emailTemplates: '{broken' });
        expect(err).toContain('JSON');
    });

    it('should reject array JSON for emailTemplates', () => {
        const err = validateAdminSettingsPayload({ emailTemplates: '[1,2]' });
        expect(err).toContain('objeto JSON');
    });

    // ── Empty/blank values should pass (clearing a setting) ─────

    it('should accept blank strings for integer fields (clearing the value)', () => {
        expect(validateAdminSettingsPayload({ maxFileSize: '' })).toBeNull();
        expect(validateAdminSettingsPayload({ smtpPort: '' })).toBeNull();
    });

    it('should accept blank strings for string fields', () => {
        expect(validateAdminSettingsPayload({ smtpHost: '' })).toBeNull();
        expect(validateAdminSettingsPayload({ footerText: '' })).toBeNull();
    });
});
