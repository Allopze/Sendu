import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'uploads');
const brandingDir = path.join(rootDir, 'branding');

const backupDir = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!backupDir) {
    console.error('Usage: node scripts/restore.js <backupDir>');
    process.exit(1);
}

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
    await copyDir(path.join(backupDir, 'data'), dataDir);
    await copyDir(path.join(backupDir, 'uploads'), uploadsDir);
    await copyDir(path.join(backupDir, 'branding'), brandingDir);

    console.log('Restore completed');
};

run().catch((err) => {
    console.error('Restore failed:', err.message);
    process.exit(1);
});
