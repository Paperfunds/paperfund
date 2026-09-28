import { config as loadDotenv } from 'dotenv';
import Redis from 'ioredis';

import { parseEnvironment } from '@paperfund/config';
import { createDatabase } from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const environment = parseEnvironment(process.env);
const database = createDatabase(environment.DATABASE_URL);
const redis = new Redis(environment.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const checks: Record<string, unknown> = {
  payoutNetwork: environment.PAYOUT_NETWORK,
  payoutExecutionEnabled: environment.PAYOUT_EXECUTION_ENABLED,
  creatorFeeNetwork: environment.CREATOR_FEE_NETWORK,
  creatorFeeIngestionEnabled: environment.CREATOR_FEE_INGESTION_ENABLED,
  creatorFeeShadowMode: environment.CREATOR_FEE_SHADOW_MODE,
  creatorFeeIdentityConfigured: Boolean(
    environment.PAPERFUND_TOKEN_MINT && environment.PAPERFUND_CREATOR_WALLET,
  ),
};
let failed = false;
try {
  await database.pool.query('select 1');
  checks.database = 'ok';
} catch (error) {
  failed = true;
  checks.database = error instanceof Error ? error.message : 'failed';
}
try {
  await redis.connect();
  checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'failed';
} catch (error) {
  failed = true;
  checks.redis = error instanceof Error ? error.message : 'failed';
}
try {
  const response = await fetch(environment.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }),
    signal: AbortSignal.timeout(environment.SOLANA_RPC_TIMEOUT_MS),
  });
  const body = (await response.json()) as { result?: string; error?: unknown };
  if (!response.ok || !body.result)
    throw new Error(`RPC health check failed: ${JSON.stringify(body.error)}`);
  checks.solanaRpc = 'ok';
  checks.solanaGenesisHash = body.result;
} catch (error) {
  failed = true;
  checks.solanaRpc = error instanceof Error ? error.message : 'failed';
}
process.stdout.write(`${JSON.stringify(checks)}\n`);
await Promise.allSettled([database.close(), redis.quit()]);
if (failed) process.exitCode = 1;
