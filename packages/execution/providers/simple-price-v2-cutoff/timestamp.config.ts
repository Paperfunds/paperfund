import config from './vitest.config.js';
export default {
  ...config,
  test: {
    ...config.test,
    include: ['packages/execution/providers/simple-price-v2-cutoff/timestamp.acceptance.ts'],
  },
};
