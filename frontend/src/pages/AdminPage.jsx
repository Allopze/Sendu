import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import {
    Loader2, Trash2, Users, FileText, Settings, Upload, X, Sun, Moon, Image,
    Mail, Send, HardDrive, FileCode, Shield, Key, Edit2, Check, CheckCircle,
    XCircle, RefreshCw, LayoutDashboard, Layout, Code
} from 'lucide-react';
import Toast from '../components/ui/Toast';
import Tooltip from '../components/ui/Tooltip';
import ConfirmModal from '../components/ui/ConfirmModal';
import Toggle from '../components/ui/Toggle';
import { useBranding } from '../context/BrandingContext';
import { useTheme } from '../context/ThemeContext';
import EmailTemplateEditor from '../components/admin/EmailTemplateEditor';

const AdminPage = () => {
    const navigate = useNavigate();
    const { updateSettings: updateBrandingContext } = useBranding();
    const { isDark } = useTheme();
    const [activeTab, setActiveTab] = useState('branding');
    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState([]);
    const [files, setFiles] = useState([]);
    const [settings, setSettings] = useState({
        logoLight: '', logoDark: '', favicon: '', dropzoneIcon: '', footerText: '',
        smtpHost: '', smtpPort: '587', smtpSecure: 'false', smtpUser: '', smtpPass: '', smtpFrom: '',
        maxFileSize: '100', maxTotalSize: '500', guestUploadLimit: '5120', guestMaxFileSize: '100', chunkSize: '20',
        maxConcurrentUploads: '10', chunkRateLimit: '1000', adaptiveChunkSizing: 'true',
        smallFileThreshold: '100', mediumFileThreshold: '1024', smallFileChunkSize: '10',
        mediumFileChunkSize: '50', largeFileChunkSize: '100', emailTemplates: ''
    });
    const [originalSettings, setOriginalSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState(null);
    const [uploading, setUploading] = useState({});
    const [testingEmail, setTestingEmail] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    const [deleteUserModal, setDeleteUserModal] = useState({ isOpen: false, userId: null, username: '' });
    const [deleteFileModal, setDeleteFileModal] = useState({ isOpen: false, fileId: null, fileName: '' });
    const [cleaningChunks, setCleaningChunks] = useState(false);
    const [resettingRateLimits, setResettingRateLimits] = useState(false);
    const [resetRateLimitModal, setResetRateLimitModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({ email: '', username: '' });
    const [resetPasswordUser, setResetPasswordUser] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const logoLightRef = useRef(null);
    const logoDarkRef = useRef(null);
    const faviconRef = useRef(null);
    const dropzoneIconRef = useRef(null);

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            const [statsRes, usersRes, filesRes, settingsRes] = await Promise.all([
                apiClient.getAdminStats(), apiClient.getAdminUsers(), apiClient.getAdminFiles(), apiClient.getAdminSettings()
            ]);
            if (statsRes.ok) setStats(await statsRes.json());
            if (usersRes.ok) setUsers((await usersRes.json()).users);
            if (filesRes.ok) setFiles((await filesRes.json()).files);
            if (settingsRes.ok) {
                const data = await settingsRes.json();
                setSettings(data);
                setOriginalSettings(data);
            }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    // Check if settings have changed
    const hasChanges = () => {
        const keysToCheck = [
            'footerText', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom',
            'maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize', 'chunkSize', 'maxConcurrentUploads',
            'chunkRateLimit', 'adaptiveChunkSizing', 'smallFileThreshold', 'mediumFileThreshold',
            'smallFileChunkSize', 'mediumFileChunkSize', 'largeFileChunkSize'
        ];
        return keysToCheck.some(key => settings[key] !== originalSettings[key]);
    };

    const handleDiscard = () => {
        setSettings({ ...originalSettings });
        navigate('/');
    };

    const handleSaveAll = async () => {
        setSaving(true);
        try {
            const settingsToSave = {
                footerText: settings.footerText,
                smtpHost: settings.smtpHost,
                smtpPort: settings.smtpPort,
                smtpSecure: settings.smtpSecure,
                smtpUser: settings.smtpUser,
                smtpPass: settings.smtpPass,
                smtpFrom: settings.smtpFrom,
                maxFileSize: settings.maxFileSize,
                maxTotalSize: settings.maxTotalSize,
                guestUploadLimit: settings.guestUploadLimit,
                guestMaxFileSize: settings.guestMaxFileSize,
                chunkSize: settings.chunkSize,
                maxConcurrentUploads: settings.maxConcurrentUploads,
                chunkRateLimit: settings.chunkRateLimit,
                adaptiveChunkSizing: settings.adaptiveChunkSizing,
                smallFileThreshold: settings.smallFileThreshold,
                mediumFileThreshold: settings.mediumFileThreshold,
                smallFileChunkSize: settings.smallFileChunkSize,
                mediumFileChunkSize: settings.mediumFileChunkSize,
                largeFileChunkSize: settings.largeFileChunkSize
            };

            await apiClient.updateAdminSettings(settingsToSave);
            setOriginalSettings({ ...settings });

            // Update branding context
            const brandingKeys = ['logoLight', 'logoDark', 'favicon', 'footerText'];
            const brandingUpdate = {};
            for (const key of brandingKeys) {
                if (settings[key] !== undefined) brandingUpdate[key] = settings[key];
            }
            if (Object.keys(brandingUpdate).length > 0) updateBrandingContext(brandingUpdate);

            setToast({ message: 'Configuración guardada', type: 'success' });
        } catch {
            setToast({ message: 'Error al guardar', type: 'error' });
        }
        finally { setSaving(false); }
    };

    const handleToggleRole = async (userId) => {
        try {
            const res = await apiClient.toggleUserRole(userId);
            if (res.ok) {
                const data = await res.json();
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: data.role } : u));
                setToast({ message: `Rol cambiado a ${data.role}`, type: 'success' });
            }
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        } catch { setToast({ message: 'Error al cambiar rol', type: 'error' }); }
    };

    const handleToggleVerified = async (userId) => {
        try {
            const res = await apiClient.toggleUserVerified(userId);
            if (res.ok) {
                const data = await res.json();
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, isVerified: data.isVerified } : u));
                setToast({ message: data.isVerified ? 'Usuario verificado' : 'Verificación removida', type: 'success' });
            }
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        } catch { setToast({ message: 'Error al cambiar verificación', type: 'error' }); }
    };

    const handleDeleteUser = async (userId) => {
        try {
            const res = await apiClient.deleteUser(userId);
            if (res.ok) {
                setUsers(prev => prev.filter(u => u.id !== userId));
                setToast({ message: 'Usuario eliminado', type: 'success' });
                fetchData();
            }
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        } catch { setToast({ message: 'Error al eliminar usuario', type: 'error' }); }
        setDeleteUserModal({ isOpen: false, userId: null, username: '' });
    };

    const handleStartEdit = (user) => {
        // Toggle: si ya está editando este usuario, cerrar
        if (editingUser === user.id) {
            setEditingUser(null);
            return;
        }
        setEditingUser(user.id);
        setEditForm({ email: user.email, username: user.username });
    };

    const handleSaveEdit = async (userId) => {
        try {
            const res = await apiClient.updateUser(userId, editForm);
            if (res.ok) {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...editForm } : u));
                setToast({ message: 'Usuario actualizado', type: 'success' });
                setEditingUser(null);
            }
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        } catch { setToast({ message: 'Error al actualizar usuario', type: 'error' }); }
    };

    const handleResetPassword = async (userId) => {
        if (!newPassword || newPassword.length < 6) {
            setToast({ message: 'La contraseña debe tener al menos 6 caracteres', type: 'error' });
            return;
        }
        try {
            const res = await apiClient.resetUserPassword(userId, newPassword);
            if (res.ok) {
                setToast({ message: 'Contraseña actualizada', type: 'success' });
                setResetPasswordUser(null);
                setNewPassword('');
            }
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        } catch { setToast({ message: 'Error al cambiar contraseña', type: 'error' }); }
    };

    const handleSendVerificationEmail = async (userId) => {
        try {
            const res = await apiClient.sendUserVerification(userId);
            if (res.ok) setToast({ message: 'Email de verificación enviado', type: 'success' });
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        }
        catch { setToast({ message: 'Error al enviar email', type: 'error' }); }
    };

    const handleSendPasswordResetEmail = async (userId) => {
        try {
            const res = await apiClient.sendUserPasswordReset(userId);
            if (res.ok) setToast({ message: 'Email de reseteo enviado', type: 'success' });
            else { const err = await res.json(); setToast({ message: err.error, type: 'error' }); }
        }
        catch { setToast({ message: 'Error al enviar email', type: 'error' }); }
    };

    const handleUploadBranding = async (type, file) => {
        if (!file) return;
        setUploading(prev => ({ ...prev, [type]: true }));
        try {
            const res = await apiClient.uploadBranding(type, file);
            if (res.ok) {
                const data = await res.json();
                setSettings(prev => ({ ...prev, [type]: data.url }));
                setOriginalSettings(prev => ({ ...prev, [type]: data.url }));
                updateBrandingContext({ [type]: data.url });
                setToast({ message: 'Archivo subido', type: 'success' });
            }
            else { const err = await res.json(); setToast({ message: err.error || 'Error', type: 'error' }); }
        } catch { setToast({ message: 'Error al subir', type: 'error' }); }
        finally { setUploading(prev => ({ ...prev, [type]: false })); }
    };

    const handleDeleteBranding = async (type) => {
        try {
            const res = await apiClient.deleteBranding(type);
            if (res.ok) {
                setSettings(prev => ({ ...prev, [type]: '' }));
                setOriginalSettings(prev => ({ ...prev, [type]: '' }));
                updateBrandingContext({ [type]: '' });
                setToast({ message: 'Eliminado', type: 'success' });
            }
        }
        catch { setToast({ message: 'Error', type: 'error' }); }
    };

    const handleTestEmail = async () => {
        if (!testEmail) { setToast({ message: 'Introduce un email', type: 'error' }); return; }
        setTestingEmail(true);
        try {
            const res = await apiClient.testEmail(testEmail);
            const data = await res.json();
            setToast({ message: res.ok ? 'Email enviado' : (data.error || 'Error'), type: res.ok ? 'success' : 'error' });
        }
        catch { setToast({ message: 'Error', type: 'error' }); }
        finally { setTestingEmail(false); }
    };

    const handleDeleteFile = async (id) => {
        try {
            await apiClient.deleteFile(id);
            fetchData();
            setToast({ message: 'Archivo eliminado', type: 'success' });
        }
        catch { setToast({ message: 'Error', type: 'error' }); }
        setDeleteFileModal({ isOpen: false, fileId: null, fileName: '' });
    };

    const handleCleanupChunks = async () => {
        setCleaningChunks(true);
        try {
            const res = await apiClient.cleanupChunks(1);
            if (res.ok) {
                const data = await res.json();
                setToast({ message: `Limpieza: ${data.deletedCount} eliminados (${data.freedMB}MB)`, type: 'success' });
                fetchData();
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        }
        catch { setToast({ message: 'Error', type: 'error' }); }
        finally { setCleaningChunks(false); }
    };

    const handleResetRateLimits = () => {
        setResetRateLimitModal(true);
    };

    const confirmResetRateLimits = async () => {
        setResettingRateLimits(true);
        try {
            const res = await apiClient.resetRateLimits('all');
            if (res.ok) {
                const data = await res.json();
                setToast({ message: `Rate limits reiniciados (${data.deleted} filas)`, type: 'success' });
            } else {
                const err = await res.json();
                setToast({ message: err.error || 'Error al reiniciar rate limits', type: 'error' });
            }
        } catch {
            setToast({ message: 'Error al reiniciar rate limits', type: 'error' });
        } finally {
            setResettingRateLimits(false);
            setResetRateLimitModal(false);
        }
    };

    const handleSaveTemplates = async (newSettings) => {
        try {
            await apiClient.updateAdminSettings(newSettings);
            setSettings(prev => ({ ...prev, ...newSettings }));
            setOriginalSettings(prev => ({ ...prev, ...newSettings }));
            setToast({ message: 'Plantillas guardadas', type: 'success' });
        } catch {
            setToast({ message: 'Error al guardar plantillas', type: 'error' });
        }
    };

    // Styles
    const inputClass = `w-full px-4 py-3 rounded-xl outline-none transition-all ${isDark ? 'bg-zinc-800/50 border border-zinc-700 text-white placeholder-zinc-500 focus:border-red-500' : 'bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-red-500'}`;
    const labelClass = `block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full w-full">
                <Loader2 className={`animate-spin w-8 h-8 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`} />
            </div>
        );
    }

    // Tab configuration
    const tabs = [
        { id: 'branding', label: 'Marca y Diseño', icon: Layout },
        { id: 'files', label: 'Archivos', icon: FileText },
        { id: 'smtp', label: 'Configuración SMTP', icon: Mail },
        { id: 'templates', label: 'Plantillas Email', icon: Code },
        { id: 'users', label: 'Usuarios', icon: Users },
        { id: 'limits', label: 'Límites', icon: HardDrive },
    ];

    // Logo Uploader Component
    const LogoUploader = ({ title, description, type, value, bgClass = '' }) => {
        const [imgError, setImgError] = useState(false);
        const [lastValue, setLastValue] = useState(value);

        // Reset error when value changes
        if (value !== lastValue) {
            setLastValue(value);
            setImgError(false);
        }

        return (
            <div className={`p-4 rounded-xl border border-dashed flex items-center justify-between group transition-colors ${isDark ? 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/30' : 'border-zinc-300 hover:border-zinc-400 bg-zinc-50'}`}>
                <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden ${bgClass || (isDark ? 'bg-zinc-800' : 'bg-zinc-200')}`}>
                        {value && !imgError ? (
                            <img
                                src={value}
                                alt={title}
                                className="w-full h-full object-contain p-1"
                                onError={() => setImgError(true)}
                            />
                        ) : (
                            <Image size={24} className="text-zinc-500" />
                        )}
                    </div>
                    <div>
                        <p className={`font-medium ${isDark ? 'text-white' : 'text-zinc-900'}`}>{title}</p>
                        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>{description}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {value && (
                        <button
                            onClick={() => handleDeleteBranding(type)}
                            className={`p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                    <button
                        onClick={() => handleUploaderClick(type)}
                        disabled={uploading[type]}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700' : 'bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-300'} disabled:opacity-50`}
                    >
                        {uploading[type] ? <Loader2 size={14} className="animate-spin" /> : 'Subir'}
                    </button>
                </div>
            </div>
        );
    };

    // Generic click handler for LogoUploader
    const handleUploaderClick = (type) => {
        if (type === 'logoLight') logoLightRef.current?.click();
        else if (type === 'logoDark') logoDarkRef.current?.click();
        else if (type === 'favicon') faviconRef.current?.click();
        else if (type === 'dropzoneIcon') dropzoneIconRef.current?.click();
    };

    // User List Item Component
    const UserListItem = ({ user }) => {
        const isAdmin = user.role === 'admin';

        return (
            <div className={`flex items-center justify-between p-3 rounded-lg border ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-white'}`}>
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${isAdmin ? 'bg-red-600' : (isDark ? 'bg-zinc-700' : 'bg-zinc-500')}`}>
                        {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{user.username}</p>
                        <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            {isAdmin ? 'Administrador' : 'Usuario'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => handleStartEdit(user)}
                    className={`p-2 rounded-lg ${isDark ? 'text-zinc-400 hover:text-white hover:bg-white/5' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}`}
                >
                    <Settings size={14} />
                </button>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Header - fixed height */}
            <div className="flex items-center justify-between flex-shrink-0 mb-6">
                <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    Panel de Control
                </h1>
                <button
                    onClick={handleDiscard}
                    className={`p-2 rounded-lg transition-colors ${isDark ? 'text-zinc-400 hover:text-white hover:bg-white/5' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}`}
                >
                    <X size={20} />
                </button>
            </div>

            {/* Reset Password Modal */}
            {resetPasswordUser && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-enter" onClick={() => setResetPasswordUser(null)}>
                    <div className={`rounded-2xl p-6 w-full max-w-md shadow-xl ${isDark ? 'bg-[#1a1a1a] border border-white/10' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                        <h3 className={`text-lg font-bold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Restablecer Contraseña</h3>
                        <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            Usuario: {users.find(u => u.id === resetPasswordUser)?.username}
                        </p>
                        <input
                            type="password"
                            placeholder="Nueva contraseña (mín. 6 caracteres)"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className={inputClass}
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button
                                onClick={() => { setResetPasswordUser(null); setNewPassword(''); }}
                                className={`px-4 py-2 rounded-xl ${isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'}`}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleResetPassword(resetPasswordUser)}
                                className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-1 gap-8 min-h-0 overflow-hidden">
                {/* Sidebar */}
                <aside className={`w-56 flex-shrink-0 pr-6 border-r ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
                    <nav className="flex flex-col gap-1.5">
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`
                                        w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all text-left
                                        ${isActive
                                            ? isDark ? 'bg-red-600/10 text-red-500 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-200'
                                            : isDark
                                                ? 'text-zinc-400 hover:bg-zinc-800 border border-transparent'
                                                : 'text-zinc-500 hover:bg-zinc-100 border border-transparent'
                                        }
                                    `}
                                >
                                    <Icon size={20} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                {/* Content */}
                <div className="flex-1 min-w-0 min-h-0 overflow-y-auto pl-4 pr-2">

                    {/* Branding / Marca y Diseño */}
                    {activeTab === 'branding' && (
                        <div className="animate-enter space-y-6">
                            <div className="space-y-4">
                                <label className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>Identidad de la Aplicación</label>

                                <div className="grid gap-3">
                                    <label className={`text-xs font-semibold uppercase tracking-wider mt-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Logotipos</label>
                                    <LogoUploader
                                        title="Logo Tema Claro"
                                        description="Visible en fondo blanco (PNG/SVG)"
                                        type="logoLight"
                                        value={settings.logoLight}
                                        bgClass="bg-white"
                                    />
                                    <LogoUploader
                                        title="Logo Tema Oscuro"
                                        description="Visible en fondo oscuro (PNG/SVG)"
                                        type="logoDark"
                                        value={settings.logoDark}
                                        bgClass={isDark ? 'bg-zinc-800' : 'bg-zinc-700'}
                                    />
                                    <LogoUploader
                                        title="Favicon"
                                        description="Icono del navegador (ICO/PNG 32x32)"
                                        type="favicon"
                                        value={settings.favicon}
                                    />
                                    <LogoUploader
                                        title="Icono Dropzone"
                                        description="Icono en zona de arrastrar archivos (PNG/SVG)"
                                        type="dropzoneIcon"
                                        value={settings.dropzoneIcon}
                                    />
                                </div>

                                {/* Hidden file inputs */}
                                <input ref={logoLightRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadBranding('logoLight', e.target.files?.[0])} />
                                <input ref={logoDarkRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadBranding('logoDark', e.target.files?.[0])} />
                                <input ref={faviconRef} type="file" accept="image/png,image/x-icon,image/svg+xml" className="hidden" onChange={(e) => handleUploadBranding('favicon', e.target.files?.[0])} />
                                <input ref={dropzoneIconRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadBranding('dropzoneIcon', e.target.files?.[0])} />

                                {/* Footer Text */}
                                <div className="mt-4">
                                    <label className={labelClass}>Texto del Footer</label>
                                    <input
                                        type="text"
                                        placeholder="© 2025 Mi Empresa — Secure File Sharing"
                                        className={inputClass}
                                        value={settings.footerText || ''}
                                        onChange={(e) => setSettings({ ...settings, footerText: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Users */}
                    {activeTab === 'users' && (
                        <div className="animate-enter">
                            <div className="flex items-center justify-between mb-4">
                                <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                    {users.length} Usuarios Registrados
                                </span>
                                <button className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${isDark ? 'border-zinc-700 text-zinc-200 hover:bg-zinc-800' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'}`}>
                                    Añadir Nuevo
                                </button>
                            </div>

                            {/* Simple User List */}
                            <div className="space-y-3">
                                {users.map(user => (
                                    <UserListItem key={user.id} user={user} />
                                ))}
                            </div>

                            {users.length === 0 && (
                                <div className={`text-center py-12 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    No hay usuarios registrados
                                </div>
                            )}

                            {/* Detailed User Edit Panel */}
                            {editingUser && (
                                <div className={`mt-6 p-5 rounded-xl animate-enter ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                    <h3 className={`text-lg font-semibold mb-6 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                        Editando: {users.find(u => u.id === editingUser)?.username}
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                        <div>
                                            <label className={labelClass}>Nombre de usuario</label>
                                            <input
                                                type="text"
                                                value={editForm.username}
                                                onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                                                className={inputClass}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Email</label>
                                            <input
                                                type="email"
                                                value={editForm.email}
                                                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                                className={inputClass}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button onClick={() => handleSaveEdit(editingUser)} className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-medium flex items-center gap-2">
                                            <Check size={14} /> Guardar
                                        </button>
                                        <button onClick={() => setResetPasswordUser(editingUser)} className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}>
                                            <Key size={14} /> Contraseña
                                        </button>
                                        <button onClick={() => handleToggleRole(editingUser)} className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}>
                                            <Shield size={14} /> Admin
                                        </button>
                                        <button onClick={() => handleToggleVerified(editingUser)} className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}>
                                            <CheckCircle size={14} /> Verificado
                                        </button>
                                        <button onClick={() => handleSendVerificationEmail(editingUser)} className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                            <Mail size={14} /> Verificación
                                        </button>
                                        <button onClick={() => handleSendPasswordResetEmail(editingUser)} className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                                            <RefreshCw size={14} /> Reset
                                        </button>
                                        <button onClick={() => setDeleteUserModal({ isOpen: true, userId: editingUser, username: editForm.username })} className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
                                            <Trash2 size={14} /> Eliminar
                                        </button>
                                        <button onClick={() => setEditingUser(null)} className={`ml-auto px-4 py-2 rounded-xl text-sm ${isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'}`}>
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Files */}
                    {activeTab === 'files' && (
                        <div className="animate-enter">
                            <div className="mb-8">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                            Archivos del Sistema
                                        </h2>
                                        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                            {files.length} archivos almacenados
                                        </p>
                                    </div>
                                    <Tooltip text="Limpiar chunks huérfanos">
                                        <button
                                            onClick={handleCleanupChunks}
                                            disabled={cleaningChunks}
                                            className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium transition-colors ${isDark ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'} disabled:opacity-50`}
                                        >
                                            {cleaningChunks ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                            Limpiar Chunks
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* Files Table */}
                            <div className={`rounded-2xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
                                <table className="w-full">
                                    <thead className={isDark ? 'bg-white/5' : 'bg-zinc-50'}>
                                        <tr className={`text-left text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                            <th className="px-6 py-4 font-semibold">Nombre</th>
                                            <th className="px-6 py-4 font-semibold">Tamaño</th>
                                            <th className="px-6 py-4 font-semibold">Descargas</th>
                                            <th className="px-6 py-4 font-semibold w-20"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {files.map((file, index) => (
                                            <tr
                                                key={file.id}
                                                className={`border-t transition-colors ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-zinc-100 hover:bg-zinc-50'}`}
                                            >
                                                <td className={`px-6 py-4 max-w-xs ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-2 rounded-lg ${isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>
                                                            <FileText size={16} />
                                                        </div>
                                                        <span className="font-medium truncate" title={file.originalName}>
                                                            {file.originalName}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className={`px-6 py-4 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                                </td>
                                                <td className={`px-6 py-4 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                                                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                                                        {file.downloadCount}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <button
                                                        onClick={() => setDeleteFileModal({ isOpen: true, fileId: file.id, fileName: file.originalName })}
                                                        className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {files.length === 0 && (
                                    <div className={`text-center py-16 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        <FileText size={48} className="mx-auto mb-4 opacity-50" />
                                        <p>No hay archivos almacenados</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Limits */}
                    {activeTab === 'limits' && (
                        <div className="animate-enter">
                            <div className="mb-8">
                                <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                    Límites y Rendimiento
                                </h2>
                                <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    Configura los límites de subida y parámetros del sistema
                                </p>
                            </div>

                            {/* Limits Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Left Column - User Limits */}
                                <div className="space-y-5">
                                    <h3 className={`text-sm font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                        Límites de Usuario
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelClass}>Máx. por Archivo (MB)</label>
                                            <input type="number" min="1" className={inputClass} value={settings.maxFileSize || ''} onChange={(e) => setSettings({ ...settings, maxFileSize: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Máx. Total (MB)</label>
                                            <input type="number" min="1" className={inputClass} value={settings.maxTotalSize || ''} onChange={(e) => setSettings({ ...settings, maxTotalSize: e.target.value })} />
                                        </div>
                                    </div>
                                    <h3 className={`text-sm font-semibold uppercase tracking-wider pt-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                        Límites de Invitado
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelClass}>Límite Total (MB)</label>
                                            <input type="number" min="1" className={inputClass} value={settings.guestUploadLimit || ''} onChange={(e) => setSettings({ ...settings, guestUploadLimit: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Máx. por Archivo (MB)</label>
                                            <input type="number" min="1" className={inputClass} value={settings.guestMaxFileSize || ''} onChange={(e) => setSettings({ ...settings, guestMaxFileSize: e.target.value })} />
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column - Performance */}
                                <div className="space-y-5">
                                    <h3 className={`text-sm font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                        Rendimiento
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelClass}>Uploads Concurrentes</label>
                                            <input type="number" min="1" max="50" className={inputClass} value={settings.maxConcurrentUploads || ''} onChange={(e) => setSettings({ ...settings, maxConcurrentUploads: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Rate Limit (req/min)</label>
                                            <input type="number" min="100" className={inputClass} value={settings.chunkRateLimit || ''} onChange={(e) => setSettings({ ...settings, chunkRateLimit: e.target.value })} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Chunk Settings */}
                            <div className={`mt-8 p-6 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <label className={`font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>Chunk Adaptativo</label>
                                        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Ajusta el tamaño de chunk según el archivo</p>
                                    </div>
                                    <Toggle
                                        checked={settings.adaptiveChunkSizing === 'true'}
                                        onChange={(checked) => setSettings({ ...settings, adaptiveChunkSizing: checked ? 'true' : 'false' })}
                                    />
                                </div>
                                {settings.adaptiveChunkSizing === 'true' ? (
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className={`p-4 rounded-xl ${isDark ? 'bg-zinc-800/50' : 'bg-white'}`}>
                                            <h4 className={`font-medium mb-3 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Pequeños</h4>
                                            <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Umbral (MB)</label>
                                            <input type="number" className={`${inputClass} mt-1`} value={settings.smallFileThreshold || ''} onChange={(e) => setSettings({ ...settings, smallFileThreshold: e.target.value })} />
                                            <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'} mt-3 block`}>Chunk (MB)</label>
                                            <input type="number" className={`${inputClass} mt-1`} value={settings.smallFileChunkSize || ''} onChange={(e) => setSettings({ ...settings, smallFileChunkSize: e.target.value })} />
                                        </div>
                                        <div className={`p-4 rounded-xl ${isDark ? 'bg-zinc-800/50' : 'bg-white'}`}>
                                            <h4 className={`font-medium mb-3 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Medianos</h4>
                                            <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Umbral (MB)</label>
                                            <input type="number" className={`${inputClass} mt-1`} value={settings.mediumFileThreshold || ''} onChange={(e) => setSettings({ ...settings, mediumFileThreshold: e.target.value })} />
                                            <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'} mt-3 block`}>Chunk (MB)</label>
                                            <input type="number" className={`${inputClass} mt-1`} value={settings.mediumFileChunkSize || ''} onChange={(e) => setSettings({ ...settings, mediumFileChunkSize: e.target.value })} />
                                        </div>
                                        <div className={`p-4 rounded-xl ${isDark ? 'bg-zinc-800/50' : 'bg-white'}`}>
                                            <h4 className={`font-medium mb-3 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Grandes</h4>
                                            <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Chunk (MB)</label>
                                            <input type="number" className={`${inputClass} mt-1`} value={settings.largeFileChunkSize || ''} onChange={(e) => setSettings({ ...settings, largeFileChunkSize: e.target.value })} />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="max-w-xs">
                                        <label className={labelClass}>Chunk Fijo (MB)</label>
                                        <input type="number" className={inputClass} value={settings.chunkSize || ''} onChange={(e) => setSettings({ ...settings, chunkSize: e.target.value })} />
                                    </div>
                                )}
                            </div>

                            {/* Ops */}
                            <div className={`mt-8 p-6 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className={`font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>Operación</label>
                                        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Utilidades de mantenimiento para el sistema</p>
                                    </div>
                                    <button
                                        onClick={handleResetRateLimits}
                                        disabled={resettingRateLimits}
                                        className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium transition-colors ${isDark ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'} disabled:opacity-50`}
                                    >
                                        {resettingRateLimits ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                        Reiniciar Rate Limits
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* SMTP */}
                    {activeTab === 'smtp' && (
                        <div className="animate-enter space-y-6">
                            {/* Header */}
                            <div>
                                <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                    Configuración SMTP
                                </h2>
                                <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    Configura el servidor de correo para notificaciones
                                </p>
                            </div>

                            {/* Server Settings */}
                            <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <h3 className={`text-sm font-semibold uppercase tracking-wider mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                    Servidor
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="md:col-span-2">
                                        <label className={labelClass}>Host SMTP</label>
                                        <input type="text" placeholder="smtp.ejemplo.com" className={inputClass} value={settings.smtpHost || ''} onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Puerto</label>
                                        <input type="text" placeholder="587" className={inputClass} value={settings.smtpPort || ''} onChange={(e) => setSettings({ ...settings, smtpPort: e.target.value })} />
                                    </div>
                                </div>
                                <p className={`text-xs mt-3 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    💡 Puerto 587 usa STARTTLS automáticamente. Puerto 465 usa SSL directo.
                                </p>
                            </div>

                            {/* Credentials */}
                            <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <h3 className={`text-sm font-semibold uppercase tracking-wider mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                    Credenciales
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelClass}>Usuario</label>
                                        <input type="text" placeholder="usuario@ejemplo.com" className={inputClass} value={settings.smtpUser || ''} onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Contraseña</label>
                                        <input type="password" placeholder="••••••••" className={inputClass} value={settings.smtpPass || ''} onChange={(e) => setSettings({ ...settings, smtpPass: e.target.value })} />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className={labelClass}>Email Remitente</label>
                                        <input type="email" placeholder="noreply@ejemplo.com" className={inputClass} value={settings.smtpFrom || ''} onChange={(e) => setSettings({ ...settings, smtpFrom: e.target.value })} />
                                    </div>
                                </div>
                            </div>

                            {/* Test Section */}
                            <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <h3 className={`text-sm font-semibold uppercase tracking-wider mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                    Probar Configuración
                                </h3>
                                <div className="flex gap-3">
                                    <input
                                        type="email"
                                        placeholder="test@ejemplo.com"
                                        className={`flex-1 ${inputClass}`}
                                        value={testEmail}
                                        onChange={(e) => setTestEmail(e.target.value)}
                                    />
                                    <button
                                        onClick={handleTestEmail}
                                        disabled={testingEmail || !settings.smtpHost || !settings.smtpUser}
                                        className="flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {testingEmail ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                        Enviar Prueba
                                    </button>
                                </div>
                                <p className={`text-xs mt-3 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    Guarda los cambios antes de probar la configuración.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Templates */}
                    {activeTab === 'templates' && (
                        <div className="animate-enter h-full flex flex-col">
                            <div className="mb-6 flex-shrink-0">
                                <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                    Plantillas de Email
                                </h2>
                                <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    Personaliza las notificaciones por correo electrónico
                                </p>
                            </div>
                            <div className="flex-1 min-h-0">
                                <EmailTemplateEditor
                                    templates={settings.emailTemplates ? JSON.parse(settings.emailTemplates) : null}
                                    onSave={handleSaveTemplates}
                                    onToast={setToast}
                                    logoUrl={settings.logoDark}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Actions */}
            <div className={`mt-auto pt-6 border-t flex justify-end gap-3 flex-shrink-0 ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
                <button
                    onClick={handleDiscard}
                    className={`px-6 py-2.5 rounded-xl font-medium transition-colors ${isDark ? 'text-zinc-400 hover:text-white hover:bg-white/5' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`}
                >
                    Descartar
                </button>
                <button
                    onClick={handleSaveAll}
                    disabled={saving}
                    className="px-6 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-500 font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                    {saving && <Loader2 size={16} className="animate-spin" />}
                    Guardar Cambios
                </button>
            </div>

            {/* Modals */}
            <ConfirmModal
                isOpen={deleteUserModal.isOpen}
                onClose={() => setDeleteUserModal({ isOpen: false, userId: null, username: '' })}
                onConfirm={() => handleDeleteUser(deleteUserModal.userId)}
                title="Eliminar usuario"
                message={`¿Eliminar a "${deleteUserModal.username}" y todos sus archivos?`}
                confirmText="Eliminar"
                variant="danger"
            />
            <ConfirmModal
                isOpen={deleteFileModal.isOpen}
                onClose={() => setDeleteFileModal({ isOpen: false, fileId: null, fileName: '' })}
                onConfirm={() => handleDeleteFile(deleteFileModal.fileId)}
                title="Eliminar archivo"
                message={`¿Eliminar "${deleteFileModal.fileName}"?`}
                confirmText="Eliminar"
                variant="danger"
            />
            <ConfirmModal
                isOpen={resetRateLimitModal}
                onClose={() => setResetRateLimitModal(false)}
                onConfirm={confirmResetRateLimits}
                title="Reiniciar Rate Limits"
                message="¿Estás seguro de que quieres reiniciar todos los límites de velocidad del sistema? Esto permitirá a todos los usuarios realizar acciones sin esperar si estaban bloqueados."
                confirmText="Reiniciar"
                variant="warning"
            />
        </div>
    );
};

export default AdminPage;
