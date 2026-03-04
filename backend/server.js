import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsPromises from 'fs/promises';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import multer from 'multer';
import sharp from 'sharp';
import checkDiskSpace from 'check-disk-space';
import { fileTypeFromFile } from 'file-type';
import { DEFAULT_EMAIL_TEMPLATES } from './templates/email/index.js';
import logger, { httpLogger } from './lib/logger.js';
import { csrfProtection, enablePersistentStorage as enableCsrfPersistence } from './lib/csrf.js';
import { encrypt, decrypt, isEncrypted } from './lib/encryption.js';
import { hashToken, generateSecureToken } from './lib/tokenHash.js';
import { generateFingerprint, getIpFingerprint, canGuestUpload, recordGuestUpload, enablePersistentStorage as enableGuestPersistence } from './lib/guestTracking.js';
import { initPersistentStores, createSqliteSessionStore, createDownloadToken, validateDownloadToken, createRateLimitStore, resetRateLimits } from './lib/persistentStores.js';
import { globalErrorHandler, notFoundHandler, asyncHandler, setupProcessErrorHandlers } from './lib/errorHandler.js';
import { runWithLock, getCleanupIntervalWithJitter } from './lib/cleanupCoordinator.js';
import { initDatabase, saveDatabase, closeDatabase } from './lib/database.js';
import { invalidateUploadCache } from './lib/uploadCache.js';
import { createChunkRouter } from './chunkRouter.js';
import { initJobQueue, enqueueEmail, enqueueCleanup, enqueueBrandingConversion, getQueueStats, stopJobProcessor, JOB_TYPES } from './lib/jobQueue.js';
import { initJobHandlers } from './lib/jobHandlers.js';
import { metrics } from './lib/metrics.js';
import { runMigrations } from './lib/migrations.js';
import { antivirus } from './lib/antivirus.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production');
}

// Get PUBLIC_ORIGIN with validation - REQUIRED in production
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN is required in production (e.g., https://yourdomain.com)');
}
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'http://localhost:5174';
const ALLOW_PUBLIC_REGISTRATION = process.env.ALLOW_PUBLIC_REGISTRATION === 'true';
const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN || null;
// Support multiple origins (comma-separated in env var)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [PUBLIC_ORIGIN];
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Timing-safe string comparison (prevents timing attacks on tokens)
const safeCompare = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Compare against self to maintain constant time regardless of length
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
};

// Database Setup - Use data directory for persistence
// MiniPaaS provides APP_DATA_PATH for persistent storage
const dataDir = process.env.APP_DATA_PATH || process.env.DATA_PATH || path.join(rootDir, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'db.sqlite');

// Initialize database (will be set after async init)
let db = null;

// Session Store - Will be initialized after database is ready
let SqliteSessionStore = null;

// Trust proxy (required for secure cookies and real IPs behind reverse proxy)
// Parse TRUST_PROXY to handle various formats: "1", "true", "loopback", etc.
const parseTrustProxy = (value) => {
    if (!value) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    // If it's a number string like "1", "2", parse as integer
    const num = parseInt(value, 10);
    if (!isNaN(num) && String(num) === value) return num;
    // Otherwise return as-is (for values like "loopback", "linklocal", IP ranges)
    return value;
};

const trustProxySetting = parseTrustProxy(process.env.TRUST_PROXY ?? (isProduction ? '1' : ''));
if (trustProxySetting) {
    app.set('trust proxy', trustProxySetting);
}

// ==============================================================
// OPTIMIZED CHUNK UPLOAD ROUTER (mounted early, before heavy middleware)
// This router handles /api/upload/chunk with minimal middleware for performance:
// - No helmet, compression, session, csrf, or httpLogger
// - Only CORS (for dev), multer, and validation
// ==============================================================

// Directories for uploads (defined early for chunk router)
const UPLOAD_DIR = process.env.APP_UPLOADS_PATH || process.env.STORAGE_PATH || path.join(rootDir, 'uploads');
const CHUNKS_DIR = path.join(UPLOAD_DIR, 'chunks');
const TEMP_DIR = process.env.APP_TEMP_PATH || path.join(rootDir, 'tmp');
const MAX_CHUNK_UPLOAD_BYTES = 200 * 1024 * 1024; // Hard limit to match multer and proxy limits
const MAX_UPLOAD_SESSION_AGE_MS = parseInt(process.env.UPLOAD_SESSION_MAX_AGE_HOURS || '24', 10) * 60 * 60 * 1000;

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Helper: Get max chunk size from settings (for validation)
// Needs to be defined before chunk router
let maxChunkSizeCache = { value: 200 * 1024 * 1024, ts: 0 };
const MAX_CHUNK_SIZE_TTL = 60 * 1000; // 1 minuto
const getMaxChunkSizeFromSettingsSync = () => {
    const now = Date.now();
    if (now - maxChunkSizeCache.ts < MAX_CHUNK_SIZE_TTL) {
        return maxChunkSizeCache.value;
    }
    if (!db) return maxChunkSizeCache.value;
    try {
        const largeChunkSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('largeFileChunkSize');
        const largeChunk = largeChunkSetting ? parseInt(largeChunkSetting.value) : 100;
        const computed = Math.max(largeChunk * 1.2, 200) * 1024 * 1024;
        const value = Math.min(computed, MAX_CHUNK_UPLOAD_BYTES);
        maxChunkSizeCache = { value, ts: now };
        return value;
    } catch {
        return maxChunkSizeCache.value;
    }
};

// Centralized settings cache with prepared statement
// Reduces repeated db.prepare() calls throughout the codebase
const settingsCache = new Map();
const SETTINGS_CACHE_TTL = 30000; // 30 seconds
let getSettingStmt = null;

const getSetting = (key, defaultValue = null) => {
    const now = Date.now();
    const cached = settingsCache.get(key);

    if (cached && (now - cached.ts) < SETTINGS_CACHE_TTL) {
        return cached.value;
    }

    if (!db) return defaultValue;

    try {
        // Lazy init prepared statement (db may not exist at module load time)
        if (!getSettingStmt) {
            getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
        }
        const row = getSettingStmt.get(key);
        const value = row ? row.value : defaultValue;
        settingsCache.set(key, { value, ts: now });
        return value;
    } catch {
        return defaultValue;
    }
};

// Invalidate cache when settings are updated
const invalidateSettingsCache = (keys = null) => {
    if (keys) {
        keys.forEach(k => settingsCache.delete(k));
    } else {
        settingsCache.clear();
    }
    // Also invalidate related caches
    maxChunkSizeCache.ts = 0;
    uploadLimitsCache.ts = 0;
};

// Helper: Get upload limits from settings (used by chunk router)
// Needs to be defined before chunk router
// Cache with 30s TTL to reduce DB queries during uploads
let uploadLimitsCache = { value: null, ts: 0 };
const UPLOAD_LIMITS_CACHE_TTL = 30000; // 30 seconds

