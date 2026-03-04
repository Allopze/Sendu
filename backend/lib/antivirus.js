/**
 * Optional antivirus scanning (ClamAV)
 * Enable with CLAMAV_ENABLED=true
 */
import { execFile } from 'child_process';
import logger from './logger.js';

const isEnabled = () => (process.env.CLAMAV_ENABLED || '').toLowerCase() === 'true';

const scanFile = (filePath) => {
    if (!isEnabled()) return Promise.resolve({ enabled: false, clean: true });

    const clamdscan = process.env.CLAMAV_BIN || 'clamdscan';
    const args = ['--no-summary', filePath];

    return new Promise((resolve, reject) => {
        execFile(clamdscan, args, { timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                const output = (stdout || stderr || '').toString();
                // ClamAV returns exit code 1 if infected
                if (error.code === 1) {
                    return resolve({ enabled: true, clean: false, output });
                }
                logger.error('Antivirus scan failed', { error: error.message, output });
                return reject(new Error('Antivirus scan failed'));
            }
            return resolve({ enabled: true, clean: true });
        });
    });
};

export const antivirus = { scanFile, isEnabled };
export default antivirus;
