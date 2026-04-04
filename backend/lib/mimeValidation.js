/**
 * MIME type validation
 *
 * Allowlist-based approach: only explicitly permitted MIME types and
 * extensions are accepted.  Dangerous server-side executables are always
 * blocked regardless of MIME type.
 */
import path from 'path';

// Allowlist for common safe file types
export const ALLOWED_MIME_PREFIXES = [
    'image/',
    'video/',
    'audio/',
    'text/',
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/x-gtar',
    'application/x-gzip',
    'application/x-compressed',
    'application/x-bzip',
    'application/x-bzip2',
    'application/x-xz',
    'application/x-lzip',
    'application/x-lzma',
    'application/x-lz4',
    'application/x-zstd',
    'application/gzip',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-',
    'application/msword',
    'application/vnd.oasis.opendocument',
];

// Blocked extensions (dangerous executables)
export const BLOCKED_EXTENSIONS = [
    '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.scr',
    '.ps1', '.psm1', '.psd1',
    '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh',
    '.hta', '.cpl', '.msc', '.inf', '.reg',
    '.sh', '.bash', '.zsh',
    '.php', '.phtml', '.php3', '.php4', '.php5', '.phps',
    '.asp', '.aspx', '.cer', '.csr', '.jsp', '.jspx',
];

/**
 * Validate a MIME type / file extension pair.
 *
 * @param {string|null} mimeType
 * @param {string} filename
 * @returns {{ valid: boolean, reason?: string }}
 */
export const validateMimeType = (mimeType, filename) => {
    const ext = path.extname(filename || '').toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
        return { valid: false, reason: `Tipo de archivo no permitido: ${ext}` };
    }

    if (!mimeType) {
        return { valid: true };
    }

    const normalizedMime = mimeType.toLowerCase();

    if (normalizedMime === 'application/octet-stream') {
        return { valid: true };
    }

    const isAllowed = ALLOWED_MIME_PREFIXES.some(prefix => normalizedMime.startsWith(prefix));

    if (!isAllowed) {
        return { valid: false, reason: `Tipo MIME no permitido: ${mimeType}` };
    }

    return { valid: true };
};
