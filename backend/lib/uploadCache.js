/**
 * Caché en memoria para datos de upload por uploadId
 * Evita lecturas repetidas de BD y disco por cada fragmento
 */

// Map de uploadId -> { meta, chunkSize, createdAt }
const uploadCache = new Map();

// TTL: 2 horas (uploads abandonados se limpian)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// Limpieza periódica cada 10 minutos
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Obtener datos cacheados para un uploadId
 * @param {string} uploadId 
 * @returns {object|null}
 */
export const getCachedUpload = (uploadId) => {
    const cached = uploadCache.get(uploadId);
    if (!cached) return null;
    
    // Verificar TTL
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
        uploadCache.delete(uploadId);
        return null;
    }
    
    return cached;
};

/**
 * Guardar datos en caché para un uploadId
 * @param {string} uploadId 
 * @param {object} data - { meta, maxChunkSize }
 */
export const setCachedUpload = (uploadId, data) => {
    uploadCache.set(uploadId, {
        ...data,
        cachedAt: Date.now()
    });
};

/**
 * Invalidar caché para un uploadId (al completar o cancelar)
 * @param {string} uploadId 
 */
export const invalidateUploadCache = (uploadId) => {
    uploadCache.delete(uploadId);
};

/**
 * Limpiar entradas expiradas
 */
const cleanupExpiredEntries = () => {
    const now = Date.now();
    for (const [uploadId, data] of uploadCache.entries()) {
        if (now - data.cachedAt > CACHE_TTL_MS) {
            uploadCache.delete(uploadId);
        }
    }
};

// Iniciar limpieza periódica
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);

// Exportar tamaño de caché para monitoreo
export const getCacheSize = () => uploadCache.size;
