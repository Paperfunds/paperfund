import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const watching = process.argv.includes('--watch');
let previous;
async function check() {
  const failures = [];
  const observations = await Promise.all(
    [
      ['api', 'https://api.paperfund.app/ready'],
      ['app', 'https://app.paperfund.app/'],
      ['privacy', 'https://privacy.paperfund.app/'],
    ].map(async ([name, url]) => {
      try {
        const r = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        const body = await r.text();
        if (r.status !== 200) failures.push(`${name}: HTTP ${r.status}`);
        if (name === 'api' && JSON.parse(body).status !== 'ok') failures.push('api: not ready');
        if (name === 'app' && body.includes('/@vite/client'))
          failures.push('app: development server exposed');
        if (
          name === 'privacy' &&
          (!body.includes('support@paperfund.app') || body.includes('privacy@paperfund.app'))
        )
          failures.push('privacy: support address not published');
        return { name, status: r.status };
      } catch {
        failures.push(`${name}: unavailable`);
        return { name, status: null };
      }
    }),
  );
  try {
    const h = JSON.parse(await readFile(resolve(root, 'logs/worker-heartbeat.json'), 'utf8'));
    const age = Date.now() - Date.parse(h.lastLifecycleSuccessAt);
    if (!Number.isFinite(age) || age < -1000 || age > 30000)
      failures.push('worker: missing/future/stale success');
    if (h.lastError) failures.push('worker: error retained');
  } catch {
    failures.push('worker: heartbeat unavailable');
  }
  failures.sort();
  return {
    observedAt: new Date().toISOString(),
    status: failures.length ? 'FAIL' : 'PASS',
    scope: 'AVAILABILITY_ONLY_NOT_FINANCIAL_AUTHORITY',
    observations,
    failures,
  };
}
do {
  const result = await check(),
    state = JSON.stringify(result.failures);
  if (state !== previous) {
    console.log(JSON.stringify(result));
    if (watching) {
      await mkdir(resolve(root, 'logs'), { recursive: true });
      await appendFile(
        resolve(root, 'logs/private-beta-monitor.jsonl'),
        JSON.stringify(result) + '\n',
      );
    }
    previous = state;
  }
  if (!watching) {
    process.exitCode = result.failures.length ? 1 : 0;
    break;
  }
  await new Promise((done) => setTimeout(done, 60000));
} while (watching);
