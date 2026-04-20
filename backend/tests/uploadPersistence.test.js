import { afterEach, describe, expect, it, vi } from 'vitest';

const LARGE_UPLOAD_FALLBACK_LIMIT_BYTES = 256 * 1024 * 1024;

const loadUploadPersistence = async () => {
    vi.resetModules();
    return import('../../frontend/src/lib/uploadPersistence.js');
};

const createFileBlob = ({ content = 'upload-data', name = 'upload.bin', type = 'application/octet-stream' } = {}) => {
    const blob = new Blob([content], { type });
    Object.defineProperties(blob, {
        name: {
            value: name,
            configurable: true
        },
        lastModified: {
            value: 1710000000000,
            configurable: true
        }
    });
    return blob;
};

const createLargeFileBlob = () => {
    class LargeBlob extends Blob {
        get size() {
            return LARGE_UPLOAD_FALLBACK_LIMIT_BYTES + 1;
        }
    }

    const blob = new LargeBlob(['x'], { type: 'application/octet-stream' });
    Object.defineProperties(blob, {
        name: {
            value: 'large-upload.bin',
            configurable: true
        },
        lastModified: {
            value: 1710000000000,
            configurable: true
        }
    });
    return blob;
};

const createOpfsMocks = () => {
    const writes = [];
    const getDirectory = vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockResolvedValue({
            getFileHandle: vi.fn().mockImplementation(async () => ({
                createWritable: async () => ({
                    write: vi.fn().mockImplementation(async (value) => {
                        writes.push(value);
                    }),
                    close: vi.fn().mockResolvedValue(undefined)
                })
            }))
        })
    });

    return {
        writes,
        navigator: {
            storage: {
                getDirectory
            }
        }
    };
};

const createIndexedDbMock = ({ shouldSucceed = true } = {}) => {
    const putSpy = vi.fn();
    const open = vi.fn(() => {
        const request = {};
        const tx = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
            objectStore: () => ({
                put: (...args) => {
                    putSpy(...args);
                    const putRequest = {};
                    queueMicrotask(() => {
                        if (shouldSucceed) {
                            putRequest.onsuccess?.();
                            tx.oncomplete?.();
                            return;
                        }

                        const error = new Error('put failed');
                        putRequest.error = error;
                        tx.error = error;
                        putRequest.onerror?.();
                        tx.onerror?.();
                    });
                    return putRequest;
                }
            })
        };

        const db = {
            objectStoreNames: {
                contains: () => true
            },
            transaction: () => tx,
            close: vi.fn()
        };

        queueMicrotask(() => {
            request.result = db;
            request.onsuccess?.();
        });

        return request;
    });

    return {
        open,
        putSpy
    };
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('uploadPersistence', () => {
    it('uses OPFS first and skips IndexedDB/Cache when OPFS succeeds', async () => {
        const opfs = createOpfsMocks();
        const indexedDb = createIndexedDbMock({ shouldSucceed: true });
        const cachesOpen = vi.fn();

        vi.stubGlobal('navigator', opfs.navigator);
        vi.stubGlobal('indexedDB', { open: indexedDb.open });
        vi.stubGlobal('caches', { open: cachesOpen });

        const { savePersistedUpload } = await loadUploadPersistence();
        const result = await savePersistedUpload({
            uploadId: 'upload-opfs',
            file: createFileBlob(),
            state: { fileName: 'upload.bin' }
        });

        expect(result).toBe(true);
        expect(opfs.navigator.storage.getDirectory).toHaveBeenCalledOnce();
        expect(indexedDb.open).not.toHaveBeenCalled();
        expect(cachesOpen).not.toHaveBeenCalled();
        expect(opfs.writes).toHaveLength(2);
    });

    it('falls back to IndexedDB and skips Cache when OPFS is unavailable', async () => {
        const indexedDb = createIndexedDbMock({ shouldSucceed: true });
        const cachesOpen = vi.fn();

        vi.stubGlobal('indexedDB', { open: indexedDb.open });
        vi.stubGlobal('caches', { open: cachesOpen });

        const { savePersistedUpload } = await loadUploadPersistence();
        const result = await savePersistedUpload({
            uploadId: 'upload-indexeddb',
            file: createFileBlob(),
            state: { fileName: 'upload.bin' }
        });

        expect(result).toBe(true);
        expect(indexedDb.open).toHaveBeenCalledOnce();
        expect(indexedDb.putSpy).toHaveBeenCalledOnce();
        expect(cachesOpen).not.toHaveBeenCalled();
    });

    it('uses Cache as the last fallback when IndexedDB fails', async () => {
        const indexedDb = createIndexedDbMock({ shouldSucceed: false });
        const cachePut = vi.fn().mockResolvedValue(undefined);
        const cachesOpen = vi.fn().mockResolvedValue({ put: cachePut });

        vi.stubGlobal('indexedDB', { open: indexedDb.open });
        vi.stubGlobal('caches', { open: cachesOpen });

        const { savePersistedUpload } = await loadUploadPersistence();
        const result = await savePersistedUpload({
            uploadId: 'upload-cache',
            file: createFileBlob(),
            state: { fileName: 'upload.bin' }
        });

        expect(result).toBe(true);
        expect(indexedDb.open).toHaveBeenCalledOnce();
        expect(cachesOpen).toHaveBeenCalledOnce();
        expect(cachePut).toHaveBeenCalledOnce();
    });

    it('does not try IndexedDB or Cache for very large uploads when OPFS is unavailable', async () => {
        const indexedDb = createIndexedDbMock({ shouldSucceed: true });
        const cachesOpen = vi.fn();

        vi.stubGlobal('indexedDB', { open: indexedDb.open });
        vi.stubGlobal('caches', { open: cachesOpen });

        const { savePersistedUpload } = await loadUploadPersistence();
        const result = await savePersistedUpload({
            uploadId: 'upload-large',
            file: createLargeFileBlob(),
            state: { fileName: 'large-upload.bin' }
        });

        expect(result).toBe(false);
        expect(indexedDb.open).not.toHaveBeenCalled();
        expect(cachesOpen).not.toHaveBeenCalled();
    });
});
