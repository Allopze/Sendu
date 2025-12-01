import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'db.sqlite');
const db = new Database(dbPath);

const username = process.argv[2];

if (!username) {
    console.error('Please provide a username');
    process.exit(1);
}

const stmt = db.prepare('UPDATE users SET role = ? WHERE username = ?');
const info = stmt.run('admin', username);

if (info.changes > 0) {
    console.log(`User ${username} is now an admin.`);
} else {
    console.log(`User ${username} not found.`);
}
