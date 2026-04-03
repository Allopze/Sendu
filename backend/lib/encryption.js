import crypto from 'crypto';

// Encryption key derived from ENCRYPTION_KEY (preferred) or SESSION_SECRET fallback (must be 32 bytes for AES-256)
const getEncryptionKey = () => {
    const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-secret';
    return crypto.createHash('sha256').update(secret).digest();
};

const GCM_PREFIX = 'enc:gcm';
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const LEGACY_CBC_IV_HEX_LENGTH = 32;

export const getEncryptionFormat = (text) => {
    if (!text || typeof text !== 'string') return null;

    if (text.startsWith(`${GCM_PREFIX}:`)) {
        return 'aes-256-gcm';
    }

    const parts = text.split(':');
    if (
        parts.length === 2
        && parts[0].length === LEGACY_CBC_IV_HEX_LENGTH
        && /^[a-f0-9]+$/i.test(parts[0])
        && /^[a-f0-9]+$/i.test(parts[1] || '')
    ) {
        return 'aes-256-cbc-legacy';
    }

    return null;
};

/**
 * Encrypt a string value
 * @param {string} text - The text to encrypt
 * @returns {string} The encrypted text (enc:gcm:iv:tag:encrypted format)
 */
export const encrypt = (text) => {
    if (!text) return text;

    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return `${GCM_PREFIX}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Decrypt a string value
 * @param {string} encryptedText - The encrypted text
 * @returns {string} The decrypted text
 */
export const decrypt = (encryptedText) => {
    if (!encryptedText) return encryptedText;

    const format = getEncryptionFormat(encryptedText);
    if (!format) return encryptedText;

    const key = getEncryptionKey();

    try {
        if (format === 'aes-256-gcm') {
            const parts = encryptedText.split(':');
            if (parts.length !== 5) {
                throw new Error('Malformed AES-GCM payload');
            }

            const [, , ivHex, authTagHex, encryptedHex] = parts;
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            if (iv.length !== GCM_IV_BYTES) {
                throw new Error('Invalid AES-GCM IV length');
            }
            if (authTag.length !== GCM_AUTH_TAG_BYTES) {
                throw new Error('Invalid AES-GCM auth tag length');
            }

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);

            return Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]).toString('utf8');
        }

        const [ivHex, encryptedHex] = encryptedText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        throw new Error(`Failed to decrypt sensitive value: ${err.message}`);
    }
};

/**
 * Check if a value is encrypted
 * @param {string} text - The text to check
 * @returns {boolean} Whether the text appears to be encrypted
 */
export const isEncrypted = (text) => {
    return Boolean(getEncryptionFormat(text));
};

export default { encrypt, decrypt, isEncrypted, getEncryptionFormat };
