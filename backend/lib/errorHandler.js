import logger, { anonymizeIp, sanitizeObject } from './logger.js';
import { closeDatabase } from './database.js';
import { metrics } from './metrics.js';

/**
 * Global error handler middleware
 * Catches all errors and returns appropriate responses
 */
export const globalErrorHandler = (err, req, res, next) => {
    // Log the error with context (sanitized)
    const errorContext = {
        requestId: req.requestId || 'unknown',
        message: err.message,
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
        path: req.path,
        method: req.method,
        ip: anonymizeIp(req.ip),
        userId: req.session?.userId || 'anonymous',
        // Don't log full user agent in errors, just first 100 chars
        userAgent: req.get('user-agent')?.substring(0, 100)
    };
    
    // Determine if it's an operational error or programming error
    if (err.isOperational) {
        logger.warn('Operational error', errorContext);
    } else {
        logger.error('Unexpected error', errorContext);
    }
    
    // Handle specific error types
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ 
            error: 'Token CSRF inválido. Por favor, recarga la página e intenta de nuevo.',
            requestId: req.requestId || null
        });
    }
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
            error: 'El archivo excede el tamaño máximo permitido.',
            requestId: req.requestId || null
        });
    }
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ 
            error: 'Formato de solicitud inválido.',
            requestId: req.requestId || null
        });
    }
    
    // SQLite constraint errors
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ 
            error: 'El recurso ya existe.',
            requestId: req.requestId || null
        });
    }
    
    // Multer errors
    if (err.name === 'MulterError') {
        return res.status(400).json({ 
            error: `Error de subida: ${err.message}`,
            requestId: req.requestId || null
        });
    }
    
    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? 'Error interno del servidor' 
        : err.message;
    
    res.status(statusCode).json({ 
        error: message,
        requestId: req.requestId || null,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
};

/**
 * Not found handler for unmatched routes
 */
export const notFoundHandler = (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        requestId: req.requestId || null
    });
};

/**
 * Async handler wrapper to catch async errors
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Custom operational error class
 */
export class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Setup process-level error handlers
 * @param {object} server - HTTP server instance (optional, for graceful shutdown)
 */
export const setupProcessErrorHandlers = (server = null, { stopJobProcessor } = {}) => {
    // Handle unhandled promise rejections
    let unhandledRejectionCount = 0;
    const MAX_UNHANDLED_REJECTIONS = 10;
    const REJECTION_WINDOW_MS = 60 * 1000; // 1 minute
    let rejectionWindowStart = Date.now();

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Promise Rejection', {
            reason: reason instanceof Error ? reason.message : reason,
            stack: reason instanceof Error ? reason.stack : undefined
        });

        // Reset counter if window has elapsed
        const now = Date.now();
        if (now - rejectionWindowStart > REJECTION_WINDOW_MS) {
            unhandledRejectionCount = 0;
            rejectionWindowStart = now;
        }
        unhandledRejectionCount++;

        // Exit if too many unhandled rejections in a short window (likely systemic failure)
        if (unhandledRejectionCount >= MAX_UNHANDLED_REJECTIONS) {
            logger.error(`${MAX_UNHANDLED_REJECTIONS} unhandled rejections in ${REJECTION_WINDOW_MS / 1000}s — exiting`);
            process.exit(1);
        }

        if (process.env.NODE_ENV !== 'production') {
            console.error('Unhandled Rejection:', reason);
        }
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception', {
            message: error.message,
            stack: error.stack
        });
        
        // Graceful shutdown
        console.error('Uncaught Exception - shutting down...');
        
        if (server) {
            server.close(() => {
                process.exit(1);
            });
            
            // Force exit after 10 seconds
            setTimeout(() => {
                process.exit(1);
            }, 10000);
        } else {
            process.exit(1);
        }
    });
    
    const gracefulShutdown = (signal) => {
        logger.info(`${signal} received, shutting down gracefully`);

        const cleanup = () => {
            try { metrics.saveSnapshot(); } catch {}
            try { if (stopJobProcessor) stopJobProcessor(); } catch {}
            try { closeDatabase(); logger.info('Database closed'); } catch {}
            process.exit(0);
        };

        if (server) {
            server.close(() => {
                logger.info('Server closed');
                cleanup();
            });
            // Force exit after 30 seconds if connections don't drain
            setTimeout(() => {
                logger.warn('Forced exit after 30 s timeout');
                process.exit(1);
            }, 30000).unref();
        } else {
            cleanup();
        }
    };

    // Handle SIGTERM for graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

export default {
    globalErrorHandler,
    notFoundHandler,
    asyncHandler,
    AppError,
    setupProcessErrorHandlers
};
