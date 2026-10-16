import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
  throw new Error('E2E requires an isolated local server; remote targets are prohibited');
}
export default defineConfig({ testDir: './tests', fullyParallel: false, workers: 1, timeout: 60_000,
  use: { baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin }, headless: true,
    launchOptions: process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH } : {} },
  reporter: [['list'], ['html', { open: 'never' }]],
});
