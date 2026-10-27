import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  cacheDir: 'C:/Users/stanp/Documents/ChatGPT/Paperfund-new/artifacts/operator/vite-cache',
  plugins: [
    {
      name: 'retain-new-observations',
      enforce: 'pre',
      transform(code, id) {
        if (
          id.endsWith('/treasury-security.test.ts') ||
          id.endsWith('/correction-security.test.ts')
        )
          return code
            .replaceAll(
              "'evidence/treasury-security-observations.json'",
              "'C:/Users/stanp/Documents/ChatGPT/Paperfund-new/artifacts/operator/treasury-security-observations.json'",
            )
            .replaceAll(
              "'evidence/correction-security-observations.json'",
              "'C:/Users/stanp/Documents/ChatGPT/Paperfund-new/artifacts/operator/correction-security-observations.json'",
            );
      },
    },
  ],
  resolve: { alias: { '@paperfund/core': resolve('packages/core/src/index.ts') } },
  test: {
    include: [
      'packages/db/test/treasury-security.test.ts',
      'packages/db/test/correction-security.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
