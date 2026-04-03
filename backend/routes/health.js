export const registerHealthRoutes = ({
    app,
    requireAdmin,
    getDatabaseHealthRepository,
    fs,
    fsPromises,
    UPLOAD_DIR,
    dataDir,
    sessionCookieSecure,
    sessionCookieSameSite,
    sessionCookieDomain,
}) => {
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: Date.now(),
            uptime: process.uptime()
        });
    });

    app.get('/api/health/session', requireAdmin, (req, res) => {
        if (process.env.NODE_ENV === 'production' && !process.env.DEBUG_SESSION) {
            return res.status(404).json({ error: 'Not found' });
        }

        const cookieName = process.env.SESSION_COOKIE_NAME || 'sendu.sid';
        const sessionCookie = req.cookies?.[cookieName];
        const trustProxyValue = app.get('trust proxy');

        res.json({
            config: {
                cookieName,
                secure: sessionCookieSecure,
                sameSite: sessionCookieSameSite,
                domain: sessionCookieDomain || '(not set)',
                trustProxy: trustProxyValue,
                trustProxyType: typeof trustProxyValue,
                nodeEnv: process.env.NODE_ENV
            },
            request: {
                hasSessionCookie: !!sessionCookie,
                cookieValue: sessionCookie ? sessionCookie.substring(0, 20) + '...' : null,
                sessionId: (req.session?.id || req.sessionID)?.substring(0, 16) + '...',
                hasUserId: !!req.session?.userId,
                protocol: req.protocol,
                secure: req.secure,
                xForwardedProto: req.get('x-forwarded-proto'),
                host: req.get('host'),
                origin: req.get('origin')
            },
            cookies: Object.keys(req.cookies || {}),
            fix: req.protocol !== 'https' && req.get('x-forwarded-proto') === 'https'
                ? 'Trust proxy is not working correctly. Try setting TRUST_PROXY=true'
                : null
        });
    });

    app.get('/api/health/ready', async (req, res) => {
        let dbOk = false;
        let storageOk = false;
        let dataOk = false;

        try {
            dbOk = await getDatabaseHealthRepository().ping();
        } catch {}

        try {
            await fsPromises.access(UPLOAD_DIR, fs.constants.W_OK);
            storageOk = true;
        } catch {}

        try {
            await fsPromises.access(dataDir, fs.constants.W_OK);
            dataOk = true;
        } catch {}

        const ready = dbOk && storageOk && dataOk;
        res.status(ready ? 200 : 503).json({
            status: ready ? 'ok' : 'degraded',
            db: dbOk,
            uploads: storageOk,
            data: dataOk,
            timestamp: Date.now()
        });
    });
};

export default registerHealthRoutes;