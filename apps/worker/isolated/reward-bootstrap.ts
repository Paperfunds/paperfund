/** Reviewed future-only assembly for the ordinary worker. Called only by the staged successor. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DatabaseService } from '../../../packages/db/src/database.js';
import type { ExecutionRouter } from '@paperfund/execution';
import * as protocols from '@paperfund/protocols';
import {
  FinalizedRpc,
  FinalizedBankArchive,
} from '../../api/isolated/verified-routes/finalized-connector.js';
import { currentQuoteRouter } from '../../api/isolated/current-quotes/router.js';
import { captureCurrentPumpRoute } from '../../api/isolated/current-quotes/capture.js';
import { currentSnapshots } from '../../api/isolated/current-quotes/production-public/discovery.mjs';
import { composePublicCurrentCutoffWorker } from './current-cutoff.js';
import { installDrain } from '../../api/isolated/verified-routes/operational/bootstrap.js';
export async function connectRewardRuntime(
  database: DatabaseService,
  baseline: ExecutionRouter,
  config: {
    PRIVATE_BETA_NON_PAYING: boolean;
    PAYOUT_EXECUTION_ENABLED: boolean;
    PAYOUT_SIGNER_TYPE: string;
    CREATOR_FEE_INGESTION_ENABLED: boolean;
    SOLANA_RPC_URL: string;
    SOLANA_RPC_TIMEOUT_MS: number;
  },
) {
  if (
    !config.PRIVATE_BETA_NON_PAYING ||
    config.PAYOUT_EXECUTION_ENABLED ||
    config.PAYOUT_SIGNER_TYPE !== 'DISABLED'
  )
    throw Error('REWARD_WORKER_NONPAYING_REQUIRED');
  const [file, pin] = process.argv.slice(2);
  if (!file || !path.isAbsolute(file) || !pin) throw Error('REWARD_WORKER_PINNED_PROFILE_REQUIRED');
  const raw = fs.readFileSync(file);
  if (createHash('sha256').update(raw).digest('hex') !== pin)
    throw Error('REWARD_WORKER_PROFILE_PIN');
  const profile = JSON.parse(raw.toString('utf8')),
    scope = profile.rewardSettlement;
  if (
    profile.schema !== 'PAPERFUND_PUBLIC_CURRENT_QUOTES_V1' ||
    profile.nonPaying !== true ||
    scope?.model !== 'DURABLE_QUOTE_V2' ||
    typeof scope.policyId !== 'string' ||
    !path.isAbsolute(profile.archiveDirectory) ||
    !path.isAbsolute(profile.controlDirectory)
  )
    throw Error('REWARD_WORKER_REVIEWED_SCOPE_REQUIRED');
  const policy = (
    await database.pool.query(
      'select to_jsonb(p) policy from current_quote_settlement_policies p where id=$1',
      [scope.policyId],
    )
  ).rows[0]?.policy;
  if (
    config.CREATOR_FEE_INGESTION_ENABLED &&
    scope.creatorFeeIngestion !== 'APPROVED_EXISTING_PIPELINE_V1'
  )
    throw Error('REWARD_INGESTION_SEPARATE_REVIEW_REQUIRED');
  const rpc = new FinalizedRpc(config.SOLANA_RPC_URL, config.SOLANA_RPC_TIMEOUT_MS);
  if (
    policy?.selection_version !== 'DURABLE_QUOTE_V2' ||
    policy.provider_id !== rpc.providerIdentity
  )
    throw Error('REWARD_WORKER_FUTURE_POLICY_REQUIRED');
  if (
    (await database.pool.query('select stopped from payout_stop_state where singleton=true'))
      .rows[0]?.stopped !== true
  )
    throw Error('REWARD_WORKER_FINANCIAL_STOP_REQUIRED');
  const archive = new FinalizedBankArchive(profile.archiveDirectory, true);
  const snapshots = currentSnapshots(
    { currentQuoteRouter, captureCurrentPumpRoute },
    protocols,
    rpc,
    archive,
    baseline,
  );
  const assembled = composePublicCurrentCutoffWorker(
    database,
    baseline,
    scope.policyId,
    rpc,
    snapshots,
  );
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<unknown> = Promise.resolve();
  const captureStatus = {
    model: 'DURABLE_QUOTE_V2',
    lastSampleAt: null as string | null,
    positions: 0,
    failures: 0,
    serviceFailure: false,
  };
  const tick = () => {
    active = assembled
      .capture(new Date())
      .then((result) => {
        Object.assign(captureStatus, {
          lastSampleAt: new Date().toISOString(),
          positions: result.positions,
          failures: result.failures.length,
          serviceFailure: false,
        });
      })
      .catch(() => {
        captureStatus.serviceFailure = true;
      })
      .finally(() => {
        if (!stopping) timer = setTimeout(tick, 250);
      });
  };
  tick();
  return {
    database: assembled.database,
    router: assembled.router,
    captureStatus,
    attachDrain: (drain: () => Promise<void>) =>
      installDrain(profile.controlDirectory, 'worker', drain),
    async stop() {
      stopping = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
