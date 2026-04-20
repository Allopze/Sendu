const DB_NAME = 'sendu-upload-persistence';
const DB_VERSION = 1;
const STORE_NAME = 'uploads';
const CACHE_NAME = 'sendu-upload-persistence-cache';
const OPFS_DIR_NAME = 'sendu-upload-persistence';
const LARGE_UPLOAD_FALLBACK_LIMIT_BYTES = 256 * 1024 * 1024;

const getCacheKey = (uploadId) => `/__sendu_upload_persistence__/${uploadId}`;
const getOpfsDataName = (uploadId) => `${uploadId}.bin`;
const getOpfsMetaName = (uploadId) => `${uploadId}.json`;
const getOpfsArchiveDirName = (uploadId) => `${uploadId}-archive`;
const STORAGE_TIMEOUT_MS = 3000;

const buildArchiveEntryFallbackName = (entryPath, index) => {
    const normalized = String(entryPath || '').split('/').filter(Boolean);
    return normalized[normalized.length - 1] || `entry-${index}.bin`;
};

const isArchiveEntriesPayload = (entries) => (
    Array.isArray(entries)
    && entries.length > 0
    && entries.every((entry) => entry && typeof entry.path === 'string' && entry.file instanceof Blob)
);

const getPersistencePayloadBytes = ({ file, entries }) => {
    if (file instanceof Blob) {
        return file.size || 0;
    }

    if (isArchiveEntriesPayload(entries)) {
        return entries.reduce((total, entry) => total + (entry.file?.size || 0), 0);
    }

    return 0;
};

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

