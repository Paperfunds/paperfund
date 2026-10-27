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
      'packages/execution/diagnostics/simple-price-v2-policy-review/*.acceptance.ts',
      'packages/execution/diagnostics/simple-price-v2-final-qualification/finality.acceptance.ts',
      'packages/execution/diagnostics/simple-price-v2-archive-integrity/integrity.acceptance.ts',
      'packages/execution/diagnostics/simple-price-v2-final-settlement/*.acceptance.ts',
      'packages/execution/diagnostics/simple-price-v2-cutoff-evidence/commit.acceptance.ts',
      'packages/execution/diagnostics/simple-price-v2-cutoff-evidence/finality.acceptance.ts',
      'packages/execution/diagnostics/simple-price-v2-final-qualification/witness.acceptance.ts',
    ],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 60000,
    setupFiles: ['packages/execution/diagnostics/simple-price-v2-policy-review/preserve.ts'],
  },
});
