/**
 * Branding helpers
 *
 * Handles default branding file discovery and settings resolution.
 */
import fs from 'fs';
import path from 'path';

export const DEFAULT_BRANDING_FILES = {
    logoLight: 'logoLight.svg',
    logoDark: 'logoDark.svg',
    favicon: 'favicon.png',
    dropzoneIcon: 'dropzoneIcon.svg',
};

/**
 * Get default branding settings by checking which files exist on disk.
 * @param {string} BRANDING_DIR – absolute path to the branding directory
 * @returns {object}
 */
export const getDefaultBrandingSettings = (BRANDING_DIR) => {
    const defaults = {
        logoLight: '',
        logoDark: '',
        favicon: '',
        dropzoneIcon: '',
    };

    for (const [key, fileName] of Object.entries(DEFAULT_BRANDING_FILES)) {
        const filePath = path.join(BRANDING_DIR, fileName);
        if (fs.existsSync(filePath)) {
            defaults[key] = `/branding/${fileName}`;
        }
    }

    return defaults;
};
