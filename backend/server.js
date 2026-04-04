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
import multer from 'multer';
import checkDiskSpace from 'check-disk-space';
import { fileTypeFromFile } from 'file-type';
import { DEFAULT_EMAIL_TEMPLATES } from './templates/email/index.js';
import logger, { httpLogger } from './lib/logger.js';
import { csrfProtection, enablePersistentStorage as enableCsrfPersistence } from './lib/csrf.js';
import { encrypt, decrypt, isEncrypted, getEncryptionFormat } from './lib/encryption.js';
import { hashToken, generateSecureToken } from './lib/tokenHash.js';
import { generateFingerprint, getIpFingerprint, canGuestUpload, recordGuestUpload, enablePersistentStorage as enableGuestPersistence } from './lib/guestTracking.js';
import { initPersistentStores, createSqliteSessionStore, createDownloadToken, validateDownloadToken, createRateLimitStore, resetRateLimits } from './lib/persistentStores.js';
import { globalErrorHandler, notFoundHandler, asyncHandler, setupProcessErrorHandlers } from './lib/errorHandler.js';
import { initDatabase, saveDatabase, closeDatabase } from './lib/database.js';
import { invalidateUploadCache } from './lib/uploadCache.js';
import { createChunkRouter } from './chunkRouter.js';
import { initJobQueue, enqueueCleanup, enqueueBrandingConversion, getQueueStats, getPendingJobs, retryDeadJobs, cancelJob, stopJobProcessor, JOB_TYPES } from './lib/jobQueue.js';
import { initJobHandlers } from './lib/jobHandlers.js';
import { metrics } from './lib/metrics.js';
import { runMigrations } from './lib/migrations.js';
import { antivirus } from './lib/antivirus.js';
import { createUploadSessionToken, validateUploadSessionToken } from './lib/uploadSessionToken.js';
import { createSettingsRepository } from './lib/settingsRepository.js';
import { createUsersRepository } from './lib/usersRepository.js';
import { createUploadSessionsRepository } from './lib/uploadSessionsRepository.js';
import { createFilesRepository } from './lib/filesRepository.js';
import { createDatabaseHealthRepository } from './lib/databaseHealthRepository.js';
import {
    initializeDatabaseDefaults,
    seedDefaultBrandingSettings,
    logDatabaseStats,
} from './lib/bootstrap.js';
import {
    applyAdminSettings,
    serializeAdminSettings,
    validateAdminSettingsPayload,
} from './lib/adminSettings.js';
import {
    buildOperationalMetrics,
    serializeOperationalMetricsPrometheus,
} from './lib/operationalMetrics.js';
import {
    SMTP_ENV_KEY_MAP,
    getSmtpEnvironmentConfig,
    mergeSmtpConfig,
    mergeSmtpIntoSettings,
} from './lib/smtpConfig.js';
import { createRuntimeSettingsCache } from './lib/runtimeSettings.js';
import { validateMimeType } from './lib/mimeValidation.js';
import { getDefaultBrandingSettings } from './lib/branding.js';
import { createSmtpTransporter, sendEmail as sendEmailDirect, sendTemplatedEmail as sendTemplatedEmailImpl } from './lib/email.js';
import { cleanupOrphanedChunks, startCleanupSchedulers } from './lib/cleanup.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicSettingsRoutes } from './routes/publicSettings.js';
import { registerAdminOperationsRoutes } from './routes/adminOperations.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerAdminSettingsRoutes } from './routes/adminSettings.js';
import { registerDownloadRoutes } from './routes/download.js';
import { registerFileRoutes } from './routes/files.js';
import { registerAdminUserRoutes } from './routes/adminUsers.js';
import { registerHealthRoutes } from './routes/health.js';

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
const METRICS_EXPORT_TOKEN = process.env.METRICS_EXPORT_TOKEN || '';
// Support multiple origins (comma-separated in env var)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [PUBLIC_ORIGIN];
const isProduction = process.env.NODE_ENV === 'production';
const LOOPBACK_HOST_REGEX = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i;
const isLoopbackOrigin = (() => {
    try {
        const parsed = new URL(PUBLIC_ORIGIN);
        return LOOPBACK_HOST_REGEX.test(parsed.host);
    } catch {
        return false;
    }
})();
const isTest = process.env.NODE_ENV === 'test';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_POLICY_MESSAGE = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres, incluyendo letras y números`;

const requestUsesSecureCookies = (req) => {
    if (!req) return false;
    if (req.secure) return true;

    const forwardedProto = req.get?.('x-forwarded-proto');
    if (!forwardedProto) return false;

    return forwardedProto.split(',')[0].trim() === 'https';
};

const serializeFileForClient = (file) => ({
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
    expiresAt: file.expiresAt || null,
    maxDownloads: file.maxDownloads || null,
    downloadCount: file.downloadCount || 0,
    userId: file.userId || null,
    hasPassword: Boolean(file.passwordHash),
});

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
let settingsRepository = null;
let usersRepository = null;
let uploadSessionsRepository = null;
let filesRepository = null;
let databaseHealthRepository = null;

const getSettingsRepository = () => {
    if (!db) {
        throw new Error('Settings repository requested before database initialization');
    }

    if (!settingsRepository) {
        settingsRepository = createSettingsRepository({ db });
    }

    return settingsRepository;
};

const getUsersRepository = () => {
    if (!db) {
        throw new Error('Users repository requested before database initialization');
    }

    if (!usersRepository) {
        usersRepository = createUsersRepository({ db });
    }

    return usersRepository;
};

const getUploadSessionsRepository = () => {
    if (!db) {
        throw new Error('Upload sessions repository requested before database initialization');
    }

    if (!uploadSessionsRepository) {
        uploadSessionsRepository = createUploadSessionsRepository({ db });
    }

    return uploadSessionsRepository;
};

const getFilesRepository = () => {
    if (!db) {
        throw new Error('Files repository requested before database initialization');
    }

    if (!filesRepository) {
        filesRepository = createFilesRepository({ db });
    }

    return filesRepository;
};

const getDatabaseHealthRepository = () => {
    if (!db) {
        throw new Error('Database health repository requested before database initialization');
    }

    if (!databaseHealthRepository) {
        databaseHealthRepository = createDatabaseHealthRepository({ db });
    }

    return databaseHealthRepository;
};

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

// Runtime settings cache (extracted module)
const settingsCache = createRuntimeSettingsCache({ getSettingsRepository, isTest });
const getRuntimeSettingValue = settingsCache.getValue;
const refreshRuntimeSettingsCache = settingsCache.refresh;
const resetRuntimeSettingsCache = settingsCache.reset;
const ensureRuntimeSettingsLoaded = settingsCache.ensureLoaded;
const invalidateSettingsCache = () => settingsCache.invalidate();

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Helper: Get max chunk size from settings (for validation)
const getMaxChunkSizeFromSettingsSync = () => {
    const configuredChunkSize = parseInt(getRuntimeSettingValue('largeFileChunkSize'), 10);
    const largeChunk = Number.isFinite(configuredChunkSize) ? configuredChunkSize : 100;
    const computed = Math.max(largeChunk * 1.2, 200) * 1024 * 1024;
    return Math.min(computed, MAX_CHUNK_UPLOAD_BYTES);
};

// Helper: Get upload limits from settings (used by chunk router)
// Needs to be defined before chunk router
const getUploadLimits = () => {
    const limits = {
        maxFileSize: 100,        // Default 100MB for registered users
        maxTotalSize: 500,       // Default 500MB total for registered users
        guestUploadLimit: 5120,  // Default 5GB (5120MB) total for non-logged users
        guestMaxFileSize: 50     // Default 50MB max file size for guests
    };

    ['maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize'].forEach((key) => {
        const parsed = parseInt(getRuntimeSettingValue(key), 10);
        if (Number.isFinite(parsed)) {
            limits[key] = parsed;
        }
    });

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
const chunkRateLimiter = isTest ? noopLimiter : rateLimit({
    windowMs: 60 * 1000, // 1 minute
    store: createRateLimitStore(60 * 1000, { keyPrefix: 'chunk' }),
    keyGenerator: (req) => ipKeyGenerator(req),
    max: () => {
        const configuredLimit = parseInt(getRuntimeSettingValue('chunkRateLimit'), 10);
        return Number.isFinite(configuredLimit) ? Math.max(1, configuredLimit) : 1000;
    },
    message: { error: 'Demasiadas solicitudes de subida. Espera un momento e intenta de nuevo.' }
});

// Mount optimized chunk router BEFORE heavy middleware
const chunkRouter = createChunkRouter({
    CHUNKS_DIR,
    TEMP_DIR,
    getMaxChunkSize: getMaxChunkSizeFromSettingsSync,
    getUploadLimits,
    getUploadSessionsRepository,
    isProduction,
    maxUploadAgeMs: MAX_UPLOAD_SESSION_AGE_MS
});

// Apply minimal middleware only to chunk route
app.use('/api/upload/chunk',
    cors(chunkCorsOptions),
    ensureRuntimeSettingsLoaded,
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
app.use('/api', ensureRuntimeSettingsLoaded);
app.use('/metrics', ensureRuntimeSettingsLoaded);

// HTTP Request Logging
app.use(httpLogger);

// Session Middleware - Uses SQLite store for persistence across restarts and replicas
// Store is initialized in startServer() after database is ready
let sessionMiddleware = null;
const sessionCookieDomain = (isProduction && !isLoopbackOrigin) ? process.env.SESSION_COOKIE_DOMAIN : null;
const sessionCookieSameSite = process.env.SESSION_COOKIE_SAMESITE || (isProduction ? 'lax' : 'lax');
const sessionCookieSecure = !isProduction
    ? false
    : (
        isLoopbackOrigin
            ? false
            : (
                process.env.SESSION_COOKIE_SECURE
                    ? process.env.SESSION_COOKIE_SECURE === 'true'
                    : 'auto'
            )
    );
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
        '/upload/chunk',    // Handled by optimized router mounted before CSRF
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
        const dedicatedRateLimitRoute = req.method === 'POST' && (
            req.path === '/auth/login' ||
            req.path === '/auth/register' ||
            req.path === '/auth/forgot-password' ||
            req.path === '/auth/reset-password' ||
            req.path.startsWith('/download/')
        );

        // Exclude admins from rate limiting
        if (req.session?.role === 'admin') return true;
        // Exclude chunk uploads and frequently called public endpoints
        return req.path.startsWith('/upload/chunk') ||
            dedicatedRateLimitRoute ||
            req.path === '/settings/public' ||
            req.path === '/settings/limits' ||
            req.path === '/auth/me' ||
            req.path === '/auth/csrf';
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
    maxAge: '1d',
    etag: true,
    lastModified: true,
}));

const getDefaultBrandingSettingsBound = () => getDefaultBrandingSettings(BRANDING_DIR);

// Helper: Get SMTP config from settings (with decryption for sensitive fields)
const getSmtpConfig = () => {
    const envConfig = getSmtpEnvironmentConfig();
    if (!db) {
        return envConfig;
    }

    const storedConfig = {};
    const sensitiveKeys = ['smtpPass'];
    Object.keys(SMTP_ENV_KEY_MAP).forEach((key) => {
        const value = getRuntimeSettingValue(key);
        if (!value) return;

        if (sensitiveKeys.includes(key) && isEncrypted(value)) {
            try {
                storedConfig[key] = decrypt(value);
            } catch (err) {
                logger.warn('Sensitive setting decryption failed; ignoring stored value', {
                    key,
                    format: getEncryptionFormat(value),
                    error: err.message,
                });
                storedConfig[key] = '';
            }
        } else {
            storedConfig[key] = value;
        }
    });

    return mergeSmtpConfig(envConfig, storedConfig);
};

const isEmailDeliveryEnabled = () => {
    const config = getSmtpConfig();
    return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
};

// Email templates from settings (with fallback to defaults)
const getEmailTemplates = () => {
    const serializedTemplates = getRuntimeSettingValue('emailTemplates');
    if (serializedTemplates) {
        try {
            const savedTemplates = JSON.parse(serializedTemplates);
            return { ...DEFAULT_EMAIL_TEMPLATES, ...savedTemplates };
        } catch (e) {
            return DEFAULT_EMAIL_TEMPLATES;
        }
    }
    return DEFAULT_EMAIL_TEMPLATES;
};

// Thin wrappers that pass runtime-resolved config to the extracted email module
const sendEmail = (to, subject, text, html = null) =>
    sendEmailDirect(to, subject, text, html, getSmtpConfig());

const createSmtpTransporterBound = () => createSmtpTransporter(getSmtpConfig());

const sendTemplatedEmail = (to, templateName, variables = {}, options = {}) =>
    sendTemplatedEmailImpl({
        to,
        templateName,
        variables,
        templates: getEmailTemplates(),
        smtpConfig: getSmtpConfig(),
        smtpConfigured: isEmailDeliveryEnabled(),
        publicOrigin: PUBLIC_ORIGIN,
        getRuntimeSettingValue,
        options,
    });

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
    return password
        && password.length >= PASSWORD_MIN_LENGTH
        && /[a-zA-Z]/.test(password)
        && /[0-9]/.test(password);
};

registerAuthRoutes({
    app,
    authLimiter,
    passwordResetLimiter,
    asyncHandler,
    getUsersRepository,
    bcrypt,
    uuidv4,
    logger,
    hashToken,
    generateSecureToken,
    safeCompare,
    sendTemplatedEmail,
    PUBLIC_ORIGIN,
    ALLOW_PUBLIC_REGISTRATION,
    ADMIN_BOOTSTRAP_TOKEN,
    PASSWORD_POLICY_MESSAGE,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    isEmailDeliveryEnabled,
    requireAuth,
    sessionCookieDomain,
    sessionCookieSecure,
    sessionCookieSameSite,
});

// Upload Routes
// (UPLOAD_DIR, CHUNKS_DIR, TEMP_DIR defined earlier for chunk router)

// Helper: Get max concurrent uploads from settings
const getMaxConcurrentUploads = () => {
    const configuredValue = parseInt(getRuntimeSettingValue('maxConcurrentUploads'), 10);
    return Number.isFinite(configuredValue) ? Math.max(1, configuredValue) : 6;
};

// MIME validation is now in lib/mimeValidation.js (imported at top)

// NOTE: Chunk size validation is handled by the optimized chunkRouter
// The following multer and error handler are used only for branding uploads

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

registerUploadRoutes({
    app,
    asyncHandler,
    getSettingsRepository,
    getUsersRepository,
    getUploadSessionsRepository,
    getFilesRepository,
    fs,
    fsPromises,
    crypto,
    bcrypt,
    uuidv4,
    logger,
    metrics,
    checkDiskSpace,
    fileTypeFromFile,
    antivirus,
    invalidateUploadCache,
    validateMimeType,
    getUploadLimits,
    getMaxConcurrentUploads,
    isEmailDeliveryEnabled,
    generateFingerprint,
    getIpFingerprint,
    canGuestUpload,
    recordGuestUpload,
    createUploadSessionToken,
    validateUploadSessionToken,
    UPLOAD_DIR,
    CHUNKS_DIR,
});

// Admin Routes
const requireAdmin = asyncHandler(async (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
    const role = await getUsersRepository().getRoleById(req.session.userId);
    if (role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    next();
});

const hasAdminSession = async (req) => {
    if (!req.session?.userId) {
        return false;
    }

    const role = await getUsersRepository().getRoleById(req.session.userId);
    return role === 'admin';
};

const getMetricsRequestToken = (req) => {
    const authHeader = req.get('authorization');
    if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    const headerToken = req.get('x-metrics-token');
    if (headerToken) {
        return headerToken.trim();
    }

    if (typeof req.query?.token === 'string') {
        return req.query.token.trim();
    }

    return '';
};

const canAccessExportedMetrics = async (req) => {
    if (await hasAdminSession(req)) {
        return true;
    }

    const providedToken = getMetricsRequestToken(req);
    if (!METRICS_EXPORT_TOKEN || !providedToken) {
        return false;
    }

    return safeCompare(providedToken, METRICS_EXPORT_TOKEN);
};

registerDownloadRoutes({
    app,
    getFilesRepository,
    metrics,
    logger,
    downloadValidateLimiter,
    createDownloadToken,
    validateDownloadToken,
    bcrypt,
    requestUsesSecureCookies,
    isProduction,
});

registerFileRoutes({
    app,
    requireAuth,
    requireAdmin,
    asyncHandler,
    getFilesRepository,
    getUsersRepository,
    serializeFileForClient,
    fsPromises,
    logger,
});

registerAdminUserRoutes({
    app,
    requireAdmin,
    asyncHandler,
    getUsersRepository,
    logger,
    fsPromises,
    bcrypt,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    PASSWORD_POLICY_MESSAGE,
    generateSecureToken,
    isEmailDeliveryEnabled,
    sendTemplatedEmail,
    PUBLIC_ORIGIN,
});

registerAdminSettingsRoutes({
    app,
    requireAdmin,
    asyncHandler,
    getDb: () => db,
    getSettingsRepository,
    logger,
    resetRateLimits,
    applyAdminSettings,
    serializeAdminSettings,
    validateAdminSettingsPayload,
    invalidateSettingsCache,
    safeCompare,
    encrypt,
    decrypt,
    isEncrypted,
    getEncryptionFormat,
    mergeSmtpIntoSettings,
    getSmtpEnvironmentConfig,
    multer,
    BRANDING_DIR,
    PUBLIC_ORIGIN,
    enqueueBrandingConversion,
    fsPromises,
    handleMulterError,
    isEmailDeliveryEnabled,
    createSmtpTransporter: createSmtpTransporterBound,
    sendEmail,
});

// NOTE: cleanup-chunks endpoint is defined later in the file with cleanupOrphanedChunks function

registerPublicSettingsRoutes({
    app,
    asyncHandler,
    getSettingsRepository,
    getDefaultBrandingSettings: getDefaultBrandingSettingsBound,
    isEmailDeliveryEnabled,
    getMaxChunkSizeFromSettingsSync,
    generateFingerprint,
    getIpFingerprint,
    canGuestUpload,
});

registerHealthRoutes({
    app,
    requireAdmin,
    getDatabaseHealthRepository,
    fs,
    fsPromises,
    UPLOAD_DIR,
    dataDir,
    sessionCookieSecure,
    sessionCookieSameSite,
    sessionCookieDomain,
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

// Cleanup functions are now in lib/cleanup.js
const cleanupOrphanedChunksBound = (maxAgeMs) => cleanupOrphanedChunks(CHUNKS_DIR, maxAgeMs);

registerAdminOperationsRoutes({
    app,
    requireAdmin,
    asyncHandler,
    enqueueCleanup,
    CHUNKS_DIR,
    UPLOAD_DIR,
    cleanupOrphanedChunks: cleanupOrphanedChunksBound,
    logger,
    getQueueStats,
    getPendingJobs,
    JOB_TYPES,
    retryDeadJobs,
    cancelJob,
    buildOperationalMetrics,
    getDatabaseHealthRepository,
    getUploadSessionsRepository,
    dataDir,
    checkDiskSpace,
    fs,
    fsPromises,
    metrics,
    serializeOperationalMetricsPrometheus,
    canAccessExportedMetrics,
});

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(globalErrorHandler);

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
        settingsRepository = null;
        usersRepository = null;
        uploadSessionsRepository = null;
        filesRepository = null;
        databaseHealthRepository = null;
        resetRuntimeSettingsCache();

        // Initialize database schema/defaults and brand assets
        await initializeDatabaseDefaults({
            db,
            runMigrations,
            saveDatabase,
            logger,
            getSettingsRepository,
        });
        await seedDefaultBrandingSettings({
            getSettingsRepository,
            getDefaultBrandingSettings: getDefaultBrandingSettingsBound,
        });
        await refreshRuntimeSettingsCache({ force: true });

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

        await logDatabaseStats({
            getUsersRepository,
            getSettingsRepository,
            logger,
        });

        if (enableSchedulers) {
            startCleanupSchedulers({
                db,
                getFilesRepository,
                getUploadSessionsRepository,
                UPLOAD_DIR,
                CHUNKS_DIR,
                CHUNK_CLEANUP_MAX_AGE_HOURS: parseInt(process.env.CHUNK_CLEANUP_MAX_AGE_HOURS || '24', 10),
                DISK_WARN_PERCENT: parseInt(process.env.DISK_WARN_PERCENT || '10', 10),
                DISK_WARN_GB: parseInt(process.env.DISK_WARN_GB || '5', 10),
            });
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
