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
    include: ['packages/execution/diagnostics/simple-price-v2-settlement/*.acceptance.ts'],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 60000,
  },
});
