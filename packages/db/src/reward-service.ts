import { createHash } from 'node:crypto';

import {
  competitionConfig,
  identifier,
  isHourlyRewardEconomicsConserved,
  processHourlyRewardEconomics,
  validateCompetitionConfig,
  type CompletedNaturalHourlyReward,
  type CreatorFeeAllocationMode,
  type HourlyRoundId,
} from '@paperfund/core';
import type { PoolClient } from 'pg';

import type { DatabaseService } from './database.js';

export interface VerifiedCreatorFeeEvent {
  readonly transactionSignature: string;
  readonly eventIndex: number;
  readonly slot: bigint;
  readonly eventTime: Date;
  readonly creatorFeeLamports: bigint;
  readonly sourceProgram: string;
  readonly tokenProjectIdentity?: string;
  readonly observedAt: Date;
  readonly normalizedMetadata?: Readonly<Record<string, unknown>>;
  readonly verificationStatus: 'VERIFIED' | 'REJECTED';
}

export interface CreatorFeeSource {
  readonly id: string;
  read(): Promise<readonly VerifiedCreatorFeeEvent[]>;
}

export class FixtureCreatorFeeSource implements CreatorFeeSource {
  readonly id = 'DETERMINISTIC_FIXTURE';
  constructor(private readonly events: readonly VerifiedCreatorFeeEvent[]) {}
  async read() {
    return this.events;
  }
}

export interface RewardAccountingConfig {
  readonly allocationMode: CreatorFeeAllocationMode;
  readonly baselineWindow: number;
  readonly lambdaBps: bigint;
  readonly configurationVersion: string;
}

export const defaultRewardAccountingConfig: RewardAccountingConfig = {
  allocationMode: 'NORMAL',
  baselineWindow: 12,
  lambdaBps: 6_000n,
  configurationVersion: 'phase-5a-v1',
};

export class RewardAccountingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function eventId(event: VerifiedCreatorFeeEvent): string {
  return `fee:${createHash('sha256').update(`${event.transactionSignature}:${event.eventIndex.toString()}`).digest('hex')}`;
}

function assertEvent(event: VerifiedCreatorFeeEvent) {
  if (
    event.transactionSignature.length === 0 ||
    !Number.isInteger(event.eventIndex) ||
    event.eventIndex < 0 ||
    event.slot < 0n ||
    event.creatorFeeLamports <= 0n ||
    event.sourceProgram.length === 0 ||
    !Number.isFinite(event.eventTime.getTime()) ||
    !Number.isFinite(event.observedAt.getTime())
  ) {
    throw new RewardAccountingError('INVALID_CREATOR_FEE_EVENT', 'Creator-fee event is malformed.');
  }
}

async function attributeEvent(client: PoolClient, event: VerifiedCreatorFeeEvent) {
  const round = (
    await client.query<{ id: string }>(
      `select id from hourly_rounds
       where starts_at <= $1 and ends_at_exclusive > $1
       order by starts_at desc limit 1`,
      [event.eventTime],
    )
  ).rows[0];
  if (!round || event.verificationStatus !== 'VERIFIED') {
    return { hourlyRoundId: round?.id ?? null, accountingStatus: 'INELIGIBLE' as const };
  }
  const frozen = (
    await client.query<{ id: string }>(
      'select id from hourly_reward_pools where hourly_round_id = $1',
      [round.id],
    )
  ).rows[0];
  return {
    hourlyRoundId: round.id,
    accountingStatus: frozen ? ('LATE_AFTER_FREEZE' as const) : ('ATTRIBUTED' as const),
  };
}

