import crypto from 'crypto';
import logger from './logger.js';
import {
    getGuestUploadTotal as getGuestUploadTotalPersistent,
    recordGuestUploadPersistent,
    canGuestUploadPersistent
} from './persistentStores.js';

/**
 * Guest upload tracking using fingerprinting
 * Tracks anonymous uploads by IP + User-Agent hash
 * 
 * Now uses SQLite for persistence:
 * - Data persists across server restarts
 * - Works with multiple replicas (shared database)
 * - Limits enforced across all instances
 */

// Fallback in-memory store (used before persistent stores are initialized)
const fallbackStore = new Map();
let usePersistentStore = false;

// Clean expired entries from fallback store every 15 minutes
setInterval(() => {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    for (const [key, data] of fallbackStore.entries()) {
        if (data.lastUpload < oneDayAgo) {
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
 * Generate a fingerprint for anonymous users
 * Uses IP address + User-Agent hash to identify users across browsers
 * @param {Request} req - Express request object
 * @returns {string} The fingerprint hash
 */
export const generateFingerprint = (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';
    const acceptLanguage = req.get('accept-language') || '';
    
    // Create fingerprint from multiple factors
    const fingerprintData = `${ip}|${userAgent}|${acceptLanguage}`;
    return crypto.createHash('sha256').update(fingerprintData).digest('hex');
};

/**
 * Get IP-only fingerprint (more aggressive deduplication)
 * @param {Request} req - Express request object
 * @returns {string} The IP-based fingerprint
 */
export const getIpFingerprint = (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    return crypto.createHash('sha256').update(ip).digest('hex');
};

/**
 * Get total uploaded bytes for a guest fingerprint
 * @param {string} fingerprint - The guest fingerprint
 * @returns {number} Total bytes uploaded
 */
export const getGuestUploadTotal = (fingerprint) => {
    if (usePersistentStore) {
        return getGuestUploadTotalPersistent(fingerprint);
    }
    const data = fallbackStore.get(fingerprint);
    return data?.totalBytes || 0;
};

/**
 * Record an upload for a guest user
 * @param {string} fingerprint - The guest fingerprint
 * @param {number} bytes - Number of bytes uploaded
 */
export const recordGuestUpload = (fingerprint, bytes) => {
    if (usePersistentStore) {
        recordGuestUploadPersistent(fingerprint, bytes);
        return;
    }
    
    const existing = fallbackStore.get(fingerprint) || { totalBytes: 0, uploads: [] };
    existing.totalBytes += bytes;
    existing.uploads.push({ bytes, timestamp: Date.now() });
    existing.lastUpload = Date.now();
    fallbackStore.set(fingerprint, existing);
    
    logger.info('Guest upload recorded', { 
        fingerprint: fingerprint.substring(0, 8) + '...', 
        bytes, 
        totalBytes: existing.totalBytes 
    });
};

/**
 * Check if guest can upload a file of given size
 * @param {string} fingerprint - The guest fingerprint
 * @param {number} fileSize - Size of file to upload
 * @param {number} limitBytes - Upload limit in bytes
 * @returns {{ allowed: boolean, remaining: number, message?: string }}
 */
export const canGuestUpload = (fingerprint, fileSize, limitBytes) => {
    if (usePersistentStore) {
        return canGuestUploadPersistent(fingerprint, fileSize, limitBytes);
    }
    
    const currentTotal = getGuestUploadTotal(fingerprint);
    const remaining = Math.max(0, limitBytes - currentTotal);
    
    if (currentTotal + fileSize > limitBytes) {
        return {
            allowed: false,
            remaining,
            message: `Has alcanzado el límite de subida para usuarios no registrados (${formatBytes(limitBytes)}). Regístrate para subir más archivos.`
        };
    }
    
    return { allowed: true, remaining: remaining - fileSize };
};

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string
 */
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get all guest upload stats (for admin)
 * @returns {Array} List of guest upload stats
 */
export const getAllGuestStats = () => {
    const stats = [];
    for (const [fingerprint, data] of fallbackStore.entries()) {
        stats.push({
            fingerprint: fingerprint.substring(0, 8) + '...',
            totalBytes: data.totalBytes,
            uploadCount: data.uploads.length,
            lastUpload: data.lastUpload
        });
    }
    return stats;
};

export default {
    generateFingerprint,
    getIpFingerprint,
    getGuestUploadTotal,
    recordGuestUpload,
    canGuestUpload,
    getAllGuestStats,
    enablePersistentStorage
};
