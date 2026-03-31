import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import {
    Loader2, Trash2, Users, FileText, Settings, X, Image,
    Mail, Send, HardDrive, Shield, Key, Check, CheckCircle,
    RefreshCw, Layout, Code, History, ListChecks
} from 'lucide-react';
import Toast from '../components/ui/Toast';
import Tooltip from '../components/ui/Tooltip';
import ConfirmModal from '../components/ui/ConfirmModal';
import Toggle from '../components/ui/Toggle';
import { useBranding } from '../context/BrandingContext';
import { useTheme } from '../context/ThemeContext';
import EmailTemplateEditor from '../components/admin/EmailTemplateEditor';

const PASSWORD_POLICY_MESSAGE = 'La contrasena debe tener al menos 8 caracteres, incluyendo letras y numeros';

const parseTemplatesSafely = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const JOB_TYPE_OPTIONS = [
    { value: 'all', label: 'Todos' },
    { value: 'email', label: 'Email' },
    { value: 'cleanup_files', label: 'Limpieza Archivos' },
    { value: 'cleanup_chunks', label: 'Limpieza Chunks' },
    { value: 'branding_convert', label: 'Conversion Branding' },
    { value: 'thumbnail_generate', label: 'Miniaturas' }
];

const formatTimestamp = (value) => {
    const ts = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ts) || ts <= 0) {
        return '-';
    }
    return new Date(ts).toLocaleString();
};