const getUploadLimits = () => {
    const now = Date.now();

    // Return cached value if still valid
    if (uploadLimitsCache.value && (now - uploadLimitsCache.ts) < UPLOAD_LIMITS_CACHE_TTL) {
        return uploadLimitsCache.value;
    }

    const limits = {
        maxFileSize: 100,        // Default 100MB for registered users
        maxTotalSize: 500,       // Default 500MB total for registered users
        guestUploadLimit: 5120,  // Default 5GB (5120MB) total for non-logged users
        guestMaxFileSize: 50     // Default 50MB max file size for guests
    };

    if (!db) return limits;
    try {
        const keys = ['maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize'];
        const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`);
        const settings = stmt.all(...keys);
        settings.forEach(s => limits[s.key] = parseInt(s.value) || limits[s.key]);

        // Cache the result
        uploadLimitsCache = { value: limits, ts: now };
    } catch {
        return limits;
    }

    return limits;
};

// Minimal CORS for chunk uploads in development
const chunkCorsOptions = {
    origin: isProduction
        ? ALLOWED_ORIGINS
        : [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:2000',
            'http://localhost:2001',
            'http://localhost:2002',
            'http://localhost:3000'
        ],
    credentials: true
};

const noopLimiter = (req, res, next) => next();

// Rate limit for chunks (permissive)
let chunkRateLimitCache = { value: 1000, ts: 0 };
const CHUNK_RATE_LIMIT_TTL = 60 * 1000;
const chunkRateLimiter = isTest ? noopLimiter : rateLimit({
    windowMs: 60 * 1000, // 1 minute
    store: createRateLimitStore(60 * 1000, { keyPrefix: 'chunk' }),
    keyGenerator: (req) => ipKeyGenerator(req),
    max: () => {
        const now = Date.now();
        if (now - chunkRateLimitCache.ts < CHUNK_RATE_LIMIT_TTL) {
            return chunkRateLimitCache.value;
        }
        if (!db) return chunkRateLimitCache.value;
        try {
            const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('chunkRateLimit');
            const value = setting ? parseInt(setting.value) || 1000 : 1000;
            chunkRateLimitCache = { value, ts: now };
            return value;
        } catch {
            return chunkRateLimitCache.value;
        }
    },
    message: { error: 'Demasiadas solicitudes de subida. Espera un momento e intenta de nuevo.' }
});

// Mount optimized chunk router BEFORE heavy middleware
const chunkRouter = createChunkRouter({
    CHUNKS_DIR,
    TEMP_DIR,
    getMaxChunkSize: getMaxChunkSizeFromSettingsSync,
    getUploadLimits,
    db: () => db, // Getter function since db is initialized later
    isProduction,
    maxUploadAgeMs: MAX_UPLOAD_SESSION_AGE_MS
});

// Apply minimal middleware only to chunk route
app.use('/api/upload/chunk',
    cors(chunkCorsOptions),
    chunkRateLimiter,
    chunkRouter
);

// ==============================================================
// STANDARD MIDDLEWARE (for all other routes)
// ==============================================================

// Middleware - Security headers with HSTS and CSP
// Note: 'unsafe-inline' for scripts/styles is needed for React inline styles.
// Consider using nonces or hashes for stricter CSP in high-security environments.
const strictCspEnabled = process.env.CSP_STRICT === 'true';

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: strictCspEnabled
                ? ["'self'", "https://static.cloudflareinsights.com"]
                : ["'self'", "'unsafe-inline'", "https://static.cloudflareinsights.com"],
            styleSrc: strictCspEnabled
                ? ["'self'", "https://fonts.googleapis.com"]
                : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrcElem: strictCspEnabled
                ? ["'self'", "https://fonts.googleapis.com"]
                : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            // Allow connections to self, allowed origins, and Cloudflare
            connectSrc: ["'self'", ...ALLOWED_ORIGINS, "https://cloudflareinsights.com"],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: isProduction ? [] : null
        }
    },
    hsts: isProduction ? {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    } : false,
    crossOriginEmbedderPolicy: false, // Disable for file downloads
    crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin for branding assets
}));
app.use(compression()); // Gzip compression for responses
app.use(cookieParser()); // Required for CSRF
app.use(cors({
    origin: isProduction
        ? ALLOWED_ORIGINS
        : [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:2000',
            'http://localhost:2001',
            'http://localhost:2002',
            'http://localhost:3000'
        ],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Request Logging
app.use(httpLogger);

// Session Middleware - Uses SQLite store for persistence across restarts and replicas
// Store is initialized in startServer() after database is ready
let sessionMiddleware = null;
const sessionCookieDomain = isProduction ? process.env.SESSION_COOKIE_DOMAIN : null;
const sessionCookieSameSite = process.env.SESSION_COOKIE_SAMESITE || (isProduction ? 'lax' : 'lax');
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : isProduction;
const setupSessionMiddleware = () => {
    SqliteSessionStore = createSqliteSessionStore(session);
    sessionMiddleware = session({
        store: new SqliteSessionStore(),
        secret: process.env.SESSION_SECRET || 'dev-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: sessionCookieSecure, // HTTPS only in production by default
            httpOnly: true,
            sameSite: sessionCookieSameSite, // Default lax; can override with SESSION_COOKIE_SAMESITE
            ...(sessionCookieDomain ? { domain: sessionCookieDomain } : {}),
            maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
        },
        name: process.env.SESSION_COOKIE_NAME || 'sendu.sid' // Custom session cookie name
    });
};

// Wrapper that applies session after it's initialized
app.use((req, res, next) => {
    if (sessionMiddleware) {
        return sessionMiddleware(req, res, next);
    }
    // Before initialization, create a mock session
    req.session = {};
    next();
});

// CSRF Protection for state-changing routes (applied after session)
// Note: paths are relative to /api/ mount point (req.path doesn't include /api/)
const csrfMiddleware = csrfProtection({
    ignorePaths: [
        '/auth/login',      // Login creates session, protected by rate limiting
        '/auth/register',   // Registration creates session, protected by rate limiting
        '/auth/logout',     // Logout destroys session, no CSRF needed
        '/auth/forgot-password', // Uses email token, protected by rate limiting
        '/auth/reset-password',  // Uses email token for validation
        '/auth/verify',     // Uses email token for validation
        '/upload/init',     // Upload init protected by session + rate limiting
        '/upload/chunk',    // File uploads use uploadId as token
        '/upload/complete', // Uses uploadId for validation
        '/upload/cancel',   // Uses uploadId for validation
        '/download/',       // Downloads don't need CSRF
        '/settings/public', // Public endpoints
        '/settings/limits',
        '/meta/'
    ]
});

// Apply CSRF to all routes except ignored ones
app.use('/api/', (req, res, next) => {
    // Skip CSRF for GET, HEAD, OPTIONS requests but still set token cookie
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Set CSRF token on GET requests so it's available for subsequent POST requests
        csrfMiddleware(req, res, next);
        return;
    }
    // Apply CSRF protection for state-changing methods
    csrfMiddleware(req, res, next);
});

// Health check endpoint (no auth, no rate limit - for load balancers)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime()
    });
});

// Rate Limiting - General API (skip chunk uploads and public endpoints)
// NOTE: Uses in-memory store by default. For multi-replica deployments with strict
// rate limiting, consider using Redis or the SQLite store from persistentStores.js
// The current implementation is sufficient for single-instance deployments and
// provides reasonable protection even in multi-replica (each instance has its own limit).
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    store: createRateLimitStore(15 * 60 * 1000, { keyPrefix: 'api' }),
    keyGenerator: (req) => ipKeyGenerator(req),
    max: 300, // limit each IP to 300 requests per windowMs (increased for SPA)
    skip: (req) => {
        // Exclude admins from rate limiting
        if (req.session?.role === 'admin') return true;
        // Exclude chunk uploads and frequently called public endpoints
        return req.path.startsWith('/upload/chunk') ||
            req.path === '/settings/public' ||
            req.path === '/settings/limits' ||
            req.path === '/auth/me';
    },
    message: { error: 'Demasiadas solicitudes. Espera un momento.' }
});
app.use('/api/', isTest ? noopLimiter : limiter);

// NOTE: Chunk rate limiting is handled in the optimized chunkRouter mounted earlier

// Rate Limiting - Strict for auth endpoints (brute force protection)
// Note: This applies BEFORE login, so we can't skip by session role here
const authLimiter = isTest ? noopLimiter : rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    store: createRateLimitStore(15 * 60 * 1000, { keyPrefix: 'auth' }),
    keyGenerator: (req) => ipKeyGenerator(req),
    max: 10, // limit each IP to 10 login attempts per windowMs (increased slightly)
    message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Rate Limiting - For password reset (prevent email bombing)
const passwordResetLimiter = isTest ? noopLimiter : rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    store: createRateLimitStore(60 * 60 * 1000, { keyPrefix: 'pwdreset' }),
    keyGenerator: (req) => ipKeyGenerator(req),
    max: 5, // limit each IP to 5 password reset requests per hour
    message: { error: 'Demasiadas solicitudes de recuperación. Intenta de nuevo en 1 hora.' }
});

// Rate Limiting - Strict for download password validation (per file + IP)
const downloadValidateLimiter = isTest ? noopLimiter : rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    store: createRateLimitStore(15 * 60 * 1000, { keyPrefix: 'dl-validate' }),
    keyGenerator: (req) => {
        const ip = ipKeyGenerator(req);
        const fileId = req.params?.id || 'unknown';
        return `${fileId}:${ip}`;
    },
    max: 5, // limit each IP to 5 password attempts per file per window
    message: { error: 'Demasiados intentos de contraseña. Intenta de nuevo en 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Static Files (Production)
if (process.env.NODE_ENV === 'production') {
    const staticPath = path.join(rootDir, 'frontend/dist');
    const publicPath = path.join(rootDir, 'public'); // For prebuilt releases

    const staticOptions = {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
            } else if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            } else if (filePath.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
            }
        }
    };

    // Try frontend/dist first, then public (for prebuilt releases)
    if (fs.existsSync(staticPath)) {
        app.use(express.static(staticPath, staticOptions));
    } else if (fs.existsSync(publicPath)) {
        app.use(express.static(publicPath, staticOptions));
    }
}

// Branding static files (logos, favicon) with cache headers
const BRANDING_DIR = path.join(rootDir, 'branding');
if (!fs.existsSync(BRANDING_DIR)) fs.mkdirSync(BRANDING_DIR, { recursive: true });
app.use('/branding', express.static(BRANDING_DIR, {
    maxAge: '1d', // Cache for 1 day
    etag: true,
    lastModified: true
}));

const DEFAULT_BRANDING_FILES = {
    logoLight: 'logoLight.svg',
    logoDark: 'logoDark.svg',
    favicon: 'favicon.png',
    dropzoneIcon: 'dropzoneIcon.svg'
};

const getDefaultBrandingSettings = () => {
    const defaults = {
        logoLight: '',
        logoDark: '',
        favicon: '',
        dropzoneIcon: ''
    };

    for (const [key, fileName] of Object.entries(DEFAULT_BRANDING_FILES)) {
        const filePath = path.join(BRANDING_DIR, fileName);
        if (fs.existsSync(filePath)) {
            defaults[key] = `/branding/${fileName}`;
        }
    }

    return defaults;
};

const ensureDefaultBrandingSettings = () => {
    if (!db) return;
    const defaults = getDefaultBrandingSettings();
    const stmtGet = db.prepare('SELECT value FROM settings WHERE key = ?');
    const stmtInsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    for (const [key, value] of Object.entries(defaults)) {
        if (!value) continue;
        const existing = stmtGet.get(key);
        if (existing?.value) continue;
        stmtInsert.run(key, value);
    }
};

// Helper: Get SMTP config from settings (with decryption for sensitive fields)
const getSmtpConfig = () => {
    const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('smtp%');
    const config = {};
    const sensitiveKeys = ['smtpPass'];
    settings.forEach(s => {
        // Decrypt sensitive values
        if (sensitiveKeys.includes(s.key) && isEncrypted(s.value)) {
            config[s.key] = decrypt(s.value);
        } else {
            config[s.key] = s.value;
        }
    });
    return config;
};

// Helper: Get email templates from settings (with fallback to defaults)
const getEmailTemplates = () => {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get('emailTemplates');
    if (result && result.value) {
        try {
            const savedTemplates = JSON.parse(result.value);
            // Merge with defaults (saved templates take priority)
            return { ...DEFAULT_EMAIL_TEMPLATES, ...savedTemplates };
        } catch (e) {
            return DEFAULT_EMAIL_TEMPLATES;
        }
    }
    return DEFAULT_EMAIL_TEMPLATES;
};

// HTML-escape helper to prevent XSS in email templates
const escapeHtml = (str) => {
    if (!str || typeof str !== 'string') return str || '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// Helper: Replace variables in template
const replaceTemplateVariables = (template, variables) => {
    let result = template;

    // Handle {{#if variable}}...{{else}}...{{/if}} blocks
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
        (match, varName, ifContent, elseContent) => {
            return variables[varName] ? ifContent : elseContent;
        }
    );

    // Handle {{#if variable}}...{{/if}} blocks (without else)
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
        (match, varName, ifContent) => {
            return variables[varName] ? ifContent : '';
        }
    );

    // Variables that should NOT be escaped (contain trusted HTML/URLs)
    const rawVariables = new Set(['verificationLink', 'resetLink', 'downloadLink', 'logoUrl', 'appUrl']);

    // Replace simple variables (HTML-escaped unless in rawVariables set)
    Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        const safeValue = rawVariables.has(key) ? (value || '') : escapeHtml(value);
        result = result.replace(regex, safeValue);
    });
    return result;
};

// Helper: Create nodemailer transporter
const createSmtpTransporter = () => {
    const config = getSmtpConfig();
    if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
        return null;
    }

    const port = parseInt(config.smtpPort) || 587;
    // Puerto 465 usa SSL directo (secure: true)
    // Puerto 587 usa STARTTLS (secure: false, pero TLS se negocia)
    const secure = port === 465;

    return nodemailer.createTransport({
        host: config.smtpHost,
        port: port,
        secure: secure, // true para 465, false para 587/25
        auth: {
            user: config.smtpUser,
            pass: config.smtpPass
        },
        // Para puerto 587, forzar uso de TLS via STARTTLS
        ...(port === 587 && { requireTLS: true })
    });
};

// Helper: Send Email with template support
const sendEmail = async (to, subject, text, html = null) => {
    const config = getSmtpConfig();
    const transporter = createSmtpTransporter();

    if (!transporter) {
        logger.info('Email sent (mock mode)', { to, subject });
        return { success: true, mock: true };
    }

    const mailOptions = {
        from: config.smtpFrom || config.smtpUser,
        to,
        subject,
        text,
        ...(html && { html })
    };

    return transporter.sendMail(mailOptions);
};

// Helper: Send templated email (uses job queue for reliability)
const sendTemplatedEmail = async (to, templateName, variables = {}, options = {}) => {
    const templates = getEmailTemplates();
    const config = getSmtpConfig();
    const smtpConfigured = !!(config.smtpHost && config.smtpUser && config.smtpPass);

    // Helper to ensure absolute URL
    const ensureAbsoluteUrl = (url) => {
        if (!url) return null;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url.split('?')[0]; // Remove cache busting
        }
        // Make relative URL absolute
        return `${PUBLIC_ORIGIN}${url.startsWith('/') ? '' : '/'}${url.split('?')[0]}`;
    };

    // Get logo URL from branding settings - use dark theme for emails (dark header background)
    // Prefer PNG version for emails (better compatibility with email clients)
    const logoDarkEmailSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logoDarkEmail');
    const logoDarkSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logoDark');
    const logoLightEmailSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logoLightEmail');
    const logoLightSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logoLight');

    let logoUrl;
    // Priority: logoDarkEmail > logoDark > logoLightEmail > logoLight > default
    if (logoDarkEmailSetting?.value) {
        logoUrl = ensureAbsoluteUrl(logoDarkEmailSetting.value);
    } else if (logoDarkSetting?.value) {
        logoUrl = ensureAbsoluteUrl(logoDarkSetting.value);
    } else if (logoLightEmailSetting?.value) {
        logoUrl = ensureAbsoluteUrl(logoLightEmailSetting.value);
    } else if (logoLightSetting?.value) {
        logoUrl = ensureAbsoluteUrl(logoLightSetting.value);
    } else {
        // No logo configured, use empty string so alt text shows
        logoUrl = '';
    }

    // Default app variables
    const appVars = {
        appName: 'Sendu',
        appUrl: PUBLIC_ORIGIN,
        logoUrl,
        ...variables
    };

    let subject, html;

    if (!templates || !templates[templateName]) {
        // Fallback to simple text email
        subject = replaceTemplateVariables(variables.subject || 'Notificación', appVars);
        html = `<p>${replaceTemplateVariables(variables.text || '', appVars)}</p>`;
    } else {
        const template = templates[templateName];
        subject = replaceTemplateVariables(template.subject, appVars);
        html = replaceTemplateVariables(template.html, appVars);
    }

    // If SMTP is not configured, skip queueing to avoid noisy job failures
    if (!smtpConfigured) {
        logger.warn('SMTP not configured, skipping email queue', { to, templateName });
        return { queued: false, mock: true };
    }

    // Use job queue for async email sending (more reliable, with retries)
    if (options.sync) {
        // For testing or when immediate feedback is needed
        return sendEmail(to, subject, html.replace(/<[^>]*>/g, ''), html);
    }

    // Queue the email for background processing
    const jobId = enqueueEmail(to, subject, html, {
        from: config.smtpFrom || config.smtpUser,
        priority: options.priority,
    });

    logger.debug('Email queued', { to, templateName, jobId });
    return { queued: true, jobId };
};

// Auth Middleware
const requireAuth = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
    next();
};

// Validation helpers
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidUsername = (username) => {
    // 3-30 characters, alphanumeric and underscores only
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    return usernameRegex.test(username);
};

const isValidPassword = (password) => {
    // Minimum 8 characters, at least one letter and one number
    return password && password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
};

// Auth Routes
app.post('/api/auth/register', authLimiter, asyncHandler(async (req, res) => {
    const { email, username, password, adminBootstrapToken } = req.body;
    if (!email || !username || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

    // Validate email format
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Formato de email inválido' });
    }

    // Validate username format
    if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'El nombre de usuario debe tener 3-30 caracteres alfanuméricos' });
    }

    // Validate password strength
    if (!isValidPassword(password)) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres, incluyendo letras y números' });
    }

    // Registration policy: allow first user bootstrap, then enforce settings
    let bootstrapRequested = false;
    const bootstrapSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('adminBootstrapCompleted');
    const bootstrapCompleted = bootstrapSetting?.value === 'true';
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;

    if (userCount === 0) {
        // First user can register and becomes admin
        bootstrapRequested = true;
    } else if (!ALLOW_PUBLIC_REGISTRATION) {
        if (!ADMIN_BOOTSTRAP_TOKEN) {
            return res.status(403).json({ error: 'Registro público deshabilitado' });
        }
        if (!adminBootstrapToken || !safeCompare(adminBootstrapToken, ADMIN_BOOTSTRAP_TOKEN) || bootstrapCompleted) {
            return res.status(403).json({ error: 'Registro público deshabilitado' });
        }
        bootstrapRequested = true;
    } else if (adminBootstrapToken && ADMIN_BOOTSTRAP_TOKEN && safeCompare(adminBootstrapToken, ADMIN_BOOTSTRAP_TOKEN) && !bootstrapCompleted) {
        bootstrapRequested = true;
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = uuidv4();

        // Generate secure verification token (store hash, send plain token)
        const { token: verificationToken, hash: verificationTokenHash } = generateSecureToken();
        const verificationTokenExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

        const role = bootstrapRequested ? 'admin' : 'user';

        const stmt = db.prepare('INSERT INTO users (id, email, username, passwordHash, role, verificationToken, verificationTokenExpires, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run(userId, email, username, hashedPassword, role, verificationTokenHash, verificationTokenExpires, Date.now());

        if (bootstrapRequested) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('adminBootstrapCompleted', 'true');
        }

        // Send verification email using template
        const verificationLink = `${PUBLIC_ORIGIN}/verify?token=${verificationToken}`;
        await sendTemplatedEmail(email, 'welcome', {
            username,
            email,
            verificationLink
        });

        const message = bootstrapRequested
            ? 'Usuario registrado como administrador. Por favor verifica tu email.'
            : 'Usuario registrado. Por favor verifica tu email.';
        res.status(201).json({ message });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'El email o nombre de usuario ya existe' });
        }
        logger.error('Error en registro', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}));

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
    const { login, password } = req.body; // login can be email or username
    if (!login || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

    // Basic input validation
    if (login.length > 255 || password.length > 255) {
        return res.status(400).json({ error: 'Datos de entrada inválidos' });
    }

    try {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?');
        const user = stmt.get(login, login);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Regenerate session to prevent session fixation attacks
        const oldSession = req.session;
        req.session.regenerate((err) => {
            if (err) {
                logger.error('Error regenerating session', { error: err.message });
                return res.status(500).json({ error: 'Error interno del servidor' });
            }

            // Restore any session data that should persist (if any)
            req.session.userId = user.id;

            // Explicitly save session to ensure it's persisted before responding
            req.session.save((saveErr) => {
                if (saveErr) {
                    logger.error('Error saving session after login', { error: saveErr.message });
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }

                logger.info('User logged in successfully', {
                    userId: user.id,
                    sessionId: (req.session.id || req.sessionID)?.substring(0, 8) + '...'
                });

                res.json({ message: 'Sesión iniciada correctamente', user: { id: user.id, username: user.username, email: user.email, role: user.role } });
            });
        });
    } catch (err) {
        logger.error('Error en login', { error: err.message });
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}));

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'No se pudo cerrar sesión' });
        res.clearCookie(process.env.SESSION_COOKIE_NAME || 'sendu.sid', {
            ...(sessionCookieDomain ? { domain: sessionCookieDomain } : {})
        });
        res.json({ message: 'Sesión cerrada' });
    });
});

app.get('/api/auth/me', (req, res) => {
    // Debug logging for session issues
    const sessionId = req.session?.id || req.sessionID;
    const hasSessionCookie = !!(req.cookies?.[process.env.SESSION_COOKIE_NAME || 'sendu.sid']);

    logger.debug('Auth check', {
        hasSessionCookie,
        sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
        userId: req.session?.userId || 'none',
        cookieSecure: sessionCookieSecure,
        cookieSameSite: sessionCookieSameSite
    });

    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });

    const stmt = db.prepare('SELECT id, username, email, role, isVerified FROM users WHERE id = ?');
    const user = stmt.get(req.session.userId);

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
});

// Email verification endpoint
app.get('/api/auth/verify', (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ error: 'Token de verificación requerido' });
    }

    try {
        // Hash the token to compare with stored hash
        const tokenHash = hashToken(token);
        logger.debug('Verification attempt', {
            tokenLength: token.length,
            tokenHashStart: tokenHash.substring(0, 16) + '...'
        });

        const user = db.prepare('SELECT id, email, verificationToken, verificationTokenExpires, isVerified FROM users WHERE verificationToken = ?').get(tokenHash);

        if (!user) {
            // Debug: Check if any user has a similar token stored
            const allUsers = db.prepare('SELECT id, email, verificationToken, isVerified FROM users WHERE verificationToken IS NOT NULL').all();
            logger.debug('No user found with token', {
                searchedHash: tokenHash.substring(0, 16) + '...',
                usersWithTokens: allUsers.length,
                storedHashes: allUsers.map(u => u.verificationToken?.substring(0, 16) + '...')
            });
            return res.status(400).json({ error: 'Token de verificación inválido o expirado' });
        }

        logger.debug('User found for verification', { userId: user.id, email: user.email });

        // Check expiration
        if (user.verificationTokenExpires && Date.now() > user.verificationTokenExpires) {
            return res.status(400).json({ error: 'El token de verificación ha expirado' });
        }

        if (user.isVerified) {
            return res.json({ message: 'El email ya está verificado', alreadyVerified: true });
        }

        // Mark user as verified and clear token
        db.prepare('UPDATE users SET isVerified = 1, verificationToken = NULL, verificationTokenExpires = NULL WHERE id = ?').run(user.id);

        res.json({ message: 'Email verificado correctamente', success: true });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al verificar email' });
    }
});

// Request password reset
app.post('/api/auth/forgot-password', passwordResetLimiter, asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email requerido' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Formato de email inválido' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

        // Always return success to prevent email enumeration
        if (!user) {
            return res.json({ message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
        }

        // Generate secure reset token (store hash, send plain token)
        const { token: resetToken, hash: resetTokenHash } = generateSecureToken();
        const resetTokenExpires = Date.now() + (60 * 60 * 1000); // 1 hour

        db.prepare('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE id = ?').run(resetTokenHash, resetTokenExpires, user.id);

        // Send password reset email
        const resetLink = `${PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
        await sendTemplatedEmail(email, 'passwordReset', {
            username: user.username,
            email: user.email,
            resetLink
        });

        res.json({ message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    }
}));

// Validate reset token
app.get('/api/auth/reset-password/validate', (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ error: 'Token requerido', valid: false });
    }

    try {
        // Hash the token to compare with stored hash
        const tokenHash = hashToken(token);
        const user = db.prepare('SELECT * FROM users WHERE resetToken = ?').get(tokenHash);

        if (!user) {
            return res.status(400).json({ error: 'Token inválido', valid: false });
        }

        if (user.resetTokenExpires && Date.now() > user.resetTokenExpires) {
            return res.status(400).json({ error: 'El token ha expirado', valid: false });
        }

        res.json({ valid: true, username: user.username });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al validar token', valid: false });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ error: 'Token y contraseña requeridos' });
    }

    if (!isValidPassword(password)) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres, incluyendo letras y números' });
    }

    try {
        // Hash the token to compare with stored hash
        const tokenHash = hashToken(token);
        const user = db.prepare('SELECT * FROM users WHERE resetToken = ?').get(tokenHash);

        if (!user) {
            return res.status(400).json({ error: 'Token inválido o expirado' });
        }

        if (user.resetTokenExpires && Date.now() > user.resetTokenExpires) {
            return res.status(400).json({ error: 'El token ha expirado' });
        }

        // Update password and clear reset token
        const hashedPassword = await bcrypt.hash(password, 12);
        db.prepare('UPDATE users SET passwordHash = ?, resetToken = NULL, resetTokenExpires = NULL WHERE id = ?').run(hashedPassword, user.id);

        res.json({ message: 'Contraseña actualizada correctamente', success: true });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al actualizar contraseña' });
    }
}));

