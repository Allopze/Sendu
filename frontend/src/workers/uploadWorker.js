/**
 * Web Worker para procesamiento de chunks en paralelo
 * Evita bloquear el hilo principal durante la subida de archivos grandes
 */

// Calcular hash SHA-256 de un chunk para verificación de integridad
const calculateHash = async (arrayBuffer) => {
    try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        // Si crypto.subtle no está disponible (ej: HTTP sin localhost), retornar null
        return null;
    }
};

// Preparar un chunk para subida
const prepareChunk = async (file, chunkIndex, chunkSize) => {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    // Leer como ArrayBuffer para calcular hash
    const arrayBuffer = await chunk.arrayBuffer();
    const hash = await calculateHash(arrayBuffer);
    
    return {
        chunkIndex,
        start,
        end,
        size: end - start,
        hash
    };
};

// Manejar mensajes del hilo principal
self.onmessage = async (e) => {
    const { type, payload } = e.data;
    
    switch (type) {
        case 'PREPARE_CHUNK': {
            const { file, chunkIndex, chunkSize } = payload;
            try {
                const result = await prepareChunk(file, chunkIndex, chunkSize);
                self.postMessage({ 
                    type: 'CHUNK_PREPARED', 
                    payload: result 
                });
            } catch (error) {
                self.postMessage({ 
                    type: 'ERROR', 
                    payload: { chunkIndex, error: error.message } 
                });
            }
            break;
        }
        
        case 'PREPARE_ALL_CHUNKS': {
            const { file, chunkSize, totalChunks } = payload;
            try {
                const chunks = [];
                for (let i = 0; i < totalChunks; i++) {
                    const result = await prepareChunk(file, i, chunkSize);
                    chunks.push(result);
                    // Reportar progreso de preparación
                    self.postMessage({
                        type: 'PREPARATION_PROGRESS',
                        payload: { prepared: i + 1, total: totalChunks }
                    });
                }
                self.postMessage({
                    type: 'ALL_CHUNKS_PREPARED',
                    payload: { chunks }
                });
            } catch (error) {
                self.postMessage({
                    type: 'ERROR',
                    payload: { error: error.message }
                });
            }
            break;
        }
        
        case 'CALCULATE_FILE_HASH': {
            const { file } = payload;
            try {
                // Para archivos pequeños, calcular hash completo
                if (file.size <= 100 * 1024 * 1024) { // 100MB
                    const arrayBuffer = await file.arrayBuffer();
                    const hash = await calculateHash(arrayBuffer);
                    self.postMessage({
                        type: 'FILE_HASH_CALCULATED',
                        payload: { hash }
                    });
                } else {
                    // Para archivos grandes, calcular hash solo del primer y último MB
                    const firstMB = file.slice(0, 1024 * 1024);
                    const lastMB = file.slice(-1024 * 1024);
                    const combined = new Blob([firstMB, lastMB]);
                    const arrayBuffer = await combined.arrayBuffer();
                    const hash = await calculateHash(arrayBuffer);
                    self.postMessage({
                        type: 'FILE_HASH_CALCULATED',
                        payload: { hash, partial: true }
                    });
                }
            } catch (error) {
                self.postMessage({
                    type: 'ERROR',
                    payload: { error: error.message }
                });
            }
            break;
        }
        
        default:
            self.postMessage({
                type: 'ERROR',
                payload: { error: `Unknown message type: ${type}` }
            });
    }
};
