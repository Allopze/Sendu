const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeBase = (value, fallback = '/api') => (value || fallback).replace(/\/$/, '');

const resolveApiBase = (value, fallback = '/api') => {
    const normalized = normalizeBase(value, fallback);

    if (typeof window === 'undefined') {
        return normalized;
    }

    // In local/previews we prefer same-origin requests even if the production
    // build baked an absolute API host. This keeps packaged builds testable
    // without weakening the deployed production configuration.
    if (/^https?:\/\//i.test(normalized) && LOCAL_HOSTNAMES.has(window.location.hostname)) {
        try {
            const parsed = new URL(normalized);
            return `${window.location.origin}${parsed.pathname}`.replace(/\/$/, '');
        } catch {
            return normalized;
        }
    }

    return normalized;
};

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE, '/api');
const UPLOAD_API_BASE = resolveApiBase(import.meta.env.VITE_UPLOAD_API_BASE, API_BASE);

// Helper to get CSRF token from cookie
const getCsrfToken = () => {
    const match = document.cookie.match(/csrf-token=([^;]+)/);
    return match ? match[1] : null;
};

let csrfBootstrapPromise = null;

const ensureCsrfToken = async ({ force = false } = {}) => {
    const existingToken = getCsrfToken();
    if ((existingToken && !force) || typeof document === 'undefined') {
        return existingToken;
    }

    if (!csrfBootstrapPromise) {
        csrfBootstrapPromise = fetch(`${API_BASE}/auth/csrf`, {
            credentials: 'include'
        }).catch(() => null).finally(() => {
            csrfBootstrapPromise = null;
        });
    }

    await csrfBootstrapPromise;
    return getCsrfToken();
};

const isCsrfFailureResponse = async (response) => {
    if (!response || response.status !== 403) {
        return false;
    }

    try {
        const data = await response.clone().json();
        return typeof data?.error === 'string' && data.error.toLowerCase().includes('csrf');
    } catch {
        return false;
    }
};

// Helper for requests that need CSRF token
const fetchWithCsrf = async (url, options = {}) => {
    const method = options.method?.toUpperCase();
    const requiresCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    const buildHeaders = async (forceRefresh = false) => {
        const headers = { ...options.headers };
        if (!requiresCsrf) {
            return headers;
        }

        const csrfToken = await ensureCsrfToken({ force: forceRefresh });
        if (csrfToken) {
            headers['x-csrf-token'] = csrfToken;
        }
        return headers;
    };

    const executeRequest = async (forceRefresh = false) => fetch(url, {
        ...options,
        headers: await buildHeaders(forceRefresh),
        credentials: 'include'
    });

    let response = await executeRequest(false);

    if (requiresCsrf && await isCsrfFailureResponse(response)) {
        response = await executeRequest(true);
    }

    return response;
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
    uploadChunk: (uploadId, uploadToken, index, chunk, signal) => {
        const formData = new FormData();
        formData.append('chunk', chunk);
        return fetch(`${UPLOAD_API_BASE}/upload/chunk?uploadId=${uploadId}&index=${index}`, {
            method: 'POST',
            credentials: 'include',
            headers: uploadToken ? { 'x-upload-token': uploadToken } : undefined,
            body: formData,
            signal
        });
    },
    completeUpload: (uploadId, extra = {}) => fetchWithCsrf(`${UPLOAD_API_BASE}/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, ...extra })
    }),
    getUploadStatus: (uploadId, uploadToken) => fetch(`${UPLOAD_API_BASE}/upload/status/${uploadId}`, {
        credentials: 'include',
        headers: uploadToken ? { 'x-upload-token': uploadToken } : undefined
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
    getAdminMetrics: () => fetch(`${API_BASE}/admin/metrics`, { credentials: 'include' }),
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
    getHealthReady: () => fetch(`${API_BASE}/health/ready`, { credentials: 'include' }),
    getPublicSettings: () => fetch(`${API_BASE}/settings/public`),
    getUploadLimits: () => fetch(`${API_BASE}/settings/limits`, { credentials: 'include' }),
};

export { API_BASE, UPLOAD_API_BASE };
export default apiClient;
