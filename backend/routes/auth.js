export const registerAuthRoutes = ({
    app,
    authLimiter,
    passwordResetLimiter,
    asyncHandler,
    getUsersRepository,
    bcrypt,
    uuidv4,
    logger,
    hashToken,
    generateSecureToken,
    safeCompare,
    sendTemplatedEmail,
    PUBLIC_ORIGIN,
    ALLOW_PUBLIC_REGISTRATION,
    ADMIN_BOOTSTRAP_TOKEN,
    PASSWORD_POLICY_MESSAGE,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    isEmailDeliveryEnabled,
    requireAuth,
    sessionCookieDomain,
    sessionCookieSecure,
    sessionCookieSameSite,
}) => {
    const usersRepository = () => getUsersRepository();

    app.get('/api/auth/csrf', (req, res) => {
        res.json({
            token: typeof req.csrfToken === 'function' ? req.csrfToken() : null
        });
    });

    app.post('/api/auth/register', authLimiter, asyncHandler(async (req, res) => {
        const { email, username, password, adminBootstrapToken } = req.body;
        if (!email || !username || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Formato de email inválido' });
        }

        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'El nombre de usuario debe tener 3-30 caracteres alfanuméricos' });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 12);
            const userId = uuidv4();
            const verificationRequired = isEmailDeliveryEnabled();
            const verificationTokenData = verificationRequired ? generateSecureToken() : null;
            const verificationTokenHash = verificationTokenData?.hash ?? null;
            const verificationTokenExpires = verificationTokenData ? Date.now() + (24 * 60 * 60 * 1000) : null;
            const bootstrapTokenAccepted = Boolean(
                adminBootstrapToken
                && ADMIN_BOOTSTRAP_TOKEN
                && safeCompare(adminBootstrapToken, ADMIN_BOOTSTRAP_TOKEN)
            );

            const { bootstrapRequested } = await usersRepository().registerUser({
                userId,
                email,
                username,
                passwordHash: hashedPassword,
                verificationRequired,
                verificationTokenHash,
                verificationTokenExpires,
                createdAt: Date.now(),
                allowPublicRegistration: ALLOW_PUBLIC_REGISTRATION,
                bootstrapTokenAccepted,
            });

            if (verificationRequired && verificationTokenData) {
                const verificationLink = `${PUBLIC_ORIGIN}/verify?token=${verificationTokenData.token}`;
                await sendTemplatedEmail(email, 'welcome', {
                    username,
                    email,
                    verificationLink
                });
            }

            const message = verificationRequired
                ? (bootstrapRequested
                    ? 'Usuario registrado como administrador. Por favor verifica tu email.'
                    : 'Usuario registrado. Por favor verifica tu email.')
                : (bootstrapRequested
                    ? 'Usuario registrado como administrador. El email está deshabilitado en este entorno, ya puedes iniciar sesión.'
                    : 'Usuario registrado. El email está deshabilitado en este entorno, ya puedes iniciar sesión.');
            res.status(201).json({
                message,
                emailDeliveryEnabled: verificationRequired,
                requiresEmailVerification: verificationRequired
            });
        } catch (err) {
            if (err.status) {
                return res.status(err.status).json({ error: err.message });
            }
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'El email o nombre de usuario ya existe' });
            }
            logger.error('Error en registro', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    }));

    app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
        const { login, password } = req.body;
        if (!login || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

        if (login.length > 255 || password.length > 255) {
            return res.status(400).json({ error: 'Datos de entrada inválidos' });
        }

        try {
            const user = await usersRepository().findByLogin(login);

            if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            req.session.regenerate((err) => {
                if (err) {
                    logger.error('Error regenerating session', { error: err.message });
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }

                req.session.userId = user.id;

                req.session.save((saveErr) => {
                    if (saveErr) {
                        logger.error('Error saving session after login', { error: saveErr.message });
                        return res.status(500).json({ error: 'Error interno del servidor' });
                    }

                    logger.info('User logged in successfully', {
                        userId: user.id,
                        sessionId: (req.session.id || req.sessionID)?.substring(0, 8) + '...'
                    });

                    res.json({ message: 'Sesión iniciada correctamente', user: { id: user.id, username: user.username, email: user.email, role: user.role } });
                });
            });
        } catch (err) {
            logger.error('Error en login', { error: err.message });
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    }));

    app.post('/api/auth/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ error: 'No se pudo cerrar sesión' });
            res.clearCookie(process.env.SESSION_COOKIE_NAME || 'sendu.sid', {
                ...(sessionCookieDomain ? { domain: sessionCookieDomain } : {})
            });
            res.json({ message: 'Sesión cerrada' });
        });
    });

    app.get('/api/auth/me', (req, res) => {
        const sessionId = req.session?.id || req.sessionID;
        const hasSessionCookie = !!(req.cookies?.[process.env.SESSION_COOKIE_NAME || 'sendu.sid']);

        logger.debug('Auth check', {
            hasSessionCookie,
            sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
            userId: req.session?.userId || 'none',
            cookieSecure: sessionCookieSecure,
            cookieSameSite: sessionCookieSameSite
        });

        if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });

        usersRepository().findAuthUserById(req.session.userId)
            .then((user) => {
                if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
                res.json({ user });
            })
            .catch((err) => {
                logger.error('Error', { error: err.message, stack: err.stack });
                res.status(500).json({ error: 'Error interno del servidor' });
            });
    });

    app.get('/api/auth/verify', asyncHandler(async (req, res) => {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ error: 'Token de verificación requerido' });
        }

        try {
            const tokenHash = hashToken(token);
            logger.debug('Verification attempt', {
                tokenLength: token.length,
                tokenHashStart: tokenHash.substring(0, 16) + '...'
            });

            const user = await usersRepository().findByVerificationToken(tokenHash);

            if (!user) {
                const allUsers = await usersRepository().listUsersWithVerificationTokens();
                logger.debug('No user found with token', {
                    searchedHash: tokenHash.substring(0, 16) + '...',
                    usersWithTokens: allUsers.length,
                    storedHashes: allUsers.map((entry) => entry.verificationToken?.substring(0, 16) + '...')
                });
                return res.status(400).json({ error: 'Token de verificación inválido o expirado' });
            }

            logger.debug('User found for verification', { userId: user.id, email: user.email });

            if (user.verificationTokenExpires && Date.now() > user.verificationTokenExpires) {
                return res.status(400).json({ error: 'El token de verificación ha expirado' });
            }

            if (user.isVerified) {
                return res.json({ message: 'El email ya está verificado', alreadyVerified: true });
            }

            await usersRepository().markVerified(user.id);

            res.json({ message: 'Email verificado correctamente', success: true });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al verificar email' });
        }
    }));

    app.post('/api/auth/forgot-password', passwordResetLimiter, asyncHandler(async (req, res) => {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email requerido' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Formato de email inválido' });
        }

        if (!isEmailDeliveryEnabled()) {
            return res.status(503).json({ error: 'La recuperación de contraseña por email no está disponible en este entorno' });
        }

        try {
            const user = await usersRepository().findByEmail(email);

            if (!user) {
                return res.json({ message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
            }

            const { token: resetToken, hash: resetTokenHash } = generateSecureToken();
            const resetTokenExpires = Date.now() + (60 * 60 * 1000);

            await usersRepository().setResetToken(user.id, resetTokenHash, resetTokenExpires);

            const resetLink = `${PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
            await sendTemplatedEmail(email, 'passwordReset', {
                username: user.username,
                email: user.email,
                resetLink
            });

            res.json({ message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al procesar la solicitud' });
        }
    }));

    app.get('/api/auth/reset-password/validate', asyncHandler(async (req, res) => {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ error: 'Token requerido', valid: false });
        }

        try {
            const tokenHash = hashToken(token);
            const user = await usersRepository().findByResetToken(tokenHash);

            if (!user) {
                return res.status(400).json({ error: 'Token inválido', valid: false });
            }

            if (user.resetTokenExpires && Date.now() > user.resetTokenExpires) {
                return res.status(400).json({ error: 'El token ha expirado', valid: false });
            }

            res.json({ valid: true, username: user.username });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al validar token', valid: false });
        }
    }));

    app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ error: 'Token y contraseña requeridos' });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
        }

        try {
            const tokenHash = hashToken(token);
            const user = await usersRepository().findByResetToken(tokenHash);

            if (!user) {
                return res.status(400).json({ error: 'Token inválido o expirado' });
            }

            if (user.resetTokenExpires && Date.now() > user.resetTokenExpires) {
                return res.status(400).json({ error: 'El token ha expirado' });
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            await usersRepository().updatePasswordAndClearReset(user.id, hashedPassword);

            res.json({ message: 'Contraseña actualizada correctamente', success: true });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al actualizar contraseña' });
        }
    }));

    app.post('/api/auth/resend-verification', requireAuth, asyncHandler(async (req, res) => {
        try {
            const user = await usersRepository().findById(req.session.userId);

            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            if (user.isVerified) {
                return res.status(400).json({ error: 'El email ya está verificado' });
            }

            if (!isEmailDeliveryEnabled()) {
                await usersRepository().markVerified(user.id);
                return res.json({
                    message: 'La verificación por email está deshabilitada en este entorno. Tu cuenta ha sido habilitada.',
                    autoVerified: true
                });
            }

            const { token: verificationToken, hash: verificationTokenHash } = generateSecureToken();
            const verificationTokenExpires = Date.now() + (24 * 60 * 60 * 1000);

            await usersRepository().setVerificationToken(user.id, verificationTokenHash, verificationTokenExpires);

            const verificationLink = `${PUBLIC_ORIGIN}/verify?token=${verificationToken}`;
            await sendTemplatedEmail(user.email, 'verification', {
                username: user.username,
                email: user.email,
                verificationLink
            });

            res.json({ message: 'Email de verificación reenviado' });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al reenviar email de verificación' });
        }
    }));
};
