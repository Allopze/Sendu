const DB_NAME = 'sendu-upload-persistence';
const DB_VERSION = 1;
const STORE_NAME = 'uploads';
const CACHE_NAME = 'sendu-upload-persistence-cache';
const OPFS_DIR_NAME = 'sendu-upload-persistence';

const getCacheKey = (uploadId) => `/__sendu_upload_persistence__/${uploadId}`;
const getOpfsDataName = (uploadId) => `${uploadId}.bin`;
const getOpfsMetaName = (uploadId) => `${uploadId}.json`;
const STORAGE_TIMEOUT_MS = 3000;

const canUseOpfs = () => (
    typeof navigator !== 'undefined'
    && typeof navigator.storage?.getDirectory === 'function'
);

const getOpfsDirectory = async () => {
    if (!canUseOpfs()) return null;

    try {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    } catch {
        return null;
    }
};

const openDb = () => {
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'uploadId' });
            }
        };
    });
};

const withStore = async (mode, callback) => {
    const db = await openDb();
    if (!db) return null;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);

        tx.oncomplete = () => {
            db.close();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error);
        };

        callback(store, resolve, reject);
    });
};

const withTimeout = async (promise, timeoutMs = STORAGE_TIMEOUT_MS) => {
    let timeoutId = null;

    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve(null), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
};

const savePersistedUploadToOpfs = async ({ uploadId, file, state }) => {
    if (!uploadId || !(file instanceof Blob)) return false;

    const directory = await getOpfsDirectory();
    if (!directory) return false;

    try {
        const dataHandle = await directory.getFileHandle(getOpfsDataName(uploadId), { create: true });
        const writable = await dataHandle.createWritable();
        await writable.write(file);
        await writable.close();

        const metadata = {
            fileName: file.name || state?.fileName || 'upload.bin',
            fileType: file.type || state?.fileType || 'application/octet-stream',
            lastModified: file.lastModified || state?.lastModified || Date.now()
        };
        const metaHandle = await directory.getFileHandle(getOpfsMetaName(uploadId), { create: true });
        const metaWritable = await metaHandle.createWritable();
        await metaWritable.write(JSON.stringify(metadata));
        await metaWritable.close();

        return true;
    } catch {
        return false;
    }
};

const getPersistedUploadFromOpfs = async (uploadId) => {
    if (!uploadId) return null;

    const directory = await getOpfsDirectory();
    if (!directory) return null;

    try {
        const dataHandle = await directory.getFileHandle(getOpfsDataName(uploadId));
        const metaHandle = await directory.getFileHandle(getOpfsMetaName(uploadId));
        const [fileBlob, metaText] = await Promise.all([
            dataHandle.getFile(),
            metaHandle.getFile().then((file) => file.text())
        ]);
        const metadata = JSON.parse(metaText);

        return {
            uploadId,
            file: new File([fileBlob], metadata.fileName || 'upload.bin', {
                type: metadata.fileType || 'application/octet-stream',
                lastModified: metadata.lastModified || Date.now()
            })
        };
    } catch {
        return null;
    }
};

const deletePersistedUploadFromOpfs = async (uploadId) => {
    if (!uploadId) return;

    const directory = await getOpfsDirectory();
    if (!directory) return;

    try {
        await directory.removeEntry(getOpfsDataName(uploadId));
    } catch {
        // Ignore cleanup failures
    }

    try {
        await directory.removeEntry(getOpfsMetaName(uploadId));
    } catch {
        // Ignore cleanup failures
    }
};

const savePersistedUploadToCache = async ({ uploadId, file, state }) => {
    if (typeof caches === 'undefined' || !uploadId || !file) return false;

    try {
        const cache = await caches.open(CACHE_NAME);
        const fileBlob = file instanceof Blob ? file.slice(0, file.size, file.type) : null;
        if (!fileBlob) return false;

        const response = new Response(fileBlob, {
            headers: {
                'content-type': file.type || state?.fileType || 'application/octet-stream',
                'x-file-name': encodeURIComponent(file.name || state?.fileName || 'upload.bin'),
                'x-last-modified': String(file.lastModified || state?.lastModified || Date.now())
            }
        });

        await cache.put(getCacheKey(uploadId), response);
        return true;
    } catch {
        return false;
    }
};

