/**
 * Job Handlers
 * 
 * Contains the actual implementation for each job type.
 * These handlers are registered with the job queue system.
 */
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import fsPromises from 'fs/promises';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { registerJobHandler, JOB_TYPES } from './jobQueue.js';
import { summarizeEmailForLogs } from './emailLog.js';
import { createFilesRepository } from './filesRepository.js';

let db = null;
let smtpConfigGetter = null;
let filesRepository = null;

/**
 * Initialize job handlers with dependencies
 * @param {object} database - Database instance
 * @param {Function} getSmtpConfig - Function to get SMTP configuration
 */
export function initJobHandlers(database, getSmtpConfig) {
    db = database;
    smtpConfigGetter = getSmtpConfig;
    filesRepository = createFilesRepository({ db: database });
    
    // Register all handlers
    registerJobHandler(JOB_TYPES.EMAIL, handleEmailJob);
    registerJobHandler(JOB_TYPES.CLEANUP_FILES, handleFileCleanupJob);
    registerJobHandler(JOB_TYPES.CLEANUP_CHUNKS, handleChunkCleanupJob);
    registerJobHandler(JOB_TYPES.BRANDING_CONVERT, handleBrandingConvertJob);
    
    logger.info('Job handlers initialized');
}

// ============================================
// Email Handler
// ============================================

/**
 * Handle email sending job
 * @param {object} payload - Email data
 */
async function handleEmailJob(payload) {
    const { to, subject, html, from, replyTo } = payload;
    
    // Get current SMTP config
    const smtpConfig = smtpConfigGetter();
    
    if (!smtpConfig.smtpHost || !smtpConfig.smtpUser) {
        throw new Error('SMTP not configured');
    }
    
    // Create transporter
    const transporter = nodemailer.createTransport({
        host: smtpConfig.smtpHost,
        port: parseInt(smtpConfig.smtpPort) || 587,
        secure: parseInt(smtpConfig.smtpPort) === 465,
        auth: {
            user: smtpConfig.smtpUser,
            pass: smtpConfig.smtpPass,
        },
    });
    
    // Send email
    const result = await transporter.sendMail({
        from: from || smtpConfig.smtpFrom || smtpConfig.smtpUser,
        to,
        subject,
        html,
        replyTo: replyTo,
    });
    
    logger.info('Email sent via job queue', summarizeEmailForLogs({
        to,
        subject,
        messageId: result.messageId
    }));
    
    return result;
}

// ============================================
// File Cleanup Handler
// ============================================

/**
 * Handle expired file cleanup job
 * @param {object} payload - Cleanup parameters
 */
async function handleFileCleanupJob(payload) {
    const { 
        maxAgeDays = 30, // Default to 30 days for expired files
        uploadDir,
    } = payload;
    
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;

    const cleanupCandidates = await filesRepository.listCleanupCandidates(now);

    for (const file of cleanupCandidates) {
        try {
            if (file.serverPath && fs.existsSync(file.serverPath)) {
                const stats = await fsPromises.stat(file.serverPath);
                await fsPromises.unlink(file.serverPath);
                freedBytes += stats.size;
            }

            await filesRepository.deleteById(file.id);
            deletedCount++;

        } catch (err) {
            logger.warn('Error deleting cleanup candidate file', {
                fileId: file.id, 
                error: err.message 
            });
        }
    }
    
    logger.info('File cleanup job completed', { 
        deletedCount, 
        freedMB: (freedBytes / (1024 * 1024)).toFixed(2) 
    });
    
    return { deletedCount, freedBytes };
}

// ============================================
// Chunk Cleanup Handler
// ============================================

/**
 * Handle orphaned chunk cleanup job
 * @param {object} payload - Cleanup parameters
 */
async function handleChunkCleanupJob(payload) {
    const { 
        maxAgeHours = 1, // Default 1 hour for orphaned chunks
        chunksDir,
    } = payload;
    
    if (!chunksDir || !fs.existsSync(chunksDir)) {
        throw new Error('Chunks directory not specified or does not exist');
    }
    
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;
    
    const entries = await fsPromises.readdir(chunksDir, { withFileTypes: true });
    
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const chunkPath = path.join(chunksDir, entry.name);
        const metaPath = path.join(chunkPath, 'meta.json');
        
        try {
            let shouldDelete = false;
            let lastActivity = 0;
            
            // Check meta.json for creation time
            try {
                const metaContent = await fsPromises.readFile(metaPath, 'utf8');
                const meta = JSON.parse(metaContent);
                lastActivity = meta.createdAt || 0;
            } catch {
                // No meta.json, check file modification times
                const stat = await fsPromises.stat(chunkPath);
                lastActivity = stat.mtimeMs;
            }
            
            // Also check individual chunk files for recent activity
            const files = await fsPromises.readdir(chunkPath);
            for (const file of files) {
                try {
                    const fileStat = await fsPromises.stat(path.join(chunkPath, file));
                    if (fileStat.mtimeMs > lastActivity) {
                        lastActivity = fileStat.mtimeMs;
                    }
                } catch {}
            }
            
            // Delete if no activity for maxAge
            if (now - lastActivity > maxAgeMs) {
                // Calculate size before deleting
                for (const file of files) {
                    try {
                        const fileStat = await fsPromises.stat(path.join(chunkPath, file));
                        freedBytes += fileStat.size;
                    } catch {}
                }
                
                await fsPromises.rm(chunkPath, { recursive: true, force: true });
                deletedCount++;
                
                logger.debug(`Deleted orphaned chunk folder: ${entry.name}`);
            }
            
        } catch (err) {
            logger.warn('Error processing chunk folder', { 
                dir: entry.name, 
                error: err.message 
            });
        }
    }
    
    logger.info('Chunk cleanup job completed', { 
        deletedCount, 
        freedMB: (freedBytes / (1024 * 1024)).toFixed(2) 
    });
    
    return { deletedCount, freedBytes };
}

// ============================================
// Branding Conversion Handler
// ============================================

/**
 * Handle branding image conversion job
 * @param {object} payload - Conversion parameters
 */
async function handleBrandingConvertJob(payload) {
    const { 
        imagePath, 
        outputPath, 
        format = 'png',
        width,
        height,
        background,
    } = payload;
    
    if (!imagePath || !fs.existsSync(imagePath)) {
        throw new Error('Source image does not exist');
    }
    
    let pipeline = sharp(imagePath);
    
    // Resize if dimensions specified
    if (width || height) {
        pipeline = pipeline.resize(width, height, {
            fit: 'contain',
            background: background || { r: 0, g: 0, b: 0, alpha: 0 },
        });
    }
    
    // Convert format
    switch (format.toLowerCase()) {
        case 'png':
            pipeline = pipeline.png({ quality: 90 });
            break;
        case 'jpeg':
        case 'jpg':
            pipeline = pipeline.jpeg({ quality: 85 });
            break;
        case 'webp':
            pipeline = pipeline.webp({ quality: 85 });
            break;
        default:
            pipeline = pipeline.png();
    }
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        await fsPromises.mkdir(outputDir, { recursive: true });
    }
    
    // Save converted image
    await pipeline.toFile(outputPath);
    
    logger.info('Branding image converted', { 
        input: imagePath, 
        output: outputPath,
        format,
    });
    
    return { outputPath };
}

export default {
    initJobHandlers,
};
