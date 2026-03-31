import fs from 'fs/promises';
import path from 'path';
import { expect, test } from '@playwright/test';

const FIXTURE_DIR = path.join(process.cwd(), 'tmp', 'playwright-fixtures');
const UPLOAD_STATE_PREFIX = 'sendu_upload_';

const ensureFixtureDir = async () => {
    await fs.mkdir(FIXTURE_DIR, { recursive: true });
};

const createFixture = async (name, buffer) => {
    await ensureFixtureDir();
    const filePath = path.join(FIXTURE_DIR, name);
    await fs.writeFile(filePath, buffer);
    return filePath;
};

test.beforeAll(async () => {
    await ensureFixtureDir();
});

test('guest can upload, share and download a file', async ({ page }) => {
    const content = Buffer.from('hola smoke sendu\n', 'utf8');
    const smokeFilePath = await createFixture('smoke.txt', content);

    await page.goto('/');
    await page.evaluate(() => fetch('/api/auth/csrf', { credentials: 'include' }));
    await page.locator('input[type="file"]').first().setInputFiles(smokeFilePath);
    await page.getByRole('button', { name: /Transferir Archivo/i }).click();

    await expect(page.getByRole('button', { name: /Copiar enlace compartido|Copiar/i })).toBeVisible({ timeout: 120000 });
    const shareHref = await page.getByRole('link', { name: /Ver archivo/i }).getAttribute('href');
    await page.goto(shareHref);

    await expect(page).toHaveURL(/\/share\//);

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Descargar Archivo/i }).click()
    ]);

    const downloadPath = await download.path();
    const downloaded = await fs.readFile(downloadPath);
    expect(downloaded.equals(content)).toBe(true);
});

test.fixme('upload survives refresh and resumes with the same session', async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'El smoke de resume usa CDP y OPFS en Chromium');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 2 * 1024 * 1024,
        uploadThroughput: 1 * 1024 * 1024,
        connectionType: 'cellular3g'
    });

    const buffer = Buffer.alloc(48 * 1024 * 1024, 114);
    const resumeFilePath = await createFixture('resume.bin', buffer);

    await page.goto('/');
    await page.evaluate(() => fetch('/api/auth/csrf', { credentials: 'include' }));
    await page.locator('input[type="file"]').first().setInputFiles(resumeFilePath);
    await page.getByRole('button', { name: /Transferir Archivo/i }).click();

    await expect(page.getByText(/Subiendo|Preparando/i)).toBeVisible({ timeout: 20000 });

    await expect.poll(async () => page.evaluate((prefix) => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix));
        return key ? key.replace(prefix, '') : null;
    }, UPLOAD_STATE_PREFIX), { timeout: 20000 }).toBeTruthy();
    const uploadId = await page.evaluate((prefix) => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix));
        return key ? key.replace(prefix, '') : null;
    }, UPLOAD_STATE_PREFIX);
    expect(uploadId).toBeTruthy();

    await expect(page.getByRole('button', { name: /Copiar enlace compartido|Copiar/i })).toHaveCount(0);
    await page.waitForTimeout(5000);
    await page.reload();

    await expect.poll(async () => page.evaluate((prefix) => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix));
        return key ? key.replace(prefix, '') : null;
    }, UPLOAD_STATE_PREFIX), { timeout: 15000 }).toBe(uploadId);

    await expect.poll(async () => page.evaluate(() => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith('sendu_upload_'));
        if (!key) return null;
        const state = JSON.parse(localStorage.getItem(key) || '{}');
        return state.fileName || null;
    }), { timeout: 10000 }).toBe('resume.bin');

    await expect(page.getByText(/Preparando|Subiendo/i)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Copiar enlace compartido|Copiar/i })).toBeVisible({ timeout: 180000 });
});
