import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiBase = (process.env['PAPERFUND_API_BASE_URL'] ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const appUrl = process.env['PAPERFUND_APP_URL'] ?? 'http://127.0.0.1:5173/trade';
const apiOrigin = new URL(apiBase).origin;
const stableKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5GE8afOOHaKL0xwnM+H7u4LcEH9+2Fe6/Yq9FS1fELJQxZ5IpwWyNusilTvj6C0AXfMdAmDos4O6pYZy54g/X705VudivW17dNHR/G8wWgjLjayAGnBxH4dm1mKLe3wTDU4H1BCQ0rpSdLdrjXO6l2FjUJuDZ37h1mkYXoSXJc7AHtEzbfTCER/vXzsNfHCiVwHIcBrez5v5R2jtt2WHXcqyPRMv/hAHNL8ixb5KxqqEuWG+lZ2UdTiDFY6A6+S37hvYm9tdABYOWcxmblFohWKV4kKT1m46jgKG+5ihhAlNYuNRVWwnQ/bFXs6M7INZo+X6MBDYreffDxMkR7GiWQIDAQAB';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'paperfund-extension-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify(
            {
              manifest_version: 3,
              name: 'Paperfund for Axiom',
              version: '0.1.0',
              description: 'Paper-only Solana competition trading inside Axiom.',
              key: stableKey,
              permissions: ['storage'],
              action: { default_title: 'Paperfund', default_popup: 'popup.html' },
              host_permissions: [`${apiOrigin}/*`],
              background: { service_worker: 'background.js', type: 'module' },
              content_scripts: [
                {
                  matches: ['https://axiom.trade/*'],
                  js: ['page-bridge.js'],
                  run_at: 'document_start',
                  world: 'MAIN',
                },
                {
                  matches: ['https://axiom.trade/*'],
                  js: ['content-loader.js'],
                  run_at: 'document_start',
                },
              ],
              content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
            },
            null,
            2,
          ),
        });
      },
    },
  ],
  define: {
    __PAPERFUND_API_BASE_URL__: JSON.stringify(apiBase),
    __PAPERFUND_APP_URL__: JSON.stringify(appUrl),
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: fileURLToPath(new URL('./src/background.ts', import.meta.url)),
        content: fileURLToPath(new URL('./src/content.tsx', import.meta.url)),
        'page-bridge': fileURLToPath(new URL('./src/page-bridge.ts', import.meta.url)),
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['**/node_modules/**', '**/build/**', '**/dist/**'],
  },
});
