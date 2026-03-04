/**
 * Background Job Queue System
 * 
 * A simple but robust job queue backed by SQLite for:
 * - Email sending (with retry logic)
 * - File cleanup tasks
 * - Branding image conversion
 * - Any other async background tasks
 * 
 * Features:
 * - Persistent across restarts
 * - Retry with exponential backoff
 * - Priority support
 * - Multi-replica safe (distributed locking)
 * - Dead letter queue for failed jobs
 */
import logger from './logger.js';

let db = null;
let isProcessing = false;
let processingInterval = null;
let cleanupInterval = null;

// Job types
export const JOB_TYPES = {
    EMAIL: 'email',
    CLEANUP_FILES: 'cleanup_files',
    CLEANUP_CHUNKS: 'cleanup_chunks',
    BRANDING_CONVERT: 'branding_convert',
    THUMBNAIL_GENERATE: 'thumbnail_generate',
};

// Job statuses
const JOB_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    DEAD: 'dead', // Max retries exceeded
};

// Default configuration
const DEFAULT_CONFIG = {
    maxRetries: 3,
    retryDelayMs: 30000, // 30 seconds base delay
    processingIntervalMs: 5000, // Check for jobs every 5 seconds
    jobTimeoutMs: 60000, // 1 minute timeout per job
    cleanupAfterDays: 7, // Keep completed/dead jobs for 7 days
};

let config = { ...DEFAULT_CONFIG };

// Job handlers registry
const jobHandlers = new Map();

const isDbOpen = () => {
    if (!db) {
        return false;
    }
    if (typeof db.open === 'boolean') {
        return db.open;
    }
    return true;
};

const isDbClosedError = (err) => /database connection is not open/i.test(err?.message || '');

/**
 * Initialize the job queue system
 * @param {object} database - The database instance
 * @param {object} options - Configuration options
 */
export function initJobQueue(database, options = {}) {
    db = database;
    config = { ...DEFAULT_CONFIG, ...options };

    if (!isDbOpen()) {
        throw new Error('Job queue requires an open database connection');
    }
    
    createJobTables();
    
    // Start processing jobs
    startJobProcessor();
    
    // Cleanup old completed jobs periodically (every hour)
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }
    cleanupInterval = setInterval(cleanupOldJobs, 60 * 60 * 1000);
    
    logger.info('Job queue system initialized');
}

/**
 * Create job queue tables
 */
function createJobTables() {
    if (!isDbOpen()) {
        return;
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS job_queue (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            last_error TEXT,
            scheduled_at INTEGER NOT NULL,
            started_at INTEGER,
            completed_at INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            locked_by TEXT,
            locked_until INTEGER
        )
    `);
    
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_status ON job_queue(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_scheduled ON job_queue(scheduled_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_type ON job_queue(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_priority ON job_queue(priority DESC, scheduled_at ASC)`);
}

/**
 * Register a job handler for a specific job type
 * @param {string} type - The job type
 * @param {Function} handler - Async function to handle the job
 */
export function registerJobHandler(type, handler) {
    if (typeof handler !== 'function') {
        throw new Error(`Handler for job type '${type}' must be a function`);
    }
    jobHandlers.set(type, handler);
    logger.debug(`Registered handler for job type: ${type}`);
}

/**
 * Add a job to the queue
 * @param {string} type - The job type
 * @param {object} payload - Job data
 * @param {object} options - Job options
 * @returns {string} The job ID
 */
