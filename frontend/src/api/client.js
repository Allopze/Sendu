const API_BASE = '/api';

const apiClient = {
    // Auth
    login: (data) => fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    }),
    logout: () => fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }),
    register: (data) => fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    }),
    me: () => fetch(`${API_BASE}/auth/me`, { credentials: 'include' }),
    
    // Email verification
    verifyEmail: (token) => fetch(`${API_BASE}/auth/verify?token=${token}`, { credentials: 'include' }),
    resendVerification: () => fetch(`${API_BASE}/auth/resend-verification`, {
        method: 'POST',
        credentials: 'include'
    }),
    
    // Password reset
    forgotPassword: (email) => fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    }),
    validateResetToken: (token) => fetch(`${API_BASE}/auth/reset-password/validate?token=${token}`),
    resetPassword: (token, password) => fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
    }),

    // Files
    initUpload: (data) => fetch(`${API_BASE}/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    }),
    uploadChunk: (uploadId, index, chunk) => {
        const formData = new FormData();
        formData.append('chunk', chunk);
        return fetch(`${API_BASE}/upload/chunk?uploadId=${uploadId}&index=${index}`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
    },
    completeUpload: (uploadId) => fetch(`${API_BASE}/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ uploadId })
    }),
    getFileMeta: (id) => fetch(`${API_BASE}/meta/${id}`, { credentials: 'include' }),
    downloadFile: (id, password) => fetch(`${API_BASE}/download/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
    }),
    deleteFile: (id) => fetch(`${API_BASE}/files/${id}`, { method: 'DELETE', credentials: 'include' }),
    getUserFiles: () => fetch(`${API_BASE}/user/files`, { credentials: 'include' }),

    // Admin
    getAdminStats: () => fetch(`${API_BASE}/admin/stats`, { credentials: 'include' }),
    getAdminUsers: () => fetch(`${API_BASE}/admin/users`, { credentials: 'include' }),
    getAdminFiles: () => fetch(`${API_BASE}/admin/files`, { credentials: 'include' }),
    getAdminSettings: () => fetch(`${API_BASE}/admin/settings`, { credentials: 'include' }),
    updateAdminSettings: (data) => fetch(`${API_BASE}/admin/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    }),
    // User management
    updateUser: (id, data) => fetch(`${API_BASE}/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    }),
    deleteUser: (id) => fetch(`${API_BASE}/admin/users/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    }),
    toggleUserRole: (id) => fetch(`${API_BASE}/admin/users/${id}/toggle-role`, {
        method: 'POST',
        credentials: 'include'
    }),
    toggleUserVerified: (id) => fetch(`${API_BASE}/admin/users/${id}/toggle-verified`, {
        method: 'POST',
        credentials: 'include'
    }),
    resetUserPassword: (id, password) => fetch(`${API_BASE}/admin/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
    }),
    sendUserVerification: (id) => fetch(`${API_BASE}/admin/users/${id}/send-verification`, {
        method: 'POST',
        credentials: 'include'
    }),
    sendUserPasswordReset: (id) => fetch(`${API_BASE}/admin/users/${id}/send-reset`, {
        method: 'POST',
        credentials: 'include'
    }),
    uploadBranding: (type, file) => {
        const formData = new FormData();
        formData.append('file', file);
        return fetch(`${API_BASE}/admin/branding/upload?type=${type}`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
    },
    deleteBranding: (type) => fetch(`${API_BASE}/admin/branding/${type}`, {
        method: 'DELETE',
        credentials: 'include'
    }),
    testEmail: (email) => fetch(`${API_BASE}/admin/smtp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
    }),

    // Public
    getPublicSettings: () => fetch(`${API_BASE}/settings/public`),
    getUploadLimits: () => fetch(`${API_BASE}/settings/limits`),
};

export default apiClient;
