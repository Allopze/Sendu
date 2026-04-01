import { describe, expect, it } from 'vitest';

import {
    getSmtpEnvironmentConfig,
    mergeSmtpConfig,
    mergeSmtpIntoSettings,
} from '../lib/smtpConfig.js';

describe('smtpConfig helpers', () => {
    it('builds SMTP defaults from environment variables', () => {
        const config = getSmtpEnvironmentConfig({
            SMTP_HOST: 'smtp.example.com',
            SMTP_USER: 'mailer@example.com',
            SMTP_PASS: 'env-secret',
            SMTP_FROM: 'ops@example.com',
        });

        expect(config).toEqual({
            smtpHost: 'smtp.example.com',
            smtpPort: '587',
            smtpSecure: 'false',
            smtpUser: 'mailer@example.com',
            smtpPass: 'env-secret',
            smtpFrom: 'ops@example.com',
        });
    });

    it('uses stored settings as overrides without dropping env secrets', () => {
        const merged = mergeSmtpConfig(
            {
                smtpHost: 'smtp.example.com',
                smtpPort: '587',
                smtpSecure: 'false',
                smtpUser: 'mailer@example.com',
                smtpPass: 'env-secret',
                smtpFrom: 'ops@example.com',
            },
            {
                smtpHost: 'smtp.internal',
                smtpPort: '465',
                smtpSecure: 'true',
                smtpUser: 'db-user@example.com',
                smtpPass: '',
            }
        );

        expect(merged.smtpHost).toBe('smtp.internal');
        expect(merged.smtpPort).toBe('465');
        expect(merged.smtpSecure).toBe('true');
        expect(merged.smtpUser).toBe('db-user@example.com');
        expect(merged.smtpPass).toBe('env-secret');
        expect(merged.smtpFrom).toBe('ops@example.com');
    });

    it('merges environment SMTP values into admin settings payloads', () => {
        const merged = mergeSmtpIntoSettings(
            {
                smtpHost: '',
                smtpPort: '587',
                smtpSecure: 'false',
                smtpUser: '',
                smtpPass: '',
                smtpPassConfigured: false,
                smtpFrom: '',
            },
            {
                smtpHost: 'smtp.example.com',
                smtpPort: '587',
                smtpSecure: 'false',
                smtpUser: 'mailer@example.com',
                smtpPass: 'env-secret',
                smtpFrom: 'ops@example.com',
            }
        );

        expect(merged.smtpHost).toBe('smtp.example.com');
        expect(merged.smtpUser).toBe('mailer@example.com');
        expect(merged.smtpFrom).toBe('ops@example.com');
        expect(merged.smtpPassConfigured).toBe(true);
        expect(merged.smtpConfigSource).toBe('environment');
    });
});