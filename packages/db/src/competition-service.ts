import type { ExecutionRouter } from '@paperfund/execution';

import type { DatabaseService } from './database.js';
import {
  DEFAULT_STARTING_PAPER_SOL_LAMPORTS,
  FinancialServiceError,
  initializeCompetitionAccount,
  settleHourlyRound,
  type SettlementFailure,
} from './financial-service.js';

export const DEFAULT_MAX_UNIQUE_TOKENS = 5;
export const DEFAULT_MAX_BUY_RATIO_BPS = 2_000;
export const DEFAULT_REWARD_GRACE_SECONDS = 60;
export const CURRENT_RULES_VERSION = 'phase-4a-v1';

export interface HourlyRoundView {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAtExclusive: Date;
  readonly state: string;
  readonly startingPaperSolLamports: bigint;
  readonly maxUniqueTokens: number;
  readonly maxBuyRatioBps: number;
  readonly rewardFinalizationGracePeriodSeconds: number;
}

export interface DailyCompetitionView {
  readonly id: string;
  readonly utcDate: string;
  readonly startsAt: Date;
  readonly endsAtExclusive: Date;
  readonly state: string;
  readonly participantCount: number;
  readonly resultCount: number;
}

export function canonicalHourlyWindow(now: Date): { startsAt: Date; endsAtExclusive: Date } {
  const startsAt = new Date(now);
  startsAt.setUTCMinutes(0, 0, 0);
  return { startsAt, endsAtExclusive: new Date(startsAt.getTime() + 3_600_000) };
}

export function canonicalDailyWindow(now: Date) {
  const startsAt = new Date(now);
  startsAt.setUTCHours(0, 0, 0, 0);
  return {
    utcDate: startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 86_400_000),
  };
}

function hourlyRoundId(startsAt: Date): string {
  return `hourly:${startsAt.toISOString()}`;
}

export async function ensureHourlyRound(
  database: DatabaseService,
  startsAt: Date,
  rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS,
): Promise<string> {
  const endsAtExclusive = new Date(startsAt.getTime() + 3_600_000);
  const id = hourlyRoundId(startsAt);
  await database.pool.query(
    `insert into hourly_rounds
      (id, starts_at, ends_at_exclusive, state, starting_paper_sol_lamports,
       max_unique_tokens, max_buy_ratio_bps, reward_finalization_grace_period_seconds, rules_version)
     values ($1, $2, $3, 'SCHEDULED', $4, $5, $6, $7, $8)
     on conflict (starts_at) do nothing`,
    [
      id,
      startsAt,
      endsAtExclusive,
      DEFAULT_STARTING_PAPER_SOL_LAMPORTS,
      DEFAULT_MAX_UNIQUE_TOKENS,
      DEFAULT_MAX_BUY_RATIO_BPS,
      rewardGraceSeconds,
      CURRENT_RULES_VERSION,
    ],
  );
  const result = await database.pool.query<{ id: string }>(
    'select id from hourly_rounds where starts_at = $1',
    [startsAt],
  );
  return result.rows[0]!.id;
}

export async function ensureDailyCompetition(
  database: DatabaseService,
  now: Date,
): Promise<string> {
  const window = canonicalDailyWindow(now);
  const id = `daily:${window.utcDate}`;
  await database.pool.query(
    `insert into daily_competitions (id, utc_date, starts_at, ends_at_exclusive, state)
     values ($1, $2, $3, $4, 'OPEN') on conflict (utc_date) do nothing`,
    [id, window.utcDate, window.startsAt, window.endsAtExclusive],
  );
  const result = await database.pool.query<{ id: string }>(
    'select id from daily_competitions where utc_date = $1',
    [window.utcDate],
  );
  return result.rows[0]!.id;
}

export async function ensureCurrentAndNextRounds(
  database: DatabaseService,
  now: Date,
  rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS,
) {
  const { startsAt, endsAtExclusive } = canonicalHourlyWindow(now);
  await ensureDailyCompetition(database, now);
  const [currentRoundId, nextRoundId] = await Promise.all([
    ensureHourlyRound(database, startsAt, rewardGraceSeconds),
    ensureHourlyRound(database, endsAtExclusive, rewardGraceSeconds),
  ]);
  return { currentRoundId, nextRoundId };
}

export async function openDueRounds(database: DatabaseService, now: Date): Promise<string[]> {
  const result = await database.pool.query<{ id: string }>(
    `update hourly_rounds set state = 'OPEN'
     where state = 'SCHEDULED' and starts_at <= $1 returning id`,
    [now],
  );
  return result.rows.map(({ id }) => id);
}

export async function getCurrentRound(
  database: DatabaseService,
  now: Date,
): Promise<HourlyRoundView | null> {
  const result = await database.pool.query<{
    id: string;
    starts_at: Date;
    ends_at_exclusive: Date;
    state: string;
    starting_paper_sol_lamports: string;
    max_unique_tokens: number;
    max_buy_ratio_bps: number;
    reward_finalization_grace_period_seconds: number;
  }>(
    `select id, starts_at, ends_at_exclusive, state, starting_paper_sol_lamports,
            max_unique_tokens, max_buy_ratio_bps, reward_finalization_grace_period_seconds
     from hourly_rounds where starts_at <= $1 and ends_at_exclusive > $1 limit 1`,
    [now],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        startsAt: row.starts_at,
        endsAtExclusive: row.ends_at_exclusive,
        state: row.state,
        startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
        maxUniqueTokens: row.max_unique_tokens,
        maxBuyRatioBps: row.max_buy_ratio_bps,
        rewardFinalizationGracePeriodSeconds: row.reward_finalization_grace_period_seconds,
      }
    : null;
}

