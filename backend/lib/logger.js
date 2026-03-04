import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { metrics } from './metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', 'logs');

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

// Define level based on environment
const level = () => {
    const env = process.env.NODE_ENV || 'development';
    return env === 'development' ? 'debug' : 'http';
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue'
};

winston.addColors(colors);

// Console format (colorized for development)
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}]: ${message}${metaStr}`;
    })
);

// File format (JSON for parsing)
const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Daily rotate transport for errors
const errorRotateTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '30d',
    format: fileFormat
});

// Daily rotate transport for all logs
const combinedRotateTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: fileFormat
});

// Create transports array
const transports = [
    // Console transport (always)
    new winston.transports.Console({
        format: consoleFormat
    })
];

// Add file transports only in production or if logs directory exists
if (process.env.NODE_ENV === 'production') {
    transports.push(errorRotateTransport, combinedRotateTransport);
}

// Create the logger
const logger = winston.createLogger({
    level: level(),
    levels,
    transports
});

// Sensitive query params to filter from logs
const SENSITIVE_PARAMS = ['token', 'resetToken', 'verifyToken', 'code', 'password', 'secret'];

// Sensitive body fields to redact in error logs
const SENSITIVE_BODY_FIELDS = ['password', 'passwordHash', 'token', 'secret', 'creditCard', 'ssn', 'email'];

/**
 * Anonymize IP address for privacy (mask last octet for IPv4, last 80 bits for IPv6)
 * @param {string} ip - IP address to anonymize
 * @returns {string} Anonymized IP
 */
const anonymizeIp = (ip) => {
    if (!ip) return 'unknown';
    
    // Handle IPv4
    if (ip.includes('.') && !ip.includes(':')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
        }
    }
    
    // Handle IPv6 (including IPv4-mapped like ::ffff:127.0.0.1)
    if (ip.includes(':')) {
        // IPv4-mapped IPv6
        if (ip.startsWith('::ffff:')) {
            const ipv4Part = ip.substring(7);
            return `::ffff:${anonymizeIp(ipv4Part)}`;
        }
        // Pure IPv6 - mask last 5 groups
        const parts = ip.split(':');
        if (parts.length >= 4) {
            return parts.slice(0, 3).join(':') + ':xxxx:xxxx:xxxx:xxxx:xxxx';
        }
    }
    
    return ip;
};

/**
 * Generate a unique request ID for correlation
 * @returns {string} Request ID
 */
const generateRequestId = () => {
    return crypto.randomBytes(8).toString('hex');
};

/**
 * Sanitize object by redacting sensitive fields
 * @param {object} obj - Object to sanitize
 * @returns {object} Sanitized object
 */
const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const sanitized = { ...obj };
    for (const field of SENSITIVE_BODY_FIELDS) {
        if (field in sanitized) {
            sanitized[field] = '[REDACTED]';
        }
    }
    return sanitized;
};

/**
 * Sanitize URL by removing sensitive query parameters
 * @param {string} url - The URL to sanitize
 * @returns {string} Sanitized URL
 */
const sanitizeUrl = (url) => {
    try {
        // Handle relative URLs by adding a dummy base
        const hasProtocol = url.startsWith('http://') || url.startsWith('https://');
        const fullUrl = hasProtocol ? url : `http://localhost${url}`;
        const urlObj = new URL(fullUrl);
        
        let modified = false;
        for (const param of SENSITIVE_PARAMS) {
            if (urlObj.searchParams.has(param)) {
                urlObj.searchParams.set(param, '[REDACTED]');
                modified = true;
            }
        }
        
        if (!modified) return url;
        
        // Return only the path + query if original was relative
        return hasProtocol ? urlObj.toString() : urlObj.pathname + urlObj.search;
    } catch {
        // If URL parsing fails, return original
        return url;
    }
};

// HTTP request logger middleware
export const httpLogger = (req, res, next) => {
    // Evitar overhead de logging en uploads de chunks (muchas peticiones rápidas)
    if (req.path && req.path.startsWith('/api/upload/chunk')) {
        return next();
    }
    const start = Date.now();
    
    // Generate and attach request ID for correlation
    const requestId = generateRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const sanitizedUrl = sanitizeUrl(req.originalUrl);
        const message = `${req.method} ${sanitizedUrl}`;
        
        const logData = {
            requestId,
            method: req.method,
            url: sanitizedUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: anonymizeIp(req.ip || req.connection?.remoteAddress),
            userAgent: req.get('user-agent')?.substring(0, 200) // Truncate long user agents
        };
        
        if (res.statusCode >= 500) {
            metrics.increment('http_5xx', 1);
            logger.error(message, logData);
        } else if (res.statusCode >= 400) {
            metrics.increment('http_4xx', 1);
            logger.warn(message, logData);
        } else {
            metrics.increment('http_2xx', 1);
            logger.http(message, logData);
        }
    });
    
    next();
};

export default logger;

// Export utilities for use in other modules
export { anonymizeIp, sanitizeObject, generateRequestId };
