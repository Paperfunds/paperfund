import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { parseEnvironment } from '@paperfund/config';
import { createDatabase, runHourlyLifecycleTick, runRewardFinalizationTick } from '@paperfund/db';
import { createProductionExecutionRouter } from '@paperfund/protocols';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const config = parseEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const router = createProductionExecutionRouter({
  rpcUrl: config.SOLANA_RPC_URL,
  rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  commitment: config.SOLANA_COMMITMENT,
});
let stopping = false;
let timer: NodeJS.Timeout | undefined;

function log(level: 'info' | 'error', event: string, metadata: Record<string, unknown>) {
  const entry = JSON.stringify({ level, event, ...metadata, timestamp: new Date().toISOString() });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}

async function tick() {
  try {
    const now = new Date();
    const events = await runHourlyLifecycleTick(
      database,
      router,
      now,
      config.REWARD_FINALIZATION_GRACE_SECONDS,
    );
    const rewardRounds = await runRewardFinalizationTick(database, now, {
      allocationMode: config.REWARD_ALLOCATION_MODE,
      baselineWindow: config.REWARD_BASELINE_WINDOW,
      lambdaBps: BigInt(config.REWARD_LAMBDA_BPS),
      configurationVersion: 'phase-5a-v1',
    });
    for (const roundId of rewardRounds) log('info', 'reward_pool_frozen', { roundId });
    for (const event of events) {
      log('info', event.type.toLowerCase(), {
        roundId: event.roundId,
        failures: event.failures,
      });
    }
  } catch (error) {
    log('error', 'round_lifecycle_tick_failed', {
      errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown worker failure',
    });
  } finally {
    if (!stopping) timer = setTimeout(() => void tick(), config.WORKER_TICK_INTERVAL_MS);
  }
}

async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  log('info', 'worker_shutdown', { signal });
  await database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
await tick();
