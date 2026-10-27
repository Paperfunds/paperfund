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
    include: ['packages/execution/providers/simple-price-v2-directional/*.acceptance.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
