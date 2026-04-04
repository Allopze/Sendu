import { X, FileText, FileImage, FileVideo, FileAudio, FileArchive, FileCode } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

const renderFileIcon = (fileName, props) => {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'json', 'xml'];

  if (imageExts.includes(ext)) return <FileImage {...props} />;
  if (videoExts.includes(ext)) return <FileVideo {...props} />;
  if (audioExts.includes(ext)) return <FileAudio {...props} />;
  if (archiveExts.includes(ext)) return <FileArchive {...props} />;
  if (codeExts.includes(ext)) return <FileCode {...props} />;
  return <FileText {...props} />;
};

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
};

const FileItem = ({ name, size, onDelete }) => {
  const { isDark } = useTheme();
  const displaySize = typeof size === 'number' ? formatSize(size) : size;
  
  return (
    <div className={`
      group flex items-center justify-between p-3 rounded-xl mb-2 transition-all duration-300
      ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-zinc-50 hover:bg-white hover:shadow-md'}
      border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700
    `}>
      <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
        <div className={`p-2 rounded-xl flex-shrink-0 ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'} text-zinc-500`}>
          {renderFileIcon(name, { size: 18 })}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className={`text-sm font-medium truncate ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>
            {name}
          </span>
          <span className="text-xs text-zinc-500">{displaySize}</span>
        </div>
      </div>
      {onDelete && (
        <button 
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-red-500/10 hover:text-red-500 text-zinc-400 transition-all flex-shrink-0 ml-2"
          aria-label={`Eliminar ${name}`}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export default FileItem;
