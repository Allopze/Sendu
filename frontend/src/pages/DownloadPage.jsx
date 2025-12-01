import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/client';
import FileInfo from '../components/download/FileInfo';
import PasswordForm from '../components/download/PasswordForm';
import { Loader2, AlertCircle } from 'lucide-react';

const DownloadPage = () => {
    const { id } = useParams();
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [passwordError, setPasswordError] = useState(null);

    useEffect(() => {
        const fetchMeta = async () => {
            try {
                const res = await apiClient.getFileMeta(id);
                if (res.ok) {
                    const data = await res.json();
                    setFile(data);
                } else {
                    const err = await res.json();
                    setError(err.error || 'Archivo no encontrado');
                }
            } catch (err) {
                setError('Error al cargar información del archivo');
            } finally {
                setLoading(false);
            }
        };

        fetchMeta();
    }, [id]);

    const handleDownload = async (password = null) => {
        setPasswordError(null);
        try {
            const res = await apiClient.downloadFile(id, password);

            if (res.ok) {
                // Trigger download
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.originalName;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                const err = await res.json();
                setPasswordError(err.error || 'Error en la descarga');
            }
        } catch (err) {
            setPasswordError('Error en la descarga');
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <Loader2 className="animate-spin text-primary-600" size={48} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="max-w-md mx-auto mt-20 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full mb-6">
                    <AlertCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold mb-2">¡Vaya!</h2>
                <p className="text-gray-500">{error}</p>
            </div>
        );
    }

    return (
        <div className="mt-10">
            {file.hasPassword ? (
                <PasswordForm file={file} onSubmit={handleDownload} error={passwordError} />
            ) : (
                <FileInfo file={file} onDownload={() => handleDownload()} />
            )}
        </div>
    );
};

export default DownloadPage;
