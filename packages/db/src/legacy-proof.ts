import type { ExecutionRouter } from '@paperfund/execution';
import type { DatabaseService } from './database.js';
import { reconcileAccountLedger, replayPersistedFill } from './financial-service.js';

/** Read-only evidence projection for the retained engine. No mainnet ACCEPTED branch exists. */
export async function legacyHourlyProof(
  database: DatabaseService,
  router: ExecutionRouter,
  roundId: string,
) {
  const round = (await database.pool.query('select * from hourly_rounds where id=$1', [roundId]))
    .rows[0];
  const reasons: string[] = [];
  if (round?.state !== 'FINALIZED') reasons.push('ROUND_NOT_FINAL');
  const holds = (
    await database.pool.query(
      'select reason from legacy_source_reviews where hourly_round_id=$1 order by id',
      [roundId],
    )
  ).rows;
  if (holds.length) reasons.push(...holds.map((r) => 'REVIEW:' + r.reason));
  const accounts = (
    await database.pool.query(
      'select id from competition_accounts where hourly_round_id=$1 order by id',
      [roundId],
    )
  ).rows;
  for (const account of accounts) {
    try {
      const r = await reconcileAccountLedger(database, account.id);
      if (!r.reconciled) reasons.push('ACCOUNT_NOT_RECONCILED');
    } catch {
      reasons.push('ACCOUNT_RECONCILIATION_UNAVAILABLE');
    }
  }
  const fills = (
    await database.pool.query(
      `select f.id,o.execution_context,l.fill_id bound
  from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id
  left join legacy_settlement_liquidations l on l.fill_id=f.id where a.hourly_round_id=$1 order by f.id`,
      [roundId],
    )
  ).rows;
  for (const fill of fills) {
    if (fill.execution_context === 'FORCED_HOURLY_SETTLEMENT' && !fill.bound)
      reasons.push('HISTORICAL_UNBOUND_FORCED_FILL');
    try {
      if (!(await replayPersistedFill(database, router, fill.id)).matched)
        reasons.push('FILL_REPLAY_MISMATCH');
    } catch {
      reasons.push('FILL_REPLAY_UNAVAILABLE');
    }
  }
  const row = (await database.pool.query('select legacy_hour_digest($1) hash', [roundId])).rows[0];
  const q = (
    await database.pool.query('select * from legacy_test_qualifications where hourly_round_id=$1', [
      roundId,
    ])
  ).rows[0];
  if (!q || q.proof_hash !== row.hash) reasons.push('QUALIFICATION_MISSING_OR_CHANGED');
  const latest = (
    await database.pool.query('select legacy_source_allowed($1,$2) allowed', ['HOURLY', roundId])
  ).rows[0];
  return {
    roundId,
    structuralHash: row.hash as string,
    structural: reasons.filter((r) => r !== 'QUALIFICATION_MISSING_OR_CHANGED').length === 0,
    localnetTestAccepted:
      reasons.length === 0 && q?.profile === 'TEST_ONLY_LOCALNET' && latest?.allowed === true,
    realFinancialAccepted: false as const,
    reasons,
    fillIds: fills.map((f) => f.id),
    accountIds: accounts.map((a) => a.id),
  };
}
