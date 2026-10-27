import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['db', 'execution', 'protocols', 'core', 'config', 'shared'].map((n) => [
        '@paperfund/' + n,
        resolve('packages/' + n + '/src/index.ts'),
      ]),
    ),
  },
  test: {
    include: [
      'packages/execution/integration/simple-price-v2/workflow.acceptance.ts',
      'packages/execution/integration/simple-price-v2-directional/workflow.acceptance.ts',
      'packages/execution/candidates/simple-price-v2-directional/policy.acceptance.ts',
      'packages/execution/providers/simple-price-v2-atomic/boundaries.acceptance.ts',
    ],
    setupFiles: ['packages/execution/providers/simple-price-v2-cutoff/preserve-evidence.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
