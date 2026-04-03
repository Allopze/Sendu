import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, saveDatabase, closeDatabase } from './lib/database.js';
import { createSettingsRepository } from './lib/settingsRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'data', 'db.sqlite');

const updateSettings = async (logoLightUrl) => {
    const db = await initDatabase(dbPath);
    const settingsRepository = createSettingsRepository({ db });

    await settingsRepository.upsert('logoLight', logoLightUrl);
    console.log(`Settings updated: logoLight=${logoLightUrl}`);
    
    saveDatabase();
    closeDatabase();
};

// Revert to default
updateSettings('').catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
