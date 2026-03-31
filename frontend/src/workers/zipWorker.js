import JSZip from 'jszip';

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

self.onmessage = async (event) => {
    const { files } = event.data || {};
    if (!Array.isArray(files) || files.length === 0) {
        self.postMessage({ type: 'error', error: 'No hay archivos para comprimir' });
        return;
    }

    try {
        const zip = new JSZip();

        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            zip.file(file.path, file.buffer, {
                binary: true,
                date: new Date(file.lastModified || Date.now())
            });
            self.postMessage({
                type: 'progress',
                progress: Math.round(((i + 1) / files.length) * 50)
            });
        }

        const buffer = await zip.generateAsync(
            {
                type: 'arraybuffer',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            },
            (metadata) => {
                self.postMessage({
                    type: 'progress',
                    progress: 50 + Math.round(metadata.percent / 2)
                });
            }
        );

        self.postMessage(
            {
                type: 'complete',
                zipName: getZipName(files),
                buffer
            },
            [buffer]
        );
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error?.message || 'No se pudo comprimir la selección'
        });
    }
};
