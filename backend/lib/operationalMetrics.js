const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const escapeLabelValue = (value) => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');

const formatLabels = (labels = {}) => {
    const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null);
    if (entries.length === 0) {
        return '';
    }

    const serialized = entries
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(',');
    return `{${serialized}}`;
};

const metricLine = (name, value, labels) => {
    if (!isFiniteNumber(value)) {
        return null;
    }
    return `${name}${formatLabels(labels)} ${value}`;
};

const normalizeProfile = (value) => {
    const normalized = String(value || 'single').trim().toLowerCase();
    return normalized === 'ha' ? 'ha' : 'single';
};

const normalizeBackend = (value, fallback) => {
    const normalized = String(value || fallback).trim().toLowerCase();
    return normalized || fallback;
};

const buildTopology = (env = process.env) => {
    const profile = normalizeProfile(env.DEPLOYMENT_PROFILE);
    const backends = {
        state: normalizeBackend(env.STATE_BACKEND, 'sqlite'),
        session: normalizeBackend(env.SESSION_BACKEND, 'sqlite'),
        rateLimit: normalizeBackend(env.RATE_LIMIT_BACKEND, 'sqlite'),
        queue: normalizeBackend(env.QUEUE_BACKEND, 'sqlite'),
        uploads: normalizeBackend(env.UPLOAD_STORAGE_BACKEND, 'filesystem'),
    };

    const haRequirements = {
        state: ['postgresql'],
        session: ['redis'],
        rateLimit: ['redis'],
        queue: ['postgresql'],
        uploads: ['object-storage', 'shared-filesystem'],
    };

    const missingHaRequirements = Object.entries(haRequirements)
        .filter(([component, allowedBackends]) => !allowedBackends.includes(backends[component]))
        .map(([component, allowedBackends]) => ({ component, expected: allowedBackends, actual: backends[component] }));

    return {
        profile,
        backends,
        profileReady: profile === 'ha' ? missingHaRequirements.length === 0 : true,
        haRequirements,
        missingHaRequirements,
    };
};

