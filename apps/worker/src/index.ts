import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { parseEnvironment } from '@paperfund/config';
import {
  createDatabase,
  recordCreatorFeeIngestionFailure,
  runCreatorFeeIngestionTick,
  runDailyRewardFinalizationTick,
  runHourlyLifecycleTick,
  runPayoutPlanGenerationTick,
  runRewardFinalizationTick,
  SolanaJsonRpcClient,
  SolanaPumpCreatorFeeSource,
} from '@paperfund/db';
import { createProductionExecutionRouter } from '@paperfund/protocols';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const config = parseEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const router = createProductionExecutionRouter({
  rpcUrl: config.SOLANA_RPC_URL,
  rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  commitment: config.SOLANA_COMMITMENT,
});
const creatorFeeSource = config.CREATOR_FEE_INGESTION_ENABLED
  ? new SolanaPumpCreatorFeeSource(
      new SolanaJsonRpcClient(config.SOLANA_RPC_URL, {
        timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
        maxAttempts: config.CREATOR_FEE_RPC_MAX_ATTEMPTS,
        minimumRequestIntervalMs: config.CREATOR_FEE_RPC_MIN_INTERVAL_MS,
      }),
      {
        tokenMint: config.PAPERFUND_TOKEN_MINT,
        creatorWallet: config.PAPERFUND_CREATOR_WALLET,
      },
      config.CREATOR_FEE_NETWORK,
      config.CREATOR_FEE_PAGE_SIZE,
    )
  : null;
let stopping = false;
let timer: NodeJS.Timeout | undefined;

function log(level: 'info' | 'error', event: string, metadata: Record<string, unknown>) {
  const entry = JSON.stringify({ level, event, ...metadata, timestamp: new Date().toISOString() });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}

async function tick() {
  if (creatorFeeSource) {
    try {
      const result = await runCreatorFeeIngestionTick(database, creatorFeeSource);
      log('info', 'creator_fee_ingestion_tick', {
        ...result,
        finalizedChainSlot: result.finalizedChainSlot.toString(),
      });
    } catch (error) {
      try {
        await recordCreatorFeeIngestionFailure(database, creatorFeeSource, error);
      } catch (healthError) {
        log('error', 'creator_fee_ingestion_health_write_failed', {
          message:
            healthError instanceof Error ? healthError.message : 'Unknown health write failure',
        });
      }
      log('error', 'creator_fee_ingestion_tick_failed', {
        errorCode:
          error instanceof Error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown creator-fee ingestion failure',
      });
    }
  }
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
    const rewardDays = await runDailyRewardFinalizationTick(database, now);
    const payoutPlans = await runPayoutPlanGenerationTick(database, now);
    for (const roundId of rewardRounds) log('info', 'reward_pool_frozen', { roundId });
    for (const dailyCompetitionId of rewardDays)
      log('info', 'daily_reward_pool_frozen', { dailyCompetitionId });
    for (const payoutPlanId of payoutPlans)
      log('info', 'shadow_payout_plan_validated', { payoutPlanId });
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
