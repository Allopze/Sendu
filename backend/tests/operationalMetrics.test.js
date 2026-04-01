import { describe, expect, it } from 'vitest';

import {
    buildOperationalMetrics,
    serializeOperationalMetricsPrometheus,
} from '../lib/operationalMetrics.js';

describe('operationalMetrics helpers', () => {
    it('builds operational metrics and emits a Prometheus payload', async () => {
        const fakeDb = {
            prepare: (query) => ({
                get: (value) => {
                    if (query.includes('SELECT 1')) {
                        return { ok: 1 };
                    }
                    if (query.includes('updatedAt <')) {
                        return { total: value ? 1 : 0 };
                    }
                    return { total: 2 };
                }
            })
        };

        const report = await buildOperationalMetrics({
            db: fakeDb,
            uploadDir: '/tmp/uploads',
            dataDir: '/tmp/data',
            checkDiskSpace: async () => ({ free: 50, size: 100 }),
            fsModule: { constants: { W_OK: 2 } },
            fsPromisesModule: { access: async () => undefined },
            getQueueStats: () => ({ byStatus: { pending: 3, dead: 1 }, byType: { email: 2 }, total: 4 }),
            metrics: {
                getSnapshot: () => ({
                    uptimeSeconds: 42,
                    counters: {
                        upload_init: 10,
                        upload_complete: 6,
                        download_start: 5,
                        download_complete: 4,
                        upload_resume_probe: 4,
                        upload_resume_available: 2,
                        http_2xx: 20,
                        http_4xx: 3,
                        http_5xx: 1,
                    }
                })
            },
            now: Date.now(),
        });

        expect(report.health.status).toBe('ok');
        expect(report.alerts.some((alert) => alert.code === 'jobs_dead')).toBe(true);
        expect(report.summary.uploads.activeSessions).toBe(2);

        const prometheusPayload = serializeOperationalMetricsPrometheus(report);
        expect(prometheusPayload).toContain('sendu_uptime_seconds 42');
        expect(prometheusPayload).toContain('sendu_health{component="overall"} 1');
        expect(prometheusPayload).toContain('sendu_queue_jobs{group="status",name="dead"} 1');
        expect(prometheusPayload).toContain('sendu_alert_active{code="jobs_dead",severity="high"} 1');
    });
});