import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, saveDatabase, closeDatabase } from './lib/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'data', 'db.sqlite');

const username = process.argv[2];

if (!username) {
    console.error('Please provide a username');
    process.exit(1);
}

const run = async () => {
    const db = await initDatabase(dbPath);
    
    const stmt = db.prepare('UPDATE users SET role = ? WHERE username = ?');
    const info = stmt.run('admin', username);

    if (info.changes > 0) {
        console.log(`User ${username} is now an admin.`);
    } else {
        console.log(`User ${username} not found.`);
    }
    
    saveDatabase();
    closeDatabase();
};

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
