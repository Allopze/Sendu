const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
const UPLOAD_API_BASE = (import.meta.env.VITE_UPLOAD_API_BASE || API_BASE).replace(/\/$/, '');

// Helper to get CSRF token from cookie
const getCsrfToken = () => {
    const match = document.cookie.match(/csrf-token=([^;]+)/);
    return match ? match[1] : null;
};

// Helper for requests that need CSRF token
const fetchWithCsrf = (url, options = {}) => {
    const csrfToken = getCsrfToken();
    const headers = {
        ...options.headers,
    };
    
    // Add CSRF token for state-changing requests
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(options.method?.toUpperCase())) {
        headers['x-csrf-token'] = csrfToken;
    }
    
    return fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });
};

const apiClient = {
    // Auth
    login: (data) => fetchWithCsrf(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }),
    logout: () => fetchWithCsrf(`${API_BASE}/auth/logout`, { method: 'POST' }),
    register: (data) => fetchWithCsrf(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }),
    me: () => fetch(`${API_BASE}/auth/me`, { credentials: 'include' }),
    
    // Email verification
    verifyEmail: (token) => fetch(`${API_BASE}/auth/verify?token=${token}`, { credentials: 'include' }),
    resendVerification: () => fetchWithCsrf(`${API_BASE}/auth/resend-verification`, {
        method: 'POST'
    }),
    
    // Password reset
    forgotPassword: (email) => fetchWithCsrf(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    }),
    validateResetToken: (token) => fetch(`${API_BASE}/auth/reset-password/validate?token=${token}`),
    resetPassword: (token, password) => fetchWithCsrf(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
    }),

    // Files
    initUpload: (data) => fetchWithCsrf(`${UPLOAD_API_BASE}/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }),
    uploadChunk: (uploadId, index, chunk, signal) => {
        const formData = new FormData();
        formData.append('chunk', chunk);
        return fetch(`${UPLOAD_API_BASE}/upload/chunk?uploadId=${uploadId}&index=${index}`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
            signal
        });
    },
    completeUpload: (uploadId) => fetchWithCsrf(`${UPLOAD_API_BASE}/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
    }),
    cancelUpload: (uploadId) => fetchWithCsrf(`${UPLOAD_API_BASE}/upload/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
    }),
    getFileMeta: (id) => fetch(`${API_BASE}/meta/${id}`, { credentials: 'include' }),
    validateDownload: (id, password) => fetchWithCsrf(`${API_BASE}/download/${id}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    }),
    downloadFile: (id, password) => fetchWithCsrf(`${API_BASE}/download/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    }),
    deleteFile: (id) => fetchWithCsrf(`${API_BASE}/files/${id}`, { method: 'DELETE' }),
    getUserFiles: () => fetch(`${API_BASE}/user/files`, { credentials: 'include' }),

    // Admin
    getAdminStats: () => fetch(`${API_BASE}/admin/stats`, { credentials: 'include' }),
    getAdminUsers: () => fetch(`${API_BASE}/admin/users`, { credentials: 'include' }),
    getAdminFiles: () => fetch(`${API_BASE}/admin/files`, { credentials: 'include' }),
    getAdminSettings: () => fetch(`${API_BASE}/admin/settings`, { credentials: 'include' }),
    getAdminSettingsAudit: (page = 1, limit = 20) => fetch(`${API_BASE}/admin/settings/audit?page=${page}&limit=${limit}`, { credentials: 'include' }),
    getAdminJobStats: () => fetch(`${API_BASE}/admin/jobs/stats`, { credentials: 'include' }),
    getAdminPendingJobs: (type = 'all', limit = 20) => {
        const queryType = encodeURIComponent(type || 'all');
        return fetch(`${API_BASE}/admin/jobs/pending?type=${queryType}&limit=${limit}`, { credentials: 'include' });
    },
    updateAdminSettings: (data) => fetchWithCsrf(`${API_BASE}/admin/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }),
    retryDeadJobs: (type) => fetchWithCsrf(`${API_BASE}/admin/jobs/retry-dead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(type ? { type } : {})
    }),
    cancelJob: (id) => fetchWithCsrf(`${API_BASE}/admin/jobs/${id}/cancel`, {
        method: 'POST'
    }),
    // User management
    updateUser: (id, data) => fetchWithCsrf(`${API_BASE}/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }),
    deleteUser: (id) => fetchWithCsrf(`${API_BASE}/admin/users/${id}`, {
        method: 'DELETE'
    }),
    toggleUserRole: (id) => fetchWithCsrf(`${API_BASE}/admin/users/${id}/toggle-role`, {
        method: 'POST'
    }),
    toggleUserVerified: (id) => fetchWithCsrf(`${API_BASE}/admin/users/${id}/toggle-verified`, {
        method: 'POST'
    }),
    resetUserPassword: (id, password) => fetchWithCsrf(`${API_BASE}/admin/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    }),
    sendUserVerification: (id) => fetchWithCsrf(`${API_BASE}/admin/users/${id}/send-verification`, {
        method: 'POST'
    }),
    sendUserPasswordReset: (id) => fetchWithCsrf(`${API_BASE}/admin/users/${id}/send-reset`, {
        method: 'POST'
    }),
    uploadBranding: (type, file) => {
        const formData = new FormData();
        formData.append('file', file);
        const csrfToken = getCsrfToken();
        return fetch(`${API_BASE}/admin/branding/upload?type=${type}`, {
            method: 'POST',
            credentials: 'include',
            headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
            body: formData
        });
    },
    deleteBranding: (type) => fetchWithCsrf(`${API_BASE}/admin/branding/${type}`, {
        method: 'DELETE'
    }),
    testEmail: (email) => fetchWithCsrf(`${API_BASE}/admin/smtp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    }),
    cleanupChunks: (maxAgeHours = 1) => fetchWithCsrf(`${API_BASE}/admin/cleanup-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeHours })
    }),
    resetRateLimits: (prefix = 'all') => fetchWithCsrf(`${API_BASE}/admin/rate-limits/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix })
    }),

    // Public
    getPublicSettings: () => fetch(`${API_BASE}/settings/public`),
    getUploadLimits: () => fetch(`${API_BASE}/settings/limits`, { credentials: 'include' }),
};

export { API_BASE, UPLOAD_API_BASE };
export default apiClient;