const savePersistedUploadToOpfs = async ({ uploadId, file, entries, state }) => {
    if (isArchiveEntriesPayload(entries)) return false;
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

const savePersistedArchiveToOpfs = async ({ uploadId, entries, state }) => {
    if (!uploadId || !isArchiveEntriesPayload(entries)) return false;

    const directory = await getOpfsDirectory();
    if (!directory) return false;

    const archiveDirName = getOpfsArchiveDirName(uploadId);

    try {
        const archiveDirectory = await directory.getDirectoryHandle(archiveDirName, { create: true });
        const manifestEntries = [];

        for (const [index, entry] of entries.entries()) {
            const source = entry.file instanceof Blob ? entry.file : null;
            if (!source) {
                return false;
            }

            const dataName = `entry-${String(index).padStart(6, '0')}.bin`;
            const fileHandle = await archiveDirectory.getFileHandle(dataName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(source);
            await writable.close();

            manifestEntries.push({
                path: entry.path,
                dataName,
                fileName: entry.file.name || buildArchiveEntryFallbackName(entry.path, index),
                fileType: entry.file.type || 'application/octet-stream',
                lastModified: entry.file.lastModified || Date.now()
            });
        }

        const manifestHandle = await archiveDirectory.getFileHandle('manifest.json', { create: true });
        const manifestWritable = await manifestHandle.createWritable();
        await manifestWritable.write(JSON.stringify({
            kind: 'archive',
            entries: manifestEntries,
            state,
        }));
        await manifestWritable.close();

        return true;
    } catch {
        try {
            await directory.removeEntry(archiveDirName, { recursive: true });
        } catch {
            // Ignore cleanup failures
        }
        return false;
    }
};

const getPersistedArchiveFromOpfs = async (uploadId) => {
    if (!uploadId) return null;

    const directory = await getOpfsDirectory();
    if (!directory) return null;

    try {
        const archiveDirectory = await directory.getDirectoryHandle(getOpfsArchiveDirName(uploadId));
        const manifestHandle = await archiveDirectory.getFileHandle('manifest.json');
        const manifestText = await (await manifestHandle.getFile()).text();
        const manifest = JSON.parse(manifestText || '{}');

        if (manifest.kind !== 'archive' || !Array.isArray(manifest.entries)) {
            return null;
        }

        const entries = [];
        for (const [index, entry] of manifest.entries.entries()) {
            const dataHandle = await archiveDirectory.getFileHandle(entry.dataName || `entry-${String(index).padStart(6, '0')}.bin`);
            const blob = await dataHandle.getFile();
            entries.push({
                path: entry.path || buildArchiveEntryFallbackName(entry.fileName, index),
                file: new File([blob], entry.fileName || buildArchiveEntryFallbackName(entry.path, index), {
                    type: entry.fileType || 'application/octet-stream',
                    lastModified: entry.lastModified || Date.now()
                })
            });
        }

        return {
            uploadId,
            kind: 'archive',
            state: manifest.state || null,
            entries,
        };
    } catch {
        return null;
    }
};

const getPersistedUploadFromOpfs = async (uploadId) => {
    if (!uploadId) return null;

    const archivePersisted = await getPersistedArchiveFromOpfs(uploadId);
    if (archivePersisted?.entries?.length) {
        return archivePersisted;
    }

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
            kind: 'file',
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
        await directory.removeEntry(getOpfsArchiveDirName(uploadId), { recursive: true });
    } catch {
        // Ignore cleanup failures
    }

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

const savePersistedUploadToCache = async ({ uploadId, file, entries, state }) => {
    if (isArchiveEntriesPayload(entries)) return false;
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

const savePersistedUploadToIndexedDb = async ({ uploadId, file, entries, state }) => {
    if (!uploadId) return false;

    try {
        const archiveEntries = isArchiveEntriesPayload(entries)
            ? entries.map((entry, index) => ({
                path: entry.path,
                fileBlob: entry.file.slice(0, entry.file.size, entry.file.type),
                fileName: entry.file.name || buildArchiveEntryFallbackName(entry.path, index),
                fileType: entry.file.type || 'application/octet-stream',
                lastModified: entry.file.lastModified || Date.now()
            }))
            : null;
        const fileBlob = file instanceof Blob ? file.slice(0, file.size, file.type) : null;

        if (!fileBlob && !archiveEntries) {
            return false;
        }

        const stored = await withStore('readwrite', (store, resolve, reject) => {
            const request = store.put({
                uploadId,
                kind: archiveEntries ? 'archive' : 'file',
                fileBlob,
                entries: archiveEntries,
                fileName: file?.name || state?.fileName || 'upload.bin',
                fileType: file?.type || state?.fileType || '',
                lastModified: file?.lastModified || state?.lastModified || Date.now(),
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

                if (record.kind === 'archive' || Array.isArray(record.entries)) {
                    const entries = Array.isArray(record.entries)
                        ? record.entries.map((entry, index) => ({
                            path: entry.path || buildArchiveEntryFallbackName(entry.fileName, index),
                            file: entry.fileBlob
                                ? new File(
                                    [entry.fileBlob],
                                    entry.fileName || buildArchiveEntryFallbackName(entry.path, index),
                                    {
                                        type: entry.fileType || 'application/octet-stream',
                                        lastModified: entry.lastModified || Date.now()
                                    }
                                )
                                : null
                        })).filter((entry) => entry.file)
                        : [];

                    resolve({
                        uploadId: record.uploadId,
                        kind: 'archive',
                        state: record.state || null,
                        entries,
                    });
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
                    kind: 'file',
                    file
                });
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return null;
    }
};

export const savePersistedUpload = async ({ uploadId, file, entries, state }) => {
    if (!uploadId || (!file && !isArchiveEntriesPayload(entries))) return false;

    const payload = { uploadId, file, entries, state };
    const payloadBytes = getPersistencePayloadBytes(payload);
    const strategies = [
        () => (
            isArchiveEntriesPayload(entries)
                ? savePersistedArchiveToOpfs({ uploadId, entries, state })
                : savePersistedUploadToOpfs(payload)
        )
    ];

    // Avoid cloning large uploads into multiple browser storage backends. For
    // large payloads we persist only to OPFS; otherwise we try smaller
    // fallbacks one by one instead of writing the same file three times.
    if (payloadBytes > 0 && payloadBytes <= LARGE_UPLOAD_FALLBACK_LIMIT_BYTES) {
        strategies.push(
            () => savePersistedUploadToIndexedDb(payload),
            () => savePersistedUploadToCache(payload)
        );
    }

    for (const persist of strategies) {
        try {
            if (await persist()) {
                return true;
            }
        } catch {
            // Try the next available backend.
        }
    }

    return false;
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
