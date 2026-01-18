import crypto from 'crypto';
import { 
    generateCsrfToken as generateTokenPersistent, 
    validateCsrfToken as validateTokenPersistent 
} from './persistentStores.js';

/**
 * CSRF Token Store - Persistent using SQLite
 * 
 * Benefits over in-memory Map:
 * - Tokens persist across server restarts
 * - Works with multiple replicas (shared database)
 * - Automatic expiration cleanup
 */

// Fallback in-memory store (used before persistent stores are initialized)
const fallbackStore = new Map();
let usePersistentStore = false;

// Clean expired tokens from fallback store every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of fallbackStore.entries()) {
        if (now > data.expires) {
            fallbackStore.delete(key);
        }
    }
}, 15 * 60 * 1000);

/**
 * Enable persistent storage (call after database is initialized)
 */
export const enablePersistentStorage = () => {
    usePersistentStore = true;
};

/**
 * Generate a CSRF token for a session
 * @param {string} sessionId - The session ID
 * @returns {string} The CSRF token
 */
export const generateToken = (sessionId) => {
    if (usePersistentStore) {
        return generateTokenPersistent(sessionId);
    }
    
    // Fallback to in-memory
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + (60 * 60 * 1000); // 1 hour expiry
    
    fallbackStore.set(`${sessionId}:${token}`, {
        sessionId,
        expires
    });
    
    return token;
};

/**
 * Validate a CSRF token
 * @param {string} sessionId - The session ID
 * @param {string} token - The token to validate
 * @returns {boolean} Whether the token is valid
 */
export const validateToken = (sessionId, token) => {
    if (usePersistentStore) {
        return validateTokenPersistent(sessionId, token);
    }
    
    // Fallback to in-memory
    const key = `${sessionId}:${token}`;
    const data = fallbackStore.get(key);
    
    if (!data) return false;
    if (Date.now() > data.expires) {
        fallbackStore.delete(key);
        return false;
    }
    if (data.sessionId !== sessionId) return false;
    
    // Token is single-use - delete after validation
    fallbackStore.delete(key);
    return true;
};

/**
 * CSRF Protection Middleware
 * Generates token on GET requests, validates on state-changing requests
 */
export const csrfProtection = (options = {}) => {
    const {
        ignoreMethods = ['GET', 'HEAD', 'OPTIONS'],
        ignorePaths = [],
        cookieName = 'csrf-token',
        headerName = 'x-csrf-token'
    } = options;
    
    return (req, res, next) => {
        const requestPath = req.path || req.originalUrl || '';
        const isIgnoredPath = ignorePaths.some(path => 
            requestPath.startsWith(path) || requestPath.startsWith(`/api${path}`)
        );

        // Skip if path is in ignore list
        if (isIgnoredPath) {
            return next();
        }
        
        // Generate session ID if not exists
        if (!req.session) {
            return next(new Error('Session middleware required for CSRF protection'));
        }
        
        const sessionId = req.session.id || req.sessionID;
        
        // Cookie options - must match session cookie settings for consistency
        const isProduction = process.env.NODE_ENV === 'production';
        const cookieSameSite = process.env.SESSION_COOKIE_SAMESITE || (isProduction ? 'lax' : 'lax');
        const cookieSecure = process.env.SESSION_COOKIE_SECURE
            ? process.env.SESSION_COOKIE_SECURE === 'true'
            : isProduction;
        
        const csrfCookieOptions = {
            httpOnly: false, // Must be accessible by JS
            secure: cookieSecure,
            sameSite: cookieSameSite, // Match session cookie SameSite
            maxAge: 60 * 60 * 1000 // 1 hour
        };
        
        // For safe methods, just attach a new token to the response
        if (ignoreMethods.includes(req.method)) {
            // Mark session as used so the session cookie is persisted along with the CSRF token
            req.session.csrfIssuedAt = req.session.csrfIssuedAt || Date.now();
            
            const token = generateToken(sessionId);
            res.cookie(cookieName, token, csrfCookieOptions);
            req.csrfToken = () => token;
            return next();
        }
        
        // For state-changing methods, validate the token
        const token = req.headers[headerName] || req.body?._csrf || req.query?._csrf;
        
        if (!token) {
            return res.status(403).json({ error: 'Token CSRF requerido' });
        }
        
        if (!validateToken(sessionId, token)) {
            return res.status(403).json({ error: 'Token CSRF inválido o expirado' });
        }
        
        // Generate new token for next request
        const newToken = generateToken(sessionId);
        res.cookie(cookieName, newToken, csrfCookieOptions);
        req.csrfToken = () => newToken;
        
        next();
    };
};

export default csrfProtection;
