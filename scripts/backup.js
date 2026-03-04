import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'uploads');
const brandingDir = path.join(rootDir, 'branding');
const backupsRoot = path.join(rootDir, 'backups');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(backupsRoot, `backup-${timestamp}`);

const copyDir = async (src, dest) => {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
            await fs.copyFile(srcPath, destPath);
        }
    }
};

const run = async () => {
    await fs.mkdir(backupDir, { recursive: true });

    // Safe SQLite backup using better-sqlite3 backup API
    const dbSrc = path.join(dataDir, 'db.sqlite');
    const dbDestDir = path.join(backupDir, 'data');
    const dbDest = path.join(dbDestDir, 'db.sqlite');
    await fs.mkdir(dbDestDir, { recursive: true });
    if (existsSync(dbSrc)) {
        const db = new Database(dbSrc, { readonly: true });
        db.backup(dbDest);
        db.close();
        console.log('Database backed up safely via SQLite backup API');
    } else {
        console.warn('No database file found, skipping database backup');
    }

    await copyDir(uploadsDir, path.join(backupDir, 'uploads'));
    await copyDir(brandingDir, path.join(backupDir, 'branding'));

    console.log(`Backup completed: ${backupDir}`);
};

run().catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
});
