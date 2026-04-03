export const registerFileRoutes = ({
    app,
    requireAuth,
    requireAdmin,
    asyncHandler,
    getFilesRepository,
    getUsersRepository,
    serializeFileForClient,
    fsPromises,
    logger,
}) => {
    const filesRepository = () => getFilesRepository();
    const usersRepository = () => getUsersRepository();

    app.get('/api/user/files', requireAuth, asyncHandler(async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;

        const total = await filesRepository().countByUser(req.session.userId);
        const files = (await filesRepository().listByUser(req.session.userId, { limit, offset }))
            .map(serializeFileForClient);

        res.json({
            files,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    }));

    app.delete('/api/files/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const file = await filesRepository().findById(id);

        if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

        const role = await usersRepository().getRoleById(req.session.userId);

        if (file.userId !== req.session.userId && role !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        await filesRepository().deleteById(id);

        try {
            await fsPromises.unlink(file.serverPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.warn('Error deleting file from disk', { fileId: id, error: err.message });
            }
        }

        res.json({ message: 'Archivo eliminado' });
    }));

    app.get('/api/admin/files', requireAdmin, asyncHandler(async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;

        const total = await filesRepository().countAll();
        const files = (await filesRepository().listAll({ limit, offset }))
            .map(serializeFileForClient);

        res.json({
            files,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    }));
};

export default registerFileRoutes;