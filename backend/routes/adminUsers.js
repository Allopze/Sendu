export const registerAdminUserRoutes = ({
    app,
    requireAdmin,
    asyncHandler,
    getUsersRepository,
    logger,
    fsPromises,
    bcrypt,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    PASSWORD_POLICY_MESSAGE,
    generateSecureToken,
    isEmailDeliveryEnabled,
    sendTemplatedEmail,
    PUBLIC_ORIGIN,
}) => {
    const usersRepository = () => getUsersRepository();

    app.get('/api/admin/stats', requireAdmin, asyncHandler(async (req, res) => {
        res.json(await usersRepository().getAdminStats());
    }));

    app.get('/api/admin/users', requireAdmin, asyncHandler(async (req, res) => {
        const users = await usersRepository().listUsers();
        res.json({ users });
    }));

    app.put('/api/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { email, username } = req.body;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email requerido' });
        }
        if (!isValidEmail(email) || email.length > 255) {
            return res.status(400).json({ error: 'Formato de email inválido' });
        }

        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username requerido' });
        }
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Username inválido (3-30 caracteres alfanuméricos o guion bajo)' });
        }

        try {
            await usersRepository().updateIdentity(id, email.toLowerCase().trim(), username.trim());
            res.json({ message: 'Usuario actualizado' });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'Email o username ya existe' });
            }
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al actualizar usuario' });
        }
    }));

    app.delete('/api/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;

        if (id === req.session.userId) {
            return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
        }

        try {
            const userFiles = await usersRepository().listOwnedFiles(id);
            for (const file of userFiles) {
                try {
                    await fsPromises.unlink(file.serverPath);
                } catch (err) {
                    if (err.code !== 'ENOENT') {
                        logger.warn('Error deleting user file', { fileId: file.id, error: err.message });
                    }
                }
            }
            await usersRepository().deleteUserAndOwnedFiles(id);
            res.json({ message: 'Usuario eliminado' });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al eliminar usuario' });
        }
    }));

    app.post('/api/admin/users/:id/toggle-role', requireAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;

        if (id === req.session.userId) {
            return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
        }

        try {
            const newRole = await usersRepository().toggleRole(id);
            if (!newRole) return res.status(404).json({ error: 'Usuario no encontrado' });
            res.json({ message: 'Rol actualizado', role: newRole });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al cambiar rol' });
        }
    }));

    app.post('/api/admin/users/:id/toggle-verified', requireAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;

        try {
            const newVerified = await usersRepository().toggleVerified(id);
            if (newVerified === null) return res.status(404).json({ error: 'Usuario no encontrado' });
            res.json({ message: 'Estado de verificación actualizado', isVerified: newVerified });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al cambiar verificación' });
        }
    }));

    app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
        const { id } = req.params;
        const { password } = req.body;

        if (!password || !isValidPassword(password)) {
            return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 12);
            await usersRepository().updatePasswordHash(id, hashedPassword);
            res.json({ message: 'Contraseña actualizada' });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al cambiar contraseña' });
        }
    });

    app.post('/api/admin/users/:id/send-verification', requireAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;

        try {
            const user = await usersRepository().findById(id);
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

            if (user.isVerified) {
                return res.status(400).json({ error: 'El usuario ya está verificado' });
            }

            if (!isEmailDeliveryEnabled()) {
                return res.status(503).json({ error: 'La verificación por email no está disponible mientras SMTP no esté configurado' });
            }

            const { token: verificationToken, hash: verificationTokenHash } = generateSecureToken();
            const verificationTokenExpires = Date.now() + (24 * 60 * 60 * 1000);

            await usersRepository().setVerificationToken(id, verificationTokenHash, verificationTokenExpires);

            logger.info('Verification token updated for user', {
                userId: id,
                email: user.email,
                tokenHashStart: verificationTokenHash.substring(0, 16) + '...',
                expires: new Date(verificationTokenExpires).toISOString()
            });

            const verificationLink = `${PUBLIC_ORIGIN}/verify?token=${verificationToken}`;
            logger.debug('Verification link generated', {
                link: verificationLink.substring(0, 50) + '...',
                tokenStart: verificationToken.substring(0, 16) + '...'
            });

            await sendTemplatedEmail(user.email, 'verification', {
                username: user.username,
                email: user.email,
                verificationLink
            });

            res.json({ message: 'Email de verificación enviado' });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al enviar email de verificación' });
        }
    }));

    app.post('/api/admin/users/:id/send-reset', requireAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;

        try {
            const user = await usersRepository().findById(id);
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

            if (!isEmailDeliveryEnabled()) {
                return res.status(503).json({ error: 'La recuperación por email no está disponible mientras SMTP no esté configurado' });
            }

            const { token: resetToken, hash: resetTokenHash } = generateSecureToken();
            const resetTokenExpires = Date.now() + (60 * 60 * 1000);

            await usersRepository().setResetToken(id, resetTokenHash, resetTokenExpires);

            const resetLink = `${PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
            await sendTemplatedEmail(user.email, 'passwordReset', {
                username: user.username,
                email: user.email,
                resetLink
            });

            res.json({ message: 'Email de reseteo de contraseña enviado' });
        } catch (err) {
            logger.error('Error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Error al enviar email de reseteo' });
        }
    }));
};

export default registerAdminUserRoutes;