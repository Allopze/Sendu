import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import FileList from '../components/dashboard/FileList';
import StatsCards from '../components/dashboard/StatsCards';
import ConfirmModal from '../components/ui/ConfirmModal';
import { Loader2 } from 'lucide-react';

const DashboardPage = () => {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ fileCount: 0, totalSize: 0, totalDownloads: 0 });
    const [deleteModal, setDeleteModal] = useState({ isOpen: false, fileId: null, fileName: '' });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const res = await apiClient.getUserFiles();
            if (res.ok) {
                const data = await res.json();
                setFiles(data.files);

                // Calculate stats locally
                const totalSize = data.files.reduce((acc, file) => acc + file.size, 0);
                const totalDownloads = data.files.reduce((acc, file) => acc + file.downloadCount, 0);
                setStats({ fileCount: data.files.length, totalSize, totalDownloads });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = (id, fileName) => {
        setDeleteModal({ isOpen: true, fileId: id, fileName });
    };

    const confirmDelete = async () => {
        await apiClient.deleteFile(deleteModal.fileId);
        setDeleteModal({ isOpen: false, fileId: null, fileName: '' });
        fetchData(); // Refresh
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <Loader2 className="animate-spin text-primary-600" size={48} />
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-3xl font-bold mb-8">Panel</h1>
            <StatsCards stats={stats} />
            <h2 className="text-xl font-bold mb-4">Tus Archivos</h2>
            <FileList files={files} onDelete={handleDelete} />
            
            <ConfirmModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, fileId: null, fileName: '' })}
                onConfirm={confirmDelete}
                title="¿Eliminar archivo?"
                message={`¿Estás seguro de que quieres eliminar "${deleteModal.fileName}"? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                variant="danger"
            />
        </div>
    );
};

export default DashboardPage;
