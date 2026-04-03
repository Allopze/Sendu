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
import { encrypt, decrypt, isEncrypted, getEncryptionFormat } from './lib/encryption.js';
import { hashToken, generateSecureToken } from './lib/tokenHash.js';
import { generateFingerprint, getIpFingerprint, canGuestUpload, recordGuestUpload, enablePersistentStorage as enableGuestPersistence } from './lib/guestTracking.js';
import { initPersistentStores, createSqliteSessionStore, createDownloadToken, validateDownloadToken, createRateLimitStore, resetRateLimits } from './lib/persistentStores.js';
import { globalErrorHandler, notFoundHandler, asyncHandler, setupProcessErrorHandlers } from './lib/errorHandler.js';
import { runWithLock, getCleanupIntervalWithJitter } from './lib/cleanupCoordinator.js';
import { initDatabase, saveDatabase, closeDatabase } from './lib/database.js';
import { invalidateUploadCache } from './lib/uploadCache.js';
import { createChunkRouter } from './chunkRouter.js';
import { initJobQueue, enqueueEmail, enqueueCleanup, enqueueBrandingConversion, getQueueStats, getPendingJobs, retryDeadJobs, cancelJob, stopJobProcessor, JOB_TYPES } from './lib/jobQueue.js';
import { initJobHandlers } from './lib/jobHandlers.js';
import { metrics } from './lib/metrics.js';
import { runMigrations } from './lib/migrations.js';
import { antivirus } from './lib/antivirus.js';
import { createUploadSessionToken, validateUploadSessionToken } from './lib/uploadSessionToken.js';
import { summarizeEmailForLogs } from './lib/emailLog.js';
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

const RUNTIME_SETTINGS_KEYS = [
    'largeFileChunkSize',
    'maxFileSize',
    'maxTotalSize',
    'guestUploadLimit',
    'guestMaxFileSize',
    'chunkRateLimit',
    'maxConcurrentUploads',
    'smtpHost',
    'smtpPort',
    'smtpSecure',
    'smtpUser',
    'smtpPass',
    'smtpFrom',
    'emailTemplates',
    'logoDarkEmail',
    'logoDark',
    'logoLightEmail',
    'logoLight'
];
const RUNTIME_SETTINGS_REFRESH_TTL_MS = isTest ? 0 : 30000;
let runtimeSettingsCache = {
    values: new Map(),
    refreshedAt: 0,
    dirty: true,
    refreshPromise: null,
};

const resetRuntimeSettingsCache = () => {
    runtimeSettingsCache = {
        values: new Map(),
        refreshedAt: 0,
        dirty: true,
        refreshPromise: null,
    };
};

const markRuntimeSettingsCacheStale = () => {
    runtimeSettingsCache.dirty = true;
    runtimeSettingsCache.refreshedAt = 0;
};

const getRuntimeSettingValue = (key, defaultValue = null) => {
    if (!runtimeSettingsCache.values.has(key)) {
        return defaultValue;
    }

    return runtimeSettingsCache.values.get(key);
};

const refreshRuntimeSettingsCache = async ({ force = false } = {}) => {
    if (!db) {
        return runtimeSettingsCache.values;
    }

    const now = Date.now();
    if (!force && !runtimeSettingsCache.dirty && (now - runtimeSettingsCache.refreshedAt) < RUNTIME_SETTINGS_REFRESH_TTL_MS) {
        return runtimeSettingsCache.values;
    }

    if (runtimeSettingsCache.refreshPromise) {
        return runtimeSettingsCache.refreshPromise;
    }

    runtimeSettingsCache.refreshPromise = (async () => {
        const rows = await getSettingsRepository().listByKeys(RUNTIME_SETTINGS_KEYS);
        const nextValues = new Map();

        rows.forEach((row) => {
            nextValues.set(row.key, row.value);
        });

        runtimeSettingsCache.values = nextValues;
        runtimeSettingsCache.refreshedAt = Date.now();
        runtimeSettingsCache.dirty = false;
        return runtimeSettingsCache.values;
    })()
        .catch((err) => {
            logger.warn('Runtime settings cache refresh failed', { error: err.message });
            throw err;
        })
        .finally(() => {
            runtimeSettingsCache.refreshPromise = null;
        });

    return runtimeSettingsCache.refreshPromise;
};

const ensureRuntimeSettingsLoaded = async (req, res, next) => {
    try {
        await refreshRuntimeSettingsCache();
    } catch {}

    next();
};

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Helper: Get max chunk size from settings (for validation)
// Needs to be defined before chunk router
const getMaxChunkSizeFromSettingsSync = () => {
    const configuredChunkSize = parseInt(getRuntimeSettingValue('largeFileChunkSize'), 10);
    const largeChunk = Number.isFinite(configuredChunkSize) ? configuredChunkSize : 100;
    const computed = Math.max(largeChunk * 1.2, 200) * 1024 * 1024;
    return Math.min(computed, MAX_CHUNK_UPLOAD_BYTES);
};

