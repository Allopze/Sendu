import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initDatabase, saveDatabase, closeDatabase } from '../backend/lib/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const dbPath = path.join(rootDir, 'data', 'db.sqlite');
const UPLOADS_DIR = process.env.STORAGE_PATH || path.join(rootDir, 'uploads');
const CHUNKS_DIR = path.join(UPLOADS_DIR, 'chunks');

const cleanup = async () => {
    const db = await initDatabase(dbPath);
    console.log('Running cleanup...');
    const now = Date.now();

    // 1. Find expired files
    const expiredFiles = db.prepare('SELECT * FROM files WHERE expiresAt IS NOT NULL AND expiresAt < ?').all(now);

    // 2. Find files with max downloads reached
    const maxDownloadFiles = db.prepare('SELECT * FROM files WHERE maxDownloads IS NOT NULL AND downloadCount >= maxDownloads').all();

    const filesToDelete = [...expiredFiles, ...maxDownloadFiles];

    // Remove duplicates
    const uniqueFiles = filesToDelete.filter((file, index, self) =>
        index === self.findIndex((t) => t.id === file.id)
    );

    console.log(`Found ${uniqueFiles.length} files to delete.`);

    for (const file of uniqueFiles) {
        try {
            if (fs.existsSync(file.serverPath)) {
                fs.unlinkSync(file.serverPath);
                console.log(`Deleted file: ${file.serverPath}`);
            }

            db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
            console.log(`Deleted record: ${file.id}`);
        } catch (err) {
            console.error(`Error deleting file ${file.id}:`, err);
        }
    }

    // 3. Clean stale upload sessions (older than 24h and not completed)
    const staleThreshold = now - (24 * 60 * 60 * 1000);
    const staleSessions = db.prepare(
        "SELECT uploadId FROM upload_sessions WHERE status IN ('initiated','processing') AND createdAt < ?"
    ).all(staleThreshold);

    console.log(`Found ${staleSessions.length} stale upload sessions.`);
    for (const session of staleSessions) {
        const chunkDir = path.join(CHUNKS_DIR, session.uploadId);
        try {
            if (fs.existsSync(chunkDir)) {
                fs.rmSync(chunkDir, { recursive: true, force: true });
                console.log(`Deleted stale chunks: ${session.uploadId}`);
            }
        } catch (err) {
            console.error(`Error deleting chunks for ${session.uploadId}:`, err);
        }
        db.prepare("UPDATE upload_sessions SET status = 'failed', updatedAt = ? WHERE uploadId = ?").run(now, session.uploadId);
    }

    // 4. Clean orphaned chunk directories (no matching upload session)
    if (fs.existsSync(CHUNKS_DIR)) {
        const chunkDirs = fs.readdirSync(CHUNKS_DIR);
        for (const dir of chunkDirs) {
            const session = db.prepare('SELECT uploadId FROM upload_sessions WHERE uploadId = ?').get(dir);
            if (!session) {
                const orphanPath = path.join(CHUNKS_DIR, dir);
                try {
                    fs.rmSync(orphanPath, { recursive: true, force: true });
                    console.log(`Deleted orphan chunk dir: ${dir}`);
                } catch (err) {
                    console.error(`Error deleting orphan ${dir}:`, err);
                }
            }
        }
    }

    // 5. Clean orphaned upload files (in uploads/ but not in DB)
    if (fs.existsSync(UPLOADS_DIR)) {
        const uploadFiles = fs.readdirSync(UPLOADS_DIR).filter(f => f !== 'chunks' && !f.endsWith('.tmp'));
        for (const file of uploadFiles) {
            const row = db.prepare('SELECT id FROM files WHERE id = ? OR serverPath = ?').get(file, path.join(UPLOADS_DIR, file));
            if (!row) {
                try {
                    fs.unlinkSync(path.join(UPLOADS_DIR, file));
                    console.log(`Deleted orphan upload: ${file}`);
                } catch (err) {
                    console.error(`Error deleting orphan upload ${file}:`, err);
                }
            }
        }
    }

    // 6. Clean expired download tokens
    const expiredTokens = db.prepare('DELETE FROM download_tokens WHERE expires_at < ?').run(now);
    if (expiredTokens.changes > 0) {
        console.log(`Deleted ${expiredTokens.changes} expired download tokens.`);
    }

    console.log('Cleanup complete.');
    saveDatabase();
    closeDatabase();
};

cleanup().catch(err => {
    console.error('Cleanup error:', err);
    process.exit(1);
});