export async function ingestCreatorFeeEvents(
  database: DatabaseService,
  source: CreatorFeeSource,
): Promise<{ inserted: number; duplicates: number; lateAfterFreeze: number }> {
  const events = await source.read();
  const client = await database.pool.connect();
  let inserted = 0;
  let duplicates = 0;
  let lateAfterFreeze = 0;
  try {
    await client.query('begin');
    for (const event of events) {
      assertEvent(event);
      const attribution = await attributeEvent(client, event);
      const id = eventId(event);
      const result = await client.query<{ id: string }>(
        `insert into creator_fee_events
          (id, transaction_signature, event_index, slot, event_time, creator_fee_lamports,
           source_program, token_project_identity, observed_at, normalized_metadata,
           verification_status, accounting_status, hourly_round_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (transaction_signature, event_index) do nothing returning id`,
        [
          id,
          event.transactionSignature,
          event.eventIndex,
          event.slot.toString(),
          event.eventTime,
          event.creatorFeeLamports.toString(),
          event.sourceProgram,
          event.tokenProjectIdentity ?? null,
          event.observedAt,
          event.normalizedMetadata ?? {},
          event.verificationStatus,
          attribution.accountingStatus,
          attribution.hourlyRoundId,
        ],
      );
      if (result.rowCount === 0) {
        const existing = (
          await client.query<{
            slot: string;
            event_time: Date;
            creator_fee_lamports: string;
            source_program: string;
            verification_status: string;
          }>(
            `select slot,event_time,creator_fee_lamports,source_program,verification_status
             from creator_fee_events where transaction_signature=$1 and event_index=$2`,
            [event.transactionSignature, event.eventIndex],
          )
        ).rows[0]!;
        if (
          BigInt(existing.slot) !== event.slot ||
          existing.event_time.getTime() !== event.eventTime.getTime() ||
          BigInt(existing.creator_fee_lamports) !== event.creatorFeeLamports ||
          existing.source_program !== event.sourceProgram ||
          existing.verification_status !== event.verificationStatus
        ) {
          throw new RewardAccountingError(
            'CREATOR_FEE_IDENTITY_CONFLICT',
            'Creator-fee chain identity was reingested with different authoritative data.',
          );
        }
        duplicates += 1;
        continue;
      }
      inserted += 1;
      if (attribution.accountingStatus === 'LATE_AFTER_FREEZE') {
        lateAfterFreeze += 1;
        await client.query(
          `insert into late_fee_reconciliations
             (id, creator_fee_event_id, hourly_round_id, discovered_at)
           values ($1,$2,$3,$4) on conflict (creator_fee_event_id) do nothing`,
          [`reconciliation:${id}`, id, attribution.hourlyRoundId, event.observedAt],
        );
      }
    }
    await client.query('commit');
    return { inserted, duplicates, lateAfterFreeze };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function runtimeCompetitionConfig(config: RewardAccountingConfig) {
  return validateCompetitionConfig({
    ...competitionConfig,
    version: config.configurationVersion,
    rewardBuffer: {
      ...competitionConfig.rewardBuffer,
      baselineWindowCompletedHours: config.baselineWindow,
      lambdaBps: config.lambdaBps,
    },
  });
}

type RewardPoolRow = {
  id: string;
  hourly_round_id: string;
  creator_fee_lamports: string;
  allocation_mode: CreatorFeeAllocationMode;
  natural_hourly_lamports: string;
  explicit_buffer_contribution_lamports: string;
  daily_allocation_lamports: string;
  platform_allocation_lamports: string;
  baseline_lamports: string | null;
  baseline_input_round_ids: string[];
  baseline_window: number;
  lambda_bps: number;
  hourly_rate_bps: number;
  daily_rate_bps: number;
  buffer_rate_bps: number;
  platform_rate_bps: number;
  finalization_grace_seconds: number;
  dynamic_target_lamports: string;
  dynamic_buffer_deposit_lamports: string;
  dynamic_buffer_support_lamports: string;
  final_hourly_prize_lamports: string;
  starting_buffer_lamports: string;
  ending_buffer_lamports: string;
  configuration_version: string;
  status: string;
  finalized_at: Date;
  frozen_at: Date;
  starts_at?: Date;
  ends_at_exclusive?: Date;
};

function exactPool(row: RewardPoolRow) {
  return {
    id: row.id,
    hourlyRoundId: row.hourly_round_id,
    creatorFeeLamports: BigInt(row.creator_fee_lamports),
    allocationMode: row.allocation_mode,
    naturalHourlyLamports: BigInt(row.natural_hourly_lamports),
    explicitBufferContributionLamports: BigInt(row.explicit_buffer_contribution_lamports),
    dailyAllocationLamports: BigInt(row.daily_allocation_lamports),
    platformAllocationLamports: BigInt(row.platform_allocation_lamports),
    baselineLamports: row.baseline_lamports === null ? null : BigInt(row.baseline_lamports),
    baselineInputRoundIds: row.baseline_input_round_ids,
    baselineWindow: row.baseline_window,
    lambdaBps: BigInt(row.lambda_bps),
    splitRatesBps: {
      hourly: BigInt(row.hourly_rate_bps),
      daily: BigInt(row.daily_rate_bps),
      buffer: BigInt(row.buffer_rate_bps),
      platform: BigInt(row.platform_rate_bps),
    },
    finalizationGraceSeconds: row.finalization_grace_seconds,
    dynamicTargetLamports: BigInt(row.dynamic_target_lamports),
    dynamicBufferDepositLamports: BigInt(row.dynamic_buffer_deposit_lamports),
    dynamicBufferSupportLamports: BigInt(row.dynamic_buffer_support_lamports),
    finalHourlyPrizeLamports: BigInt(row.final_hourly_prize_lamports),
    startingBufferLamports: BigInt(row.starting_buffer_lamports),
    endingBufferLamports: BigInt(row.ending_buffer_lamports),
    configurationVersion: row.configuration_version,
    status: row.status,
    finalizedAt: row.finalized_at,
    frozenAt: row.frozen_at,
    ...(row.starts_at ? { startsAt: row.starts_at } : {}),
    ...(row.ends_at_exclusive ? { endsAtExclusive: row.ends_at_exclusive } : {}),
  };
}

async function loadPool(client: PoolClient, roundId: string) {
  return (
    await client.query<RewardPoolRow>(
      `select p.*, r.starts_at, r.ends_at_exclusive
       from hourly_reward_pools p join hourly_rounds r on r.id = p.hourly_round_id
       where p.hourly_round_id = $1`,
      [roundId],
    )
  ).rows[0];
}

export async function finalizeHourlyRewardPool(
  database: DatabaseService,
  input: {
    readonly hourlyRoundId: string;
    readonly now: Date;
    readonly config?: RewardAccountingConfig;
  },
) {
  const config = input.config ?? defaultRewardAccountingConfig;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [input.hourlyRoundId]);
    const existing = await loadPool(client, input.hourlyRoundId);
    if (existing) {
      await client.query('commit');
      return exactPool(existing);
    }
    const round = (
      await client.query<{
        id: string;
        starts_at: Date;
        ends_at_exclusive: Date;
        reward_finalization_grace_period_seconds: number;
      }>(
        `select id, starts_at, ends_at_exclusive, reward_finalization_grace_period_seconds
         from hourly_rounds where id = $1 for update`,
        [input.hourlyRoundId],
      )
    ).rows[0];
    if (!round)
      throw new RewardAccountingError('REWARD_ROUND_NOT_FOUND', 'Hourly round not found.');
    const freezeAt = new Date(
      round.ends_at_exclusive.getTime() + round.reward_finalization_grace_period_seconds * 1_000,
    );
    if (input.now < freezeAt) {
      throw new RewardAccountingError('REWARD_GRACE_ACTIVE', 'Reward grace period has not ended.');
    }
    await client.query(
      `insert into reward_buffer_state (id, balance_lamports) values ('PRIMARY', 0)
       on conflict (id) do nothing`,
    );
    const buffer = (
      await client.query<{ balance_lamports: string }>(
        `select balance_lamports from reward_buffer_state where id = 'PRIMARY' for update`,
      )
    ).rows[0]!;
    const fees = (
      await client.query<{ total: string }>(
        `select coalesce(sum(creator_fee_lamports), 0)::text total
         from creator_fee_events
         where hourly_round_id = $1 and verification_status = 'VERIFIED'
           and accounting_status = 'ATTRIBUTED'`,
        [input.hourlyRoundId],
      )
    ).rows[0]!;
    const historyRows = (
      await client.query<{
        hourly_round_id: string;
        starts_at: Date;
        ends_at_exclusive: Date;
        natural_hourly_lamports: string;
      }>(
        `select p.hourly_round_id, r.starts_at, r.ends_at_exclusive, p.natural_hourly_lamports
         from hourly_reward_pools p join hourly_rounds r on r.id = p.hourly_round_id
         where p.status in ('FROZEN','FINAL') and r.starts_at < $1
         order by r.starts_at desc limit $2`,
        [round.starts_at, config.baselineWindow],
      )
    ).rows;
    const history: CompletedNaturalHourlyReward[] = historyRows.map((row) => ({
      hourlyRoundId: identifier(row.hourly_round_id, 'HourlyRoundId') as HourlyRoundId,
      startsAt: row.starts_at.toISOString() as CompletedNaturalHourlyReward['startsAt'],
      endsAtExclusive:
        row.ends_at_exclusive.toISOString() as CompletedNaturalHourlyReward['endsAtExclusive'],
      naturalHourlyLamports: BigInt(
        row.natural_hourly_lamports,
      ) as CompletedNaturalHourlyReward['naturalHourlyLamports'],
    }));
    const economics = processHourlyRewardEconomics({
      creatorFeeLamports: BigInt(fees.total),
      mode: config.allocationMode,
      currentBufferLamports: BigInt(buffer.balance_lamports),
      previousCompletedNaturalHourlyRewards: history,
      config: runtimeCompetitionConfig(config),
    });
    if (!economics.ok || !isHourlyRewardEconomicsConserved(economics.economics)) {
      throw new RewardAccountingError(
        'REWARD_ECONOMICS_INVALID',
        'Reward economics did not conserve.',
      );
    }
    const value = economics.economics;
    const split =
      config.allocationMode === 'NORMAL'
        ? competitionConfig.creatorFees.normal
        : competitionConfig.creatorFees.bufferAccumulation;
    const poolId = `hourly-reward:${input.hourlyRoundId}`;
    const baselineIds =
      value.baseline.ok && value.baseline.status === 'ACTIVE'
        ? value.baseline.includedHourlyRoundIds
        : [];
    await client.query(
      `insert into hourly_reward_pools
        (id,hourly_round_id,creator_fee_lamports,allocation_mode,natural_hourly_lamports,
         explicit_buffer_contribution_lamports,daily_allocation_lamports,platform_allocation_lamports,
         baseline_lamports,baseline_input_round_ids,baseline_window,lambda_bps,hourly_rate_bps,
         daily_rate_bps,buffer_rate_bps,platform_rate_bps,finalization_grace_seconds,
         dynamic_target_lamports,dynamic_buffer_deposit_lamports,dynamic_buffer_support_lamports,
         final_hourly_prize_lamports,starting_buffer_lamports,ending_buffer_lamports,
         configuration_version,status,finalized_at,frozen_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'FROZEN',$25,$25)`,
      [
        poolId,
        input.hourlyRoundId,
        value.creatorFeeTotalLamports.toString(),
        value.allocationMode,
        value.naturalHourlyLamports.toString(),
        value.explicitBufferLamports.toString(),
        value.dailyContributionLamports.toString(),
        value.platformContributionLamports.toString(),
        value.baseline.ok && value.baseline.status === 'ACTIVE'
          ? value.baseline.baselineLamports.toString()
          : null,
        JSON.stringify(baselineIds),
        config.baselineWindow,
        Number(config.lambdaBps),
        Number(split.hourlyBps),
        Number(split.dailyBps),
        Number(split.bufferContributionBps),
        Number(split.platformBps),
        round.reward_finalization_grace_period_seconds,
        value.dynamicTargetLamports.toString(),
        value.dynamicDepositLamports.toString(),
        value.dynamicWithdrawalLamports.toString(),
        value.actualHourlyPrizeLamports.toString(),
        value.startingBufferLamports.toString(),
        value.endingBufferLamports.toString(),
        config.configurationVersion,
        input.now,
      ],
    );
    let movementBalance: bigint = value.startingBufferLamports;
    const movements: Array<{ reason: string; amount: bigint }> = [
      { reason: 'EXPLICIT_ACCUMULATION', amount: value.explicitBufferLamports },
      { reason: 'DYNAMIC_EXCESS_DEPOSIT', amount: value.dynamicDepositLamports },
      { reason: 'WEAK_HOUR_SUPPORT', amount: -value.dynamicWithdrawalLamports },
    ];
    for (const movement of movements) {
      if (movement.amount === 0n) continue;
      const ending = movementBalance + movement.amount;
      await client.query(
        `insert into reward_buffer_movements
          (id,hourly_reward_pool_id,reason,amount_lamports,starting_balance_lamports,ending_balance_lamports)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          `buffer:${input.hourlyRoundId}:${movement.reason}`,
          poolId,
          movement.reason,
          movement.amount.toString(),
          movementBalance.toString(),
          ending.toString(),
        ],
      );
      movementBalance = ending;
    }
    await client.query(
      `update reward_buffer_state set balance_lamports = $1, updated_at = $2 where id = 'PRIMARY'`,
      [value.endingBufferLamports.toString(), input.now],
    );
    const daily = (
      await client.query<{ id: string }>(
        `select id from daily_competitions
         where starts_at <= $1 and ends_at_exclusive > $1 limit 1 for update`,
        [round.starts_at],
      )
    ).rows[0];
    if (!daily)
      throw new RewardAccountingError('DAILY_POOL_NOT_FOUND', 'Daily competition not found.');
    const dailyPoolId = `daily-reward:${daily.id}`;
    await client.query(
      `insert into daily_reward_pools (id,daily_competition_id) values ($1,$2)
       on conflict (daily_competition_id) do nothing`,
      [dailyPoolId, daily.id],
    );
    await client.query(
      `insert into daily_reward_contributions
        (id,daily_reward_pool_id,hourly_reward_pool_id,amount_lamports,contributed_at)
       values ($1,$2,$3,$4,$5)`,
      [
        `daily-contribution:${input.hourlyRoundId}`,
        dailyPoolId,
        poolId,
        value.dailyContributionLamports.toString(),
        input.now,
      ],
    );
    await client.query(
      `update daily_reward_pools p set accumulated_lamports = q.total, updated_at = $2
       from (
         select daily_reward_pool_id, sum(amount_lamports) total
         from daily_reward_contributions where daily_reward_pool_id = $1
         group by daily_reward_pool_id
       ) q where p.id = q.daily_reward_pool_id`,
      [dailyPoolId, input.now],
    );
    await client.query(
      `update creator_fee_events set accounting_status = 'COUNTED'
       where hourly_round_id = $1 and verification_status = 'VERIFIED'
         and accounting_status = 'ATTRIBUTED'`,
      [input.hourlyRoundId],
    );
    await client.query('commit');
    return exactPool((await loadPool(client, input.hourlyRoundId))!);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function runRewardFinalizationTick(
  database: DatabaseService,
  now: Date,
  config: RewardAccountingConfig = defaultRewardAccountingConfig,
) {
  const eligible = await database.pool.query<{ id: string }>(
    `select r.id from hourly_rounds r
     where r.ends_at_exclusive + make_interval(secs => r.reward_finalization_grace_period_seconds) <= $1
       and not exists (select 1 from hourly_reward_pools p where p.hourly_round_id = r.id)
     order by r.starts_at`,
    [now],
  );
  const finalized: string[] = [];
  for (const { id } of eligible.rows) {
    await finalizeHourlyRewardPool(database, { hourlyRoundId: id, now, config });
    finalized.push(id);
  }
  return finalized;
}

export async function getHourlyRewardPool(
  database: DatabaseService,
  roundId: string,
  config: RewardAccountingConfig = defaultRewardAccountingConfig,
) {
  const client = await database.pool.connect();
  try {
    const row = await loadPool(client, roundId);
    return row ? exactPool(row) : getProvisionalHourlyRewardPool(database, roundId, config);
  } finally {
    client.release();
  }
}

export async function getProvisionalHourlyRewardPool(
  database: DatabaseService,
  roundId: string,
  rewardConfig: RewardAccountingConfig = defaultRewardAccountingConfig,
) {
  const row = (
    await database.pool.query<{
      id: string;
      starts_at: Date;
      ends_at_exclusive: Date;
      verified_fees: string;
    }>(
      `select r.id,r.starts_at,r.ends_at_exclusive,
              coalesce(sum(e.creator_fee_lamports) filter (
                where e.verification_status = 'VERIFIED' and e.accounting_status = 'ATTRIBUTED'
              ),0)::text verified_fees
       from hourly_rounds r left join creator_fee_events e on e.hourly_round_id = r.id
       where r.id = $1 group by r.id`,
      [roundId],
    )
  ).rows[0];
  if (!row) return null;
  const config = runtimeCompetitionConfig(rewardConfig);
  const split = processHourlyRewardEconomics({
    creatorFeeLamports: BigInt(row.verified_fees),
    mode: rewardConfig.allocationMode,
    currentBufferLamports: 0n,
    previousCompletedNaturalHourlyRewards: [],
    config,
  });
  if (!split.ok)
    throw new RewardAccountingError('REWARD_ECONOMICS_INVALID', 'Provisional split failed.');
  return {
    hourlyRoundId: row.id,
    startsAt: row.starts_at,
    endsAtExclusive: row.ends_at_exclusive,
    status: 'PROVISIONAL',
    verifiedCreatorFeeLamports: BigInt(row.verified_fees),
    provisionalNaturalHourlyLamports: split.economics.naturalHourlyLamports,
    provisionalDailyAllocationLamports: split.economics.dailyContributionLamports,
    dynamicSmoothingFinal: false,
  };
}

export async function getCurrentHourlyRewardPool(
  database: DatabaseService,
  now: Date,
  config: RewardAccountingConfig = defaultRewardAccountingConfig,
) {
  const round = (
    await database.pool.query<{ id: string }>(
      'select id from hourly_rounds where starts_at <= $1 and ends_at_exclusive > $1 limit 1',
      [now],
    )
  ).rows[0];
  return round ? getHourlyRewardPool(database, round.id, config) : null;
}

export async function getCurrentDailyRewardPool(
  database: DatabaseService,
  now: Date,
  rewardConfig: RewardAccountingConfig = defaultRewardAccountingConfig,
) {
  const daily = (
    await database.pool.query<{ id: string; starts_at: Date; ends_at_exclusive: Date }>(
      'select id,starts_at,ends_at_exclusive from daily_competitions where starts_at <= $1 and ends_at_exclusive > $1 limit 1',
      [now],
    )
  ).rows[0];
  if (!daily) return null;
  const frozen = (
    await database.pool.query<{ accumulated: string }>(
      `select coalesce(sum(c.amount_lamports),0)::text accumulated
       from daily_reward_contributions c join daily_reward_pools p on p.id = c.daily_reward_pool_id
       where p.daily_competition_id = $1`,
      [daily.id],
    )
  ).rows[0]!;
  const provisional = (
    await database.pool.query<{ amount: string }>(
      `select coalesce(sum(e.creator_fee_lamports),0)::text amount
       from creator_fee_events e join hourly_rounds r on r.id = e.hourly_round_id
       where r.starts_at >= $1 and r.starts_at < $2
         and e.verification_status = 'VERIFIED' and e.accounting_status = 'ATTRIBUTED'`,
      [daily.starts_at, daily.ends_at_exclusive],
    )
  ).rows[0]!;
  const split = processHourlyRewardEconomics({
    creatorFeeLamports: BigInt(provisional.amount),
    mode: rewardConfig.allocationMode,
    currentBufferLamports: 0n,
    previousCompletedNaturalHourlyRewards: [],
    config: runtimeCompetitionConfig(rewardConfig),
  });
  if (!split.ok) {
    throw new RewardAccountingError('REWARD_ECONOMICS_INVALID', 'Daily provisional split failed.');
  }
  return {
    dailyCompetitionId: daily.id,
    startsAt: daily.starts_at,
    endsAtExclusive: daily.ends_at_exclusive,
    status: 'PROVISIONAL',
    frozenContributionsLamports: BigInt(frozen.accumulated),
    provisionalContributionLamports: split.economics.dailyContributionLamports,
    accumulatedLamports: BigInt(frozen.accumulated) + split.economics.dailyContributionLamports,
  };
}

export async function reconcileHourlyRewardPool(database: DatabaseService, roundId: string) {
  const pool = await getHourlyRewardPool(database, roundId);
  if (!pool || !('id' in pool)) return pool;
  const events = (
    await database.pool.query(
      `select id,transaction_signature,event_index,slot,event_time,creator_fee_lamports,
              source_program,token_project_identity,observed_at,accounting_status
       from creator_fee_events where hourly_round_id = $1 and accounting_status = 'COUNTED'
       order by event_time,transaction_signature,event_index`,
      [roundId],
    )
  ).rows;
  const movements = (
    await database.pool.query(
      `select reason,amount_lamports,starting_balance_lamports,ending_balance_lamports
       from reward_buffer_movements where hourly_reward_pool_id = $1 order by created_at,id`,
      [pool.id],
    )
  ).rows;
  return {
    ...pool,
    verifiedFeeEvents: events,
    bufferMovements: movements,
    conservation: {
      leftLamports: pool.creatorFeeLamports + pool.startingBufferLamports,
      rightLamports:
        pool.finalHourlyPrizeLamports +
        pool.dailyAllocationLamports +
        pool.platformAllocationLamports +
        pool.endingBufferLamports,
      holds:
        pool.creatorFeeLamports + pool.startingBufferLamports ===
        pool.finalHourlyPrizeLamports +
          pool.dailyAllocationLamports +
          pool.platformAllocationLamports +
          pool.endingBufferLamports,
    },
  };
}
