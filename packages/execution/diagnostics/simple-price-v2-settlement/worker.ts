import { ensureCurrentAndNextRounds, ensureDailyCompetition, openDueRounds } from '@paperfund/db';
import type { DatabaseService } from '../../../db/src/database.js';
import { ExecutionEngineError, ExecutionRouter } from '@paperfund/execution';
import { bindPrivateRound } from '../../integration/simple-price-v2-directional/service.js';
import { PROTOCOL } from '../../integration/simple-price-v2-directional/adapter.js';
import { settlePrivate } from '../../integration/simple-price-v2/settlement.js';
import { MODEL_VERSION } from '../../candidates/simple-price-v2-directional/model.js';
import type { Policy } from '../../candidates/simple-price-v2-directional/model.js';
import { REQUIRED_CUTOFF_POLICY } from './diagnosis.js';
export type ReplayMode = 'LIVE_POLICY_UNAPPROVED' | 'CONTROLLED_ARCHIVED_REPLAY';
/** Private orchestration only. Original production worker is neither imported nor modified.
 * Unknown live cutoff-selection policy fails before any financial liquidation, including lucky
 * first-second captures. Fixture replay is a separate, explicitly labelled test-only mode.
 */
export async function recoveryTick(
  db: DatabaseService,
  router: ExecutionRouter,
  now: Date,
  policy: Policy,
  mode: ReplayMode,
  isolationToken: string,
) {
  if (mode !== 'LIVE_POLICY_UNAPPROVED' && mode !== 'CONTROLLED_ARCHIVED_REPLAY')
    throw Error('INVALID_PRIVATE_REPLAY_MODE');
  if (
    mode === 'CONTROLLED_ARCHIVED_REPLAY' &&
    policy.version !== 'CONTROLLED_ARCHIVED_TIME_REPLAY_V1'
  )
    throw Error('CONTROLLED_REPLAY_POLICY_BINDING_REQUIRED');
  const guard = (await db.pool.query('select token from private_v2.isolation_guard')).rows;
  if (guard.length !== 1 || guard[0].token !== isolationToken)
    throw Error('DISPOSABLE_DATABASE_GUARD_REQUIRED');
  const lock = await db.pool.connect();
  try {
    await lock.query("select pg_advisory_lock(hashtext('private-v2-blocker-worker'))");
    await ensureDailyCompetition(db, now);
    const ensured = await ensureCurrentAndNextRounds(db, now);
    for (const id of [ensured.currentRoundId, ensured.nextRoundId]) {
      if (
        !(await db.pool.query('select 1 from private_v2.round_models where round_id=$1', [id]))
          .rowCount
      )
        await bindPrivateRound(db, id, policy);
    }
    const opened = await openDueRounds(db, now);
    const due = (
      await db.pool.query(
        "select id from hourly_rounds where ends_at_exclusive<=$1 and state in ('OPEN','CLOSING','SETTLING') order by starts_at",
        [now],
      )
    ).rows as { id: string }[];
    const guarded =
      mode === 'LIVE_POLICY_UNAPPROVED'
        ? new ExecutionRouter([
            {
              protocolId: PROTOCOL,
              adapterVersion: MODEL_VERSION,
              loadMarketState: async () => {
                throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', REQUIRED_CUTOFF_POLICY);
              },
              simulateBuy: async () => {
                throw Error(REQUIRED_CUTOFF_POLICY);
              },
              simulateSell: async () => {
                throw Error(REQUIRED_CUTOFF_POLICY);
              },
              valuePositionForExit: async () => {
                throw Error(REQUIRED_CUTOFF_POLICY);
              },
            },
          ])
        : router;
    const settlements = [];
    for (const { id } of due)
      settlements.push({ id, control: await settlePrivate(db, guarded, id, now) });
    return { ensured, opened, settlements };
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext('private-v2-blocker-worker'))");
    lock.release();
  }
}
