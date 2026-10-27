import { vi } from 'vitest';
import type * as FileSystem from 'node:fs';
// Reused suites write their numerical artifacts on close. Preserve those old records exactly.
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof FileSystem>();
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const path = String(args[0]).replaceAll('\\', '/');
      if (
        path === 'artifacts/simple-price-v2-api-review/numerical.json' ||
        path === 'artifacts/simple-price-v2-directional-review/api-numerical.json'
      ) {
        args[0] =
          'artifacts/simple-price-v2-cutoff-review/support-' +
          Date.now() +
          '-' +
          (path.includes('directional') ? 'directional' : 'original') +
          '.json';
      }
      return fs.writeFileSync(...args);
    },
  };
});