export const buildOperationalMetrics = async ({
    databaseHealthRepository = null,
    uploadSessionsRepository = null,
    uploadDir,
    dataDir,
    checkDiskSpace,
    fsModule,
    fsPromisesModule,
    getQueueStats,
    metrics,
    now = Date.now(),
    env = process.env,
}) => {
    let disk = null;
    let uploadsWritable = false;
    let dataWritable = false;
    let dbOk = false;

    try {
        disk = await checkDiskSpace(uploadDir);
    } catch {}

    try {
        dbOk = databaseHealthRepository ? await databaseHealthRepository.ping() : false;
    } catch {}

    try {
        await fsPromisesModule.access(uploadDir, fsModule.constants.W_OK);
        uploadsWritable = true;
    } catch {}

    try {
        await fsPromisesModule.access(dataDir, fsModule.constants.W_OK);
        dataWritable = true;
    } catch {}

    const queue = await getQueueStats();
    const snapshot = metrics.getSnapshot();
    const counters = snapshot.counters || {};
    const totalUploadsStarted = counters.upload_init || 0;
    const totalUploadsCompleted = counters.upload_complete || 0;
    const totalUploadsCancelled = counters.upload_cancel || 0;
    const totalDownloadsStarted = counters.download_start || 0;
    const totalDownloadsCompleted = counters.download_complete || 0;
    const totalDownloadsFailed = (counters.download_fail || 0) + (counters.download_abort || 0);
    const totalResumeProbes = counters.upload_resume_probe || 0;
    const totalResumeAvailable = counters.upload_resume_available || 0;
    const totalChunkClientErrors = counters.upload_chunk_client_error || 0;
    const totalChunkServerErrors = counters.upload_chunk_server_error || 0;
    const totalHttpRequests = (counters.http_2xx || 0) + (counters.http_4xx || 0) + (counters.http_5xx || 0);
    const uploadCompletionRate = totalUploadsStarted > 0 ? totalUploadsCompleted / totalUploadsStarted : null;
    const downloadSuccessRate = totalDownloadsStarted > 0 ? totalDownloadsCompleted / totalDownloadsStarted : null;
    const resumeAvailabilityRate = totalResumeProbes > 0 ? totalResumeAvailable / totalResumeProbes : null;
    const httpServerErrorRate = totalHttpRequests > 0 ? (counters.http_5xx || 0) / totalHttpRequests : null;
    const activeUploads = uploadSessionsRepository ? await uploadSessionsRepository.countActive() : 0;
    const staleUploads = uploadSessionsRepository ? await uploadSessionsRepository.countStaleActiveBefore(now - (15 * 60 * 1000)) : 0;
    const diskFreePercent = disk?.size ? (disk.free / disk.size) : null;
    const alerts = [];
    const topology = buildTopology(env);

    if (!dbOk || !uploadsWritable || !dataWritable) {
        alerts.push({
            code: 'readiness_degraded',
            severity: 'high',
            message: 'Alguna dependencia critica no esta lista para escribir en produccion.'
        });
    }
    if (typeof diskFreePercent === 'number' && diskFreePercent < 0.15) {
        alerts.push({
            code: 'disk_low',
            severity: diskFreePercent < 0.08 ? 'high' : 'medium',
            message: `Espacio libre bajo en uploads (${Math.round(diskFreePercent * 100)}%).`
        });
    }
    if ((queue.byStatus?.dead || 0) > 0) {
        alerts.push({
            code: 'jobs_dead',
            severity: 'high',
            message: `Hay ${queue.byStatus.dead} jobs en dead-letter queue.`
        });
    }
    if ((counters.http_5xx || 0) > 0) {
        alerts.push({
            code: 'http_5xx_seen',
            severity: 'medium',
            message: `Se registraron ${counters.http_5xx} respuestas 5xx desde el ultimo arranque.`
        });
    }
    if (staleUploads > 0) {
        alerts.push({
            code: 'stale_uploads',
            severity: 'medium',
            message: `Hay ${staleUploads} subidas activas sin actividad reciente.`
        });
    }
    if (typeof resumeAvailabilityRate === 'number' && totalResumeProbes >= 3 && resumeAvailabilityRate < 0.6) {
        alerts.push({
            code: 'resume_recovery_degraded',
            severity: 'medium',
            message: `La reanudación solo recuperó ${Math.round(resumeAvailabilityRate * 100)}% de las sesiones consultadas desde el último arranque.`
        });
    }
    if (totalChunkServerErrors > 0) {
        alerts.push({
            code: 'chunk_server_errors',
            severity: 'high',
            message: `Se registraron ${totalChunkServerErrors} errores 5xx procesando fragmentos de subida.`
        });
    }
    if (typeof downloadSuccessRate === 'number' && totalDownloadsStarted >= 5 && downloadSuccessRate < 0.9) {
        alerts.push({
            code: 'download_success_rate_low',
            severity: 'medium',
            message: `La tasa de éxito de descargas cayó a ${Math.round(downloadSuccessRate * 100)}%.`
        });
    }
    if (typeof uploadCompletionRate === 'number' && totalUploadsStarted >= 5 && uploadCompletionRate < 0.75) {
        alerts.push({
            code: 'upload_completion_rate_low',
            severity: 'medium',
            message: `La tasa de finalización de subidas cayó a ${Math.round(uploadCompletionRate * 100)}%.`
        });
    }
    if (topology.profile === 'ha' && !topology.profileReady) {
        const missing = topology.missingHaRequirements
            .map(({ component, expected, actual }) => `${component}=${actual} (esperado: ${expected.join(' | ')})`)
            .join(', ');
        alerts.push({
            code: 'ha_profile_not_ready',
            severity: 'high',
            message: `DEPLOYMENT_PROFILE=ha exige backends coordinados externos. Configuración incompleta: ${missing}.`
        });
    }

    return {
        metrics: snapshot,
        queue,
        disk,
        topology,
        health: {
            status: dbOk && uploadsWritable && dataWritable ? 'ok' : 'degraded',
            db: dbOk,
            uploads: uploadsWritable,
            data: dataWritable
        },
        alerts,
        summary: {
            uploads: {
                started: totalUploadsStarted,
                completed: totalUploadsCompleted,
                cancelled: totalUploadsCancelled,
                inProgressEstimate: Math.max(0, totalUploadsStarted - totalUploadsCompleted - totalUploadsCancelled),
                activeSessions: activeUploads,
                staleSessions: staleUploads,
                completionRate: uploadCompletionRate
            },
            downloads: {
                started: totalDownloadsStarted,
                completed: totalDownloadsCompleted,
                failedOrAborted: totalDownloadsFailed,
                successRate: downloadSuccessRate
            },
            resumable: {
                probes: totalResumeProbes,
                availableSessions: totalResumeAvailable,
                availabilityRate: resumeAvailabilityRate,
                chunkClientErrors: totalChunkClientErrors,
                chunkServerErrors: totalChunkServerErrors
            },
            http: {
                totalRequests: totalHttpRequests,
                ok: counters.http_2xx || 0,
                clientErrors: counters.http_4xx || 0,
                serverErrors: counters.http_5xx || 0,
                serverErrorRate: httpServerErrorRate
            },
            storage: {
                freeBytes: disk?.free || null,
                sizeBytes: disk?.size || null,
                freePercent: diskFreePercent
            }
        },
        slo: {
            uploads: {
                targetCompletionRate: 0.98,
                currentCompletionRate: uploadCompletionRate
            },
            downloads: {
                targetSuccessRate: 0.99,
                currentSuccessRate: downloadSuccessRate
            },
            resumable: {
                targetAvailabilityRate: 0.9,
                currentAvailabilityRate: resumeAvailabilityRate
            },
            http: {
                targetServerErrorRate: 0.01,
                currentServerErrorRate: httpServerErrorRate
            }
        }
    };
};

