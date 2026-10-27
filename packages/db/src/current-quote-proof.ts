/** Read-only technical qualification for current-quote rounds. Never grants payment authority. */
import { createHash } from 'node:crypto';
import { canonicalJson, type ExecutionRouter } from '@paperfund/execution';
import type { DatabaseService } from './database.js';
import { reconcileAccountLedger, replayPersistedFill } from './financial-service.js';

export async function currentQuoteHourlyProof(
  database: DatabaseService,
  router: ExecutionRouter,
  roundId: string,
) {
  const query = async (sql: string, values: unknown[] = []) =>
    (await database.pool.query(sql, values)).rows;
  const round = (await query('select * from hourly_rounds where id=$1', [roundId]))[0];
  if (!round) throw Error('CURRENT_QUOTE_ROUND_NOT_FOUND');
  const reasons: string[] = [];
  const holds = await query(
    'select * from legacy_source_reviews where hourly_round_id=$1 order by id',
    [roundId],
  );
  if (holds.length) reasons.push('HISTORICAL_REVIEW_PRESERVED');
  const accounts = await query(
    'select * from competition_accounts where hourly_round_id=$1 order by id',
    [roundId],
  );
  const positions = await query(
    'select p.* from positions p join competition_accounts a on a.id=p.competition_account_id where a.hourly_round_id=$1 order by p.id',
    [roundId],
  );
  const fills = await query(
    `select f.*,o.competition_account_id,o.execution_context
    from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id
    where a.hourly_round_id=$1 order by f.executed_at,f.id`,
    [roundId],
  );
  const results = await query(
    'select * from hourly_results where hourly_round_id=$1 order by competition_account_id',
    [roundId],
  );
  const ledgers = [];
  for (const account of accounts) {
    const ledger = await reconcileAccountLedger(database, account.id);
    ledgers.push(ledger);
    if (!ledger.reconciled) reasons.push('ACCOUNT_LEDGER_MISMATCH:' + account.id);
    const slots = await query(
      'select * from competition_token_slots where competition_account_id=$1 order by asset_id',
      [account.id],
    );
    const bought = await query(
      `select distinct m.base_asset_id from fills f join orders o on o.id=f.order_id
      join markets m on m.id=f.market_id where o.competition_account_id=$1 and f.side='BUY' and f.base_quantity>0 order by m.base_asset_id`,
      [account.id],
    );
    if (
      slots.length > round.max_unique_tokens ||
      slots.length !== bought.length ||
      slots.some((s) => !bought.some((b) => b.base_asset_id === s.asset_id))
    )
      reasons.push('TOKEN_SLOT_MISMATCH:' + account.id);
    const result = results.find((r) => r.competition_account_id === account.id);
    if (
      result &&
      (result.user_id !== account.user_id ||
        BigInt(result.final_settled_balance_lamports) !== ledger.materializedCashLamports ||
        BigInt(result.starting_paper_sol_lamports) !== ledger.startingCapitalLamports ||
        BigInt(result.hourly_pnl_lamports) !==
          ledger.materializedCashLamports - ledger.startingCapitalLamports)
    )
      reasons.push('HOURLY_RESULT_MISMATCH:' + account.id);
  }
  const replays = [];
  for (const fill of fills) {
    const at = +new Date(fill.executed_at),
      start = +new Date(round.starts_at),
      end = +new Date(round.ends_at_exclusive);
    if (fill.execution_context === 'NORMAL_USER') {
      if (!Number.isFinite(at) || at < start || at >= end)
        reasons.push('USER_FILL_OUTSIDE_ROUND:' + fill.id);
    } else if (!(await database.verifySettlementFill?.(fill.id))) {
      // Do not infer cutoff qualification from a forced timestamp or successful replay.
      reasons.push('FORCED_CUTOFF_ACCEPTANCE_REQUIRED:' + fill.id);
    }
    try {
      replays.push(await replayPersistedFill(database, router, fill.id));
    } catch {
      reasons.push('FILL_REPLAY_FAILED:' + fill.id);
    }
  }
  const open = positions.filter(
    (p) =>
      p.status === 'OPEN' ||
      BigInt(p.remaining_base_units) !== 0n ||
      BigInt(p.cost_basis_lamports) !== 0n,
  );
  if (open.length) reasons.push('RETAINED_CUTOFF_EXIT_EVIDENCE_REQUIRED');
  const technicalReasons = [...new Set(reasons)];
  const finalityReasons =
    round.state !== 'FINALIZED' || results.length !== accounts.length
      ? ['ROUND_AND_ALL_RESULTS_NOT_FINAL']
      : [];
  const snapshot = { round, accounts, positions, fills, results, holds, ledgers };
  const structuralHash = createHash('sha256')
    .update(
      canonicalJson(
        JSON.parse(JSON.stringify(snapshot, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      ),
    )
    .digest('hex');
  return {
    roundId,
    structuralHash,
    accountingQualified: technicalReasons.length === 0,
    finalResultsQualified: technicalReasons.length === 0 && finalityReasons.length === 0,
    technicalReasons,
    finalityReasons,
    accountCount: accounts.length,
    fillCount: fills.length,
    openPositionCount: open.length,
    replays,
    ledgers,
    // Existing accepted-source, funding, custody, approvals and STOP gates remain mandatory.
    realFinancialAccepted: false as const,
    payable: false as const,
  };
}

export async function currentQuoteDailyProof(
  database: DatabaseService,
  router: ExecutionRouter,
  dayId: string,
) {
  const day = (await database.pool.query('select * from daily_competitions where id=$1', [dayId]))
    .rows[0];
  if (!day) throw Error('CURRENT_QUOTE_DAY_NOT_FOUND');
  const rounds = (
    await database.pool.query(
      'select id,starts_at,ends_at_exclusive from hourly_rounds where starts_at>=$1 and starts_at<$2 order by starts_at',
      [day.starts_at, day.ends_at_exclusive],
    )
  ).rows;
  const reasons: string[] = [];
  if (
    +new Date(day.ends_at_exclusive) - +new Date(day.starts_at) !== 86400000 ||
    new Date(day.starts_at).toISOString().slice(11) !== '00:00:00.000Z' ||
    rounds.length !== 24 ||
    rounds.some(
      (r, i) =>
        +new Date(r.starts_at) !== +new Date(day.starts_at) + i * 3600000 ||
        +new Date(r.ends_at_exclusive) !== +new Date(r.starts_at) + 3600000,
    )
  )
    reasons.push('UTC_24_HOUR_COVERAGE_REQUIRED');
  const hours = [];
  for (const r of rounds) hours.push(await currentQuoteHourlyProof(database, router, r.id));
  if (hours.some((h) => !h.finalResultsQualified)) reasons.push('ALL_HOURLY_RESULTS_MUST_QUALIFY');
  if (day.state !== 'FINALIZED') reasons.push('DAILY_NOT_FINAL');
  const scores = (
    await database.pool.query(
      `with expected as (
    select h.user_id,sum(h.hourly_pnl_lamports)::text score,count(*)::int hours
    from hourly_results h join hourly_rounds r on r.id=h.hourly_round_id
    where r.starts_at >= $2 and r.starts_at < $3 group by h.user_id
  ), actual as (select * from daily_results where daily_competition_id=$1)
    select e.user_id,e.score expected,e.hours,d.cumulative_pnl_lamports::text score,d.completed_hourly_round_count
    from expected e full join actual d on d.user_id=e.user_id`,
      [dayId, day.starts_at, day.ends_at_exclusive],
    )
  ).rows;
  const badLinks = (
    await database.pool.query(
      `select h.id from hourly_results h join hourly_rounds r on r.id=h.hourly_round_id
    left join daily_result_hourly_results l on l.hourly_result_id=h.id
    left join daily_results d on d.id=l.daily_result_id
    where r.starts_at >= $2 and r.starts_at < $3 and (d.id is null or d.daily_competition_id<>$1 or d.user_id<>h.user_id)
    union all select h.id from daily_results d join daily_result_hourly_results l on l.daily_result_id=d.id
    join hourly_results h on h.id=l.hourly_result_id join hourly_rounds r on r.id=h.hourly_round_id
    where d.daily_competition_id=$1 and (r.starts_at<$2 or r.starts_at >=$3 or h.user_id<>d.user_id)`,
      [dayId, day.starts_at, day.ends_at_exclusive],
    )
  ).rows;
  if (
    badLinks.length ||
    scores.some(
      (s) =>
        s.score !== s.expected ||
        s.hours === null ||
        Number(s.completed_hourly_round_count) !== s.hours,
    )
  )
    reasons.push('DAILY_CUMULATIVE_ACCOUNTING_MISMATCH');
  return {
    dayId,
    hours,
    reasons,
    finalResultsQualified: reasons.length === 0,
    realFinancialAccepted: false as const,
    payable: false as const,
  };
}