export function enqueueJob(type, payload, options = {}) {
    const {
        priority = 0,
        delay = 0, // Delay in milliseconds before job becomes available
        maxRetries = config.maxRetries,
    } = options;
    
    const id = generateJobId();
    const scheduledAt = Date.now() + delay;
    
    try {
        db.prepare(`
            INSERT INTO job_queue (id, type, payload, priority, max_retries, scheduled_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, type, JSON.stringify(payload), priority, maxRetries, scheduledAt);
        
        logger.debug(`Enqueued job ${id} of type ${type}`, { priority, delay });
        return id;
    } catch (err) {
        logger.error('Failed to enqueue job', { type, error: err.message });
        throw err;
    }
}

/**
 * Add an email job to the queue
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {object} options - Additional options (from, priority, etc.)
 * @returns {string} The job ID
 */
export function enqueueEmail(to, subject, html, options = {}) {
    return enqueueJob(JOB_TYPES.EMAIL, {
        to,
        subject,
        html,
        from: options.from,
        replyTo: options.replyTo,
    }, {
        priority: options.priority ?? 10, // Emails have high priority by default
        maxRetries: options.maxRetries ?? 5,
    });
}

/**
 * Add a cleanup job to the queue
 * @param {string} cleanupType - Type of cleanup (files, chunks)
 * @param {object} params - Cleanup parameters
 * @returns {string} The job ID
 */
export function enqueueCleanup(cleanupType, params = {}) {
    const type = cleanupType === 'chunks' ? JOB_TYPES.CLEANUP_CHUNKS : JOB_TYPES.CLEANUP_FILES;
    return enqueueJob(type, params, {
        priority: -10, // Low priority for cleanup tasks
    });
}

/**
 * Add a branding conversion job
 * @param {string} imagePath - Path to the image file
 * @param {string} outputPath - Path for the converted image
 * @param {object} options - Conversion options (format, size, etc.)
 * @returns {string} The job ID
 */
export function enqueueBrandingConversion(imagePath, outputPath, options = {}) {
    return enqueueJob(JOB_TYPES.BRANDING_CONVERT, {
        imagePath,
        outputPath,
        format: options.format || 'png',
        width: options.width,
        height: options.height,
        background: options.background,
    }, {
        priority: 5, // Medium priority
    });
}

/**
 * Get the next available job and lock it
 * @param {string} workerId - Unique identifier for this worker
 * @returns {object|null} The job or null if none available
 */
function acquireNextJob(workerId) {
    if (!isDbOpen()) {
        return null;
    }

    const now = Date.now();
    const lockDuration = config.jobTimeoutMs;
    
    try {
        // Find and lock the next available job in one transaction
        const job = db.prepare(`
            SELECT * FROM job_queue 
            WHERE status = 'pending' 
            AND scheduled_at <= ?
            AND (locked_until IS NULL OR locked_until < ?)
            ORDER BY priority DESC, scheduled_at ASC
            LIMIT 1
        `).get(now, now);
        
        if (!job) return null;
        
        // Try to lock it
        const result = db.prepare(`
            UPDATE job_queue 
            SET status = 'processing', 
                locked_by = ?, 
                locked_until = ?,
                started_at = ?,
                attempts = attempts + 1
            WHERE id = ? 
            AND status = 'pending'
            AND (locked_until IS NULL OR locked_until < ?)
        `).run(workerId, now + lockDuration, now, job.id, now);
        
        if (result.changes === 0) {
            // Another worker got it first
            return null;
        }
        
        return {
            ...job,
            payload: JSON.parse(job.payload),
        };
    } catch (err) {
        if (isDbClosedError(err)) {
            stopJobProcessor();
            return null;
        }
        logger.error('Error acquiring job', { error: err.message });
        return null;
    }
}

/**
 * Mark a job as completed
 * @param {string} jobId - The job ID
 */
function completeJob(jobId) {
    try {
        db.prepare(`
            UPDATE job_queue 
            SET status = 'completed', 
                completed_at = ?,
                locked_by = NULL,
                locked_until = NULL
            WHERE id = ?
        `).run(Date.now(), jobId);
    } catch (err) {
        logger.error('Error completing job', { jobId, error: err.message });
    }
}

/**
 * Mark a job as failed and schedule retry if possible
 * @param {string} jobId - The job ID
 * @param {string} error - Error message
 * @param {number} attempts - Current attempt count
 * @param {number} maxRetries - Max allowed retries
 */
function failJob(jobId, error, attempts, maxRetries) {
    const now = Date.now();
    
    try {
        if (attempts >= maxRetries) {
            // Move to dead letter queue
            db.prepare(`
                UPDATE job_queue 
                SET status = 'dead', 
                    last_error = ?,
                    completed_at = ?,
                    locked_by = NULL,
                    locked_until = NULL
                WHERE id = ?
            `).run(error, now, jobId);
            
            logger.warn(`Job ${jobId} moved to dead letter queue after ${attempts} attempts`, { error });
        } else {
            // Schedule retry with exponential backoff
            const retryDelay = config.retryDelayMs * Math.pow(2, attempts - 1);
            const nextRun = now + retryDelay;
            
            db.prepare(`
                UPDATE job_queue 
                SET status = 'pending', 
                    last_error = ?,
                    scheduled_at = ?,
                    locked_by = NULL,
                    locked_until = NULL
                WHERE id = ?
            `).run(error, nextRun, jobId);
            
            logger.debug(`Job ${jobId} scheduled for retry at ${new Date(nextRun).toISOString()}`, { 
                attempt: attempts, 
                maxRetries 
            });
        }
    } catch (err) {
        logger.error('Error failing job', { jobId, error: err.message });
    }
}

/**
 * Process the next available job
 */
async function processNextJob() {
    if (!isDbOpen()) {
        stopJobProcessor();
        return;
    }

    if (isProcessing) return;
    
    const workerId = `worker-${process.pid}-${Date.now()}`;
    const job = acquireNextJob(workerId);
    
    if (!job) return;
    
    isProcessing = true;
    
    try {
        const handler = jobHandlers.get(job.type);
        
        if (!handler) {
            throw new Error(`No handler registered for job type: ${job.type}`);
        }
        
        logger.debug(`Processing job ${job.id} of type ${job.type}`, { attempt: job.attempts });
        
        // Execute the handler with timeout
        await Promise.race([
            handler(job.payload, job),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Job timeout')), config.jobTimeoutMs)
            ),
        ]);
        
        completeJob(job.id);
        logger.debug(`Job ${job.id} completed successfully`);
        
    } catch (err) {
        logger.error(`Job ${job.id} failed`, { type: job.type, error: err.message });
        failJob(job.id, err.message, job.attempts, job.max_retries);
    } finally {
        isProcessing = false;
    }
}

/**
 * Start the job processor
 */
function startJobProcessor() {
    if (processingInterval || !isDbOpen()) return;
    
    // Reset any stale processing jobs (from crashed workers)
    try {
        db.prepare(`
            UPDATE job_queue 
            SET status = 'pending', locked_by = NULL, locked_until = NULL 
            WHERE status = 'processing' AND locked_until < ?
        `).run(Date.now());
    } catch (err) {
        if (!isDbClosedError(err)) {
            logger.error('Failed to reset stale processing jobs', { error: err.message });
        }
        return;
    }
    
    // Process jobs at regular intervals
    processingInterval = setInterval(processNextJob, config.processingIntervalMs);
    
    // Also process immediately for any pending jobs
    processNextJob();
    
    logger.info('Job processor started');
}

/**
 * Stop the job processor
 */
export function stopJobProcessor() {
    isProcessing = false;

    if (processingInterval) {
        clearInterval(processingInterval);
        processingInterval = null;
        logger.info('Job processor stopped');
    }

    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

/**
 * Clean up old completed and dead jobs
 */
function cleanupOldJobs() {
    if (!isDbOpen()) {
        return;
    }

    const cutoff = Date.now() - (config.cleanupAfterDays * 24 * 60 * 60 * 1000);
    
    try {
        const result = db.prepare(`
            DELETE FROM job_queue 
            WHERE (status = 'completed' OR status = 'dead') 
            AND completed_at < ?
        `).run(cutoff);
        
        if (result.changes > 0) {
            logger.debug(`Cleaned up ${result.changes} old jobs`);
        }
    } catch (err) {
        logger.error('Error cleaning up old jobs', { error: err.message });
    }
}

/**
 * Get job queue statistics
 * @returns {object} Queue statistics
 */
export function getQueueStats() {
    if (!isDbOpen()) {
        return { byStatus: {}, byType: {}, total: 0 };
    }

    try {
        const stats = db.prepare(`
            SELECT 
                status,
                COUNT(*) as count,
                AVG(attempts) as avg_attempts
            FROM job_queue
            GROUP BY status
        `).all();
        
        const byType = db.prepare(`
            SELECT 
                type,
                COUNT(*) as count
            FROM job_queue
            WHERE status = 'pending'
            GROUP BY type
        `).all();
        
        return {
            byStatus: stats.reduce((acc, s) => ({ ...acc, [s.status]: s.count }), {}),
            byType: byType.reduce((acc, t) => ({ ...acc, [t.type]: t.count }), {}),
            total: stats.reduce((sum, s) => sum + s.count, 0),
        };
    } catch (err) {
        logger.error('Error getting queue stats', { error: err.message });
        return { byStatus: {}, byType: {}, total: 0 };
    }
}

/**
 * Get pending jobs for a specific type
 * @param {string} type - The job type
 * @param {number} limit - Max jobs to return
 * @returns {Array} List of jobs
 */
export function getPendingJobs(type, limit = 10) {
    if (!isDbOpen()) {
        return [];
    }

    try {
        return db.prepare(`
            SELECT id, type, payload, priority, attempts, scheduled_at, created_at
            FROM job_queue
            WHERE type = ? AND status = 'pending'
            ORDER BY priority DESC, scheduled_at ASC
            LIMIT ?
        `).all(type, limit).map(job => ({
            ...job,
            payload: JSON.parse(job.payload),
        }));
    } catch (err) {
        logger.error('Error getting pending jobs', { error: err.message });
        return [];
    }
}

/**
 * Retry all dead jobs of a specific type
 * @param {string} type - The job type (optional, retries all if not specified)
 * @returns {number} Number of jobs retried
 */
export function retryDeadJobs(type = null) {
    if (!isDbOpen()) {
        return 0;
    }

    try {
        const query = type
            ? `UPDATE job_queue SET status = 'pending', attempts = 0, scheduled_at = ? WHERE status = 'dead' AND type = ?`
            : `UPDATE job_queue SET status = 'pending', attempts = 0, scheduled_at = ? WHERE status = 'dead'`;
        
        const params = type ? [Date.now(), type] : [Date.now()];
        const result = db.prepare(query).run(...params);
        
        logger.info(`Retried ${result.changes} dead jobs`, { type });
        return result.changes;
    } catch (err) {
        logger.error('Error retrying dead jobs', { error: err.message });
        return 0;
    }
}

/**
 * Cancel a pending job
 * @param {string} jobId - The job ID
 * @returns {boolean} Whether the job was cancelled
 */
export function cancelJob(jobId) {
    if (!isDbOpen()) {
        return false;
    }

    try {
        const result = db.prepare(`
            DELETE FROM job_queue WHERE id = ? AND status = 'pending'
        `).run(jobId);
        
        return result.changes > 0;
    } catch (err) {
        logger.error('Error cancelling job', { jobId, error: err.message });
        return false;
    }
}

/**
 * Generate a unique job ID
 */
function generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export default {
    initJobQueue,
    registerJobHandler,
    enqueueJob,
    enqueueEmail,
    enqueueCleanup,
    enqueueBrandingConversion,
    stopJobProcessor,
    getQueueStats,
    getPendingJobs,
    retryDeadJobs,
    cancelJob,
    JOB_TYPES,
};
