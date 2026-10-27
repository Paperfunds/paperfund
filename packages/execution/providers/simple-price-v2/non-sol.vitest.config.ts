import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['db', 'execution', 'protocols', 'core', 'config', 'shared'].map((name) => [
        '@paperfund/' + name,
        resolve('packages/' + name + '/src/index.ts'),
      ]),
    ),
  },
  test: {
    include: ['packages/execution/providers/simple-price-v2/non-sol*.acceptance.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
