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

const uploadSingleFileFromHome = async (page, filePath, { password } = {}) => {
    await page.goto('/');
    await page.evaluate(() => fetch('/api/auth/csrf', { credentials: 'include' }));
    await page.locator('input[type="file"]').first().setInputFiles(filePath);

    if (password) {
        await page.locator('input[placeholder="(Opcional)"]').fill(password);
    }

    await page.getByRole('button', { name: /Transferir Archivo/i }).click();
    await expect(page.getByRole('button', { name: /Copiar enlace compartido|Copiar/i })).toBeVisible({ timeout: 120000 });
    return page.getByRole('link', { name: /Ver archivo/i }).getAttribute('href');
};

test('guest can upload, share and download a file', async ({ page }) => {
    const content = Buffer.from('hola smoke sendu\n', 'utf8');
    const smokeFilePath = await createFixture('smoke.txt', content);

    const shareHref = await uploadSingleFileFromHome(page, smokeFilePath);
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

test('guest cannot access dashboard without authentication', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Bienvenido/i })).toBeVisible({ timeout: 15000 });
});

test('registered user can upload a file and see it in dashboard', async ({ page }) => {
    const timestamp = Date.now();
    const email = `smoke-${timestamp}@example.com`;
    const username = `smoke${timestamp}`;
    const password = 'Smoke1234';
    const content = Buffer.from('archivo dashboard sendu\n', 'utf8');
    const filePath = await createFixture('dashboard.txt', content);

    await page.goto('/register');
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/Usuario/i).fill(username);
    await page.getByLabel(/Contraseña/i).fill(password);
    await page.getByRole('button', { name: /Registrarse/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

    await page.getByLabel(/Email o Usuario/i).fill(email);
    await page.getByLabel(/Contraseña/i).fill(password);
    await page.getByRole('button', { name: /Iniciar Sesión/i }).click();
    await expect(page.getByRole('button', { name: new RegExp(username, 'i') })).toBeVisible({ timeout: 15000 });

    await page.goto('/');
    const shareHref = await uploadSingleFileFromHome(page, filePath);
    expect(shareHref).toMatch(/\/share\//);

    await page.goto('/dashboard');
    await expect(page.getByText('dashboard.txt')).toBeVisible({ timeout: 15000 });
});

test('upload survives refresh and resumes with the same session', async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'El smoke de resume usa CDP y OPFS en Chromium');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 2 * 1024 * 1024,
        uploadThroughput: 512 * 1024,
        connectionType: 'cellular3g'
    });

    const buffer = Buffer.alloc(24 * 1024 * 1024, 114);
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

    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 20,
        downloadThroughput: 20 * 1024 * 1024,
        uploadThroughput: 20 * 1024 * 1024,
        connectionType: 'wifi'
    });

    await expect(page.getByText(/Subiendo/i)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Copiar enlace compartido|Copiar/i })).toBeVisible({ timeout: 180000 });
});
