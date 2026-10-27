import config from './vitest.config.js';
export default {
  ...config,
  test: {
    ...config.test,
    include: [
      'packages/core/test/payout-allocation.test.ts',
      'packages/core/test/reward-economics.test.ts',
      'packages/core/test/leaderboards.test.ts',
      'packages/core/test/daily-scoring.test.ts',
    ],
  },
};
