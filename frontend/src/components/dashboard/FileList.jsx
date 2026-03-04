import FileCard from './FileCard';

const FileList = ({ files, onDelete }) => {
    if (files.length === 0) {
        return (
            <div className="text-center py-20 text-gray-500">
                <p className="text-lg">No hay archivos subidos todavía.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {files.map(file => (
                <FileCard key={file.id} file={file} onDelete={onDelete} />
            ))}
        </div>
    );
};

export default FileList;