// Resend verification email
app.post('/api/auth/resend-verification', requireAuth, asyncHandler(async (req, res) => {

    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (user.isVerified) {
            return res.status(400).json({ error: 'El email ya está verificado' });
        }

        // Generate new verification token (store hash, send plain token)
        const { token: verificationToken, hash: verificationTokenHash } = generateSecureToken();
        const verificationTokenExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

        db.prepare('UPDATE users SET verificationToken = ?, verificationTokenExpires = ? WHERE id = ?').run(verificationTokenHash, verificationTokenExpires, user.id);

        // Send verification email
        const verificationLink = `${PUBLIC_ORIGIN}/verify?token=${verificationToken}`;
        await sendTemplatedEmail(user.email, 'verification', {
            username: user.username,
            email: user.email,
            verificationLink
        });

        res.json({ message: 'Email de verificación reenviado' });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al reenviar email de verificación' });
    }
}));

// Upload Routes
// (UPLOAD_DIR, CHUNKS_DIR, TEMP_DIR defined earlier for chunk router)

// Helper: Get max concurrent uploads from settings
const getMaxConcurrentUploads = () => {
    if (!db) return 6;
    try {
        const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('maxConcurrentUploads');
        const value = setting ? parseInt(setting.value) : 6;
        return Math.max(1, value || 6);
    } catch {
        return 6;
    }
};

