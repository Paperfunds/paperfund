import { vi } from 'vitest';
import type * as FileSystem from 'node:fs';
let sequence = 0;
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof FileSystem>();
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const path = String(args[0]).replaceAll('\\', '/');
      if (
        path.startsWith('artifacts/simple-price-v2-final-settlement-review/') ||
        path.startsWith('artifacts/simple-price-v2-cutoff-evidence-review/') ||
        path.startsWith('artifacts/simple-price-v2-final-qualification-review/')
      ) {
        args[0] =
          'artifacts/simple-price-v2-archive-integrity-review/preserved-regression-' +
          Date.now() +
          '-' +
          sequence++ +
          '-' +
          path.split('/').at(-1);
      }
      return fs.writeFileSync(...args);
    },
  };
});