const formatBytes = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '-';
    }
    if (bytes >= 1024 ** 3) {
        return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 ** 2) {
        return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${bytes} B`;
};

const truncateText = (value, maxLen = 120) => {
    const normalized = value === undefined || value === null ? '' : String(value);
    if (normalized.length <= maxLen) {
        return normalized;
    }
    return `${normalized.slice(0, maxLen)}...`;
};

const AdminPage = () => {
    const navigate = useNavigate();
    const { updateSettings: updateBrandingContext } = useBranding();
    const { isDark } = useTheme();
    const [activeTab, setActiveTab] = useState('branding');
    const [users, setUsers] = useState([]);
    const [files, setFiles] = useState([]);
    const [settings, setSettings] = useState({
        logoLight: '', logoDark: '', favicon: '', dropzoneIcon: '', footerText: '',
        smtpHost: '', smtpPort: '587', smtpSecure: 'false', smtpUser: '', smtpPass: '', smtpPassConfigured: false, smtpFrom: '',
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
    const [jobStats, setJobStats] = useState({ byStatus: {}, byType: {}, total: 0 });
    const [pendingJobs, setPendingJobs] = useState([]);
    const [jobTypeFilter, setJobTypeFilter] = useState('all');
    const [loadingJobs, setLoadingJobs] = useState(false);
    const [jobActionRunning, setJobActionRunning] = useState('');
    const [opsMetrics, setOpsMetrics] = useState(null);
    const [opsReadiness, setOpsReadiness] = useState(null);
    const [loadingOps, setLoadingOps] = useState(false);
    const [auditEntries, setAuditEntries] = useState([]);
    const [auditPagination, setAuditPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [loadingAudit, setLoadingAudit] = useState(false);
    const logoLightRef = useRef(null);
    const logoDarkRef = useRef(null);
    const faviconRef = useRef(null);
    const dropzoneIconRef = useRef(null);

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            const [usersRes, filesRes, settingsRes] = await Promise.all([
                apiClient.getAdminUsers(), apiClient.getAdminFiles(), apiClient.getAdminSettings()
            ]);
            if (usersRes.ok) setUsers((await usersRes.json()).users);
            if (filesRes.ok) setFiles((await filesRes.json()).files);
            if (settingsRes.ok) {
                const data = await settingsRes.json();
                const normalized = {
                    ...data,
                    smtpPass: '',
                    smtpPassConfigured: Boolean(data.smtpPassConfigured)
                };
                setSettings(normalized);
                setOriginalSettings(normalized);
            }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const readErrorMessage = useCallback(async (res, fallback) => {
        const data = await res.json().catch(() => ({}));
        return data.error || fallback;
    }, []);

    const fetchJobsData = useCallback(async ({ type = jobTypeFilter, showErrorToast = true } = {}) => {
        setLoadingJobs(true);
        try {
            const [statsRes, pendingRes] = await Promise.all([
                apiClient.getAdminJobStats(),
                apiClient.getAdminPendingJobs(type, 50)
            ]);

            if (!statsRes.ok) {
                throw new Error(await readErrorMessage(statsRes, 'No se pudo cargar el estado de la cola'));
            }
            if (!pendingRes.ok) {
                throw new Error(await readErrorMessage(pendingRes, 'No se pudieron cargar los jobs pendientes'));
            }

            const statsData = await statsRes.json();
            const pendingData = await pendingRes.json();
            setJobStats({
                byStatus: statsData.byStatus || {},
                byType: statsData.byType || {},
                total: Number(statsData.total) || 0
            });
            setPendingJobs(Array.isArray(pendingData.jobs) ? pendingData.jobs : []);
        } catch (err) {
            if (showErrorToast) {
                setToast({ message: err.message || 'Error cargando jobs', type: 'error' });
            }
        } finally {
            setLoadingJobs(false);
        }
    }, [jobTypeFilter, readErrorMessage]);

    const fetchAuditData = useCallback(async (page = 1, limit = 20, showErrorToast = true) => {
        setLoadingAudit(true);
        try {
            const res = await apiClient.getAdminSettingsAudit(page, limit);
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, 'No se pudo cargar la auditoria de settings'));
            }
            const data = await res.json();
            const pagination = data.pagination || {};
            setAuditEntries(Array.isArray(data.entries) ? data.entries : []);
            setAuditPagination({
                page: Number(pagination.page) || page,
                limit: Number(pagination.limit) || limit,
                total: Number(pagination.total) || 0,
                totalPages: Math.max(1, Number(pagination.totalPages) || 1)
            });
        } catch (err) {
            if (showErrorToast) {
                setToast({ message: err.message || 'Error cargando auditoria', type: 'error' });
            }
        } finally {
            setLoadingAudit(false);
        }
    }, [readErrorMessage]);

    const fetchOpsData = useCallback(async ({ showErrorToast = true } = {}) => {
        setLoadingOps(true);
        try {
            const [metricsRes, readinessRes] = await Promise.all([
                apiClient.getAdminMetrics(),
                apiClient.getHealthReady()
            ]);

            if (!metricsRes.ok) {
                throw new Error(await readErrorMessage(metricsRes, 'No se pudo cargar la observabilidad'));
            }

            const metricsData = await metricsRes.json();
            setOpsMetrics(metricsData);

            if (readinessRes.ok) {
                setOpsReadiness(await readinessRes.json());
            } else {
                setOpsReadiness(null);
            }
        } catch (err) {
            if (showErrorToast) {
                setToast({ message: err.message || 'Error cargando observabilidad', type: 'error' });
            }
        } finally {
            setLoadingOps(false);
        }
    }, [readErrorMessage]);

    useEffect(() => {
        if (activeTab === 'ops') {
            fetchOpsData({ showErrorToast: false });
            return;
        }
        if (activeTab === 'jobs') {
            fetchJobsData({ type: jobTypeFilter, showErrorToast: false });
            return;
        }
        if (activeTab === 'audit') {
            fetchAuditData(1, auditPagination.limit, false);
        }
    }, [activeTab, jobTypeFilter, auditPagination.limit, fetchAuditData, fetchJobsData, fetchOpsData]);

    // Check if settings have changed
    const hasChanges = () => {
        if ((settings.smtpPass || '').trim().length > 0) {
            return true;
        }

        const keysToCheck = [
            'footerText', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFrom',
            'maxFileSize', 'maxTotalSize', 'guestUploadLimit', 'guestMaxFileSize', 'chunkSize', 'maxConcurrentUploads',
            'chunkRateLimit', 'adaptiveChunkSizing', 'smallFileThreshold', 'mediumFileThreshold',
            'smallFileChunkSize', 'mediumFileChunkSize', 'largeFileChunkSize'
        ];
        return keysToCheck.some(key => settings[key] !== originalSettings[key]);
    };

    const handleDiscard = () => {
        setSettings({ ...originalSettings, smtpPass: '' });
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

            if ((settings.smtpPass || '').trim()) {
                settingsToSave.smtpPass = settings.smtpPass;
            }

            const res = await apiClient.updateAdminSettings(settingsToSave);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Error al guardar configuracion');
            }

            const nextSettings = {
                ...settings,
                smtpPass: '',
                smtpPassConfigured: settings.smtpPassConfigured || Boolean(settingsToSave.smtpPass)
            };
            setSettings(nextSettings);
            setOriginalSettings(nextSettings);

            // Update branding context
            const brandingKeys = ['logoLight', 'logoDark', 'favicon', 'footerText'];
            const brandingUpdate = {};
            for (const key of brandingKeys) {
                if (settings[key] !== undefined) brandingUpdate[key] = settings[key];
            }
            if (Object.keys(brandingUpdate).length > 0) updateBrandingContext(brandingUpdate);

            setToast({ message: 'Configuración guardada', type: 'success' });
        } catch (err) {
            setToast({ message: err.message || 'Error al guardar', type: 'error' });
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
        const isPasswordValid = newPassword.length >= 8 && /[a-zA-Z]/.test(newPassword) && /[0-9]/.test(newPassword);
        if (!isPasswordValid) {
            setToast({ message: PASSWORD_POLICY_MESSAGE, type: 'error' });
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
            const res = await apiClient.deleteFile(id);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'No se pudo eliminar el archivo');
            }
            fetchData();
            setToast({ message: 'Archivo eliminado', type: 'success' });
        }
        catch (err) { setToast({ message: err.message || 'Error', type: 'error' }); }
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

    const handleJobFilterChange = (nextType) => {
        setJobTypeFilter(nextType);
    };

    const handleRetryDeadJobs = async () => {
        setJobActionRunning('retry-dead');
        try {
            const retryType = jobTypeFilter === 'all' ? null : jobTypeFilter;
            const res = await apiClient.retryDeadJobs(retryType);
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, 'No se pudieron reintentar jobs muertos'));
            }
            const data = await res.json().catch(() => ({}));
            setToast({
                message: data.message || 'Jobs muertos reintentados',
                type: 'success'
            });
            await fetchJobsData({ type: jobTypeFilter, showErrorToast: false });
        } catch (err) {
            setToast({ message: err.message || 'Error al reintentar jobs', type: 'error' });
        } finally {
            setJobActionRunning('');
        }
    };

    const handleCancelJob = async (jobId) => {
        setJobActionRunning(jobId);
        try {
            const res = await apiClient.cancelJob(jobId);
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, 'No se pudo cancelar el job'));
            }
            setToast({ message: 'Job cancelado', type: 'success' });
            await fetchJobsData({ type: jobTypeFilter, showErrorToast: false });
        } catch (err) {
            setToast({ message: err.message || 'Error al cancelar job', type: 'error' });
        } finally {
            setJobActionRunning('');
        }
    };

    const handleAuditPageChange = (nextPage) => {
        if (nextPage < 1 || nextPage > auditPagination.totalPages) {
            return;
        }
        fetchAuditData(nextPage, auditPagination.limit);
    };

    const handleSaveTemplates = async (newSettings) => {
        try {
            const res = await apiClient.updateAdminSettings(newSettings);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Error al guardar plantillas');
            }
            setSettings(prev => ({ ...prev, ...newSettings }));
            setOriginalSettings(prev => ({ ...prev, ...newSettings }));
            setToast({ message: 'Plantillas guardadas', type: 'success' });
        } catch (err) {
            setToast({ message: err.message || 'Error al guardar plantillas', type: 'error' });
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
        { id: 'ops', label: 'Observabilidad', icon: Shield },
        { id: 'jobs', label: 'Cola de Jobs', icon: ListChecks },
        { id: 'audit', label: 'Auditoría', icon: History },
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
                            placeholder="Nueva contrasena (min. 8 caracteres, letras y numeros)"
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
                                        {files.map((file) => (
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

                    {/* Observabilidad */}
                    {activeTab === 'ops' && (
                        <div className="animate-enter space-y-6">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                        Observabilidad
                                    </h2>
                                    <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        Señales operativas para uploads, descargas, almacenamiento y cola.
                                    </p>
                                </div>
                                <button
                                    onClick={() => fetchOpsData()}
                                    disabled={loadingOps}
                                    className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium transition-colors ${isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'} disabled:opacity-50`}
                                >
                                    {loadingOps ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                    Actualizar
                                </button>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                                {[
                                    {
                                        label: 'Health',
                                        value: (opsMetrics?.health?.status || opsReadiness?.status || 'sin datos').toUpperCase(),
                                        tone: (opsMetrics?.health?.status || opsReadiness?.status) === 'ok'
                                            ? (isDark ? 'text-green-300' : 'text-green-700')
                                            : (isDark ? 'text-amber-300' : 'text-amber-700')
                                    },
                                    {
                                        label: 'Uploads Activos',
                                        value: opsMetrics?.summary?.uploads?.activeSessions ?? '-',
                                        tone: isDark ? 'text-white' : 'text-zinc-900'
                                    },
                                    {
                                        label: 'Descargas Fallidas',
                                        value: opsMetrics?.summary?.downloads?.failedOrAborted ?? '-',
                                        tone: isDark ? 'text-white' : 'text-zinc-900'
                                    },
                                    {
                                        label: 'Jobs Muertos',
                                        value: opsMetrics?.queue?.byStatus?.dead ?? 0,
                                        tone: (opsMetrics?.queue?.byStatus?.dead || 0) > 0
                                            ? (isDark ? 'text-red-300' : 'text-red-700')
                                            : (isDark ? 'text-white' : 'text-zinc-900')
                                    }
                                ].map((item) => (
                                    <div key={item.label} className={`p-4 rounded-xl border ${isDark ? 'border-white/10 bg-white/5' : 'border-zinc-200 bg-zinc-50'}`}>
                                        <p className={`text-xs uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                            {item.label}
                                        </p>
                                        <p className={`text-2xl font-bold mt-1 ${item.tone}`}>
                                            {item.value}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                        <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                            Alertas derivadas
                                        </h3>
                                        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                            Heurísticas rápidas para saber si el release está respirando bien.
                                        </p>
                                    </div>
                                    <span className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        Uptime: {Math.round(opsMetrics?.metrics?.uptimeSeconds || 0)}s
                                    </span>
                                </div>

                                <div className="mt-4 flex flex-col gap-3">
                                    {(opsMetrics?.alerts || []).map((alert) => (
                                        <div
                                            key={alert.code}
                                            className={`rounded-xl border px-4 py-3 ${alert.severity === 'high'
                                                ? (isDark ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700')
                                                : (isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700')
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-medium">{alert.message}</span>
                                                <span className="text-xs uppercase tracking-wider opacity-80">{alert.severity}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {(opsMetrics?.alerts || []).length === 0 && (
                                        <div className={`rounded-xl border px-4 py-3 ${isDark ? 'border-green-500/20 bg-green-500/10 text-green-200' : 'border-green-200 bg-green-50 text-green-700'}`}>
                                            Sin alertas activas derivadas en esta muestra.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                    <h3 className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                        Estado del servicio
                                    </h3>
                                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <dt className={labelClass}>Base de Datos</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.health?.db ? 'Lista' : 'No lista'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Uploads</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.health?.uploads ? 'Writable' : 'Bloqueado'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Data</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.health?.data ? 'Writable' : 'Bloqueado'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Ready Endpoint</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsReadiness?.status || '-'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Espacio Libre</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>
                                                {formatBytes(opsMetrics?.summary?.storage?.freeBytes)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Capacidad Total</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>
                                                {formatBytes(opsMetrics?.summary?.storage?.sizeBytes)}
                                            </dd>
                                        </div>
                                    </dl>
                                </div>

                                <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                    <h3 className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                        Resumen de tráfico
                                    </h3>
                                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <dt className={labelClass}>Requests Totales</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.summary?.http?.totalRequests ?? '-'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Errores 5xx</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.summary?.http?.serverErrors ?? '-'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Uploads Iniciados</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.summary?.uploads?.started ?? '-'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Uploads Completados</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.summary?.uploads?.completed ?? '-'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Sesiones Estancadas</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.summary?.uploads?.staleSessions ?? '-'}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>Queue Pending</dt>
                                            <dd className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{opsMetrics?.queue?.byStatus?.pending ?? 0}</dd>
                                        </div>
                                    </dl>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Jobs */}
                    {activeTab === 'jobs' && (
                        <div className="animate-enter space-y-6">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                        Cola de Jobs
                                    </h2>
                                    <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        Estado de la cola asíncrona y control de jobs pendientes
                                    </p>
                                </div>
                                <button
                                    onClick={() => fetchJobsData({ type: jobTypeFilter })}
                                    disabled={loadingJobs}
                                    className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium transition-colors ${isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'} disabled:opacity-50`}
                                >
                                    {loadingJobs ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                    Actualizar
                                </button>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                {[
                                    { key: 'pending', label: 'Pendientes' },
                                    { key: 'processing', label: 'Procesando' },
                                    { key: 'completed', label: 'Completados' },
                                    { key: 'failed', label: 'Fallidos' },
                                    { key: 'dead', label: 'Muertos' }
                                ].map((item) => (
                                    <div key={item.key} className={`p-4 rounded-xl border ${isDark ? 'border-white/10 bg-white/5' : 'border-zinc-200 bg-zinc-50'}`}>
                                        <p className={`text-xs uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                            {item.label}
                                        </p>
                                        <p className={`text-2xl font-bold mt-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                            {jobStats.byStatus[item.key] || 0}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className={`p-5 rounded-2xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-zinc-50 border border-zinc-100'}`}>
                                <div className="flex flex-col md:flex-row md:items-end gap-4">
                                    <div className="flex-1">
                                        <label className={labelClass}>Tipo de Job</label>
                                        <select
                                            value={jobTypeFilter}
                                            onChange={(e) => handleJobFilterChange(e.target.value)}
                                            className={inputClass}
                                        >
                                            {JOB_TYPE_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        onClick={handleRetryDeadJobs}
                                        disabled={jobActionRunning === 'retry-dead'}
                                        className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors ${isDark ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'} disabled:opacity-50`}
                                    >
                                        {jobActionRunning === 'retry-dead' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                        Reintentar Jobs Muertos
                                    </button>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {Object.entries(jobStats.byType || {}).map(([type, count]) => (
                                        <span
                                            key={type}
                                            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-white text-zinc-700 border border-zinc-200'}`}
                                        >
                                            {type}: {count}
                                        </span>
                                    ))}
                                    {Object.keys(jobStats.byType || {}).length === 0 && (
                                        <span className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                            No hay jobs pendientes por tipo
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className={`rounded-2xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
                                <table className="w-full">
                                    <thead className={isDark ? 'bg-white/5' : 'bg-zinc-50'}>
                                        <tr className={`text-left text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                            <th className="px-4 py-3 font-semibold">ID</th>
                                            <th className="px-4 py-3 font-semibold">Tipo</th>
                                            <th className="px-4 py-3 font-semibold">Prioridad</th>
                                            <th className="px-4 py-3 font-semibold">Intentos</th>
                                            <th className="px-4 py-3 font-semibold">Programado</th>
                                            <th className="px-4 py-3 font-semibold">Payload</th>
                                            <th className="px-4 py-3 font-semibold w-24"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pendingJobs.map((job) => {
                                            const payloadText = truncateText(
                                                typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload || {}),
                                                90
                                            );

                                            return (
                                                <tr
                                                    key={job.id}
                                                    className={`border-t ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-zinc-100 hover:bg-zinc-50'}`}
                                                >
                                                    <td className={`px-4 py-3 text-xs font-mono ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                                                        {truncateText(job.id, 24)}
                                                    </td>
                                                    <td className={`px-4 py-3 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>{job.type}</td>
                                                    <td className={`px-4 py-3 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>{job.priority ?? 0}</td>
                                                    <td className={`px-4 py-3 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>{job.attempts ?? 0}</td>
                                                    <td className={`px-4 py-3 text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{formatTimestamp(job.scheduled_at)}</td>
                                                    <td className={`px-4 py-3 text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`} title={typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload || {})}>
                                                        {payloadText || '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button
                                                            onClick={() => handleCancelJob(job.id)}
                                                            disabled={jobActionRunning === job.id}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'bg-red-50 text-red-600 hover:bg-red-100'} disabled:opacity-50`}
                                                        >
                                                            {jobActionRunning === job.id ? '...' : 'Cancelar'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                {!loadingJobs && pendingJobs.length === 0 && (
                                    <div className={`text-center py-12 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        No hay jobs pendientes para el filtro seleccionado
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Audit */}
                    {activeTab === 'audit' && (
                        <div className="animate-enter space-y-6">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                                        Auditoría de Configuración
                                    </h2>
                                    <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        Historial de cambios realizados en settings administrativos
                                    </p>
                                </div>
                                <button
                                    onClick={() => fetchAuditData(auditPagination.page, auditPagination.limit)}
                                    disabled={loadingAudit}
                                    className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium transition-colors ${isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'} disabled:opacity-50`}
                                >
                                    {loadingAudit ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                    Actualizar
                                </button>
                            </div>

                            <div className={`rounded-2xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
                                <table className="w-full">
                                    <thead className={isDark ? 'bg-white/5' : 'bg-zinc-50'}>
                                        <tr className={`text-left text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                            <th className="px-4 py-3 font-semibold">Fecha</th>
                                            <th className="px-4 py-3 font-semibold">Admin</th>
                                            <th className="px-4 py-3 font-semibold">Setting</th>
                                            <th className="px-4 py-3 font-semibold">Valor Anterior</th>
                                            <th className="px-4 py-3 font-semibold">Valor Nuevo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditEntries.map((entry) => (
                                            <tr
                                                key={entry.id}
                                                className={`border-t ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-zinc-100 hover:bg-zinc-50'}`}
                                            >
                                                <td className={`px-4 py-3 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                                                    {formatTimestamp(entry.changedAt)}
                                                </td>
                                                <td className={`px-4 py-3 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                                                    {entry.adminUsername || truncateText(entry.adminUserId, 16) || 'sistema'}
                                                </td>
                                                <td className={`px-4 py-3 text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-900'}`}>
                                                    {entry.settingKey}
                                                </td>
                                                <td className={`px-4 py-3 text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`} title={entry.oldValue || ''}>
                                                    {truncateText(entry.oldValue, 70) || '-'}
                                                </td>
                                                <td className={`px-4 py-3 text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`} title={entry.newValue || ''}>
                                                    {truncateText(entry.newValue, 70) || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {!loadingAudit && auditEntries.length === 0 && (
                                    <div className={`text-center py-12 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                        No hay cambios registrados en esta página
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between">
                                <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                    Página {auditPagination.page} de {auditPagination.totalPages} · {auditPagination.total} registros
                                </p>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleAuditPageChange(auditPagination.page - 1)}
                                        disabled={loadingAudit || auditPagination.page <= 1}
                                        className={`px-3 py-2 rounded-lg text-sm transition-colors ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'} disabled:opacity-50`}
                                    >
                                        Anterior
                                    </button>
                                    <button
                                        onClick={() => handleAuditPageChange(auditPagination.page + 1)}
                                        disabled={loadingAudit || auditPagination.page >= auditPagination.totalPages}
                                        className={`px-3 py-2 rounded-lg text-sm transition-colors ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'} disabled:opacity-50`}
                                    >
                                        Siguiente
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
                                        <input
                                            type="password"
                                            placeholder={settings.smtpPassConfigured ? 'Dejar vacio para mantener la contrasena actual' : 'Ingresa la contrasena SMTP'}
                                            className={inputClass}
                                            value={settings.smtpPass || ''}
                                            onChange={(e) => setSettings({ ...settings, smtpPass: e.target.value })}
                                        />
                                        {settings.smtpPassConfigured && !settings.smtpPass && (
                                            <p className={`text-xs mt-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                                Ya hay una contrasena SMTP configurada.
                                            </p>
                                        )}
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
                                    templates={parseTemplatesSafely(settings.emailTemplates)}
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
                    disabled={saving || !hasChanges()}
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