// MIME type validation - allowlist for common safe file types
// Extensible via admin settings in future
const ALLOWED_MIME_PREFIXES = [
    'image/',           // All image types
    'video/',           // All video types
    'audio/',           // All audio types
    'text/',            // Text files
    'application/pdf',  // PDFs
    'application/zip',  // Archives
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/x-gtar',
    'application/x-gzip',
    'application/x-compressed',     // .tgz, .tar.gz
    'application/x-bzip',
    'application/x-bzip2',
    'application/x-xz',
    'application/x-lzip',
    'application/x-lzma',
    'application/x-lz4',
    'application/x-zstd',
    'application/gzip',
    'application/json',
    'application/xml',
    'application/javascript',
    // application/octet-stream removed — too permissive (bypasses allowlist)
    'application/vnd.openxmlformats-officedocument', // Office docs
    'application/vnd.ms-',      // MS Office
    'application/msword',
    'application/vnd.oasis.opendocument', // LibreOffice
];

// Blocked extensions (dangerous executables)
const BLOCKED_EXTENSIONS = [
    '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.scr',
    '.ps1', '.psm1', '.psd1', // PowerShell
    '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh', // Windows scripting
    '.hta', '.cpl', '.msc', '.inf', '.reg', // Windows system
    '.sh', '.bash', '.zsh', // Unix scripts
    '.php', '.phtml', '.php3', '.php4', '.php5', '.phps', // PHP
    '.asp', '.aspx', '.cer', '.csr', '.jsp', '.jspx', // Server scripts
];

const validateMimeType = (mimeType, filename) => {
    // Check blocked extensions first
    const ext = path.extname(filename || '').toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
        return { valid: false, reason: `Tipo de archivo no permitido: ${ext}` };
    }

    // Check MIME type against allowlist
    if (!mimeType) {
        return { valid: true }; // Allow if no MIME type (will be treated as octet-stream)
    }

    const normalizedMime = mimeType.toLowerCase();

    // Allow octet-stream only when file extension is not blocked (secondary check)
    if (normalizedMime === 'application/octet-stream') {
        return { valid: true };
    }

    const isAllowed = ALLOWED_MIME_PREFIXES.some(prefix => normalizedMime.startsWith(prefix));

    if (!isAllowed) {
        return { valid: false, reason: `Tipo MIME no permitido: ${mimeType}` };
    }

    return { valid: true };
};

