import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import Redis from 'ioredis';
import { parseEnvironment } from '@paperfund/config';
import { createDatabase } from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const environment = parseEnvironment(process.env);
const database = createDatabase(environment.DATABASE_URL);
const redis = new Redis(environment.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const results: Array<{ check: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: unknown }> = [];
const production = environment.NODE_ENV === 'production';
const record = (check: string, status: 'PASS' | 'WARN' | 'FAIL', detail: unknown) =>
  results.push({ check, status, detail });

try {
  await database.pool.query('select 1');
  record('database', 'PASS', 'reachable');
  const journal = JSON.parse(
    await readFile(resolve('packages/db/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  const applied = await database.pool.query<{ count: string }>(
    'select count(*)::text count from drizzle.__drizzle_migrations',
  );
  const count = Number(applied.rows[0]?.count ?? 0);
  record(
    'migrations',
    count === journal.entries.length ? 'PASS' : 'FAIL',
    `${count.toString()}/${journal.entries.length.toString()} applied`,
  );
} catch (error) {
  record('database', 'FAIL', error instanceof Error ? error.message : 'unavailable');
}
try {
  await redis.connect();
  record('redis', (await redis.ping()) === 'PONG' ? 'PASS' : 'FAIL', 'local dependency');
} catch (error) {
  record('redis', 'FAIL', error instanceof Error ? error.message : 'unavailable');
}
try {
  const started = performance.now();
  const rpc = async (method: string, params: unknown[] = []) => {
    const response = await fetch(environment.SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      signal: AbortSignal.timeout(environment.SOLANA_RPC_TIMEOUT_MS),
    });
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    if (!response.ok || body.result === undefined)
      throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
    return body.result;
  };
  const genesisHash = String(await rpc('getGenesisHash'));
  const finalizedSlot = Number(await rpc('getSlot', [{ commitment: 'finalized' }]));
  const latencyMs = Math.round(performance.now() - started);
  const hashes = {
    'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  } as const;
  const requiredNetworks = new Set<string>();
  if (environment.CREATOR_FEE_INGESTION_ENABLED)
    requiredNetworks.add(environment.CREATOR_FEE_NETWORK);
  if (environment.PAYOUT_EXECUTION_ENABLED) requiredNetworks.add(environment.PAYOUT_NETWORK);
  const mismatched = [...requiredNetworks].filter(
    (network) => network !== 'localnet' && hashes[network as keyof typeof hashes] !== genesisHash,
  );
  record('solanaRpc', mismatched.length ? 'FAIL' : 'PASS', {
    genesisHash,
    finalizedSlot,
    latencyMs,
    requiredNetworks: [...requiredNetworks],
  });
} catch (error) {
  record('solanaRpc', 'FAIL', error instanceof Error ? error.message : 'unavailable');
}
try {
  const response = await fetch(
    `http://${environment.API_HOST}:${environment.API_PORT.toString()}/ready`,
    { signal: AbortSignal.timeout(2_000) },
  );
  record('api', response.ok ? 'PASS' : 'FAIL', `HTTP ${response.status.toString()}`);
} catch (error) {
  record(
    'api',
    production ? 'FAIL' : 'WARN',
    error instanceof Error ? error.message : 'not running',
  );
}
try {
  const value = JSON.parse(await readFile(resolve(environment.WORKER_HEARTBEAT_FILE), 'utf8')) as {
    lastTickStartedAt?: string;
    lastLifecycleSuccessAt?: string;
    lastFeePollAt?: string;
    lastError?: unknown;
  };
  const ageMs = value.lastTickStartedAt
    ? Date.now() - Date.parse(value.lastTickStartedAt)
    : Infinity;
  const fresh = ageMs <= Math.max(30_000, environment.WORKER_TICK_INTERVAL_MS * 3);
  record('worker', fresh ? 'PASS' : production ? 'FAIL' : 'WARN', { ageMs, ...value });
} catch (error) {
  record(
    'worker',
    production ? 'FAIL' : 'WARN',
    error instanceof Error ? error.message : 'no heartbeat',
  );
}
if (environment.CREATOR_FEE_INGESTION_ENABLED) {
  const sourceId = `SOLANA_PUMP:${environment.CREATOR_FEE_NETWORK}:${environment.PAPERFUND_TOKEN_MINT}`;
  const checkpoint = await database.pool.query<{
    last_success_at: Date | null;
    last_error_category: string | null;
    shadow_mode: boolean;
  }>(
    'select last_success_at,last_error_category,shadow_mode from creator_fee_ingestion_checkpoints where source_id=$1',
    [sourceId],
  );
  record(
    'creatorFeeIngestion',
    checkpoint.rows[0] ? 'PASS' : 'WARN',
    checkpoint.rows[0] ?? 'no checkpoint yet',
  );
} else record('creatorFeeIngestion', 'WARN', 'disabled');
record('payoutSafety', environment.PAYOUT_EXECUTION_ENABLED ? 'WARN' : 'PASS', {
  enabled: environment.PAYOUT_EXECUTION_ENABLED,
  network: environment.PAYOUT_NETWORK,
  mainnetConfirmed: environment.PAYOUT_MAINNET_CONFIRM,
  mainnetCapLamports: environment.PAYOUT_MAINNET_MAX_PLAN_LAMPORTS,
});
record('publicOrigins', production ? 'PASS' : 'WARN', {
  api: environment.API_PUBLIC_ORIGIN || 'not configured',
  app: environment.APP_PUBLIC_ORIGIN || 'not configured',
  cors: environment.ALLOWED_ORIGINS.split(',').map((value) => value.trim()),
});

const failed = results.some((item) => item.status === 'FAIL');
process.stdout.write(`${JSON.stringify({ status: failed ? 'FAIL' : 'PASS', results }, null, 2)}\n`);
await Promise.allSettled([database.close(), redis.quit()]);
if (failed) process.exitCode = 1;
