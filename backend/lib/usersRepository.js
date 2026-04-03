export const createUsersRepository = ({ db }) => {
    const getBootstrapCompletedStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const setBootstrapCompletedStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const insertUserStmt = db.prepare(`
        INSERT INTO users (id, email, username, passwordHash, role, isVerified, verificationToken, verificationTokenExpires, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findByLoginStmt = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?');
    const findAuthUserByIdStmt = db.prepare('SELECT id, username, email, role, isVerified FROM users WHERE id = ?');
    const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const findUploadActorByIdStmt = db.prepare('SELECT isVerified, role FROM users WHERE id = ?');
    const findByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
    const findByUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
    const findByVerificationTokenStmt = db.prepare('SELECT id, email, verificationToken, verificationTokenExpires, isVerified FROM users WHERE verificationToken = ?');
    const listUsersWithVerificationTokensStmt = db.prepare('SELECT id, email, verificationToken, isVerified FROM users WHERE verificationToken IS NOT NULL');
    const markVerifiedStmt = db.prepare('UPDATE users SET isVerified = 1, verificationToken = NULL, verificationTokenExpires = NULL WHERE id = ?');
    const setResetTokenStmt = db.prepare('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE id = ?');
    const findByResetTokenStmt = db.prepare('SELECT * FROM users WHERE resetToken = ?');
    const updatePasswordAndClearResetStmt = db.prepare('UPDATE users SET passwordHash = ?, resetToken = NULL, resetTokenExpires = NULL WHERE id = ?');
    const setVerificationTokenStmt = db.prepare('UPDATE users SET verificationToken = ?, verificationTokenExpires = ? WHERE id = ?');
    const updateIdentityStmt = db.prepare('UPDATE users SET email = ?, username = ? WHERE id = ?');
    const listUsersStmt = db.prepare('SELECT id, email, username, role, isVerified, createdAt FROM users');
    const countUsersStmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const countFilesStmt = db.prepare('SELECT COUNT(*) as count FROM files');
    const sumFilesSizeStmt = db.prepare('SELECT SUM(size) as size FROM files');
    const listOwnedFilesStmt = db.prepare('SELECT id, serverPath FROM files WHERE userId = ?');
    const deleteUserFilesStmt = db.prepare('DELETE FROM files WHERE userId = ?');
    const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');
    const findRoleByIdStmt = db.prepare('SELECT role FROM users WHERE id = ?');
    const updateRoleStmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    const updateRoleByUsernameStmt = db.prepare('UPDATE users SET role = ? WHERE username = ?');
    const findVerifiedByIdStmt = db.prepare('SELECT isVerified FROM users WHERE id = ?');
    const updateVerifiedStmt = db.prepare('UPDATE users SET isVerified = ? WHERE id = ?');
    const updatePasswordHashStmt = db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?');
    const getOwnedFileTotalSizeStmt = db.prepare('SELECT COALESCE(SUM(size), 0) as totalSize FROM files WHERE userId = ?');

    const deleteUserAndOwnedFilesTxn = db.transaction((userId) => {
        deleteUserFilesStmt.run(userId);
        return deleteUserStmt.run(userId).changes || 0;
    });

    const registerUserTxn = db.transaction(({
        userId,
        email,
        username,
        passwordHash,
        verificationRequired,
        verificationTokenHash,
        verificationTokenExpires,
        createdAt,
        allowPublicRegistration,
        bootstrapTokenAccepted,
    }) => {
        const bootstrapSetting = getBootstrapCompletedStmt.get('adminBootstrapCompleted');
        const bootstrapCompleted = bootstrapSetting?.value === 'true';

        let bootstrapRequested = false;
        if (!allowPublicRegistration) {
            if (!bootstrapTokenAccepted || bootstrapCompleted) {
                const err = new Error('Registro publico deshabilitado');
                err.status = 403;
                throw err;
            }
            bootstrapRequested = true;
        } else if (bootstrapTokenAccepted && !bootstrapCompleted) {
            bootstrapRequested = true;
        }

        insertUserStmt.run(
            userId,
            email,
            username,
            passwordHash,
            bootstrapRequested ? 'admin' : 'user',
            verificationRequired ? 0 : 1,
            verificationTokenHash,
            verificationTokenExpires,
            createdAt,
        );

        if (bootstrapRequested) {
            setBootstrapCompletedStmt.run('adminBootstrapCompleted', 'true');
        }

        return { bootstrapRequested };
    });

    return {
        async registerUser(payload) {
            return registerUserTxn(payload);
        },

        async findByLogin(login) {
            return findByLoginStmt.get(login, login) || null;
        },

        async findAuthUserById(userId) {
            return findAuthUserByIdStmt.get(userId) || null;
        },

        async findById(userId) {
            return findByIdStmt.get(userId) || null;
        },

        async findUploadActorById(userId) {
            return findUploadActorByIdStmt.get(userId) || null;
        },

        async findByEmail(email) {
            return findByEmailStmt.get(email) || null;
        },

        async findByUsername(username) {
            return findByUsernameStmt.get(username) || null;
        },

        async findByVerificationToken(tokenHash) {
            return findByVerificationTokenStmt.get(tokenHash) || null;
        },

        async listUsersWithVerificationTokens() {
            return listUsersWithVerificationTokensStmt.all();
        },

        async markVerified(userId) {
            return markVerifiedStmt.run(userId).changes || 0;
        },

        async setResetToken(userId, tokenHash, expiresAt) {
            return setResetTokenStmt.run(tokenHash, expiresAt, userId).changes || 0;
        },

        async findByResetToken(tokenHash) {
            return findByResetTokenStmt.get(tokenHash) || null;
        },

        async updatePasswordAndClearReset(userId, passwordHash) {
            return updatePasswordAndClearResetStmt.run(passwordHash, userId).changes || 0;
        },

        async setVerificationToken(userId, tokenHash, expiresAt) {
            return setVerificationTokenStmt.run(tokenHash, expiresAt, userId).changes || 0;
        },

        async getAdminStats() {
            return {
                userCount: countUsersStmt.get()?.count || 0,
                fileCount: countFilesStmt.get()?.count || 0,
                totalSize: sumFilesSizeStmt.get()?.size || 0,
            };
        },

        async listUsers() {
            return listUsersStmt.all();
        },

        async updateIdentity(userId, email, username) {
            return updateIdentityStmt.run(email, username, userId).changes || 0;
        },

        async listOwnedFiles(userId) {
            return listOwnedFilesStmt.all(userId);
        },

        async deleteUserAndOwnedFiles(userId) {
            return deleteUserAndOwnedFilesTxn(userId);
        },

        async getRoleById(userId) {
            return findRoleByIdStmt.get(userId)?.role || null;
        },

        async toggleRole(userId) {
            const user = findRoleByIdStmt.get(userId);
            if (!user) {
                return null;
            }

            const nextRole = user.role === 'admin' ? 'user' : 'admin';
            updateRoleStmt.run(nextRole, userId);
            return nextRole;
        },

        async setRoleByUsername(username, role) {
            if (typeof username !== 'string' || username.length === 0) {
                return 0;
            }

            if (typeof role !== 'string' || role.length === 0) {
                return 0;
            }

            return updateRoleByUsernameStmt.run(role, username).changes || 0;
        },

        async toggleVerified(userId) {
            const user = findVerifiedByIdStmt.get(userId);
            if (!user) {
                return null;
            }

            const nextVerified = user.isVerified ? 0 : 1;
            updateVerifiedStmt.run(nextVerified, userId);
            return nextVerified;
        },

        async updatePasswordHash(userId, passwordHash) {
            return updatePasswordHashStmt.run(passwordHash, userId).changes || 0;
        },

        async getOwnedFileTotalSize(userId) {
            return getOwnedFileTotalSizeStmt.get(userId)?.totalSize || 0;
        },
    };
};

export default createUsersRepository;