// Invalidate cache when settings are updated
const invalidateSettingsCache = (keys = null) => {
    markRuntimeSettingsCacheStale();
    refreshRuntimeSettingsCache({ force: true }).catch(() => {});
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
        if (!value) {
            return;
        }

        // Decrypt sensitive values
        if (sensitiveKeys.includes(key) && isEncrypted(value)) {
            try {
                storedConfig[key] = decrypt(value);
            } catch (err) {
                logger.warn('Sensitive setting decryption failed; ignoring stored value', {
                    key,
                    format: getEncryptionFormat(value),
                    error: err.message
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

// Helper: Get email templates from settings (with fallback to defaults)
const getEmailTemplates = () => {
    const serializedTemplates = getRuntimeSettingValue('emailTemplates');
    if (serializedTemplates) {
        try {
            const savedTemplates = JSON.parse(serializedTemplates);
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
    if (!isEmailDeliveryEnabled()) {
        return null;
    }

    const port = parseInt(config.smtpPort) || 587;
    const explicitSecure = typeof config.smtpSecure === 'string'
        ? config.smtpSecure.trim().toLowerCase()
        : '';
    // Puerto 465 usa SSL directo (secure: true)
    // Puerto 587 usa STARTTLS (secure: false, pero TLS se negocia)
    const secure = explicitSecure
        ? explicitSecure === 'true'
        : port === 465;

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
        logger.info('Email sent (mock mode)', summarizeEmailForLogs({ to, subject }));
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
    const smtpConfigured = isEmailDeliveryEnabled();

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
    const logoDarkEmailSetting = getRuntimeSettingValue('logoDarkEmail', '');
    const logoDarkSetting = getRuntimeSettingValue('logoDark', '');
    const logoLightEmailSetting = getRuntimeSettingValue('logoLightEmail', '');
    const logoLightSetting = getRuntimeSettingValue('logoLight', '');

    let logoUrl;
    // Priority: logoDarkEmail > logoDark > logoLightEmail > logoLight > default
    if (logoDarkEmailSetting) {
        logoUrl = ensureAbsoluteUrl(logoDarkEmailSetting);
    } else if (logoDarkSetting) {
        logoUrl = ensureAbsoluteUrl(logoDarkSetting);
    } else if (logoLightEmailSetting) {
        logoUrl = ensureAbsoluteUrl(logoLightEmailSetting);
    } else if (logoLightSetting) {
        logoUrl = ensureAbsoluteUrl(logoLightSetting);
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
        logger.warn('SMTP not configured, skipping email queue', summarizeEmailForLogs({
            to,
            subject,
            templateName
        }));
        return { queued: false, mock: true };
    }

    // Use job queue for async email sending (more reliable, with retries)
    if (options.sync) {
        // For testing or when immediate feedback is needed
        return sendEmail(to, subject, html.replace(/<[^>]*>/g, ''), html);
    }

    // Queue the email for background processing
    const jobId = await enqueueEmail(to, subject, html, {
        from: config.smtpFrom || config.smtpUser,
        priority: options.priority,
    });

    logger.debug('Email queued', summarizeEmailForLogs({
        to,
        subject,
        templateName,
        jobId
    }));
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
    createSmtpTransporter,
    sendEmail,
});

// NOTE: cleanup-chunks endpoint is defined later in the file with cleanupOrphanedChunks function

registerPublicSettingsRoutes({
    app,
    asyncHandler,
    getSettingsRepository,
    getDefaultBrandingSettings,
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

// Automatic cleanup job - runs every hour with distributed locking
const cleanupExpiredFiles = async () => {
    const now = Date.now();

    const uniqueFiles = await getFilesRepository().listCleanupCandidates(now);

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
            await getFilesRepository().deleteById(file.id);
            logger.info(`Cleanup: Deleted file ${file.id} (${file.originalName})`);
        } catch (err) {
            logger.error('Cleanup error', { fileId: file.id, error: err.message });
        }
    }
};

// Cleanup old upload sessions to prevent table growth
const cleanupUploadSessions = async () => {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    try {
        await getUploadSessionsRepository().deleteFinishedBefore(cutoff);
    } catch (err) {
        logger.warn('Cleanup upload sessions failed', { error: err.message });
    }
};

// Reconcile orphaned files between DB and disk
const reconcileOrphanedFiles = async () => {
    try {
        const dbFiles = await getFilesRepository().listStorageEntries();
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
                await getFilesRepository().deleteById(file.id);
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

registerAdminOperationsRoutes({
    app,
    requireAdmin,
    asyncHandler,
    enqueueCleanup,
    CHUNKS_DIR,
    UPLOAD_DIR,
    cleanupOrphanedChunks,
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

// Cleanup with distributed locking (safe for multi-replica)
const runCleanup = async () => {
    if (!db) return; // Skip if database not initialized yet
    const ran = await runWithLock(async () => {
        await cleanupExpiredFiles();
        await cleanupUploadSessions();
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
            getDefaultBrandingSettings,
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