const getPersistedUploadFromCache = async (uploadId) => {
    if (typeof caches === 'undefined' || !uploadId) return null;

    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(getCacheKey(uploadId));
        if (!response) return null;

        const blob = await response.blob();
        const fileName = decodeURIComponent(response.headers.get('x-file-name') || 'upload.bin');
        const fileType = response.headers.get('content-type') || 'application/octet-stream';
        const lastModified = parseInt(response.headers.get('x-last-modified') || `${Date.now()}`, 10);

        return {
            uploadId,
            file: new File([blob], fileName, {
                type: fileType,
                lastModified: Number.isFinite(lastModified) ? lastModified : Date.now()
            })
        };
    } catch {
        return null;
    }
};

const deletePersistedUploadFromCache = async (uploadId) => {
    if (typeof caches === 'undefined' || !uploadId) return;

    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(getCacheKey(uploadId));
    } catch {
        // Ignore cleanup failures
    }
};

const savePersistedUploadToIndexedDb = async ({ uploadId, file, state }) => {
    if (!uploadId || !file) return false;

    try {
        const fileBlob = file instanceof Blob ? file.slice(0, file.size, file.type) : null;
        const stored = await withStore('readwrite', (store, resolve, reject) => {
            const request = store.put({
                uploadId,
                fileBlob,
                fileName: file.name || state?.fileName || 'upload.bin',
                fileType: file.type || state?.fileType || '',
                lastModified: file.lastModified || state?.lastModified || Date.now(),
                state,
                savedAt: Date.now()
            });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
        return Boolean(stored);
    } catch {
        return false;
    }
};

const getPersistedUploadFromIndexedDb = async (uploadId) => {
    if (!uploadId) return null;

    try {
        return await withStore('readonly', (store, resolve, reject) => {
            const request = store.get(uploadId);
            request.onsuccess = () => {
                const record = request.result || null;
                if (!record) {
                    resolve(null);
                    return;
                }

                const file = record.fileBlob
                    ? new File(
                        [record.fileBlob],
                        record.fileName || record.state?.fileName || 'upload.bin',
                        {
                            type: record.fileType || record.state?.fileType || '',
                            lastModified: record.lastModified || record.state?.lastModified || Date.now()
                        }
                    )
                    : null;

                resolve({
                    ...record,
                    file
                });
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return null;
    }
};

export const savePersistedUpload = async ({ uploadId, file, state }) => {
    if (!uploadId || !file) return false;

    const results = await Promise.allSettled([
        savePersistedUploadToOpfs({ uploadId, file, state }),
        savePersistedUploadToIndexedDb({ uploadId, file, state }),
        savePersistedUploadToCache({ uploadId, file, state })
    ]);

    return results.some((result) => result.status === 'fulfilled' && result.value === true);
};

export const getPersistedUpload = async (uploadId) => {
    if (!uploadId) return null;

    const opfsPersisted = await withTimeout(getPersistedUploadFromOpfs(uploadId));
    if (opfsPersisted?.file) {
        return opfsPersisted;
    }

    const indexedDbPersisted = await withTimeout(getPersistedUploadFromIndexedDb(uploadId));
    if (indexedDbPersisted?.file) {
        return indexedDbPersisted;
    }

    return withTimeout(getPersistedUploadFromCache(uploadId));
};

export const deletePersistedUpload = async (uploadId) => {
    if (!uploadId) return;

    await Promise.allSettled([
        withTimeout(deletePersistedUploadFromOpfs(uploadId)),
        withTimeout(
            withStore('readwrite', (store, resolve, reject) => {
                const request = store.delete(uploadId);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            })
        ),
        withTimeout(deletePersistedUploadFromCache(uploadId))
    ]);
};