export const serializeOperationalMetricsPrometheus = (report) => {
    const lines = [
        '# TYPE sendu_uptime_seconds gauge',
        '# TYPE sendu_health gauge',
        '# TYPE sendu_storage_bytes gauge',
        '# TYPE sendu_storage_free_ratio gauge',
        '# TYPE sendu_queue_jobs gauge',
        '# TYPE sendu_uploads_total gauge',
        '# TYPE sendu_upload_sessions gauge',
        '# TYPE sendu_downloads_total gauge',
        '# TYPE sendu_resumable_total gauge',
        '# TYPE sendu_http_requests_total gauge',
        '# TYPE sendu_slo_ratio gauge',
        '# TYPE sendu_alert_active gauge',
        '# TYPE sendu_counter_total gauge',
        '# TYPE sendu_topology_profile_ready gauge',
        '# TYPE sendu_topology_backend_info gauge',
    ];

    const addLine = (name, value, labels) => {
        const line = metricLine(name, value, labels);
        if (line) {
            lines.push(line);
        }
    };

    addLine('sendu_uptime_seconds', report.metrics?.uptimeSeconds);
    addLine('sendu_health', report.health?.db ? 1 : 0, { component: 'db' });
    addLine('sendu_health', report.health?.uploads ? 1 : 0, { component: 'uploads' });
    addLine('sendu_health', report.health?.data ? 1 : 0, { component: 'data' });
    addLine('sendu_health', report.health?.status === 'ok' ? 1 : 0, { component: 'overall' });
    addLine('sendu_topology_profile_ready', report.topology?.profileReady ? 1 : 0, { profile: report.topology?.profile });

    for (const [component, backend] of Object.entries(report.topology?.backends || {})) {
        addLine('sendu_topology_backend_info', 1, { profile: report.topology?.profile, component, backend });
    }

    addLine('sendu_storage_bytes', report.summary?.storage?.freeBytes, { kind: 'free' });
    addLine('sendu_storage_bytes', report.summary?.storage?.sizeBytes, { kind: 'total' });
    addLine('sendu_storage_free_ratio', report.summary?.storage?.freePercent);

    for (const [status, count] of Object.entries(report.queue?.byStatus || {})) {
        addLine('sendu_queue_jobs', count, { group: 'status', name: status });
    }
    for (const [type, count] of Object.entries(report.queue?.byType || {})) {
        addLine('sendu_queue_jobs', count, { group: 'type', name: type });
    }

    addLine('sendu_uploads_total', report.summary?.uploads?.started, { state: 'started' });
    addLine('sendu_uploads_total', report.summary?.uploads?.completed, { state: 'completed' });
    addLine('sendu_uploads_total', report.summary?.uploads?.cancelled, { state: 'cancelled' });
    addLine('sendu_upload_sessions', report.summary?.uploads?.activeSessions, { state: 'active' });
    addLine('sendu_upload_sessions', report.summary?.uploads?.staleSessions, { state: 'stale' });
    addLine('sendu_slo_ratio', report.summary?.uploads?.completionRate, { indicator: 'upload_completion_rate', kind: 'current' });
    addLine('sendu_slo_ratio', report.slo?.uploads?.targetCompletionRate, { indicator: 'upload_completion_rate', kind: 'target' });

    addLine('sendu_downloads_total', report.summary?.downloads?.started, { state: 'started' });
    addLine('sendu_downloads_total', report.summary?.downloads?.completed, { state: 'completed' });
    addLine('sendu_downloads_total', report.summary?.downloads?.failedOrAborted, { state: 'failed_or_aborted' });
    addLine('sendu_slo_ratio', report.summary?.downloads?.successRate, { indicator: 'download_success_rate', kind: 'current' });
    addLine('sendu_slo_ratio', report.slo?.downloads?.targetSuccessRate, { indicator: 'download_success_rate', kind: 'target' });

    addLine('sendu_resumable_total', report.summary?.resumable?.probes, { state: 'probes' });
    addLine('sendu_resumable_total', report.summary?.resumable?.availableSessions, { state: 'available_sessions' });
    addLine('sendu_resumable_total', report.summary?.resumable?.chunkClientErrors, { state: 'chunk_client_errors' });
    addLine('sendu_resumable_total', report.summary?.resumable?.chunkServerErrors, { state: 'chunk_server_errors' });
    addLine('sendu_slo_ratio', report.summary?.resumable?.availabilityRate, { indicator: 'resumable_availability_rate', kind: 'current' });
    addLine('sendu_slo_ratio', report.slo?.resumable?.targetAvailabilityRate, { indicator: 'resumable_availability_rate', kind: 'target' });

    addLine('sendu_http_requests_total', report.summary?.http?.ok, { status: '2xx' });
    addLine('sendu_http_requests_total', report.summary?.http?.clientErrors, { status: '4xx' });
    addLine('sendu_http_requests_total', report.summary?.http?.serverErrors, { status: '5xx' });
    addLine('sendu_slo_ratio', report.summary?.http?.serverErrorRate, { indicator: 'http_server_error_rate', kind: 'current' });
    addLine('sendu_slo_ratio', report.slo?.http?.targetServerErrorRate, { indicator: 'http_server_error_rate', kind: 'target' });

    for (const alert of report.alerts || []) {
        addLine('sendu_alert_active', 1, { code: alert.code, severity: alert.severity });
    }

    for (const [counterName, value] of Object.entries(report.metrics?.counters || {})) {
        addLine('sendu_counter_total', value, { counter: counterName });
    }

    return `${lines.join('\n')}\n`;
};