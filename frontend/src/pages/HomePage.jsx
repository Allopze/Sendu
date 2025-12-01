import { useState } from 'react';
import DropZone from '../components/upload/DropZone';
import UploadProgress from '../components/upload/UploadProgress';
import UploadResult from '../components/upload/UploadResult';
import useUpload from '../hooks/useUpload';

const HomePage = () => {
    const [file, setFile] = useState(null);
    const [options, setOptions] = useState({ expires: '7', password: '' });
    const { progress, status, error, result, uploadFile, cancelUpload, resetUpload } = useUpload();

    const handleFileSelect = (selectedFile) => {
        setFile(selectedFile);
        uploadFile(selectedFile, options);
    };

    const handleCancel = () => {
        cancelUpload();
        setFile(null);
    };

    const handleReset = () => {
        resetUpload();
        setFile(null);
    };

    return (
        <div className="max-w-5xl mx-auto pt-10 px-4 relative z-10">
            <div className="text-center mb-10">
                <h1 className="text-6xl md:text-8xl mb-4 tracking-tighter font-[Poppins]">
                    <span className="text-[#222222] dark:text-[#e0e0e0] font-normal">Send</span>
                    <span className="text-[#fd3f31] font-bold">u</span>
                </h1>
            </div>

            {status === 'idle' && (
                <DropZone
                    onFileSelect={handleFileSelect}
                    options={options}
                    setOptions={setOptions}
                />
            )}

            {status === 'uploading' && file && (
                <UploadProgress
                    file={file}
                    progress={progress}
                    onCancel={handleCancel}
                />
            )}

            {status === 'complete' && result && (
                <UploadResult fileId={result.fileId} />
            )}

            {status === 'error' && (
                <div className="glass p-6 rounded-xl mt-6 text-center border-red-200 dark:border-red-900/30">
                    <p className="text-red-500 font-bold mb-2">Error en la subida</p>
                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">{error}</p>
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        Intentar de nuevo
                    </button>
                </div>
            )}
        </div>
    );
};

export default HomePage;
