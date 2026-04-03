import { defineConfig } from '@playwright/test';

const port = process.env.E2E_PORT || '4010';
const baseURL = `http://127.0.0.1:${port}`;
const sessionSecret = process.env.E2E_SESSION_SECRET || 'sendu-e2e-session-secret';

export default defineConfig({
    testDir: './e2e',
    timeout: 180000,
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    use: {
        baseURL,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        acceptDownloads: true
    },
    webServer: {
        command: `bash -lc "rm -rf tmp/e2e-browser && mkdir -p tmp/e2e-browser/data tmp/e2e-browser/uploads tmp/e2e-browser/tmp && npm run build >/tmp/sendu-e2e-build.log 2>&1 && PORT=${port} NODE_ENV=production ALLOW_PUBLIC_REGISTRATION=true PUBLIC_ORIGIN=${baseURL} ALLOWED_ORIGINS=${baseURL} SESSION_SECRET=${sessionSecret} SESSION_COOKIE_DOMAIN= SMTP_HOST= SMTP_PORT= SMTP_SECURE= SMTP_USER= SMTP_PASS= SMTP_FROM= APP_DATA_PATH=tmp/e2e-browser/data APP_UPLOADS_PATH=tmp/e2e-browser/uploads APP_TEMP_PATH=tmp/e2e-browser/tmp npm start"`,
        url: baseURL,
        timeout: 240000,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe'
    }
});
