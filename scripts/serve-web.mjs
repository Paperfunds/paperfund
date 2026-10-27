import { publicRewardEvidence } from './public-reward-evidence.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Cloudflare Tunnel continues to target loopback:5173. Start only after approved Vite shutdown.
const root = process.env['PAPERFUND_WEB_ROOT']
  ? resolve(process.env['PAPERFUND_WEB_ROOT'])
  : fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const index = await readFile(resolve(root, 'index.html'));
if (index.includes('/@vite/client') || index.includes('/src/'))
  throw new Error('A production web build is required.');
const port = Number(process.env['PAPERFUND_WEB_PORT'] ?? '5173');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid web port.');
const routes = new Set([
  '/',
  '/trade',
  '/hourly',
  '/daily',
  '/history',
  '/rewards',
  '/rules',
  '/privacy',
  '/support',
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.paperfund.app; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  );
  response.setHeader('cache-control', 'no-store');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }
  try {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    if (
      path.includes('\\') ||
      path.includes('\0') ||
      path.split('/').some((part) => part.startsWith('.'))
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (path === '/website/rewards') {
      const bytes = Buffer.from(JSON.stringify(await publicRewardEvidence()));
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
      return;
    }
    const file = routes.has(path) ? resolve(root, 'index.html') : resolve(root, '.' + path);
    if (
      !file.startsWith(root.endsWith(sep) ? root : root + sep) ||
      !(await stat(file)).isFile() ||
      !mime[extname(file)]
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    const bytes = file.endsWith(sep + 'index.html') ? index : await readFile(file);
    response.setHeader('content-type', mime[extname(file)]);
    if (path.startsWith('/assets/'))
      response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    response.writeHead(200, { 'content-length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Paperfund production web listening on loopback:${port}`),
);
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