app.post('/api/upload/init', asyncHandler(async (req, res) => {
    const { originalName, size, mimeType, totalChunks, checksum } = req.body;

    // Validate required fields
    if (!originalName || typeof originalName !== 'string') {
        return res.status(400).json({ error: 'Nombre de archivo requerido' });
    }
    if (!size || typeof size !== 'number' || size <= 0) {
        return res.status(400).json({ error: 'Tamaño de archivo inválido' });
    }
    if (!totalChunks || typeof totalChunks !== 'number' || totalChunks <= 0) {
        return res.status(400).json({ error: 'Número de chunks inválido' });
    }

    // Sanitize filename (remove path traversal attempts)
    const sanitizedName = path.basename(originalName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
        return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    // Validate MIME type and extension
    const mimeValidation = validateMimeType(mimeType, sanitizedName);
    if (!mimeValidation.valid) {
        return res.status(400).json({ error: mimeValidation.reason });
    }

    // Validate file size against limits (different for guests vs registered users)
    const limits = getUploadLimits();
    const isLoggedIn = !!req.session.userId;

    // Require verified email for authenticated uploads
    if (isLoggedIn) {
        const userRow = db.prepare('SELECT isVerified, role FROM users WHERE id = ?').get(req.session.userId);
        if (!userRow) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        if (!userRow.isVerified && userRow.role !== 'admin') {
            return res.status(403).json({ error: 'Verifica tu email para subir archivos' });
        }
    }
    let guestFingerprint = null;
    let ipFingerprint = null;
    const effectiveMaxFileSize = isLoggedIn ? limits.maxFileSize : limits.guestMaxFileSize;
    const maxFileSizeBytes = effectiveMaxFileSize * 1024 * 1024;

    if (size > maxFileSizeBytes) {
        const message = isLoggedIn
            ? `El archivo excede el límite de ${effectiveMaxFileSize}MB`
            : `El archivo excede el límite de ${effectiveMaxFileSize}MB para invitados. Inicia sesión para subir archivos más grandes.`;
        return res.status(400).json({ error: message });
    }

    // Check total storage quota for authenticated users
    if (req.session.userId) {
        const maxTotalSizeBytes = limits.maxTotalSize * 1024 * 1024;
        const userTotalStmt = db.prepare('SELECT COALESCE(SUM(size), 0) as totalSize FROM files WHERE userId = ?');
        const { totalSize } = userTotalStmt.get(req.session.userId);

        if (totalSize + size > maxTotalSizeBytes) {
            const usedMB = Math.round(totalSize / (1024 * 1024));
            return res.status(400).json({
                error: `Has alcanzado tu límite de almacenamiento (${usedMB}MB de ${limits.maxTotalSize}MB usados). Elimina algunos archivos para subir más.`,
                quotaExceeded: true,
                used: totalSize,
                limit: maxTotalSizeBytes
            });
        }
    }

    // Check guest upload limit for non-logged users
    if (!req.session.userId) {
        guestFingerprint = generateFingerprint(req);
        ipFingerprint = getIpFingerprint(req);
        const guestLimitBytes = limits.guestUploadLimit * 1024 * 1024;

        // Check both fingerprints (user might try different browsers)
        const check1 = canGuestUpload(guestFingerprint, size, guestLimitBytes);
        const check2 = canGuestUpload(ipFingerprint, size, guestLimitBytes);

        if (!check1.allowed || !check2.allowed) {
            return res.status(429).json({
                error: check1.message || check2.message,
                remaining: Math.min(check1.remaining, check2.remaining),
                limitReached: true
            });
        }
    }

    // Always track IP fingerprint (limit concurrent uploads per IP)
    if (!ipFingerprint) {
        ipFingerprint = getIpFingerprint(req);
    }

    // Enforce backend concurrency limit
    const maxConcurrent = getMaxConcurrentUploads();
    if (isLoggedIn) {
        const { count } = db.prepare(`
            SELECT COUNT(*) as count FROM upload_sessions
            WHERE userId = ? AND status IN ('initiated','processing')
        `).get(req.session.userId);
        if (count >= maxConcurrent) {
            return res.status(429).json({ error: `Límite de uploads concurrentes (${maxConcurrent}) alcanzado.` });
        }
    }

    // Enforce per-IP concurrency limit for all users
    const { count: ipCount } = db.prepare(`
        SELECT COUNT(*) as count FROM upload_sessions
        WHERE ipFingerprint = ? AND status IN ('initiated','processing')
    `).get(ipFingerprint);
    if (ipCount >= maxConcurrent) {
        return res.status(429).json({ error: `Límite de uploads concurrentes (${maxConcurrent}) alcanzado.` });
    }

    const uploadId = uuidv4();
    const uploadPath = path.join(CHUNKS_DIR, uploadId);

    // Validate expires field (must be a positive integer representing days, max 365 days)
    let validatedExpires = null;
    if (req.body.expires !== undefined && req.body.expires !== null && req.body.expires !== '') {
        const expiresValue = parseInt(req.body.expires, 10);
        if (isNaN(expiresValue) || expiresValue < 1 || expiresValue > 365) {
            return res.status(400).json({ error: 'El valor de expiración debe ser entre 1 y 365 días' });
        }
        validatedExpires = expiresValue;
    }

    // Validate maxDownloads field (must be a positive integer, max 10000)
    let validatedMaxDownloads = null;
    if (req.body.maxDownloads !== undefined && req.body.maxDownloads !== null && req.body.maxDownloads !== '') {
        const maxDownloadsValue = parseInt(req.body.maxDownloads, 10);
        if (isNaN(maxDownloadsValue) || maxDownloadsValue < 1 || maxDownloadsValue > 10000) {
            return res.status(400).json({ error: 'El límite de descargas debe ser entre 1 y 10000' });
        }
        validatedMaxDownloads = maxDownloadsValue;
    }

    // Hash password immediately if provided (don't store plaintext even temporarily)
    // Use a lower cost factor for the temporary hash to avoid blocking
    let passwordHash = null;
    if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim()) {
        passwordHash = await bcrypt.hash(req.body.password.trim(), 12);
    }

    // Validate checksum format if provided (SHA-256 hex)
    let validatedChecksum = null;
    if (checksum && typeof checksum === 'string') {
        if (/^[a-f0-9]{64}$/i.test(checksum)) {
            validatedChecksum = checksum.toLowerCase();
        } else {
            return res.status(400).json({ error: 'Formato de checksum inválido (se espera SHA-256 hex)' });
        }
    }

    await fsPromises.mkdir(uploadPath, { recursive: true });
    await fsPromises.writeFile(path.join(uploadPath, 'meta.json'), JSON.stringify({
        originalName: sanitizedName, // Use sanitized name
        size,
        mimeType,
        totalChunks,
        userId: req.session.userId || null,
        fingerprint: req.session.userId ? null : guestFingerprint,
        ipFingerprint: req.session.userId ? null : ipFingerprint,
        createdAt: Date.now(),
        expires: validatedExpires,
        maxDownloads: validatedMaxDownloads,
        passwordHash, // Store hash, not plaintext
        checksum: validatedChecksum
    }));

    const now = Date.now();
    db.prepare(`
        INSERT OR REPLACE INTO upload_sessions (uploadId, userId, ipFingerprint, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(uploadId, req.session.userId || null, ipFingerprint, 'initiated', now, now);

    metrics.increment('upload_init', 1);
    res.json({ uploadId });
}));

// NOTE: Chunk size validation is handled by the optimized chunkRouter
// The following multer and error handler are used only for branding uploads

// Multer with dynamic file size limit based on chunk size setting
// We use a generous limit (200MB) to support large adaptive chunks
const upload = multer({
    dest: TEMP_DIR,
    limits: {
        fileSize: 200 * 1024 * 1024 // 200MB max to support large chunks
    }
});

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        logger.error('Multer error', { code: err.code, message: err.message, field: err.field });
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'El fragmento excede el tamaño máximo permitido' });
        }
        return res.status(400).json({ error: `Error de subida: ${err.message}` });
    }
    if (err) {
        logger.error('Upload error', { message: err.message, stack: err.stack });
        return res.status(500).json({ error: 'Error interno durante la subida' });
    }
    next();
};

// NOTE: /api/upload/chunk is handled by the optimized chunkRouter mounted earlier
// This avoids passing through helmet, compression, session, csrf, and httpLogger

app.post('/api/upload/complete', asyncHandler(async (req, res) => {
    const { uploadId } = req.body;

    if (!uploadId) {
        return res.status(400).json({ error: 'Se requiere el ID de subida' });
    }

    if (!/^[a-f0-9-]{36}$/i.test(uploadId)) {
        return res.status(400).json({ error: 'ID de subida inválido' });
    }

    // Invalidar caché inmediatamente
    invalidateUploadCache(uploadId);

    const sessionRow = db.prepare('SELECT status, fileId FROM upload_sessions WHERE uploadId = ?').get(uploadId);
    if (!sessionRow || sessionRow.status === 'cancelled') {
        return res.status(404).json({ error: 'Sesión de subida no encontrada' });
    }
    if (sessionRow.status === 'completed' && sessionRow.fileId) {
        return res.json({ fileId: sessionRow.fileId, message: 'Subida completada' });
    }
    if (sessionRow.status === 'processing') {
        return res.status(409).json({ error: 'Subida en proceso, intenta de nuevo' });
    }

    const statusUpdate = db.prepare(`
        UPDATE upload_sessions SET status = 'processing', updatedAt = ?
        WHERE uploadId = ? AND status IN ('initiated','failed')
    `).run(Date.now(), uploadId);
    if (statusUpdate.changes === 0) {
        return res.status(409).json({ error: 'Subida en proceso, intenta de nuevo' });
    }

    const uploadPath = path.join(CHUNKS_DIR, uploadId);

    try {
        await fsPromises.access(uploadPath);
    } catch {
        db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
        return res.status(404).json({ error: 'Sesión de subida no encontrada' });
    }

    let meta;
    try {
        const metaContent = await fsPromises.readFile(path.join(uploadPath, 'meta.json'), 'utf8');
        meta = JSON.parse(metaContent);
    } catch (err) {
        db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
        return res.status(400).json({ error: 'Sesión de subida inválida: faltan metadatos' });
    }

    // Check disk space before assembling
    try {
        const { free } = await checkDiskSpace(UPLOAD_DIR);
        const safetyBytes = 50 * 1024 * 1024; // 50MB safety buffer
        if (free < meta.size + safetyBytes) {
            db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
            return res.status(507).json({ error: 'Espacio insuficiente en el servidor' });
        }
    } catch (err) {
        logger.warn('Disk space check failed', { error: err.message });
    }

    const finalFileId = uuidv4();
    const finalPath = path.join(UPLOAD_DIR, finalFileId);
    const tempPath = path.join(UPLOAD_DIR, `${finalFileId}.tmp`);

    try {
        // Verify all chunks exist before starting assembly
        for (let i = 0; i < meta.totalChunks; i++) {
            const chunkPath = path.join(uploadPath, `${i}.part`);
            try {
                await fsPromises.access(chunkPath);
            } catch {
                throw new Error(`Missing chunk ${i}`);
            }
        }

        // Assemble file using streams to avoid loading entire file into memory
        const writeStream = fs.createWriteStream(tempPath);

        for (let i = 0; i < meta.totalChunks; i++) {
            const chunkPath = path.join(uploadPath, `${i}.part`);
            await new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(chunkPath);
                readStream.on('error', reject);
                readStream.on('end', resolve);
                readStream.pipe(writeStream, { end: false });
            });
        }

        // Close the write stream
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            writeStream.end();
        });

        // Clean up chunks directory
        await fsPromises.rm(uploadPath, { recursive: true, force: true });

        let expiresAt = null;
        if (meta.expires) {
            // expires is already validated as integer in /init
            expiresAt = Date.now() + (meta.expires * 24 * 60 * 60 * 1000);
        } else {
            // Apply server-wide default retention if configured
            const defaultRetention = db.prepare('SELECT value FROM settings WHERE key = ?').get('defaultRetentionDays');
            if (defaultRetention?.value) {
                const days = parseInt(defaultRetention.value, 10);
                if (days > 0 && days <= 365) {
                    expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
                }
            }
        }

        // Use the password hash stored during /init (already hashed, no plaintext)
        const passwordHash = meta.passwordHash || null;

        // Verify final file size matches expected size (strict)
        const finalStats = await fsPromises.stat(tempPath);
        if (finalStats.size !== meta.size) {
            logger.warn('File size mismatch', {
                expected: meta.size,
                actual: finalStats.size,
                uploadId
            });
            await fsPromises.unlink(tempPath);
            db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
            return res.status(400).json({
                error: 'El tamaño del archivo no coincide con lo esperado. Por favor, intenta de nuevo.'
            });
        }

        // Verify checksum if provided during /init (SHA-256)
        if (meta.checksum) {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(tempPath);
            await new Promise((resolve, reject) => {
                stream.on('data', (chunk) => hash.update(chunk));
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            const computed = hash.digest('hex');
            if (computed !== meta.checksum) {
                logger.warn('Checksum mismatch', { expected: meta.checksum, actual: computed, uploadId });
                await fsPromises.unlink(tempPath);
                db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
                return res.status(400).json({
                    error: 'El checksum del archivo no coincide. El archivo puede estar corrupto.'
                });
            }
        }

        // Detect real file type from content (security validation)
        let detectedMime = meta.mimeType;
        try {
            const detected = await fileTypeFromFile(tempPath);
            if (detected?.mime) {
                detectedMime = detected.mime;
            }
        } catch { }

        const mimeValidation = validateMimeType(detectedMime, meta.originalName);
        if (!mimeValidation.valid) {
            await fsPromises.unlink(tempPath);
            db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
            return res.status(400).json({ error: mimeValidation.reason });
        }

        // Optional antivirus scan (fail-closed when enabled)
        try {
            const avResult = await antivirus.scanFile(tempPath);
            if (avResult.enabled && !avResult.clean) {
                await fsPromises.unlink(tempPath);
                db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
                return res.status(400).json({ error: 'Archivo detectado como malicioso' });
            }
        } catch {
            if (antivirus.isEnabled()) {
                await fsPromises.unlink(tempPath);
                db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
                return res.status(503).json({ error: 'Escaneo antivirus no disponible' });
            }
        }

        // Rename file to final path first, then insert DB record
        // (if crash occurs between rename and INSERT, cleanup will remove orphan files)
        try {
            await fsPromises.rename(tempPath, finalPath);
        } catch (err) {
            throw err;
        }

        const stmt = db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, maxDownloads, passwordHash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        try {
            stmt.run(finalFileId, meta.originalName, finalPath, detectedMime || meta.mimeType, meta.size, Date.now(), meta.userId, expiresAt, meta.maxDownloads || null, passwordHash);
        } catch (err) {
            // Rollback: remove renamed file if DB insert fails
            try { await fsPromises.unlink(finalPath); } catch {}
            throw err;
        }

        db.prepare('UPDATE upload_sessions SET status = ?, fileId = ?, updatedAt = ? WHERE uploadId = ?')
            .run('completed', finalFileId, Date.now(), uploadId);

        // Record guest upload after successful completion
        if (!meta.userId && meta.fingerprint) {
            recordGuestUpload(meta.fingerprint, meta.size);
            if (meta.ipFingerprint && meta.ipFingerprint !== meta.fingerprint) {
                recordGuestUpload(meta.ipFingerprint, meta.size);
            }
        }

        metrics.increment('upload_complete', 1);
        metrics.increment('upload_complete_bytes', meta.size || 0);
        res.json({ fileId: finalFileId, message: 'Subida completada' });

    } catch (err) {
        logger.error('Error al completar subida', { error: err.message });
        // Clean up on error
        try {
            await fsPromises.rm(uploadPath, { recursive: true, force: true });
        } catch { }
        try {
            await fsPromises.unlink(tempPath);
        } catch { }
        db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('failed', Date.now(), uploadId);
        res.status(500).json({ error: err.message || 'Error al completar la subida' });
    }
}));

// Cancel upload and clean up chunks
app.post('/api/upload/cancel', asyncHandler(async (req, res) => {
    const { uploadId } = req.body;

    if (!uploadId) {
        return res.status(400).json({ error: 'Se requiere el ID de subida' });
    }

    // Validate uploadId format to prevent path traversal
    if (!/^[a-f0-9-]{36}$/i.test(uploadId)) {
        return res.status(400).json({ error: 'ID de subida inválido' });
    }

    // Invalidar caché inmediatamente
    invalidateUploadCache(uploadId);

    const uploadPath = path.join(CHUNKS_DIR, uploadId);

    try {
        await fsPromises.rm(uploadPath, { recursive: true, force: true });
        db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('cancelled', Date.now(), uploadId);
        logger.info('Upload cancelled and cleaned up', { uploadId });
        metrics.increment('upload_cancel', 1);
        res.json({ message: 'Subida cancelada' });
    } catch (err) {
        // If folder doesn't exist, that's fine
        if (err.code === 'ENOENT') {
            db.prepare('UPDATE upload_sessions SET status = ?, updatedAt = ? WHERE uploadId = ?').run('cancelled', Date.now(), uploadId);
            metrics.increment('upload_cancel', 1);
            return res.json({ message: 'Subida cancelada' });
        }
        logger.error('Error cancelling upload', { uploadId, error: err.message });
        res.status(500).json({ error: 'Error al cancelar la subida' });
    }
}));

// ... (previous code)



// Download Routes
app.get('/api/meta/:id', (req, res) => {
    const { id } = req.params;
    const stmt = db.prepare('SELECT id, originalName, size, mimeType, createdAt, expiresAt, maxDownloads, downloadCount, userId, passwordHash FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check expiration
    if (file.expiresAt && Date.now() > file.expiresAt) {
        return res.status(410).json({ error: 'El archivo ha expirado' });
    }

    // Check download limit
    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
        return res.status(410).json({ error: 'Límite de descargas alcanzado' });
    }

    const isOwner = req.session.userId && req.session.userId === file.userId;
    const hasPassword = !!file.passwordHash;

    res.json({
        id: file.id,
        originalName: file.originalName,
        size: file.size,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
        expiresAt: file.expiresAt,
        hasPassword,
        isOwner
    });
});

// Download tokens are now stored in SQLite via persistentStores.js
// This provides persistence across restarts and works with multiple replicas

// Validate password and get temporary download token
app.post('/api/download/:id/validate', downloadValidateLimiter, async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check expiration
    if (file.expiresAt && Date.now() > file.expiresAt) {
        return res.status(410).json({ error: 'El archivo ha expirado' });
    }

    // Check download limit
    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
        return res.status(410).json({ error: 'Límite de descargas alcanzado' });
    }

    // Verify password
    if (!file.passwordHash) {
        return res.status(400).json({ error: 'Este archivo no requiere contraseña' });
    }

    if (!password) return res.status(401).json({ error: 'Contraseña requerida' });
    const match = await bcrypt.compare(password, file.passwordHash);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

    // Generate temporary token valid for 5 minutes (stored in SQLite)
    const token = createDownloadToken(id, 5 * 60 * 1000);

    res.cookie('sendu_download_token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge: 5 * 60 * 1000,
        path: `/api/download/${id}`
    });

    res.json({ message: 'Token generado' });
});

// GET download - supports direct download and token-based download
app.get('/api/download/:id', async (req, res) => {
    const { id } = req.params;
    const authHeader = req.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const token = req.cookies?.sendu_download_token || req.get('x-download-token') || bearerToken || null;

    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check expiration
    if (file.expiresAt && Date.now() > file.expiresAt) {
        return res.status(410).json({ error: 'El archivo ha expirado' });
    }

    // Check download limit
    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
        return res.status(410).json({ error: 'Límite de descargas alcanzado' });
    }

    // If file has password, require valid token
    if (file.passwordHash) {
        if (!token) {
            return res.status(401).json({ error: 'Se requiere autenticación para este archivo' });
        }

        // Validate token from SQLite store (single-use)
        if (!validateDownloadToken(token, id)) {
            return res.status(401).json({ error: 'Token inválido o expirado' });
        }
    }

    // Increment download count
    const updateStmt = db.prepare('UPDATE files SET downloadCount = downloadCount + 1 WHERE id = ?');
    updateStmt.run(id);
    metrics.increment('download', 1);

    // Clear one-time download cookie
    res.clearCookie('sendu_download_token', {
        path: `/api/download/${id}`
    });

    // Send file with proper headers for download
    res.download(file.serverPath, file.originalName);
});

// Legacy POST download (kept for backwards compatibility)
app.post('/api/download/:id', downloadValidateLimiter, async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check expiration
    if (file.expiresAt && Date.now() > file.expiresAt) {
        return res.status(410).json({ error: 'El archivo ha expirado' });
    }

    // Check download limit
    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
        return res.status(410).json({ error: 'Límite de descargas alcanzado' });
    }

    // Verify password if set
    if (file.passwordHash) {
        if (!password) return res.status(401).json({ error: 'Contraseña requerida' });
        const match = await bcrypt.compare(password, file.passwordHash);
        if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Increment download count
    const updateStmt = db.prepare('UPDATE files SET downloadCount = downloadCount + 1 WHERE id = ?');
    updateStmt.run(id);
    metrics.increment('download', 1);

    // Send file
    res.download(file.serverPath, file.originalName);
});

// User Files Route (with pagination)
app.get('/api/user/files', requireAuth, (req, res) => {

    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // Get total count
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM files WHERE userId = ?');
    const { total } = countStmt.get(req.session.userId);

    // Get paginated files
    const stmt = db.prepare('SELECT * FROM files WHERE userId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?');
    const files = stmt.all(req.session.userId, limit, offset);

    res.json({
        files,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    });
});

app.delete('/api/files/:id', requireAuth, asyncHandler(async (req, res) => {

    const { id } = req.params;
    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check ownership or admin
    const userStmt = db.prepare('SELECT role FROM users WHERE id = ?');
    const user = userStmt.get(req.session.userId);

    if (file.userId !== req.session.userId && user.role !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Delete from DB
    const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');
    deleteStmt.run(id);

    // Delete from disk asynchronously
    try {
        await fsPromises.unlink(file.serverPath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.warn('Error deleting file from disk', { fileId: id, error: err.message });
        }
    }

    res.json({ message: 'Archivo eliminado' });
}));

// Admin Routes
const requireAdmin = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
    const stmt = db.prepare('SELECT role FROM users WHERE id = ?');
    const user = stmt.get(req.session.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    next();
};

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get().count;
    const totalSize = db.prepare('SELECT SUM(size) as size FROM files').get().size || 0;

    res.json({ userCount, fileCount, totalSize });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, email, username, role, isVerified, createdAt FROM users').all();
    res.json({ users });
});

// Update user
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { email, username } = req.body;

    // Validate email format
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email requerido' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 255) {
        return res.status(400).json({ error: 'Formato de email inválido' });
    }

    // Validate username format (alphanumeric, underscores, 3-30 chars)
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username requerido' });
    }
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(username)) {
        return res.status(400).json({ error: 'Username inválido (3-30 caracteres alfanuméricos o guion bajo)' });
    }

    try {
        const stmt = db.prepare('UPDATE users SET email = ?, username = ? WHERE id = ?');
        stmt.run(email.toLowerCase().trim(), username.trim(), id);
        res.json({ message: 'Usuario actualizado' });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Email o username ya existe' });
        }
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.session.userId) {
        return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    try {
        // Delete user's files first
        const userFiles = db.prepare('SELECT id, serverPath FROM files WHERE userId = ?').all(id);
        for (const file of userFiles) {
            try {
                await fsPromises.unlink(file.serverPath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    logger.warn('Error deleting user file', { fileId: file.id, error: err.message });
                }
            }
        }
        db.prepare('DELETE FROM files WHERE userId = ?').run(id);

        // Delete user
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        res.json({ message: 'Usuario eliminado' });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
}));

// Toggle user role (admin/user)
app.post('/api/admin/users/:id/toggle-role', requireAdmin, (req, res) => {
    const { id } = req.params;

    // Prevent changing your own role
    if (id === req.session.userId) {
        return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }

    try {
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const newRole = user.role === 'admin' ? 'user' : 'admin';
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, id);
        res.json({ message: 'Rol actualizado', role: newRole });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al cambiar rol' });
    }
});

// Toggle user verified status
app.post('/api/admin/users/:id/toggle-verified', requireAdmin, (req, res) => {
    const { id } = req.params;

    try {
        const user = db.prepare('SELECT isVerified FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const newVerified = user.isVerified ? 0 : 1;
        db.prepare('UPDATE users SET isVerified = ? WHERE id = ?').run(newVerified, id);
        res.json({ message: 'Estado de verificación actualizado', isVerified: newVerified });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al cambiar verificación' });
    }
});

// Reset user password
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || !isValidPassword(password)) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres, incluyendo letras y números' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hashedPassword, id);
        res.json({ message: 'Contraseña actualizada' });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

// Admin: Send verification email to user
app.post('/api/admin/users/:id/send-verification', requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (user.isVerified) {
            return res.status(400).json({ error: 'El usuario ya está verificado' });
        }

        // Generate new verification token (store hash, send plain token)
        const { token: verificationToken, hash: verificationTokenHash } = generateSecureToken();
        const verificationTokenExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

        db.prepare('UPDATE users SET verificationToken = ?, verificationTokenExpires = ? WHERE id = ?').run(verificationTokenHash, verificationTokenExpires, id);

        logger.info('Verification token updated for user', {
            userId: id,
            email: user.email,
            tokenHashStart: verificationTokenHash.substring(0, 16) + '...',
            expires: new Date(verificationTokenExpires).toISOString()
        });

        // Send verification email
        const verificationLink = `${PUBLIC_ORIGIN}/verify?token=${verificationToken}`;
        logger.debug('Verification link generated', {
            link: verificationLink.substring(0, 50) + '...',
            tokenStart: verificationToken.substring(0, 16) + '...'
        });

        await sendTemplatedEmail(user.email, 'verification', {
            username: user.username,
            email: user.email,
            verificationLink
        });

        res.json({ message: 'Email de verificación enviado' });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al enviar email de verificación' });
    }
}));

// Admin: Send password reset email to user
app.post('/api/admin/users/:id/send-reset', requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Generate reset token (store hash, send plain token)
        const { token: resetToken, hash: resetTokenHash } = generateSecureToken();
        const resetTokenExpires = Date.now() + (60 * 60 * 1000); // 1 hour

        db.prepare('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE id = ?').run(resetTokenHash, resetTokenExpires, id);

        // Send password reset email
        const resetLink = `${PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
        await sendTemplatedEmail(user.email, 'passwordReset', {
            username: user.username,
            email: user.email,
            resetLink
        });

        res.json({ message: 'Email de reseteo de contraseña enviado' });
    } catch (err) {
        logger.error('Error', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Error al enviar email de reseteo' });
    }
}));

app.get('/api/admin/files', requireAdmin, (req, res) => {
    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // Get total count
    const { total } = db.prepare('SELECT COUNT(*) as total FROM files').get();

    // Get paginated files
    const files = db.prepare('SELECT * FROM files ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(limit, offset);

    res.json({
        files,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.json(settingsMap);
});

// Admin: Reset rate limit counters
app.post('/api/admin/rate-limits/reset', requireAdmin, (req, res) => {
    const { prefix } = req.body || {};
    if (prefix && !/^[a-z0-9_-]+$/i.test(prefix)) {
        return res.status(400).json({ error: 'Prefijo inválido' });
    }
    const normalizedPrefix = prefix === 'all' ? null : prefix || null;
    const deleted = resetRateLimits(normalizedPrefix);
    res.json({ message: 'Rate limits reiniciados', deleted, prefix: normalizedPrefix || 'all' });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const settings = req.body;

    // Allowlist of valid settings keys (prevents arbitrary key injection)
    const ALLOWED_SETTINGS_KEYS = new Set([
        'logoLight', 'logoDark', 'logoLightEmail', 'logoDarkEmail',
        'favicon', 'dropzoneIcon', 'footerText',
        'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom',
        'maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize', 'chunkSize',
        'maxConcurrentUploads', 'chunkRateLimit', 'adaptiveChunkSizing',
        'smallFileThreshold', 'mediumFileThreshold', 'smallFileChunkSize',
        'mediumFileChunkSize', 'largeFileChunkSize', 'emailTemplates',
        'defaultRetentionDays'
    ]);

    // Reject unknown keys
    const unknownKeys = Object.keys(settings).filter(k => !ALLOWED_SETTINGS_KEYS.has(k));
    if (unknownKeys.length > 0) {
        return res.status(400).json({ error: `Claves de configuración no permitidas: ${unknownKeys.join(', ')}` });
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    // Keys that should be encrypted
    const sensitiveKeys = ['smtpPass'];

    const insertMany = db.transaction((settings) => {
        for (const [key, value] of Object.entries(settings)) {
            // Encrypt sensitive values
            const finalValue = sensitiveKeys.includes(key) && value ? encrypt(value) : String(value);
            stmt.run(key, finalValue);
        }
    });

    try {
        insertMany(settings);
        // Invalidate cache so new values take effect immediately
        invalidateSettingsCache(Object.keys(settings));
        res.json({ message: 'Configuración actualizada' });
    } catch (err) {
        logger.error('Error al actualizar configuración', { error: err.message });
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

// Branding Upload (logos and favicon)
const BRANDING_TYPES = new Set(['logoLight', 'logoDark', 'favicon', 'dropzoneIcon']);
const BRANDING_MIME_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico'
};

const validateBrandingType = (req, res, next) => {
    const type = req.query.type;
    if (!BRANDING_TYPES.has(type)) {
        return res.status(400).json({ error: 'Tipo inválido. Debe ser logoLight, logoDark, favicon o dropzoneIcon' });
    }
    req.brandingType = type;
    next();
};

const brandingUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, BRANDING_DIR),
        filename: (req, file, cb) => {
            const ext = BRANDING_MIME_EXT[file.mimetype];
            if (!ext) {
                return cb(new Error('Tipo de archivo inválido. Solo se permiten PNG, JPG, SVG e ICO.'));
            }
            cb(null, `${req.brandingType}${ext}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        if (BRANDING_MIME_EXT[file.mimetype]) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo inválido. Solo se permiten PNG, JPG, SVG e ICO.'));
        }
    }
});

app.post('/api/admin/branding/upload', requireAdmin, validateBrandingType, brandingUpload.single('file'), handleMulterError, asyncHandler(async (req, res) => {
    const type = req.brandingType;

    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const timestamp = Date.now();

    // If it's an SVG logo, queue a background job to create PNG version for emails
    if (req.file.mimetype === 'image/svg+xml' && (type === 'logoLight' || type === 'logoDark')) {
        const svgPath = path.join(BRANDING_DIR, req.file.filename);
        const pngFilename = `${type}-email.png`;
        const pngPath = path.join(BRANDING_DIR, pngFilename);

        // Queue the conversion job (non-blocking)
        enqueueBrandingConversion(svgPath, pngPath, {
            format: 'png',
            height: 80, // Height for emails, maintains aspect ratio
        });

        // Pre-register the PNG URL (will be available after job completes)
        const pngRelativePath = `/branding/${pngFilename}?t=${timestamp}`;
        const pngUrl = PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}${pngRelativePath}` : pngRelativePath;
        const emailLogoKey = type === 'logoLight' ? 'logoLightEmail' : 'logoDarkEmail';
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(emailLogoKey, pngUrl);

        logger.info(`Queued PNG conversion for emails: ${pngFilename}`);
    }

    // Build the URL - always use relative path for branding assets
    // They will be served through the same origin
    const relativePath = `/branding/${req.file.filename}?t=${timestamp}`;

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(type, relativePath);

    res.json({ message: 'Archivo subido', url: relativePath });
}));

app.delete('/api/admin/branding/:type', requireAdmin, asyncHandler(async (req, res) => {
    const { type } = req.params;
    if (!['logoLight', 'logoDark', 'favicon', 'dropzoneIcon'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }

    // Find and delete the file(s) - including email PNG version
    const files = await fsPromises.readdir(BRANDING_DIR);
    const filesToDelete = files.filter(f => f.startsWith(type));
    for (const file of filesToDelete) {
        await fsPromises.unlink(path.join(BRANDING_DIR, file));
    }

    // Remove from settings (including email version)
    db.prepare('DELETE FROM settings WHERE key = ?').run(type);
    if (type === 'logoLight' || type === 'logoDark') {
        const emailKey = type === 'logoLight' ? 'logoLightEmail' : 'logoDarkEmail';
        db.prepare('DELETE FROM settings WHERE key = ?').run(emailKey);
    }

    res.json({ message: 'Recurso de marca eliminado' });
}));

// NOTE: cleanup-chunks endpoint is defined later in the file with cleanupOrphanedChunks function

// SMTP Test Endpoint
app.post('/api/admin/smtp/test', requireAdmin, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Se requiere una dirección de email' });
    }

    try {
        const config = getSmtpConfig();

        if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
            return res.status(400).json({ error: 'Configuración SMTP incompleta. Guarda la configuración primero.' });
        }

        const result = await sendEmail(
            email,
            'Sendu - Email de Prueba',
            'Este es un email de prueba desde Sendu. Si recibes este mensaje, la configuración SMTP está funcionando correctamente.',
            '<h1>Sendu - Email de Prueba</h1><p>Si recibes este mensaje, la configuración SMTP está funcionando correctamente.</p>'
        );

        if (result.mock) {
            return res.json({ message: 'Email enviado (modo simulación)', mock: true });
        }

        res.json({ message: 'Email de prueba enviado correctamente', messageId: result.messageId });
    } catch (err) {
        logger.error('SMTP Test Error', { error: err.message });
        res.status(500).json({ error: `Error SMTP: ${err.message}` });
    }
});

// Public Settings (for Navbar/Branding)
app.get('/api/settings/public', (req, res) => {
    const keys = ['logoLight', 'logoDark', 'favicon', 'dropzoneIcon', 'footerText'];
    const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`);
    const settings = stmt.all(...keys);

    const defaultBranding = getDefaultBrandingSettings();

    const settingsMap = {
        logoLight: defaultBranding.logoLight,
        logoDark: defaultBranding.logoDark,
        favicon: defaultBranding.favicon,
        dropzoneIcon: defaultBranding.dropzoneIcon,
        footerText: ''
    };

    settings.forEach(s => settingsMap[s.key] = s.value);
    res.json(settingsMap);
});

// Upload Limits (public)
app.get('/api/settings/limits', (req, res) => {
    const keys = [
        'maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize',
        'chunkSize', 'maxConcurrentUploads',
        // Adaptive chunk sizing settings
        'adaptiveChunkSizing', 'smallFileThreshold', 'mediumFileThreshold',
        'smallFileChunkSize', 'mediumFileChunkSize', 'largeFileChunkSize',
        // Rate limiting for chunks
        'chunkRateLimit'
    ];
    const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`);
    const settings = stmt.all(...keys);

    const settingsMap = {
        maxFileSize: 100,           // Default 100MB for registered users
        maxTotalSize: 500,          // Default 500MB total storage for registered users
        guestUploadLimit: 5120,     // Default 5GB (5120MB) total for guests
        guestMaxFileSize: 50,       // Default 50MB max file size for guests
        chunkSize: 20,              // Default 20MB per chunk (fallback if adaptive disabled)
        maxConcurrentUploads: 6,    // Default 6 parallel uploads (balanced for most connections)
        // Adaptive chunk sizing defaults - reduced for better reliability
        adaptiveChunkSizing: true,  // Enable adaptive chunk sizing by default
        smallFileThreshold: 100,    // Files < 100MB are "small"
        mediumFileThreshold: 1024,  // Files < 1GB are "medium", >= 1GB are "large"
        smallFileChunkSize: 16,     // 16MB chunks for small files (fast feedback, menos overhead)
        mediumFileChunkSize: 48,    // 48MB chunks para medianos (balance velocidad/fiabilidad)
        largeFileChunkSize: 96,     // 96MB chunks para grandes (mejor throughput en conexiones buenas)
        chunkRateLimit: 1000        // Default 1000 chunk requests per minute
    };

    settings.forEach(s => {
        if (s.key === 'adaptiveChunkSizing') {
            settingsMap[s.key] = s.value === 'true' || s.value === true;
        } else {
            settingsMap[s.key] = parseInt(s.value) || settingsMap[s.key];
        }
    });

    // Calculate effective max file size based on user type
    const isLoggedIn = !!req.session.userId;
    settingsMap.effectiveMaxFileSize = isLoggedIn ? settingsMap.maxFileSize : settingsMap.guestMaxFileSize;
    settingsMap.isLoggedIn = isLoggedIn;
    // Tamaño máximo de chunk permitido por backend (en MB, basado en ajustes + colchón)
    const maxChunkSizeBytes = getMaxChunkSizeFromSettingsSync();
    settingsMap.maxChunkSize = Math.round(maxChunkSizeBytes / (1024 * 1024));

    // Add guest remaining if not logged in
    if (!isLoggedIn) {
        const fingerprint = generateFingerprint(req);
        const ipFingerprint = getIpFingerprint(req);
        const guestLimitBytes = settingsMap.guestUploadLimit * 1024 * 1024;

        const check1 = canGuestUpload(fingerprint, 0, guestLimitBytes);
        const check2 = canGuestUpload(ipFingerprint, 0, guestLimitBytes);

        settingsMap.guestRemaining = Math.min(check1.remaining, check2.remaining);
    }

    res.json(settingsMap);
});

// Health check endpoint (for Docker/PaaS health probes)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime()
    });
});

