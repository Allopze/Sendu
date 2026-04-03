export const createJobQueueRepository = ({ db }) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS job_queue (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            last_error TEXT,
            scheduled_at INTEGER NOT NULL,
            started_at INTEGER,
            completed_at INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            locked_by TEXT,
            locked_until INTEGER
        )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_status ON job_queue(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_scheduled ON job_queue(scheduled_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_type ON job_queue(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_priority ON job_queue(priority DESC, scheduled_at ASC)`);

    const enqueueJobStmt = db.prepare(`
        INSERT INTO job_queue (id, type, payload, priority, max_retries, scheduled_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const selectNextPendingStmt = db.prepare(`
        SELECT * FROM job_queue
        WHERE status = 'pending'
        AND scheduled_at <= ?
        AND (locked_until IS NULL OR locked_until < ?)
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT 1
    `);
    const lockPendingJobStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'processing',
            locked_by = ?,
            locked_until = ?,
            started_at = ?,
            attempts = attempts + 1
        WHERE id = ?
        AND status = 'pending'
        AND (locked_until IS NULL OR locked_until < ?)
    `);
    const completeJobStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'completed',
            completed_at = ?,
            locked_by = NULL,
            locked_until = NULL
        WHERE id = ?
    `);
    const markDeadJobStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'dead',
            last_error = ?,
            completed_at = ?,
            locked_by = NULL,
            locked_until = NULL
        WHERE id = ?
    `);
    const rescheduleJobStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'pending',
            last_error = ?,
            scheduled_at = ?,
            locked_by = NULL,
            locked_until = NULL
        WHERE id = ?
    `);
    const resetStaleProcessingStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'pending', locked_by = NULL, locked_until = NULL
        WHERE status = 'processing' AND locked_until < ?
    `);
    const cleanupFinishedBeforeStmt = db.prepare(`
        DELETE FROM job_queue
        WHERE (status = 'completed' OR status = 'dead')
        AND completed_at < ?
    `);
    const statsByStatusStmt = db.prepare(`
        SELECT
            status,
            COUNT(*) as count,
            AVG(attempts) as avg_attempts
        FROM job_queue
        GROUP BY status
    `);
    const pendingByTypeStatsStmt = db.prepare(`
        SELECT
            type,
            COUNT(*) as count
        FROM job_queue
        WHERE status = 'pending'
        GROUP BY type
    `);
    const listPendingByTypeStmt = db.prepare(`
        SELECT id, type, payload, priority, attempts, scheduled_at, created_at
        FROM job_queue
        WHERE type = ? AND status = 'pending'
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT ?
    `);
    const retryDeadByTypeStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'pending', attempts = 0, scheduled_at = ?, locked_by = NULL, locked_until = NULL
        WHERE status = 'dead' AND type = ?
    `);
    const retryDeadAllStmt = db.prepare(`
        UPDATE job_queue
        SET status = 'pending', attempts = 0, scheduled_at = ?, locked_by = NULL, locked_until = NULL
        WHERE status = 'dead'
    `);
    const cancelPendingStmt = db.prepare(`
        DELETE FROM job_queue WHERE id = ? AND status = 'pending'
    `);

    const acquireNextAvailableJobTxn = db.transaction((workerId, now, lockUntil) => {
        const job = selectNextPendingStmt.get(now, now);
        if (!job) {
            return null;
        }

        const result = lockPendingJobStmt.run(workerId, lockUntil, now, job.id, now);
        if ((result.changes || 0) === 0) {
            return null;
        }

        return {
            ...job,
            status: 'processing',
            locked_by: workerId,
            locked_until: lockUntil,
            started_at: now,
            attempts: (job.attempts || 0) + 1,
        };
    });

    return {
        async enqueueJob({ id, type, payload, priority, maxRetries, scheduledAt }) {
            return enqueueJobStmt.run(id, type, payload, priority, maxRetries, scheduledAt).changes || 0;
        },

        async acquireNextAvailableJob({ workerId, now, lockUntil }) {
            const job = acquireNextAvailableJobTxn(workerId, now, lockUntil);
            if (!job) {
                return null;
            }

            return {
                ...job,
                payload: JSON.parse(job.payload),
            };
        },

        async completeJob(jobId, completedAt) {
            return completeJobStmt.run(completedAt, jobId).changes || 0;
        },

        async markDeadJob(jobId, error, completedAt) {
            return markDeadJobStmt.run(error, completedAt, jobId).changes || 0;
        },

        async rescheduleJob(jobId, error, scheduledAt) {
            return rescheduleJobStmt.run(error, scheduledAt, jobId).changes || 0;
        },

        async resetStaleProcessingJobs(now) {
            return resetStaleProcessingStmt.run(now).changes || 0;
        },

        async cleanupFinishedBefore(cutoff) {
            return cleanupFinishedBeforeStmt.run(cutoff).changes || 0;
        },

        async getQueueStats() {
            const stats = statsByStatusStmt.all();
            const byType = pendingByTypeStatsStmt.all();

            return {
                byStatus: stats.reduce((accumulator, row) => ({ ...accumulator, [row.status]: row.count }), {}),
                byType: byType.reduce((accumulator, row) => ({ ...accumulator, [row.type]: row.count }), {}),
                total: stats.reduce((sum, row) => sum + row.count, 0),
            };
        },

        async listPendingJobs(type, limit) {
            return listPendingByTypeStmt.all(type, limit).map((job) => ({
                ...job,
                payload: JSON.parse(job.payload),
            }));
        },

        async retryDeadJobs(type, scheduledAt) {
            const result = type
                ? retryDeadByTypeStmt.run(scheduledAt, type)
                : retryDeadAllStmt.run(scheduledAt);

            return result.changes || 0;
        },

        async cancelPendingJob(jobId) {
            return cancelPendingStmt.run(jobId).changes || 0;
        },
    };
};

export default createJobQueueRepository;