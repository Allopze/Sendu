import crypto from 'crypto';

/**
 * Hash a token using SHA-256
 * This is used for storing verification and reset tokens securely
 * @param {string} token - The plain token to hash
 * @returns {string} The hashed token (hex)
 */
export const hashToken = (token) => {
    if (!token) return null;
    return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Generate a secure random token
 * @returns {{ token: string, hash: string }} The plain token and its hash
 */
export const generateSecureToken = () => {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = hashToken(token);
    return { token, hash };
};

export default { hashToken, generateSecureToken };
