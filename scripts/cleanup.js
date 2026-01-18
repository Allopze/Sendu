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

const cleanup = async () => {
    const db = await initDatabase(dbPath);
    console.log('Running cleanup...');
    const now = Date.now();

    // Find expired files
    const expiredFiles = db.prepare('SELECT * FROM files WHERE expiresAt IS NOT NULL AND expiresAt < ?').all(now);

    // Find files with max downloads reached
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

    console.log('Cleanup complete.');
    saveDatabase();
    closeDatabase();
};

cleanup().catch(err => {
    console.error('Cleanup error:', err);
    process.exit(1);
});
