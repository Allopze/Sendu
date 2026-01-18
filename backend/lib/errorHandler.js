import logger, { anonymizeIp, sanitizeObject } from './logger.js';

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
            error: 'Token CSRF inválido. Por favor, recarga la página e intenta de nuevo.' 
        });
    }
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
            error: 'El archivo excede el tamaño máximo permitido.' 
        });
    }
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ 
            error: 'Formato de solicitud inválido.' 
        });
    }
    
    // SQLite constraint errors
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ 
            error: 'El recurso ya existe.' 
        });
    }
    
    // Multer errors
    if (err.name === 'MulterError') {
        return res.status(400).json({ 
            error: `Error de subida: ${err.message}` 
        });
    }
    
    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? 'Error interno del servidor' 
        : err.message;
    
    res.status(statusCode).json({ 
        error: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
};

/**
 * Not found handler for unmatched routes
 */
export const notFoundHandler = (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
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
export const setupProcessErrorHandlers = (server = null) => {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Promise Rejection', {
            reason: reason instanceof Error ? reason.message : reason,
            stack: reason instanceof Error ? reason.stack : undefined
        });
        
        // In production, log and continue
        // In development, you might want to exit
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
    
    // Handle SIGTERM for graceful shutdown
    process.on('SIGTERM', () => {
        logger.info('SIGTERM received, shutting down gracefully');
        
        if (server) {
            server.close(() => {
                logger.info('Server closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });
    
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
        logger.info('SIGINT received, shutting down gracefully');
        
        if (server) {
            server.close(() => {
                logger.info('Server closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });
};

export default {
    globalErrorHandler,
    notFoundHandler,
    asyncHandler,
    AppError,
    setupProcessErrorHandlers
};
