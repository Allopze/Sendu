import { describe, expect, it } from 'vitest';

import {
    buildOperationalMetrics,
    serializeOperationalMetricsPrometheus,
} from '../lib/operationalMetrics.js';

describe('operationalMetrics helpers', () => {
    it('builds operational metrics and emits a Prometheus payload', async () => {
        const report = await buildOperationalMetrics({
            databaseHealthRepository: {
                ping: async () => true,
            },
            uploadSessionsRepository: {
                countActive: async () => 2,
                countStaleActiveBefore: async () => 1,
            },
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
            env: {
                DEPLOYMENT_PROFILE: 'ha',
                STATE_BACKEND: 'sqlite',
                SESSION_BACKEND: 'sqlite',
                RATE_LIMIT_BACKEND: 'sqlite',
                QUEUE_BACKEND: 'sqlite',
                UPLOAD_STORAGE_BACKEND: 'filesystem',
            },
        });

        expect(report.health.status).toBe('ok');
        expect(report.alerts.some((alert) => alert.code === 'jobs_dead')).toBe(true);
        expect(report.alerts.some((alert) => alert.code === 'ha_profile_not_ready')).toBe(true);
        expect(report.summary.uploads.activeSessions).toBe(2);
        expect(report.topology.profile).toBe('ha');
        expect(report.topology.profileReady).toBe(false);

        const prometheusPayload = serializeOperationalMetricsPrometheus(report);
        expect(prometheusPayload).toContain('sendu_uptime_seconds 42');
        expect(prometheusPayload).toContain('sendu_health{component="overall"} 1');
        expect(prometheusPayload).toContain('sendu_queue_jobs{group="status",name="dead"} 1');
        expect(prometheusPayload).toContain('sendu_alert_active{code="jobs_dead",severity="high"} 1');
        expect(prometheusPayload).toContain('sendu_topology_profile_ready{profile="ha"} 0');
        expect(prometheusPayload).toContain('sendu_topology_backend_info{profile="ha",component="state",backend="sqlite"} 1');
    });
});