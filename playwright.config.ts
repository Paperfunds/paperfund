import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run e2e:server',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run preview --workspace @paperfund/web -- --port 5174',
      url: 'http://127.0.0.1:5174/trade',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
