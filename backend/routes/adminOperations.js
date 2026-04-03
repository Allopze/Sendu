export const registerAdminOperationsRoutes = ({
    app,
    requireAdmin,
    asyncHandler,
    enqueueCleanup,
    CHUNKS_DIR,
    UPLOAD_DIR,
    cleanupOrphanedChunks,
    logger,
    getQueueStats,
    getPendingJobs,
    JOB_TYPES,
    retryDeadJobs,
    cancelJob,
    buildOperationalMetrics,
    getDatabaseHealthRepository,
    getUploadSessionsRepository,
    dataDir,
    checkDiskSpace,
    fs,
    fsPromises,
    metrics,
    serializeOperationalMetricsPrometheus,
    canAccessExportedMetrics,
}) => {
    app.post('/api/admin/cleanup-chunks', requireAdmin, asyncHandler(async (req, res) => {
        const { maxAgeHours = 1, useQueue = false } = req.body;

        if (useQueue) {
            const jobId = await enqueueCleanup('chunks', {
                maxAgeHours,
                chunksDir: CHUNKS_DIR
            });
            return res.json({
                message: 'Limpieza encolada para procesamiento en segundo plano',
                jobId
            });
        }

        const maxAgeMs = Math.max(1, Math.min(720, maxAgeHours)) * 60 * 60 * 1000;
        const result = await cleanupOrphanedChunks(maxAgeMs);
        const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(2);

        logger.info(`Manual cleanup: Deleted ${result.deletedCount} orphaned chunk folders, freed ${freedMB}MB`);

        res.json({
            message: `Se eliminaron ${result.deletedCount} carpetas de chunks huérfanos`,
            deletedCount: result.deletedCount,
            freedBytes: result.freedBytes,
            freedMB: parseFloat(freedMB)
        });
    }));

    app.get('/api/admin/jobs/stats', requireAdmin, asyncHandler(async (req, res) => {
        res.json(await getQueueStats());
    }));

    app.get('/api/admin/jobs/pending', requireAdmin, asyncHandler(async (req, res) => {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const type = typeof req.query.type === 'string' ? req.query.type : null;

        if (type && type !== 'all' && !Object.values(JOB_TYPES).includes(type)) {
            return res.status(400).json({ error: 'Tipo de job invalido' });
        }

        if (type && type !== 'all') {
            return res.json({ jobs: await getPendingJobs(type, limit) });
        }

        const jobGroups = await Promise.all(Object.values(JOB_TYPES).map((jobType) => getPendingJobs(jobType, limit)));
        const combined = jobGroups
            .flat()
            .sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return a.scheduled_at - b.scheduled_at;
            })
            .slice(0, limit);

        return res.json({ jobs: combined });
    }));

    app.post('/api/admin/jobs/retry-dead', requireAdmin, asyncHandler(async (req, res) => {
        const { type } = req.body || {};

        if (type && !Object.values(JOB_TYPES).includes(type)) {
            return res.status(400).json({ error: 'Tipo de job invalido' });
        }

        const retried = await retryDeadJobs(type || null);
        res.json({
            message: `Se reintentaron ${retried} job(s) muertos`,
            retried,
            type: type || 'all'
        });
    }));

    app.post('/api/admin/jobs/:id/cancel', requireAdmin, asyncHandler(async (req, res) => {
        const cancelled = await cancelJob(req.params.id);
        if (!cancelled) {
            return res.status(404).json({ error: 'Job no encontrado o no esta pendiente' });
        }
        res.json({ message: 'Job cancelado', id: req.params.id });
    }));

    app.get('/api/admin/metrics', requireAdmin, asyncHandler(async (req, res) => {
        const report = await buildOperationalMetrics({
            databaseHealthRepository: getDatabaseHealthRepository(),
            uploadSessionsRepository: getUploadSessionsRepository(),
            uploadDir: UPLOAD_DIR,
            dataDir,
            checkDiskSpace,
            fsModule: fs,
            fsPromisesModule: fsPromises,
            getQueueStats,
            metrics,
        });
        res.json(report);
    }));

    app.get('/metrics', asyncHandler(async (req, res) => {
        if (!(await canAccessExportedMetrics(req))) {
            return res.status(401).type('text/plain').send('unauthorized\n');
        }

        const report = await buildOperationalMetrics({
            databaseHealthRepository: getDatabaseHealthRepository(),
            uploadSessionsRepository: getUploadSessionsRepository(),
            uploadDir: UPLOAD_DIR,
            dataDir,
            checkDiskSpace,
            fsModule: fs,
            fsPromisesModule: fsPromises,
            getQueueStats,
            metrics,
        });

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        res.send(serializeOperationalMetricsPrometheus(report));
    }));

    app.post('/api/admin/jobs/cleanup', requireAdmin, asyncHandler(async (req, res) => {
        const { type = 'all' } = req.body;
        const jobs = [];

        if (type === 'files' || type === 'all') {
            const jobId = await enqueueCleanup('files', { uploadDir: UPLOAD_DIR });
            jobs.push({ type: 'files', jobId });
        }

        if (type === 'chunks' || type === 'all') {
            const jobId = await enqueueCleanup('chunks', { chunksDir: CHUNKS_DIR });
            jobs.push({ type: 'chunks', jobId });
        }

        res.json({
            message: `${jobs.length} trabajo(s) de limpieza encolado(s)`,
            jobs
        });
    }));
};
