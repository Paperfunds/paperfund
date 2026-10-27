import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@paperfund/db': fileURLToPath(
        new URL('../../../../packages/db/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['apps/api/isolated/verified-routes/production.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 30000,
  },
});
