import { describe, it, expect } from 'vitest';

import {
    serializeAdminSettings,
    stringifySettingValue,
    validateAdminSettingsPayload,
} from '../lib/adminSettings.js';

describe('adminSettings helpers', () => {
    it('redacts sensitive settings when serializing admin settings', () => {
        const serialized = serializeAdminSettings([
            { key: 'smtpHost', value: 'smtp.example.com' },
            { key: 'smtpPass', value: 'super-secret' },
        ]);

        expect(serialized.smtpHost).toBe('smtp.example.com');
        expect(serialized.smtpPass).toBe('');
        expect(serialized.smtpPassConfigured).toBe(true);
    });

    it('serializes object email templates as JSON', () => {
        const value = stringifySettingValue('emailTemplates', { welcome: { subject: 'Hola' } });
        expect(JSON.parse(value)).toEqual({ welcome: { subject: 'Hola' } });
    });

    it('rejects invalid settings payloads with detailed validation errors', () => {
        const validationError = validateAdminSettingsPayload({
            smtpPort: '99999',
            mediumFileThreshold: '5',
            smallFileThreshold: '10',
            smtpFrom: 'not-an-email',
        });

        expect(validationError).toContain('smtpPort debe ser un entero entre 1 y 65535');
        expect(validationError).toContain('mediumFileThreshold no puede ser menor que smallFileThreshold');
        expect(validationError).toContain('smtpFrom debe ser un email valido');
    });

    it('accepts valid payloads', () => {
        const validationError = validateAdminSettingsPayload({
            smtpPort: '587',
            smtpSecure: 'false',
            smtpFrom: 'ops@example.com',
            maxFileSize: '100',
            maxTotalSize: '500',
            guestUploadLimit: '5120',
            guestMaxFileSize: '100',
            smallFileThreshold: '100',
            mediumFileThreshold: '1024',
            smallFileChunkSize: '10',
            mediumFileChunkSize: '50',
            largeFileChunkSize: '100',
            emailTemplates: JSON.stringify({ welcome: { subject: 'Hola' } }),
        });

        expect(validationError).toBeNull();
    });
});