// Session debug endpoint (only in development or with DEBUG_SESSION env, admin-only)
app.get('/api/health/session', requireAdmin, (req, res) => {
    if (process.env.NODE_ENV === 'production' && !process.env.DEBUG_SESSION) {
        return res.status(404).json({ error: 'Not found' });
    }

    const cookieName = process.env.SESSION_COOKIE_NAME || 'sendu.sid';
    const sessionCookie = req.cookies?.[cookieName];
    const trustProxyValue = app.get('trust proxy');

    res.json({
        config: {
            cookieName,
            secure: sessionCookieSecure,
            sameSite: sessionCookieSameSite,
            domain: sessionCookieDomain || '(not set)',
            trustProxy: trustProxyValue,
            trustProxyType: typeof trustProxyValue,
            nodeEnv: process.env.NODE_ENV
        },
        request: {
            hasSessionCookie: !!sessionCookie,
            cookieValue: sessionCookie ? sessionCookie.substring(0, 20) + '...' : null,
            sessionId: (req.session?.id || req.sessionID)?.substring(0, 16) + '...',
            hasUserId: !!req.session?.userId,
            protocol: req.protocol,
            secure: req.secure,
            xForwardedProto: req.get('x-forwarded-proto'),
            host: req.get('host'),
            origin: req.get('origin')
        },
        cookies: Object.keys(req.cookies || {}),
        fix: req.protocol !== 'https' && req.get('x-forwarded-proto') === 'https'
            ? 'Trust proxy is not working correctly. Try setting TRUST_PROXY=true'
            : null
    });
});

