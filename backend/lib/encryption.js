import crypto from 'crypto';

// Encryption key derived from SESSION_SECRET (must be 32 bytes for AES-256)
const getEncryptionKey = () => {
    const secret = process.env.SESSION_SECRET || 'dev-secret';
    return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt a string value
 * @param {string} text - The text to encrypt
 * @returns {string} The encrypted text (iv:encrypted format)
 */
export const encrypt = (text) => {
    if (!text) return text;
    
    const iv = crypto.randomBytes(16);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
};

/**
 * Decrypt a string value
 * @param {string} encryptedText - The encrypted text (iv:encrypted format)
 * @returns {string} The decrypted text
 */
export const decrypt = (encryptedText) => {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
    
    try {
        const [ivHex, encrypted] = encryptedText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (err) {
        // If decryption fails, return original (might be unencrypted legacy data)
        return encryptedText;
    }
};

/**
 * Check if a value is encrypted (has iv:encrypted format)
 * @param {string} text - The text to check
 * @returns {boolean} Whether the text appears to be encrypted
 */
export const isEncrypted = (text) => {
    if (!text || typeof text !== 'string') return false;
    const parts = text.split(':');
    return parts.length === 2 && parts[0].length === 32; // IV is 16 bytes = 32 hex chars
};

export default { encrypt, decrypt, isEncrypted };
