import {
  browserPublicUrl,
  assertNoServerRpcInBrowserEnvironment,
} from '../../scripts/browser-config-security.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { build as viteBuild, defineConfig, loadEnv } from 'vite';
import { validateExtensionScripts } from '../../scripts/extension-script-validation.mjs';

const stableKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5GE8afOOHaKL0xwnM+H7u4LcEH9+2Fe6/Yq9FS1fELJQxZ5IpwWyNusilTvj6C0AXfMdAmDos4O6pYZy54g/X705VudivW17dNHR/G8wWgjLjayAGnBxH4dm1mKLe3wTDU4H1BCQ0rpSdLdrjXO6l2FjUJuDZ37h1mkYXoSXJc7AHtEzbfTCER/vXzsNfHCiVwHIcBrez5v5R2jtt2WHXcqyPRMv/hAHNL8ixb5KxqqEuWG+lZ2UdTiDFY6A6+S37hvYm9tdABYOWcxmblFohWKV4kKT1m46jgKG+5ihhAlNYuNRVWwnQ/bFXs6M7INZo+X6MBDYreffDxMkR7GiWQIDAQAB';

const extensionPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

function buildUrl(name: string, fallback: string, release: boolean): URL {
  const configured = process.env[name];
  if (release && !configured) throw new Error(`${name} is required for a release extension build.`);
  const url = browserPublicUrl(name, configured ?? fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${name} must be a credential-free HTTP(S) URL without a fragment.`);
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (
    release &&
    url.protocol !== 'https:' &&
    !(loopback && process.env['PAPERFUND_ALLOW_INSECURE_LOCAL'] === 'true')
  ) {
    throw new Error(`${name} must use HTTPS for a release build.`);
  }
  return url;
}

export default defineConfig(({ mode }) => {
  const release = mode === 'production';
  assertNoServerRpcInBrowserEnvironment(
    loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), ''),
  );
  const apiUrl = buildUrl('PAPERFUND_API_BASE_URL', 'http://127.0.0.1:3000', release);
  const appUrl = buildUrl('PAPERFUND_APP_URL', 'http://127.0.0.1:5173/trade', release);
  const apiBase = apiUrl.toString().replace(/\/$/, '');
  const apiOrigin = apiUrl.origin;

  return {
    plugins: [
      react(),
      {
        name: 'paperfund-extension-manifest',
        async generateBundle() {
          // MV3 manifest content scripts are classic scripts, including world: MAIN.
          // Build separately so shared imports cannot become runtime ESM chunks.
          const bridge = await viteBuild({
            configFile: false,
            logLevel: 'silent',
            build: {
              write: false,
              lib: {
                entry: fileURLToPath(new URL('./src/page-bridge.ts', import.meta.url)),
                name: 'PaperfundPageBridge',
                formats: ['iife'],
              },
              rollupOptions: { output: { inlineDynamicImports: true } },
            },
          });
          const outputs = Array.isArray(bridge) ? bridge : [bridge];
          const chunks = outputs.flatMap((output) => ('output' in output ? output.output : []));
          if (
            chunks.length !== 1 ||
            chunks[0]?.type !== 'chunk' ||
            chunks[0].imports.length ||
            chunks[0].dynamicImports.length
          )
            throw new Error('Page bridge must be one self-contained classic script.');
          this.emitFile({ type: 'asset', fileName: 'page-bridge.js', source: chunks[0].code });
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify(
              {
                manifest_version: 3,
                name: 'Paperfund',
                version: extensionPackage.version,
                description:
                  'Paper-trading competition overlay for Axiom, GMGN.ai, and Terminal / Padre.',
                key: stableKey,
                permissions: ['storage'],
                icons: {
                  16: 'icons/paperfund-16.png',
                  32: 'icons/paperfund-32.png',
                  48: 'icons/paperfund-48.png',
                  128: 'icons/paperfund-128.png',
                },
                action: {
                  default_title: 'Paperfund',
                  default_popup: 'popup.html',
                  default_icon: {
                    16: 'icons/paperfund-16.png',
                    32: 'icons/paperfund-32.png',
                  },
                },
                host_permissions: [`${apiOrigin}/*`],
                background: { service_worker: 'background.js', type: 'module' },
                content_scripts: [
                  {
                    matches: [
                      'https://axiom.trade/*',
                      'https://gmgn.ai/*',
                      'https://trade.padre.gg/*',
                    ],
                    js: ['page-bridge.js'],
                    run_at: 'document_start',
                    world: 'MAIN',
                  },
                  {
                    matches: [
                      'https://axiom.trade/*',
                      'https://gmgn.ai/*',
                      'https://trade.padre.gg/*',
                    ],
                    js: ['content-loader.js'],
                    run_at: 'document_start',
                  },
                ],
                web_accessible_resources: [
                  {
                    resources: ['content.js', 'chunks/*.js', 'icons/paperfund-mark.png'],
                    matches: [
                      'https://axiom.trade/*',
                      'https://gmgn.ai/*',
                      'https://trade.padre.gg/*',
                    ],
                  },
                ],
                content_security_policy: {
                  extension_pages: "script-src 'self'; object-src 'self'",
                },
              },
              null,
              2,
            ),
          });
        },
        closeBundle() {
          validateExtensionScripts(fileURLToPath(new URL('./build', import.meta.url)));
        },
      },
    ],
    define: {
      __PAPERFUND_API_BASE_URL__: JSON.stringify(apiBase),
      __PAPERFUND_APP_URL__: JSON.stringify(appUrl.toString()),
    },
    build: {
      outDir: 'build',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: fileURLToPath(new URL('./src/background.ts', import.meta.url)),
          content: fileURLToPath(new URL('./src/content.tsx', import.meta.url)),
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
  };
});
