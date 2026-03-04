/**
 * Minimal in-memory metrics collector with optional file persistence
 * Counters survive restarts via periodic snapshots to data/metrics.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '../..');
const dataDir = process.env.APP_DATA_PATH || process.env.DATA_PATH || path.join(rootDir, 'data');
const METRICS_FILE = path.join(dataDir, 'metrics.json');

const counters = new Map();
const startedAt = Date.now();
let snapshotTimer = null;

// Restore counters from disk on startup
const restoreSnapshot = () => {
    try {
        if (fs.existsSync(METRICS_FILE)) {
            const data = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
            if (data && typeof data.counters === 'object') {
                for (const [key, value] of Object.entries(data.counters)) {
                    if (typeof value === 'number') counters.set(key, value);
                }
            }
        }
    } catch {
        // Ignore corrupt/missing file — start fresh
    }
};

// Save counters to disk
const saveSnapshot = () => {
    try {
        const data = { savedAt: Date.now(), counters: Object.fromEntries(counters) };
        fs.writeFileSync(METRICS_FILE, JSON.stringify(data), 'utf8');
    } catch {
        // Non-critical — swallow errors
    }
};

restoreSnapshot();

const increment = (name, value = 1) => {
    const current = counters.get(name) || 0;
    counters.set(name, current + value);
};

const getSnapshot = () => {
    const data = {};
    for (const [key, value] of counters.entries()) {
        data[key] = value;
    }
    return {
        startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: Date.now(),
        counters: data
    };
};

// Start periodic save (every 5 minutes)
const startPeriodicSave = () => {
    if (snapshotTimer) return;
    snapshotTimer = setInterval(saveSnapshot, 5 * 60 * 1000);
    snapshotTimer.unref(); // Don't block process exit
};

startPeriodicSave();

export const metrics = {
    increment,
    getSnapshot,
    saveSnapshot  // Called during graceful shutdown
};

export default metrics;
