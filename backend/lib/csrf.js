import crypto from 'crypto';

// In-memory store for CSRF tokens (in production, use Redis or similar)
const tokenStore = new Map();

// Clean expired tokens every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of tokenStore.entries()) {
        if (now > data.expires) {
            tokenStore.delete(key);
        }
    }
}, 15 * 60 * 1000);

/**
 * Generate a CSRF token for a session
 * @param {string} sessionId - The session ID
 * @returns {string} The CSRF token
 */
export const generateToken = (sessionId) => {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + (60 * 60 * 1000); // 1 hour expiry
    
    tokenStore.set(`${sessionId}:${token}`, {
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
    const key = `${sessionId}:${token}`;
    const data = tokenStore.get(key);
    
    if (!data) return false;
    if (Date.now() > data.expires) {
        tokenStore.delete(key);
        return false;
    }
    if (data.sessionId !== sessionId) return false;
    
    // Token is single-use - delete after validation
    tokenStore.delete(key);
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
        
        // For safe methods, just attach a new token to the response
        if (ignoreMethods.includes(req.method)) {
            // Mark session as used so the session cookie is persisted along with the CSRF token
            req.session.csrfIssuedAt = req.session.csrfIssuedAt || Date.now();
            
            const token = generateToken(sessionId);
            res.cookie(cookieName, token, {
                httpOnly: false, // Must be accessible by JS
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 60 * 60 * 1000 // 1 hour
            });
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
        res.cookie(cookieName, newToken, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 1000
        });
        req.csrfToken = () => newToken;
        
        next();
    };
};

export default csrfProtection;