// Readiness check (DB + storage)
app.get('/api/health/ready', async (req, res) => {
    let dbOk = false;
    let storageOk = false;
    let dataOk = false;

    try {
        db.prepare('SELECT 1').get();
        dbOk = true;
    } catch { }

    try {
        await fsPromises.access(UPLOAD_DIR, fs.constants.W_OK);
        storageOk = true;
    } catch { }

    try {
        await fsPromises.access(dataDir, fs.constants.W_OK);
        dataOk = true;
    } catch { }

    const ready = dbOk && storageOk && dataOk;
    res.status(ready ? 200 : 503).json({
        status: ready ? 'ok' : 'degraded',
        db: dbOk,
        uploads: storageOk,
        data: dataOk,
        timestamp: Date.now()
    });
});

// SPA Fallback - Serve index.html for non-API routes in production
// This enables client-side routing (e.g., /dashboard, /download/xyz)
if (process.env.NODE_ENV === 'production') {
    app.get('/{*splat}', (req, res, next) => {
        // Skip API routes
        if (req.path.startsWith('/api/')) {
            return next();
        }

        // Skip branding and other static assets
        if (req.path.startsWith('/branding/') || req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
            return next();
        }

        // Serve index.html for SPA routes
        const staticPath = path.join(rootDir, 'frontend/dist');
        const publicPath = path.join(rootDir, 'public');

        let indexPath = path.join(staticPath, 'index.html');
        if (!fs.existsSync(indexPath)) {
            indexPath = path.join(publicPath, 'index.html');
        }

        if (fs.existsSync(indexPath)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.sendFile(indexPath);
        }

        next();
    });
}

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(globalErrorHandler);

// Database Initialization (Schema)
const initDb = () => {
    // Run versioned migrations (idempotent)
    runMigrations(db);

    // Initialize default settings if not present
    const concurrencySetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('maxConcurrentUploads');
    if (!concurrencySetting) {
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('maxConcurrentUploads', '6');
    }

    const bootstrapSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('adminBootstrapCompleted');
    if (!bootstrapSetting) {
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('adminBootstrapCompleted', 'false');
    }

    logger.info('Database initialized');

    // Save database after initialization
    saveDatabase();
};

// Automatic cleanup job - runs every hour with distributed locking
const cleanupExpiredFiles = async () => {
    const now = Date.now();

    // Find expired files
    const expiredFiles = db.prepare('SELECT * FROM files WHERE expiresAt IS NOT NULL AND expiresAt < ?').all(now);

    // Find files with max downloads reached
    const maxDownloadFiles = db.prepare('SELECT * FROM files WHERE maxDownloads IS NOT NULL AND downloadCount >= maxDownloads').all();

    const filesToDelete = [...expiredFiles, ...maxDownloadFiles];

    // Remove duplicates
    const uniqueFiles = filesToDelete.filter((file, index, self) =>
        index === self.findIndex((t) => t.id === file.id)
    );

    if (uniqueFiles.length === 0) return;

    logger.info(`Cleanup: Found ${uniqueFiles.length} expired files to delete`);

    for (const file of uniqueFiles) {
        try {
            try {
                await fsPromises.unlink(file.serverPath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    logger.warn('Cleanup: File not found on disk', { fileId: file.id });
                }
            }
            db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
            logger.info(`Cleanup: Deleted file ${file.id} (${file.originalName})`);
        } catch (err) {
            logger.error('Cleanup error', { fileId: file.id, error: err.message });
        }
    }
};

