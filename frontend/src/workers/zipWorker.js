import { ZipWriter } from '@zip.js/zip.js';

const getZipName = (files) => {
    if (files.length === 1 && !files[0].path.includes('/')) {
        return files[0].name || 'archivo.zip';
    }

    const paths = files.map((file) => file.path);
    const firstPath = paths[0] || '';
    if (firstPath.includes('/')) {
        const rootFolder = firstPath.split('/')[0];
        if (rootFolder && paths.every((path) => path.startsWith(`${rootFolder}/`))) {
            return `${rootFolder}.zip`;
        }
    }

    return 'archivos.zip';
};

let pendingChunkAck = null;
let cancelled = false;

const waitForChunkAck = () => new Promise((resolve) => {
    pendingChunkAck = resolve;
});

const acknowledgeChunk = () => {
    if (pendingChunkAck) {
        pendingChunkAck();
        pendingChunkAck = null;
    }
};

const createTrackedReadable = (source, totalBytes, processedBytesRef, emitProgress) => source.stream().pipeThrough(new TransformStream({
    transform(chunk, controller) {
        const chunkSize = chunk?.byteLength || chunk?.length || 0;
        processedBytesRef.entryBytes += chunkSize;
        controller.enqueue(chunk);

        if (totalBytes > 0) {
            emitProgress(((processedBytesRef.processedBytes + processedBytesRef.entryBytes) / totalBytes) * 95);
        }
    }
}));

const ensureSourceBlob = (file) => {
    const source = file.file || file.blob || null;
    if (!(source instanceof Blob)) {
        throw new Error(`No hay contenido disponible para ${file.path}`);
    }
    return source;
};

const createZipBlob = async (files) => {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('No hay archivos para comprimir');
    }

    const totalBytes = files.reduce((sum, file) => sum + Number(file.file?.size || file.size || 0), 0);
    const zipStream = new TransformStream();
    const zipBlobPromise = new Response(zipStream.readable).blob();
    const zipWriter = new ZipWriter(zipStream.writable);
    const processedBytesRef = {
        processedBytes: 0,
        entryBytes: 0
    };

    const emitProgress = (value) => {
        self.postMessage({
            type: 'progress',
            progress: Math.max(0, Math.min(99, Math.round(value)))
        });
    };

    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const source = ensureSourceBlob(file);
        const fileSize = Number(source.size) || 0;
        processedBytesRef.entryBytes = 0;

        const trackedReadable = createTrackedReadable(source, totalBytes, processedBytesRef, emitProgress);
        await zipWriter.add(file.path, trackedReadable);
        processedBytesRef.processedBytes += fileSize;

        if (totalBytes > 0) {
            emitProgress((processedBytesRef.processedBytes / totalBytes) * 95);
        } else {
            emitProgress(((i + 1) / files.length) * 95);
        }
    }

    await zipWriter.close();
    return {
        blob: await zipBlobPromise,
        zipName: getZipName(files)
    };
};

const streamZip = async (files) => {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('No hay archivos para comprimir');
    }

    cancelled = false;
    pendingChunkAck = null;

    const totalBytes = files.reduce((sum, file) => sum + Number(file.file?.size || file.size || 0), 0);
    const zipStream = new TransformStream();
    const zipWriter = new ZipWriter(zipStream.writable);
    const processedBytesRef = {
        processedBytes: 0,
        entryBytes: 0
    };
    const zipName = getZipName(files);
    let emittedBytes = 0;

    const emitProgress = (value) => {
        self.postMessage({
            type: 'progress',
            progress: Math.max(0, Math.min(99, Math.round(value)))
        });
    };

    const reader = zipStream.readable.getReader();
    const pumpZipOutput = (async () => {
        while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunkBytes = value?.byteLength || 0;
            emittedBytes += chunkBytes;
            const transferable = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            self.postMessage({
                type: 'stream-chunk',
                chunk: transferable,
                chunkBytes,
                zipName
            }, [transferable]);
            await waitForChunkAck();
        }
    })();

    for (let i = 0; i < files.length; i += 1) {
        if (cancelled) {
            throw new Error('Compresión cancelada');
        }

        const file = files[i];
        const source = ensureSourceBlob(file);
        const fileSize = Number(source.size) || 0;
        processedBytesRef.entryBytes = 0;

        const trackedReadable = createTrackedReadable(source, totalBytes, processedBytesRef, emitProgress);
        await zipWriter.add(file.path, trackedReadable);
        processedBytesRef.processedBytes += fileSize;

        if (totalBytes > 0) {
            emitProgress((processedBytesRef.processedBytes / totalBytes) * 95);
        } else {
            emitProgress(((i + 1) / files.length) * 95);
        }
    }

    await zipWriter.close();
    await pumpZipOutput;
    self.postMessage({
        type: 'stream-complete',
        zipName,
        actualSize: emittedBytes
    });
};

self.onmessage = async (event) => {
    const { files, mode = 'blob', type } = event.data || {};

    if (type === 'ack-chunk') {
        acknowledgeChunk();
        return;
    }

    if (type === 'cancel') {
        cancelled = true;
        acknowledgeChunk();
        return;
    }

    try {
        if (mode === 'stream') {
            await streamZip(files);
            return;
        }

        const { blob, zipName } = await createZipBlob(files);
        self.postMessage({
            type: 'complete',
            zipName,
            blob
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error?.message || 'No se pudo comprimir la selección'
        });
    }
};
