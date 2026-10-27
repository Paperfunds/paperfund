import './e2e/test-wallet.js';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-extension',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 120_000,
  webServer: {
    command: 'npm run e2e:server',
    url: `http://127.0.0.1:${process.env['PAPERFUND_E2E_PORT'] ?? '3000'}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
