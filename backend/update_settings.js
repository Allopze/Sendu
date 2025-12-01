import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'db.sqlite');
const db = new Database(dbPath);

const updateSettings = (showName, logoUrl) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const insertMany = db.transaction(() => {
        stmt.run('showName', showName);
        stmt.run('logoUrl', logoUrl);
    });
    insertMany();
    console.log(`Settings updated: showName=${showName}, logoUrl=${logoUrl}`);
};

// Revert to default
updateSettings('true', '');
