import {
  browserPublicUrl,
  assertNoServerRpcInBrowserEnvironment,
} from '../../scripts/browser-config-security.mjs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export const WEB_DEV_ALLOWED_HOSTS = ['app.paperfund.app'] as const;

function requireProductionApiOrigin(value: string | undefined, allowInsecureLocal: boolean) {
  if (!value) throw new Error('VITE_API_BASE_URL is required for a production web build.');
  const origin = browserPublicUrl('VITE_API_BASE_URL', value);
  const loopback = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
  if (origin.protocol !== 'https:' && !(allowInsecureLocal && loopback))
    throw new Error('VITE_API_BASE_URL must use HTTPS outside an explicit local build.');
}

export default defineConfig(({ command, mode }) => {
  const environmentDirectory = process.env.INIT_CWD ?? process.cwd();
  const environment = loadEnv(mode, environmentDirectory, '');
  assertNoServerRpcInBrowserEnvironment(environment);
  if (environment.VITE_API_BASE_URL)
    browserPublicUrl('VITE_API_BASE_URL', environment.VITE_API_BASE_URL);
  if (command === 'build' && mode === 'production')
    requireProductionApiOrigin(
      environment.VITE_API_BASE_URL ||
        (environment.PAPERFUND_REQUIRE_PRODUCTION_ORIGINS !== 'true'
          ? 'http://127.0.0.1:3000'
          : undefined),
      environment.PAPERFUND_ALLOW_INSECURE_LOCAL === 'true' ||
        environment.PAPERFUND_REQUIRE_PRODUCTION_ORIGINS !== 'true',
    );
  return {
    plugins: [react()],
    envDir: environmentDirectory,
    server: { port: 5173, allowedHosts: [...WEB_DEV_ALLOWED_HOSTS] },
    preview: { port: 5173 },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  };
});