// Cleanup old upload sessions to prevent table growth
const cleanupUploadSessions = () => {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    try {
        db.prepare(`
            DELETE FROM upload_sessions
            WHERE status IN ('completed','cancelled','failed') AND updatedAt < ?
        `).run(cutoff);
    } catch (err) {
        logger.warn('Cleanup upload sessions failed', { error: err.message });
    }
};

// Reconcile orphaned files between DB and disk
const reconcileOrphanedFiles = async () => {
    try {
        const dbFiles = db.prepare('SELECT id, serverPath FROM files').all();
        const dbPathSet = new Set(dbFiles.map(f => f.serverPath));

        const entries = await fsPromises.readdir(UPLOAD_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) continue;
            const filePath = path.join(UPLOAD_DIR, entry.name);
            if (!dbPathSet.has(filePath)) {
                try {
                    await fsPromises.unlink(filePath);
                    logger.info('Reconcile: deleted orphaned file', { file: entry.name });
                } catch (err) {
                    logger.warn('Reconcile: failed to delete orphaned file', { file: entry.name, error: err.message });
                }
            }
        }

        for (const file of dbFiles) {
            if (!fs.existsSync(file.serverPath)) {
                db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
                logger.warn('Reconcile: removed DB entry for missing file', { fileId: file.id });
            }
        }
    } catch (err) {
        logger.error('Reconcile orphaned files failed', { error: err.message });
    }
};

// Cleanup orphaned chunks (uploads that were never completed)
// Only deletes chunks that haven't been modified for maxAgeMs (safe for slow uploads)
const cleanupOrphanedChunks = async (maxAgeMs = 24 * 60 * 60 * 1000) => {
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;

    // Ensure chunks directory exists
    if (!fs.existsSync(CHUNKS_DIR)) {
        fs.mkdirSync(CHUNKS_DIR, { recursive: true });
        return { deletedCount: 0, freedBytes: 0 };
    }

    try {
        const chunkDirs = await fsPromises.readdir(CHUNKS_DIR);

        for (const dir of chunkDirs) {
            const chunkPath = path.join(CHUNKS_DIR, dir);

            try {
                const stat = await fsPromises.stat(chunkPath);
                if (!stat.isDirectory()) continue;

                // Find the most recent modification time among all files in the folder
                // This ensures we don't delete active uploads (slow connections)
                let lastActivity = stat.mtimeMs;

                const files = await fsPromises.readdir(chunkPath);
                for (const file of files) {
                    try {
                        const fileStat = await fsPromises.stat(path.join(chunkPath, file));
                        if (fileStat.mtimeMs > lastActivity) {
                            lastActivity = fileStat.mtimeMs;
                        }
                    } catch { }
                }

                // Only delete if NO activity for maxAge (safe for slow uploads)
                const timeSinceLastActivity = now - lastActivity;
                if (timeSinceLastActivity > maxAgeMs) {
                    // Calculate size before deleting
                    for (const file of files) {
                        try {
                            const fileStat = await fsPromises.stat(path.join(chunkPath, file));
                            freedBytes += fileStat.size;
                        } catch { }
                    }

                    await fsPromises.rm(chunkPath, { recursive: true, force: true });
                    deletedCount++;
                    logger.info(`Cleanup: Deleted orphaned chunk folder ${dir} (inactive for ${Math.round(timeSinceLastActivity / 60000)} minutes)`);
                }
            } catch (err) {
                logger.warn('Error processing chunk folder', { dir, error: err.message });
            }
        }
    } catch (err) {
        logger.error('Error reading chunks directory', { error: err.message });
    }

    return { deletedCount, freedBytes };
};

// Admin endpoint to manually trigger orphaned chunks cleanup
app.post('/api/admin/cleanup-chunks', requireAdmin, asyncHandler(async (req, res) => {
    const { maxAgeHours = 1, useQueue = false } = req.body; // Default: 1 hour old chunks

    if (useQueue) {
        // Queue the cleanup job for background processing
        const jobId = enqueueCleanup('chunks', {
            maxAgeHours,
            chunksDir: CHUNKS_DIR
        });
        return res.json({
            message: 'Limpieza encolada para procesamiento en segundo plano',
            jobId
        });
    }

    // Immediate cleanup (legacy behavior)
    const maxAgeMs = Math.max(1, Math.min(720, maxAgeHours)) * 60 * 60 * 1000; // 1 hour to 30 days

    const result = await cleanupOrphanedChunks(maxAgeMs);

    const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(2);
    logger.info(`Manual cleanup: Deleted ${result.deletedCount} orphaned chunk folders, freed ${freedMB}MB`);

    res.json({
        message: `Se eliminaron ${result.deletedCount} carpetas de chunks huérfanos`,
        deletedCount: result.deletedCount,
        freedBytes: result.freedBytes,
        freedMB: parseFloat(freedMB)
    });
}));

// Admin endpoint to view job queue status
app.get('/api/admin/jobs/stats', requireAdmin, asyncHandler(async (req, res) => {
    const stats = getQueueStats();
    res.json(stats);
}));

// Admin endpoint for basic operational metrics
app.get('/api/admin/metrics', requireAdmin, asyncHandler(async (req, res) => {
    let disk = null;
    try {
        disk = await checkDiskSpace(UPLOAD_DIR);
    } catch { }
    const queue = getQueueStats();
    res.json({
        metrics: metrics.getSnapshot(),
        queue,
        disk
    });
}));

// Admin endpoint to schedule cleanup jobs
app.post('/api/admin/jobs/cleanup', requireAdmin, asyncHandler(async (req, res) => {
    const { type = 'all' } = req.body;
    const jobs = [];

    if (type === 'files' || type === 'all') {
        const jobId = enqueueCleanup('files', { uploadDir: UPLOAD_DIR });
        jobs.push({ type: 'files', jobId });
    }

    if (type === 'chunks' || type === 'all') {
        const jobId = enqueueCleanup('chunks', { chunksDir: CHUNKS_DIR });
        jobs.push({ type: 'chunks', jobId });
    }

    res.json({
        message: `${jobs.length} trabajo(s) de limpieza encolado(s)`,
        jobs
    });
}));

// Cleanup with distributed locking (safe for multi-replica)
const runCleanup = async () => {
    if (!db) return; // Skip if database not initialized yet
    const ran = await runWithLock(async () => {
        await cleanupExpiredFiles();
        cleanupUploadSessions();
        await reconcileOrphanedFiles();
    });
    if (ran) {
        logger.debug('Cleanup completed successfully');
    }
};

// Run cleanup with jitter to prevent thundering herd in multi-replica deployments
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour base
const scheduleNextCleanup = () => {
    const interval = getCleanupIntervalWithJitter(CLEANUP_INTERVAL);
    setTimeout(async () => {
        await runCleanup();
        scheduleNextCleanup();
    }, interval);
};

// Orphaned chunk cleanup schedule
const CHUNK_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours base
const CHUNK_CLEANUP_MAX_AGE_HOURS = parseInt(process.env.CHUNK_CLEANUP_MAX_AGE_HOURS || '24', 10);
const runChunkCleanup = async () => {
    if (!db) return;
    const maxAgeMs = Math.max(1, Math.min(720, CHUNK_CLEANUP_MAX_AGE_HOURS)) * 60 * 60 * 1000;
    const ran = await runWithLock(async () => {
        await cleanupOrphanedChunks(maxAgeMs);
    });
    if (ran) {
        logger.debug('Chunk cleanup completed successfully');
    }
};

const scheduleNextChunkCleanup = () => {
    const interval = getCleanupIntervalWithJitter(CHUNK_CLEANUP_INTERVAL);
    setTimeout(async () => {
        await runChunkCleanup();
        scheduleNextChunkCleanup();
    }, interval);
};

// Disk space monitor (logs warnings for low disk)
const DISK_WARN_PERCENT = parseInt(process.env.DISK_WARN_PERCENT || '10', 10);
const DISK_WARN_GB = parseInt(process.env.DISK_WARN_GB || '5', 10);
const DISK_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const monitorDiskSpace = async () => {
    try {
        const { free, size } = await checkDiskSpace(UPLOAD_DIR);
        const freePercent = size > 0 ? Math.round((free / size) * 100) : 0;
        const freeGb = Math.round(free / (1024 * 1024 * 1024));
        if (freePercent <= DISK_WARN_PERCENT || freeGb <= DISK_WARN_GB) {
            metrics.increment('disk_low', 1);
            logger.warn('Low disk space detected', { freePercent, freeGb, path: UPLOAD_DIR });
        }
    } catch (err) {
        logger.warn('Disk space monitor failed', { error: err.message });
    }
};

// Main startup function
const startServer = async (options = {}) => {
    const {
        dbPathOverride = null,
        listen = true,
        enableSchedulers = true,
        enableJobs = true
    } = options;
    try {
        if (db) {
            return null;
        }
        const targetDbPath = dbPathOverride || dbPath;
        // Log database location and status
        const dbExists = fs.existsSync(targetDbPath);
        logger.info(`Database path: ${targetDbPath}`);
        logger.info(`Database exists: ${dbExists}`);
        if (dbExists) {
            const stats = fs.statSync(targetDbPath);
            logger.info(`Database size: ${(stats.size / 1024).toFixed(2)} KB`);
        }

        // Initialize database first
        db = await initDatabase(targetDbPath);

        // Initialize database schema
        initDb();

        // Seed default branding settings if missing
        ensureDefaultBrandingSettings();

        // Initialize persistent stores (CSRF, guest tracking, download tokens, sessions)
        initPersistentStores(db);
        enableCsrfPersistence();
        enableGuestPersistence();

        // Setup session middleware now that database is ready
        setupSessionMiddleware();
        logger.info('Persistent stores initialized (sessions, CSRF, guest tracking, download tokens)');

        if (enableJobs) {
            // Initialize job queue system for background tasks
            initJobQueue(db, {
                processingIntervalMs: 5000,  // Check for jobs every 5 seconds
                maxRetries: 5,               // Retry failed jobs up to 5 times
                retryDelayMs: 30000,         // 30 second base delay with exponential backoff
            });
            initJobHandlers(db, getSmtpConfig);
            logger.info('Job queue system initialized (emails, cleanup, branding conversion)');
        }

        // Log some stats to verify data persistence
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
        const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get()?.count || 0;
        logger.info(`Database loaded: ${userCount} users, ${settingsCount} settings`);

        if (enableSchedulers) {
            // Run cleanup on startup and schedule next
            runCleanup();
            scheduleNextCleanup();
            runChunkCleanup();
            scheduleNextChunkCleanup();
            // Start disk monitoring
            monitorDiskSpace();
            setInterval(monitorDiskSpace, DISK_CHECK_INTERVAL);
        }

        if (listen) {
            // Start Server
            const server = app.listen(PORT, () => {
                logger.info(`Server running on port ${PORT}`);
                logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
                logger.info(`Public Origin: ${PUBLIC_ORIGIN}`);
                logger.info(`Storage paths:`);
                logger.info(`  - Data: ${dataDir}`);
                logger.info(`  - Uploads: ${UPLOAD_DIR}`);
                logger.info(`  - Temp: ${TEMP_DIR}`);
            });

            // Setup process-level error handlers for graceful shutdown
            setupProcessErrorHandlers(server, { stopJobProcessor });
            return server;
        }

        return null;

    } catch (err) {
        logger.error('Failed to start server', { error: err.message });
        process.exit(1);
    }
};

if (process.env.NODE_ENV !== 'test') {
    startServer();
}

export { db, app, startServer };
