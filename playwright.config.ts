import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', ...devices['Desktop Chrome'], hasTouch: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