export async function enterCurrentRound(
  database: DatabaseService,
  input: { readonly userId: string; readonly now: Date },
) {
  const round = await getCurrentRound(database, input.now);
  if (!round || round.state !== 'OPEN') {
    throw new FinancialServiceError('ROUND_NOT_OPEN', 'The current hourly round is not open.');
  }
  return initializeCompetitionAccount(database, {
    accountId: `account:${round.id}:${input.userId}`,
    userId: input.userId,
    hourlyRoundId: round.id,
    idempotencyKey: `round-entry:${round.id}:${input.userId}`,
    requireOpenAt: input.now,
  });
}

export async function getCurrentDailyCompetition(
  database: DatabaseService,
  now: Date,
): Promise<DailyCompetitionView | null> {
  const result = await database.pool.query<{
    id: string;
    utc_date: string;
    starts_at: Date;
    ends_at_exclusive: Date;
    state: string;
    participant_count: number;
    result_count: number;
  }>(
    `select d.id, d.utc_date::text, d.starts_at, d.ends_at_exclusive, d.state,
            count(distinct dr.user_id)::int participant_count,
            count(dr.id)::int result_count
     from daily_competitions d left join daily_results dr on dr.daily_competition_id = d.id
     where d.starts_at <= $1 and d.ends_at_exclusive > $1
     group by d.id limit 1`,
    [now],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        utcDate: row.utc_date,
        startsAt: row.starts_at,
        endsAtExclusive: row.ends_at_exclusive,
        state: row.state,
        participantCount: row.participant_count,
        resultCount: row.result_count,
      }
    : null;
}

export interface LifecycleEvent {
  readonly type:
    | 'ROUND_CREATED'
    | 'ROUND_OPENED'
    | 'ROUND_SETTLING'
    | 'ROUND_FINALIZED'
    | 'SETTLEMENT_RETRY'
    | 'SETTLEMENT_OPERATIONAL_ERROR'
    | 'DAILY_FINALIZED';
  readonly roundId: string;
  readonly failures?: number;
  readonly failureDetails?: readonly SettlementFailure[];
}

export async function runHourlyLifecycleTick(
  database: DatabaseService,
  router: ExecutionRouter,
  now: Date,
  rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS,
): Promise<readonly LifecycleEvent[]> {
  const events: LifecycleEvent[] = [];
  const window = canonicalHourlyWindow(now);
  const existing = await database.pool.query<{ starts_at: Date }>(
    'select starts_at from hourly_rounds where starts_at in ($1, $2)',
    [window.startsAt, window.endsAtExclusive],
  );
  const existingTimes = new Set(existing.rows.map(({ starts_at }) => starts_at.toISOString()));
  const ensured = await ensureCurrentAndNextRounds(database, now, rewardGraceSeconds);
  if (!existingTimes.has(window.startsAt.toISOString()))
    events.push({ type: 'ROUND_CREATED', roundId: ensured.currentRoundId });
  if (!existingTimes.has(window.endsAtExclusive.toISOString()))
    events.push({ type: 'ROUND_CREATED', roundId: ensured.nextRoundId });
  for (const roundId of await openDueRounds(database, now)) {
    events.push({ type: 'ROUND_OPENED', roundId });
  }
  const ended = await database.pool.query<{ id: string; starts_at: Date }>(
    `select id, starts_at from hourly_rounds
     where ends_at_exclusive <= $1 and state in ('OPEN', 'CLOSING', 'SETTLING')
     order by starts_at`,
    [now],
  );
  for (const { id, starts_at } of ended.rows) {
    await ensureDailyCompetition(database, starts_at);
    const result = await settleHourlyRound(database, router, {
      hourlyRoundId: id,
      authoritativeTimestamp: now,
    });
    events.push({
      type: result.state === 'FINALIZED' ? 'ROUND_FINALIZED' : 'ROUND_SETTLING',
      roundId: id,
      failures: result.failures.length,
    });
    for (const disposition of ['RETRY', 'OPERATIONAL_ERROR'] as const) {
      const details = result.failures.filter((f) => f.disposition === disposition);
      if (details.length > 0)
        events.push({
          type: disposition === 'RETRY' ? 'SETTLEMENT_RETRY' : 'SETTLEMENT_OPERATIONAL_ERROR',
          roundId: id,
          failures: details.length,
          failureDetails: details,
        });
    }
  }
  await database.pool.query(
    `update daily_competitions set state = 'FINALIZING'
     where ends_at_exclusive <= $1 and state in ('OPEN', 'CLOSING')`,
    [now],
  );
  const finalizedDays = await database.pool.query<{ id: string }>(
    `update daily_competitions d set state = 'FINALIZED', finalized_at = $1
     where d.state = 'FINALIZING'
       and not exists (select 1 from legacy_source_reviews h join hourly_rounds r on r.id=h.hourly_round_id where r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive)
       and (select count(*) from hourly_rounds r
            where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive) = 24
       and not exists (
         select 1 from hourly_rounds r
         where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive
           and r.state <> 'FINALIZED'
       )
     returning d.id`,
    [now],
  );
  for (const { id } of finalizedDays.rows) events.push({ type: 'DAILY_FINALIZED', roundId: id });
  return events;
}
