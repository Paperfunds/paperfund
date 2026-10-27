import { monitorStatus } from './monitor.mjs';
import Redis from 'ioredis';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { ROOT, readSetting } from './common.mjs';
import { databaseStatus } from './treasury.mjs';
const exec = promisify(execFile);
export async function probe(url, json = false) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    const t = await r.text();
    return { healthy: r.ok && (!json || JSON.parse(t).status === 'ok'), status: r.status };
  } catch {
    return { healthy: false, status: null };
  }
}
export async function systemStatus() {
  const targets = {
    api: 'http://127.0.0.1:3000/ready',
    website: 'http://127.0.0.1:5173/',
    publicApi: 'https://api.paperfund.app/ready',
    publicWebsite: 'https://app.paperfund.app/',
    publicPrivacy: 'https://privacy.paperfund.app/',
  };
  const services = Object.fromEntries(
    await Promise.all(
      Object.entries(targets).map(async ([name, url]) => [
        name,
        await probe(url, name.toLowerCase().includes('api')),
      ]),
    ),
  );
  let redis;
  try {
    redis = new Redis(await readSetting('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 3000,
      retryStrategy: () => null,
    });
    redis.on('error', () => {});
    await redis.connect();
    services.redis = { healthy: (await redis.ping()) === 'PONG' };
  } catch {
    services.redis = { healthy: false };
  } finally {
    redis?.disconnect();
  }
  let heartbeat = null;
  try {
    const h = JSON.parse(await readFile(resolve(ROOT, 'logs/worker-heartbeat.json'), 'utf8')),
      age = Date.now() - Date.parse(h.lastLifecycleSuccessAt);
    heartbeat = {
      processId: h.processId,
      startedAt: h.startedAt,
      lastLifecycleSuccessAt: h.lastLifecycleSuccessAt,
      healthy: Number.isFinite(age) && age >= -1000 && age < 30000,
      errorRetained: !!h.lastError,
    };
  } catch {
    /* Missing telemetry is returned as unavailable. */
  }
  let docker = { healthy: false };
  try {
    const r = await exec('docker', ['ps', '--format', '{{.Names}} {{.Status}}'], {
      windowsHide: true,
      timeout: 5000,
    });
    docker = {
      healthy: true,
      containers: r.stdout
        .trim()
        .split(/\r?\n/)
        .filter((l) => /^paperfund-(postgres|redis)-1 /.test(l)),
    };
  } catch {
    /* Missing telemetry is returned as unavailable. */
  }
  let database;
  try {
    database = await databaseStatus();
  } catch {
    database = { healthy: false, error: 'DATABASE_READ_FAILED' };
  }
  return {
    fees: await monitorStatus().catch(() => ({
      status: 'STATE_UNREADABLE',
      error: 'MONITOR_STATE_UNREADABLE',
    })),
    observedAt: new Date().toISOString(),
    services,
    worker: heartbeat,
    docker,
    database,
    financial: {
      enabled: false,
      authorization: 'NONE',
      clock: 'UNQUALIFIED_EXISTING_100MS_POLICY',
      provider: 'UNQUALIFIED',
      signer: 'NOT_ENROLLED',
      mainnet: 'DRY_RUN_ONLY',
      effectiveOperatorStop: true,
    },
    note: 'Runtime health does not qualify competition evidence. Existing API/worker are observed without restart.',
  };
}
