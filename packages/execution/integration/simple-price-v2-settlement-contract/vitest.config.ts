import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/execution/integration/simple-price-v2-settlement-contract/*.test.ts'],
    fileParallelism: false,
  },
});
