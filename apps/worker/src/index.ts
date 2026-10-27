import { safeWorkerErrorMessage, workerDiagnosticJson } from './safe-diagnostics.js';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseApplicationEnvironment } from '@paperfund/config';
import {
  createDatabase,
  GenericCapability,
  genericCapabilityOptions,
  recordCreatorFeeIngestionFailure,
  recordCreatorFeeIngestionRetries,
  runCreatorFeeIngestionTick,
  runDailyRewardFinalizationTick,
  runHourlyLifecycleTick,
  runPayoutPlanGenerationTick,
  runRewardFinalizationTick,
  SolanaJsonRpcClient,
  SolanaPumpCreatorFeeSource,
} from '@paperfund/db';
import { createProductionExecutionRouter } from '@paperfund/protocols';

const config = parseApplicationEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const genericCapability = new GenericCapability(database, {
  ...genericCapabilityOptions(config),
  systemSettlement: true,
});
const router = createProductionExecutionRouter({
  genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
  genericPumpSwapBuysEnabled: false,
  genericAccessResolver: (mint, quote, settlement) =>
    genericCapability.resolve(mint, quote, settlement),
  nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
  nonSolPumpSwapRoutes: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES,
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
        onRetry: ({ method, attempt, maxAttempts, message }) => {
          creatorFeeRetryErrors += 1;
          log('error', 'creator_fee_rpc_retry', { method, attempt, maxAttempts, message });
        },
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
let creatorFeeRetryErrors = 0;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const heartbeatPath = isAbsolute(config.WORKER_HEARTBEAT_FILE)
  ? config.WORKER_HEARTBEAT_FILE
  : resolve(repositoryRoot, config.WORKER_HEARTBEAT_FILE);
const heartbeat = {
  genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
  genericPumpSwapEntriesArmed: config.GENERIC_PUMPSWAP_BUYS_ENABLED,
  genericOperatorCount: config.GENERIC_PUMPSWAP_OPERATOR_USER_IDS.length,
  nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
  nonSolPumpSwapAllowedMints: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES.map((r) => r.mint),
  processId: process.pid,
  startedAt: new Date().toISOString(),
  lastTickStartedAt: null as string | null,
  lastLifecycleSuccessAt: null as string | null,
  lastFeePollAt: null as string | null,
  lastError: null as { at: string; scope: string; message: string } | null,
};

async function writeHeartbeat() {
  const temporary = `${heartbeatPath}.${process.pid.toString()}.tmp`;
  await mkdir(dirname(heartbeatPath), { recursive: true });
  await writeFile(temporary, `${workerDiagnosticJson(heartbeat)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, heartbeatPath);
}

function log(level: 'info' | 'error', event: string, metadata: Record<string, unknown>) {
  const entry = workerDiagnosticJson({
    level,
    event,
    ...metadata,
    timestamp: new Date().toISOString(),
  });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}

async function tick() {
  heartbeat.lastTickStartedAt = new Date().toISOString();
  if (creatorFeeSource) {
    const retriesBeforeTick = creatorFeeRetryErrors;
    try {
      const result = await runCreatorFeeIngestionTick(database, creatorFeeSource, new Date(), {
        shadowMode: config.CREATOR_FEE_SHADOW_MODE,
      });
      const retryErrors = creatorFeeRetryErrors - retriesBeforeTick;
      await recordCreatorFeeIngestionRetries(database, creatorFeeSource, retryErrors);
      heartbeat.lastFeePollAt = new Date().toISOString();
      heartbeat.lastError = null;
      log('info', 'creator_fee_ingestion_tick', {
        ...result,
        observedLagSlots: result.observedLagSlots.toString(),
        finalizedChainSlot: result.finalizedChainSlot.toString(),
        retryErrors,
      });
      if (result.rejected > 0)
        log('info', 'creator_fee_candidates_rejected', {
          count: result.rejected,
          category: 'NO_VERIFIED_CREATOR_FEE_EVENT',
        });
      if (result.reconciliationRequired > 0)
        log('error', 'creator_fee_reconciliation_required', {
          count: result.reconciliationRequired,
        });
    } catch (error) {
      try {
        await recordCreatorFeeIngestionFailure(database, creatorFeeSource, error, new Date(), {
          shadowMode: config.CREATOR_FEE_SHADOW_MODE,
          retryErrors: creatorFeeRetryErrors - retriesBeforeTick,
        });
      } catch (healthError) {
        log('error', 'creator_fee_ingestion_health_write_failed', {
          message: safeWorkerErrorMessage(healthError, 'Unknown health write failure'),
        });
      }
      log('error', 'creator_fee_ingestion_tick_failed', {
        errorCode:
          error instanceof Error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR',
        message: safeWorkerErrorMessage(error, 'Unknown creator-fee ingestion failure'),
      });
      heartbeat.lastError = {
        at: new Date().toISOString(),
        scope: 'creator_fee_ingestion',
        message: safeWorkerErrorMessage(error, 'Unknown creator-fee ingestion failure'),
      };
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
    const payoutPlans = config.PRIVATE_BETA_NON_PAYING ? [] : await runPayoutPlanGenerationTick(database, now);
    for (const roundId of rewardRounds) log('info', 'reward_pool_frozen', { roundId });
    for (const dailyCompetitionId of rewardDays)
      log('info', 'daily_reward_pool_frozen', { dailyCompetitionId });
    for (const payoutPlanId of payoutPlans)
      log('info', 'shadow_payout_plan_validated', { payoutPlanId });
    for (const event of events) {
      log(
        event.type === 'SETTLEMENT_OPERATIONAL_ERROR' ? 'error' : 'info',
        event.type.toLowerCase(),
        {
          roundId: event.roundId,
          failures: event.failures,
          failureDetails: event.failureDetails,
        },
      );
    }
    const operationalError = events.find((event) => event.type === 'SETTLEMENT_OPERATIONAL_ERROR');
    if (operationalError) {
      heartbeat.lastError = {
        at: new Date().toISOString(),
        scope: 'settlement',
        message: `${operationalError.roundId}: ${operationalError.failureDetails?.[0]?.message ?? 'Settlement requires operator intervention.'}`,
      };
    } else {
      heartbeat.lastLifecycleSuccessAt = new Date().toISOString();
      if (!creatorFeeSource) heartbeat.lastError = null;
    }
  } catch (error) {
    log('error', 'round_lifecycle_tick_failed', {
      errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR',
      message: safeWorkerErrorMessage(error, 'Unknown worker failure'),
    });
    heartbeat.lastError = {
      at: new Date().toISOString(),
      scope: 'round_lifecycle',
      message: safeWorkerErrorMessage(error, 'Unknown worker failure'),
    };
  } finally {
    try {
      await writeHeartbeat();
    } catch (error) {
      log('error', 'worker_heartbeat_write_failed', {
        message: safeWorkerErrorMessage(error, 'Unknown heartbeat write failure'),
      });
    }
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
log('info', 'worker_started', {
  creatorFeeIngestionEnabled: config.CREATOR_FEE_INGESTION_ENABLED,
  creatorFeeShadowMode: config.CREATOR_FEE_SHADOW_MODE,
  creatorFeeNetwork: config.CREATOR_FEE_NETWORK,
  payoutNetwork: config.PAYOUT_NETWORK,
  payoutExecutionEnabled: config.PAYOUT_EXECUTION_ENABLED,
});
await tick();
