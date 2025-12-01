import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import StatsCards from '../components/dashboard/StatsCards';
import { Loader2, Trash2, Users, FileText, Settings, Upload, X, Sun, Moon, Image, Mail, Send, HardDrive, FileCode, Shield, Key, Edit2, Check, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import Toast from '../components/ui/Toast';
import Tooltip from '../components/ui/Tooltip';
import ConfirmModal from '../components/ui/ConfirmModal';
import { useBranding } from '../context/BrandingContext';
import EmailTemplateEditor from '../components/admin/EmailTemplateEditor';

const AdminPage = () => {
    const { updateSettings: updateBrandingContext } = useBranding();
    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState([]);
    const [files, setFiles] = useState([]);
    const [settings, setSettings] = useState({ 
        showName: 'true', 
        logoLight: '', 
        logoDark: '', 
        favicon: '',
        footerText: '',
        smtpHost: '',
        smtpPort: '587',
        smtpSecure: 'false',
        smtpUser: '',
        smtpPass: '',
        smtpFrom: '',
        maxFileSize: '100',
        maxTotalSize: '500',
        emailTemplates: ''
    });
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState(null);
    const [uploading, setUploading] = useState({});
    const [testingEmail, setTestingEmail] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    
    // Confirmation modal state
    const [deleteUserModal, setDeleteUserModal] = useState({ isOpen: false, userId: null, username: '' });
    const [deleteFileModal, setDeleteFileModal] = useState({ isOpen: false, fileId: null, fileName: '' });
    
    // User management state
    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({ email: '', username: '' });
    const [resetPasswordUser, setResetPasswordUser] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [userMenuOpen, setUserMenuOpen] = useState(null);
    
    const logoLightRef = useRef(null);
    const logoDarkRef = useRef(null);
    const faviconRef = useRef(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [statsRes, usersRes, filesRes, settingsRes] = await Promise.all([
                apiClient.getAdminStats(),
                apiClient.getAdminUsers(),
                apiClient.getAdminFiles(),
                apiClient.getAdminSettings()
            ]);

            if (statsRes.ok) setStats(await statsRes.json());
            if (usersRes.ok) setUsers((await usersRes.json()).users);
            if (filesRes.ok) setFiles((await filesRes.json()).files);
            if (settingsRes.ok) setSettings(await settingsRes.json());

        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // User management functions
    const handleToggleRole = async (userId) => {
        try {
            const res = await apiClient.toggleUserRole(userId);
            if (res.ok) {
                const data = await res.json();
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: data.role } : u));
                setToast({ message: `Rol cambiado a ${data.role}`, type: 'success' });
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al cambiar rol', type: 'error' });
        }
        setUserMenuOpen(null);
    };

    const handleToggleVerified = async (userId) => {
        try {
            const res = await apiClient.toggleUserVerified(userId);
            if (res.ok) {
                const data = await res.json();
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, isVerified: data.isVerified } : u));
                setToast({ message: data.isVerified ? 'Usuario verificado' : 'Verificación removida', type: 'success' });
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al cambiar verificación', type: 'error' });
        }
        setUserMenuOpen(null);
    };

    const handleDeleteUser = async (userId) => {
        try {
            const res = await apiClient.deleteUser(userId);
            if (res.ok) {
                setUsers(prev => prev.filter(u => u.id !== userId));
                setToast({ message: 'Usuario eliminado', type: 'success' });
                fetchData(); // Refresh stats
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al eliminar usuario', type: 'error' });
        }
        setUserMenuOpen(null);
        setDeleteUserModal({ isOpen: false, userId: null, username: '' });
    };

    const openDeleteUserModal = (user) => {
        setDeleteUserModal({ isOpen: true, userId: user.id, username: user.username });
        setUserMenuOpen(null);
    };

    const handleStartEdit = (user) => {
        setEditingUser(user.id);
        setEditForm({ email: user.email, username: user.username });
        setUserMenuOpen(null);
    };

    const handleSaveEdit = async (userId) => {
        try {
            const res = await apiClient.updateUser(userId, editForm);
            if (res.ok) {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...editForm } : u));
                setToast({ message: 'Usuario actualizado', type: 'success' });
                setEditingUser(null);
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al actualizar usuario', type: 'error' });
        }
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
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al cambiar contraseña', type: 'error' });
        }
    };

    const handleSendVerificationEmail = async (userId) => {
        try {
            const res = await apiClient.sendUserVerification(userId);
            if (res.ok) {
                setToast({ message: 'Email de verificación enviado', type: 'success' });
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al enviar email de verificación', type: 'error' });
        }
    };

    const handleSendPasswordResetEmail = async (userId) => {
        try {
            const res = await apiClient.sendUserPasswordReset(userId);
            if (res.ok) {
                setToast({ message: 'Email de reseteo de contraseña enviado', type: 'success' });
            } else {
                const err = await res.json();
                setToast({ message: err.error, type: 'error' });
            }
        } catch (err) {
            setToast({ message: 'Error al enviar email de reseteo', type: 'error' });
        }
    };

    const handleUpdateSettings = async (newSettings) => {
        try {
            await apiClient.updateAdminSettings(newSettings);
            setSettings(prev => ({ ...prev, ...newSettings }));
            // Update branding context for immediate UI refresh
            const brandingKeys = ['showName', 'logoLight', 'logoDark', 'favicon', 'footerText'];
            const brandingUpdate = {};
            for (const key of brandingKeys) {
                if (newSettings[key] !== undefined) {
                    brandingUpdate[key] = newSettings[key];
                }
            }
            if (Object.keys(brandingUpdate).length > 0) {
                updateBrandingContext(brandingUpdate);
            }
            setToast({ message: 'Configuración guardada correctamente', type: 'success' });
        } catch (err) {
            console.error(err);
            setToast({ message: 'Error al guardar configuración', type: 'error' });
        }
    };

    const handleUploadBranding = async (type, file) => {
        if (!file) return;
        setUploading(prev => ({ ...prev, [type]: true }));
        try {
            const res = await apiClient.uploadBranding(type, file);
            if (res.ok) {
                const data = await res.json();
                setSettings(prev => ({ ...prev, [type]: data.url }));
                // Update branding context for immediate UI refresh
                updateBrandingContext({ [type]: data.url });
                setToast({ message: 'Archivo subido correctamente', type: 'success' });
            } else {
                const err = await res.json();
                setToast({ message: err.error || 'Error al subir archivo', type: 'error' });
            }
        } catch (err) {
            console.error(err);
            setToast({ message: 'Error al subir archivo', type: 'error' });
        } finally {
            setUploading(prev => ({ ...prev, [type]: false }));
        }
    };

    const handleDeleteBranding = async (type) => {
        try {
            const res = await apiClient.deleteBranding(type);
            if (res.ok) {
                setSettings(prev => ({ ...prev, [type]: '' }));
                // Update branding context for immediate UI refresh
                updateBrandingContext({ [type]: '' });
                setToast({ message: 'Archivo eliminado', type: 'success' });
            }
        } catch (err) {
            console.error(err);
            setToast({ message: 'Error al eliminar archivo', type: 'error' });
        }
    };

    const handleTestEmail = async () => {
        if (!testEmail) {
            setToast({ message: 'Introduce un email de prueba', type: 'error' });
            return;
        }
        setTestingEmail(true);
        try {
            const res = await apiClient.testEmail(testEmail);
            const data = await res.json();
            if (res.ok) {
                setToast({ message: 'Email de prueba enviado correctamente', type: 'success' });
            } else {
                setToast({ message: data.error || 'Error al enviar email', type: 'error' });
            }
        } catch (err) {
            console.error(err);
            setToast({ message: 'Error al enviar email de prueba', type: 'error' });
        } finally {
            setTestingEmail(false);
        }
    };

    const handleDeleteFile = async (id) => {
        try {
            await apiClient.deleteFile(id);
            fetchData();
            setToast({ message: 'Archivo eliminado', type: 'success' });
        } catch (err) {
            setToast({ message: 'Error al eliminar archivo', type: 'error' });
        }
        setDeleteFileModal({ isOpen: false, fileId: null, fileName: '' });
    };

    const openDeleteFileModal = (file) => {
        setDeleteFileModal({ isOpen: true, fileId: file.id, fileName: file.originalName });
    };

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="animate-spin" /></div>;

    return (
        <>
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}

            <div className="space-y-8">
                <h1 className="text-3xl font-bold">Panel de Administración</h1>

                {/* Estadísticas */}
                {stats && <StatsCards stats={stats} />}

                {/* Reset Password Modal */}
                {resetPasswordUser && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setResetPasswordUser(null)}>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
                            <h3 className="text-lg font-bold mb-4">Restablecer Contraseña</h3>
                            <p className="text-sm text-gray-500 mb-4">Usuario: {users.find(u => u.id === resetPasswordUser)?.username}</p>
                            <input
                                type="password"
                                placeholder="Nueva contraseña (mín. 6 caracteres)"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500 mb-4"
                            />
                            <div className="flex justify-end gap-3">
                                <button onClick={() => { setResetPasswordUser(null); setNewPassword(''); }} className="px-4 py-2 text-gray-600 hover:text-gray-800">
                                    Cancelar
                                </button>
                                <button onClick={() => handleResetPassword(resetPasswordUser)} className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700">
                                    Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Panel Unificado */}
                <div className="glass rounded-2xl overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
                    {/* Usuarios */}
                    <div className="pb-6">
                        <div className="flex items-center gap-3 px-4 py-4">
                            <Users size={20} className="text-primary-600" />
                            <h2 className="text-lg font-bold">Usuarios</h2>
                            <span className="text-sm text-gray-500">({users.length})</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50/50 dark:bg-gray-800/30 text-sm text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">Usuario</th>
                                        <th className="px-4 py-3 font-medium">Email</th>
                                        <th className="px-4 py-3 font-medium">Estado</th>
                                        <th className="px-4 py-3 font-medium">Rol</th>
                                        <th className="px-4 py-3 font-medium">Creado</th>
                                        <th className="px-4 py-3 font-medium text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(user => (
                                        <tr key={user.id} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                                            <td className="px-4 py-3">
                                                {editingUser === user.id ? (
                                                    <input
                                                        type="text"
                                                        value={editForm.username}
                                                        onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                                                        className="w-full px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                                                    />
                                                ) : (
                                                    <span className="font-medium">{user.username}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {editingUser === user.id ? (
                                                    <input
                                                        type="email"
                                                        value={editForm.email}
                                                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                                        className="w-full px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                                                    />
                                                ) : (
                                                    <span className="text-gray-600 dark:text-gray-400">{user.email}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {user.isVerified ? (
                                                    <span className="flex items-center gap-1 text-green-600 text-sm">
                                                        <CheckCircle size={14} /> Verificado
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-yellow-600 text-sm">
                                                        <XCircle size={14} /> Pendiente
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${user.role === 'admin' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                                    {user.role === 'admin' ? 'Admin' : 'Usuario'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-500 text-sm">{new Date(user.createdAt).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-right">
                                                {editingUser === user.id ? (
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => handleSaveEdit(user.id)} className="p-2 rounded-lg text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30">
                                                            <Check size={16} />
                                                        </button>
                                                        <button onClick={() => setEditingUser(null)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end gap-1">
                                                        <Tooltip text="Editar">
                                                            <button onClick={() => handleStartEdit(user)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700">
                                                                <Edit2 size={15} />
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip text="Cambiar contraseña">
                                                            <button onClick={() => { setResetPasswordUser(user.id); }} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700">
                                                                <Key size={15} />
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip text="Enviar email de reseteo">
                                                            <button onClick={() => handleSendPasswordResetEmail(user.id)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-blue-600">
                                                                <RefreshCw size={15} />
                                                            </button>
                                                        </Tooltip>
                                                        {!user.isVerified && (
                                                            <Tooltip text="Enviar email de verificación">
                                                                <button onClick={() => handleSendVerificationEmail(user.id)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-green-600">
                                                                    <Mail size={15} />
                                                                </button>
                                                            </Tooltip>
                                                        )}
                                                        <Tooltip text={user.isVerified ? 'Quitar verificación' : 'Verificar'}>
                                                            <button onClick={() => handleToggleVerified(user.id)} className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${user.isVerified ? 'text-green-500' : 'text-yellow-500'}`}>
                                                                {user.isVerified ? <CheckCircle size={15} /> : <XCircle size={15} />}
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip text={user.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}>
                                                            <button onClick={() => handleToggleRole(user.id)} className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${user.role === 'admin' ? 'text-primary-500' : 'text-gray-400'}`}>
                                                                <Shield size={15} />
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip text="Eliminar">
                                                            <button onClick={() => openDeleteUserModal(user)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500">
                                                                <Trash2 size={15} />
                                                            </button>
                                                        </Tooltip>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {users.length === 0 && (
                                        <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No hay usuarios registrados</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Archivos */}
                    <div className="py-8 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 px-4 pb-4">
                            <FileText size={20} className="text-primary-600" />
                            <h2 className="text-lg font-bold">Archivos</h2>
                            <span className="text-sm text-gray-500">({files.length})</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50/50 dark:bg-gray-800/30 text-sm text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">Nombre</th>
                                        <th className="px-4 py-3 font-medium">Tamaño</th>
                                        <th className="px-4 py-3 font-medium">Descargas</th>
                                        <th className="px-4 py-3 font-medium">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {files.map(file => (
                                        <tr key={file.id} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                                            <td className="px-4 py-3 max-w-xs truncate font-medium" title={file.originalName}>{file.originalName}</td>
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</td>
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{file.downloadCount}</td>
                                            <td className="px-4 py-3">
                                                <button onClick={() => openDeleteFileModal(file)} className="p-2 rounded-lg text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {files.length === 0 && (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No hay archivos subidos</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Configuración */}
                    <div className="py-8 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 px-4 pb-4">
                            <Settings size={20} className="text-primary-600" />
                            <h2 className="text-lg font-bold">Configuración de Marca</h2>
                        </div>
                        <div className="px-4 pb-6 space-y-8">
                            {/* Toggle Nombre */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="font-medium text-gray-700 dark:text-gray-300">Mostrar Nombre "Sendu"</label>
                                    <p className="text-sm text-gray-500">Muestra el nombre junto al logo en la navegación</p>
                                </div>
                                <button
                                    onClick={() => handleUpdateSettings({ showName: settings.showName === 'true' ? 'false' : 'true' })}
                                    className={`w-14 h-7 rounded-full transition-colors relative ${settings.showName === 'true' ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                >
                                    <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${settings.showName === 'true' ? 'left-8' : 'left-1'}`} />
                                </button>
                            </div>

                            {/* Logos Upload */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Logo Tema Claro */}
                                <div>
                                    <label className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        <Sun size={16} /> Logo Tema Claro
                                    </label>
                                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-center hover:border-primary-500 transition-colors">
                                        {settings.logoLight ? (
                                            <div className="relative group">
                                                <img src={settings.logoLight} alt="Logo Claro" className="h-16 mx-auto object-contain bg-white rounded p-2" />
                                                <button
                                                    onClick={() => handleDeleteBranding('logoLight')}
                                                    className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => logoLightRef.current?.click()}
                                                disabled={uploading.logoLight}
                                                className="flex flex-col items-center gap-2 w-full py-4 text-gray-500 hover:text-primary-600 transition-colors"
                                            >
                                                {uploading.logoLight ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                                                <span className="text-sm">Subir logo</span>
                                            </button>
                                        )}
                                        <input
                                            ref={logoLightRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/svg+xml"
                                            className="hidden"
                                            onChange={(e) => handleUploadBranding('logoLight', e.target.files[0])}
                                        />
                                    </div>
                                </div>

                                {/* Logo Tema Oscuro */}
                                <div>
                                    <label className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        <Moon size={16} /> Logo Tema Oscuro
                                    </label>
                                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-center hover:border-primary-500 transition-colors">
                                        {settings.logoDark ? (
                                            <div className="relative group">
                                                <img src={settings.logoDark} alt="Logo Oscuro" className="h-16 mx-auto object-contain bg-gray-800 rounded p-2" />
                                                <button
                                                    onClick={() => handleDeleteBranding('logoDark')}
                                                    className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => logoDarkRef.current?.click()}
                                                disabled={uploading.logoDark}
                                                className="flex flex-col items-center gap-2 w-full py-4 text-gray-500 hover:text-primary-600 transition-colors"
                                            >
                                                {uploading.logoDark ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                                                <span className="text-sm">Subir logo</span>
                                            </button>
                                        )}
                                        <input
                                            ref={logoDarkRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/svg+xml"
                                            className="hidden"
                                            onChange={(e) => handleUploadBranding('logoDark', e.target.files[0])}
                                        />
                                    </div>
                                </div>

                                {/* Favicon */}
                                <div>
                                    <label className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        <Image size={16} /> Favicon
                                    </label>
                                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-center hover:border-primary-500 transition-colors">
                                        {settings.favicon ? (
                                            <div className="relative group">
                                                <img src={settings.favicon} alt="Favicon" className="h-16 w-16 mx-auto object-contain bg-gray-100 dark:bg-gray-800 rounded p-2" />
                                                <button
                                                    onClick={() => handleDeleteBranding('favicon')}
                                                    className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => faviconRef.current?.click()}
                                                disabled={uploading.favicon}
                                                className="flex flex-col items-center gap-2 w-full py-4 text-gray-500 hover:text-primary-600 transition-colors"
                                            >
                                                {uploading.favicon ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                                                <span className="text-sm">Subir favicon</span>
                                            </button>
                                        )}
                                        <input
                                            ref={faviconRef}
                                            type="file"
                                            accept="image/png,image/x-icon,image/vnd.microsoft.icon"
                                            className="hidden"
                                            onChange={(e) => handleUploadBranding('favicon', e.target.files[0])}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">PNG o ICO, 32x32 o 64x64 recomendado</p>
                                </div>
                            </div>

                            {/* Footer Text */}
                            <div>
                                <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Texto del Footer</label>
                                <p className="text-sm text-gray-500 mb-2">Deja vacío para usar el texto por defecto</p>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        placeholder="© 2025 Mi Empresa. Todos los derechos reservados."
                                        className="flex-grow px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.footerText || ''}
                                        onChange={(e) => setSettings({ ...settings, footerText: e.target.value })}
                                    />
                                    <button
                                        onClick={() => handleUpdateSettings({ footerText: settings.footerText })}
                                        className="px-6 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium whitespace-nowrap"
                                    >
                                        Guardar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Límites de Subida */}
                    <div className="py-8 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 px-4 pb-4">
                            <HardDrive size={20} className="text-primary-600" />
                            <h2 className="text-lg font-bold">Límites de Subida</h2>
                        </div>
                        <div className="px-4 pb-6 space-y-6">
                            <p className="text-sm text-gray-500">Configura los límites de tamaño para las subidas de archivos</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Max File Size */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Tamaño Máximo por Archivo (MB)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="100"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.maxFileSize || ''}
                                        onChange={(e) => setSettings({ ...settings, maxFileSize: e.target.value })}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Límite de tamaño para cada archivo individual</p>
                                </div>

                                {/* Max Total Size */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Tamaño Máximo Total por Subida (MB)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="500"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.maxTotalSize || ''}
                                        onChange={(e) => setSettings({ ...settings, maxTotalSize: e.target.value })}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Límite total cuando se suben múltiples archivos</p>
                                </div>
                            </div>

                            {/* Save Limits Button */}
                            <div className="flex justify-end">
                                <button
                                    onClick={() => handleUpdateSettings({ 
                                        maxFileSize: settings.maxFileSize,
                                        maxTotalSize: settings.maxTotalSize
                                    })}
                                    className="px-6 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium"
                                >
                                    Guardar Límites
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* SMTP Email */}
                    <div className="py-8 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 px-4 pb-4">
                            <Mail size={20} className="text-primary-600" />
                            <h2 className="text-lg font-bold">Configuración SMTP</h2>
                        </div>
                        <div className="px-4 pb-6 space-y-6">
                            <p className="text-sm text-gray-500">Configura el servidor SMTP para enviar notificaciones por email</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* SMTP Host */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Servidor SMTP</label>
                                    <input
                                        type="text"
                                        placeholder="smtp.ejemplo.com"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.smtpHost || ''}
                                        onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                                    />
                                </div>

                                {/* SMTP Port */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Puerto</label>
                                    <input
                                        type="text"
                                        placeholder="587"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.smtpPort || ''}
                                        onChange={(e) => setSettings({ ...settings, smtpPort: e.target.value })}
                                    />
                                </div>

                                {/* SMTP User */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Usuario</label>
                                    <input
                                        type="text"
                                        placeholder="usuario@ejemplo.com"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.smtpUser || ''}
                                        onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                                    />
                                </div>

                                {/* SMTP Password */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Contraseña</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.smtpPass || ''}
                                        onChange={(e) => setSettings({ ...settings, smtpPass: e.target.value })}
                                    />
                                </div>

                                {/* SMTP From */}
                                <div>
                                    <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Email Remitente</label>
                                    <input
                                        type="email"
                                        placeholder="noreply@ejemplo.com"
                                        className="w-full px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={settings.smtpFrom || ''}
                                        onChange={(e) => setSettings({ ...settings, smtpFrom: e.target.value })}
                                    />
                                </div>

                                {/* SMTP Secure */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="font-medium text-gray-700 dark:text-gray-300">TLS/SSL</label>
                                        <p className="text-sm text-gray-500">Usar conexión segura (puerto 465)</p>
                                    </div>
                                    <button
                                        onClick={() => setSettings({ ...settings, smtpSecure: settings.smtpSecure === 'true' ? 'false' : 'true' })}
                                        className={`w-14 h-7 rounded-full transition-colors relative ${settings.smtpSecure === 'true' ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                    >
                                        <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${settings.smtpSecure === 'true' ? 'left-8' : 'left-1'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Save SMTP Button */}
                            <div className="flex justify-end">
                                <button
                                    onClick={() => handleUpdateSettings({ 
                                        smtpHost: settings.smtpHost,
                                        smtpPort: settings.smtpPort,
                                        smtpUser: settings.smtpUser,
                                        smtpPass: settings.smtpPass,
                                        smtpFrom: settings.smtpFrom,
                                        smtpSecure: settings.smtpSecure
                                    })}
                                    className="px-6 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium"
                                >
                                    Guardar Configuración SMTP
                                </button>
                            </div>

                            {/* Test Email */}
                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                <label className="block font-medium text-gray-700 dark:text-gray-300 mb-2">Probar Configuración</label>
                                <p className="text-sm text-gray-500 mb-3">Envía un email de prueba para verificar la configuración</p>
                                <div className="flex gap-3">
                                    <input
                                        type="email"
                                        placeholder="test@ejemplo.com"
                                        className="flex-grow px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                        value={testEmail}
                                        onChange={(e) => setTestEmail(e.target.value)}
                                    />
                                    <button
                                        onClick={handleTestEmail}
                                        disabled={testingEmail}
                                        className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors font-medium whitespace-nowrap disabled:opacity-50"
                                    >
                                        {testingEmail ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                        Enviar Prueba
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Plantillas de Email */}
                    <div className="py-8 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 px-4 pb-4">
                            <FileCode size={20} className="text-primary-600" />
                            <h2 className="text-lg font-bold">Plantillas de Email</h2>
                        </div>
                        <div className="px-4 pb-6">
                            <p className="text-sm text-gray-500 mb-6">Personaliza las plantillas de correo electrónico con editor HTML y variables dinámicas</p>
                            <EmailTemplateEditor
                                templates={settings.emailTemplates ? JSON.parse(settings.emailTemplates) : null}
                                onSave={handleUpdateSettings}
                                onToast={setToast}
                                logoUrl={settings.logoDark}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal de confirmación para eliminar usuario */}
            <ConfirmModal
                isOpen={deleteUserModal.isOpen}
                onClose={() => setDeleteUserModal({ isOpen: false, userId: null, username: '' })}
                onConfirm={() => handleDeleteUser(deleteUserModal.userId)}
                title="Eliminar usuario"
                message={`¿Estás seguro de que deseas eliminar al usuario "${deleteUserModal.username}" y todos sus archivos? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                variant="danger"
            />

            {/* Modal de confirmación para eliminar archivo */}
            <ConfirmModal
                isOpen={deleteFileModal.isOpen}
                onClose={() => setDeleteFileModal({ isOpen: false, fileId: null, fileName: '' })}
                onConfirm={() => handleDeleteFile(deleteFileModal.fileId)}
                title="Eliminar archivo"
                message={`¿Estás seguro de que deseas eliminar "${deleteFileModal.fileName}"?`}
                confirmText="Eliminar"
                variant="danger"
            />
        </>
    );
};

export default AdminPage;
