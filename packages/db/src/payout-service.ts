import {
  DAILY_PAYOUT_CURVE_VERSION,
  HOURLY_PAYOUT_CURVE_VERSION,
  PAYOUT_TIE_POLICY_VERSION,
  allocatePayouts,
  competitionConfig,
  identifier,
  type Leaderboard,
  type UserId,
} from '@paperfund/core';
import type { PoolClient } from 'pg';

import type { DatabaseService } from './database.js';

export type PayoutCompetitionType = 'HOURLY' | 'DAILY';

export class PayoutPlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ScoreRow {
  readonly user_id: string;
  readonly wallet_address: string;
  readonly score: string;
  readonly result_id: string;
}

interface RankedScore {
  readonly userId: UserId;
  readonly walletAddress: string;
  readonly score: bigint;
  readonly resultId: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function leaderboardFromRows(rows: readonly ScoreRow[]): Leaderboard<RankedScore> {
  const sorted = [...rows]
    .map((row) => ({
      userId: identifier(row.user_id, 'UserId') as UserId,
      walletAddress: row.wallet_address,
      score: BigInt(row.score),
      resultId: row.result_id,
    }))
    .sort(
      (left, right) =>
        (left.score > right.score ? -1 : left.score < right.score ? 1 : 0) ||
        compareText(left.userId, right.userId),
    );
  const rankGroups: Array<{
    rank: number;
    tied: boolean;
    tieGroupSize: number;
    results: readonly RankedScore[];
  }> = [];
  for (const row of sorted) {
    const previous = rankGroups.at(-1);
    if (previous && previous.results[0]!.score === row.score) {
      const results = [...previous.results, row];
      rankGroups[rankGroups.length - 1] = {
        ...previous,
        tied: true,
        tieGroupSize: results.length,
        results,
      };
    } else {
      rankGroups.push({
        rank: rankGroups.reduce((sum, group) => sum + group.tieGroupSize, 0) + 1,
        tied: false,
        tieGroupSize: 1,
        results: [row],
      });
    }
  }
  return { participantCount: sorted.length, rankGroups };
}

async function sourceRows(
  client: Pick<PoolClient, 'query'>,
  competitionType: PayoutCompetitionType,
  sourceId: string,
): Promise<ScoreRow[]> {
  return competitionType === 'HOURLY'
    ? (
        await client.query<ScoreRow>(
          `select hr.id result_id,hr.user_id,u.wallet_address,hr.hourly_pnl_lamports::text score
           from hourly_results hr join users u on u.id=hr.user_id
           where hr.hourly_round_id=$1 order by hr.hourly_pnl_lamports desc,hr.user_id`,
          [sourceId],
        )
      ).rows
    : (
        await client.query<ScoreRow>(
          `select dr.id result_id,dr.user_id,u.wallet_address,dr.cumulative_pnl_lamports::text score
           from daily_results dr join users u on u.id=dr.user_id
           where dr.daily_competition_id=$1 order by dr.cumulative_pnl_lamports desc,dr.user_id`,
          [sourceId],
        )
      ).rows;
}

function curveFor(type: PayoutCompetitionType) {
  return type === 'HOURLY'
    ? {
        version: HOURLY_PAYOUT_CURVE_VERSION,
        entries: competitionConfig.hourlyPayoutCurve,
        nominalWinnerCount: competitionConfig.hourlyWinnerCount,
      }
    : {
        version: DAILY_PAYOUT_CURVE_VERSION,
        entries: competitionConfig.dailyPayoutCurve,
        nominalWinnerCount: competitionConfig.dailyWinnerCount,
      };
}

function sourceSnapshot(leaderboard: Leaderboard<RankedScore>) {
  return leaderboard.rankGroups.flatMap((group) =>
    group.results.map((result) => ({
      resultId: result.resultId,
      userId: result.userId,
      walletAddress: result.walletAddress,
      score: result.score.toString(),
      competitiveRank: group.rank,
      tieGroupSize: group.tieGroupSize,
    })),
  );
}

async function sourceAndPool(client: PoolClient, type: PayoutCompetitionType, sourceId: string) {
  if (type === 'HOURLY') {
    const row = (
      await client.query<{
        source_state: string;
        pool_state: string;
        prize_pool: string;
        pool_id: string;
      }>(
        `select r.state source_state,p.status pool_state,p.final_hourly_prize_lamports::text prize_pool,p.id pool_id
         from hourly_rounds r join hourly_reward_pools p on p.hourly_round_id=r.id
         where r.id=$1 for update of r,p`,
        [sourceId],
      )
    ).rows[0];
    if (!row)
      throw new PayoutPlanError(
        'PAYOUT_SOURCE_NOT_READY',
        'Hourly result or reward pool is missing.',
      );
    if (row.source_state !== 'FINALIZED' || !['FROZEN', 'FINAL'].includes(row.pool_state)) {
      throw new PayoutPlanError(
        'PAYOUT_SOURCE_NOT_FINAL',
        'Hourly result and reward pool must be final.',
      );
    }
    return row;
  }
  const row = (
    await client.query<{
      source_state: string;
      pool_state: string;
      prize_pool: string;
      pool_id: string;
    }>(
      `select d.state source_state,p.status pool_state,p.accumulated_lamports::text prize_pool,p.id pool_id
       from daily_competitions d join daily_reward_pools p on p.daily_competition_id=d.id
       where d.id=$1 for update of d,p`,
      [sourceId],
    )
  ).rows[0];
  if (!row)
    throw new PayoutPlanError('PAYOUT_SOURCE_NOT_READY', 'Daily result or reward pool is missing.');
  if (row.source_state !== 'FINALIZED' || !['FROZEN', 'FINAL'].includes(row.pool_state)) {
    throw new PayoutPlanError(
      'PAYOUT_SOURCE_NOT_FINAL',
      'Daily result and reward pool must be final.',
    );
  }
  return row;
}

export async function finalizeDailyRewardPool(
  database: DatabaseService,
  input: { readonly dailyCompetitionId: string; readonly now: Date },
) {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
      `daily-reward-freeze:${input.dailyCompetitionId}`,
    ]);
    const daily = (
      await client.query<{ id: string; state: string }>(
        'select id,state from daily_competitions where id=$1 for update',
        [input.dailyCompetitionId],
      )
    ).rows[0];
    if (!daily)
      throw new PayoutPlanError('PAYOUT_SOURCE_NOT_FOUND', 'Daily competition not found.');
    if (daily.state !== 'FINALIZED') {
      throw new PayoutPlanError('PAYOUT_SOURCE_NOT_FINAL', 'Daily competition is not finalized.');
    }
    const incomplete = (
      await client.query<{ count: string }>(
        `select count(*)::text count from hourly_rounds r
         where r.starts_at >= (select starts_at from daily_competitions where id=$1)
           and r.starts_at < (select ends_at_exclusive from daily_competitions where id=$1)
           and (r.state <> 'FINALIZED' or not exists (
             select 1 from hourly_reward_pools p where p.hourly_round_id=r.id
           ))`,
        [input.dailyCompetitionId],
      )
    ).rows[0]!;
    if (BigInt(incomplete.count) > 0n) {
      throw new PayoutPlanError(
        'DAILY_REWARD_NOT_READY',
        'Hourly reward pools are not all frozen.',
      );
    }
    const poolId = `daily-reward:${input.dailyCompetitionId}`;
    await client.query(
      `insert into daily_reward_pools (id,daily_competition_id) values ($1,$2)
       on conflict (daily_competition_id) do nothing`,
      [poolId, input.dailyCompetitionId],
    );
    await client.query(
      `update daily_reward_pools set status='FROZEN',finalized_at=$2,updated_at=$2
       where daily_competition_id=$1 and status='OPEN'`,
      [input.dailyCompetitionId, input.now],
    );
    const frozen = (
      await client.query<{
        id: string;
        accumulated_lamports: string;
        status: string;
        finalized_at: Date;
      }>(
        `select id,accumulated_lamports::text,status,finalized_at
         from daily_reward_pools where daily_competition_id=$1`,
        [input.dailyCompetitionId],
      )
    ).rows[0]!;
    await client.query('commit');
    return {
      id: frozen.id,
      dailyCompetitionId: input.dailyCompetitionId,
      accumulatedLamports: BigInt(frozen.accumulated_lamports),
      status: frozen.status,
      finalizedAt: frozen.finalized_at,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function runDailyRewardFinalizationTick(database: DatabaseService, now: Date) {
  const rows = await database.pool.query<{ id: string }>(
    `select d.id from daily_competitions d
     where d.state='FINALIZED'
       and not exists (
         select 1 from daily_reward_pools p
         where p.daily_competition_id=d.id and p.status in ('FROZEN','FINAL')
       ) order by d.starts_at`,
  );
  const finalized: string[] = [];
  for (const row of rows.rows) {
    try {
      await finalizeDailyRewardPool(database, { dailyCompetitionId: row.id, now });
      finalized.push(row.id);
    } catch (error) {
      if (!(error instanceof PayoutPlanError) || error.code !== 'DAILY_REWARD_NOT_READY')
        throw error;
    }
  }
  return finalized;
}

export async function generateShadowPayoutPlan(
  database: DatabaseService,
  input: {
    readonly competitionType: PayoutCompetitionType;
    readonly sourceId: string;
    readonly now: Date;
  },
) {
  const curve = curveFor(input.competitionType);
  const planId = `payout:${input.competitionType.toLowerCase()}:${input.sourceId}:${curve.version}`;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [planId]);
    const existing = (
      await client.query<{ id: string }>('select id from payout_plans where id=$1', [planId])
    ).rows[0];
    if (existing) {
      await client.query('commit');
      return (await getPayoutPlanAudit(database, existing.id))!;
    }
    const source = await sourceAndPool(client, input.competitionType, input.sourceId);
    const rows = await sourceRows(client, input.competitionType, input.sourceId);
    const leaderboard = leaderboardFromRows(rows);
    const calculated = allocatePayouts({
      prizePoolLamports: BigInt(source.prize_pool),
      leaderboard,
      payoutCurve: curve.entries,
    });
    if (!calculated.ok) {
      throw new PayoutPlanError(calculated.reason, 'Authoritative payout allocation failed.');
    }
    const total = calculated.allocations.reduce((sum, row) => sum + row.payoutLamports, 0n);
    const configSnapshot = {
      curveVersion: curve.version,
      tiePolicyVersion: PAYOUT_TIE_POLICY_VERSION,
      nominalWinnerCount: curve.nominalWinnerCount,
      curve: curve.entries.map(({ rank, sharePpm }) => ({ rank, sharePpm: sharePpm.toString() })),
      occupiedWeightPpm: calculated.occupiedWeightPpm.toString(),
      dustPolicy: 'largest-remainder-by-ordinal; tie-dust-by-user-id-ascending',
    };
    await client.query(
      `insert into payout_plans
       (id,competition_type,hourly_round_id,daily_competition_id,prize_pool_lamports,
        curve_version,tie_policy_version,participant_count,nominal_winner_count,
        actual_winner_count,state,calculated_at,config_snapshot,source_result_snapshot,
        total_allocated_lamports,conservation_holds)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CALCULATED',$11,$12,$13,$14,true)`,
      [
        planId,
        input.competitionType,
        input.competitionType === 'HOURLY' ? input.sourceId : null,
        input.competitionType === 'DAILY' ? input.sourceId : null,
        calculated.prizePoolLamports.toString(),
        curve.version,
        PAYOUT_TIE_POLICY_VERSION,
        leaderboard.participantCount,
        curve.nominalWinnerCount,
        calculated.actualWinnerCount,
        input.now,
        JSON.stringify(configSnapshot),
        JSON.stringify(sourceSnapshot(leaderboard)),
        total.toString(),
      ],
    );
    for (const bucket of calculated.rankBuckets) {
      await client.query(
        `insert into payout_rank_buckets
         (id,payout_plan_id,ordinal,weight_ppm,floor_allocation_lamports,remainder_basis,final_allocation_lamports)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          `${planId}:bucket:${bucket.ordinal}`,
          planId,
          bucket.ordinal,
          bucket.weightPpm.toString(),
          bucket.floorAllocationLamports.toString(),
          bucket.remainderBasis.toString(),
          bucket.finalAllocationLamports.toString(),
        ],
      );
    }
    for (const allocation of calculated.allocations) {
      const tie = calculated.tieGroups.find((group) => group.competitiveRank === allocation.rank)!;
      await client.query(
        `insert into payout_allocations
         (id,payout_plan_id,user_id,competitive_rank,tie_group_size,ordinal_start,ordinal_end,
          funded_ordinal_count,allocated_lamports,dust_adjustment_lamports,allocation_explanation)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `${planId}:user:${allocation.userId}`,
          planId,
          allocation.userId,
          allocation.rank,
          allocation.tieGroupSize,
          allocation.ordinalStart,
          allocation.ordinalEnd,
          allocation.fundedOrdinalCount,
          allocation.payoutLamports.toString(),
          allocation.dustAdjustmentLamports.toString(),
          JSON.stringify({
            fundedOrdinals: tie.fundedOrdinals,
            combinedFundedLamports: tie.combinedFundedLamports.toString(),
            equalFloorLamports: tie.equalFloorLamports.toString(),
            tieDustLamports: tie.tieDustLamports.toString(),
            dustOrder: tie.userIdsInDustOrder,
          }),
        ],
      );
    }
    await client.query(
      `update payout_plans set state='FROZEN',frozen_at=$2 where id=$1 and state='CALCULATED'`,
      [planId, input.now],
    );
    await client.query(
      `update payout_plans set state='VALIDATED',validated_at=$2 where id=$1 and state='FROZEN'`,
      [planId, input.now],
    );
    await client.query('commit');
    return (await getPayoutPlanAudit(database, planId))!;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function generateHourlyShadowPayoutPlan(
  database: DatabaseService,
  input: { readonly hourlyRoundId: string; readonly now: Date },
) {
  return generateShadowPayoutPlan(database, {
    competitionType: 'HOURLY',
    sourceId: input.hourlyRoundId,
    now: input.now,
  });
}

export function generateDailyShadowPayoutPlan(
  database: DatabaseService,
  input: { readonly dailyCompetitionId: string; readonly now: Date },
) {
  return generateShadowPayoutPlan(database, {
    competitionType: 'DAILY',
    sourceId: input.dailyCompetitionId,
    now: input.now,
  });
}

export async function carryZeroParticipantPoolToRewardBuffer(
  database: DatabaseService,
  input: {
    readonly competitionType: PayoutCompetitionType;
    readonly sourceId: string;
    readonly now: Date;
  },
) {
  const outcomeId = `no-participants:${input.competitionType.toLowerCase()}:${input.sourceId}`;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [outcomeId]);
    const existing = (
      await client.query<{ carried_lamports: string }>(
        'select carried_lamports::text from no_participant_reward_outcomes where id=$1',
        [outcomeId],
      )
    ).rows[0];
    if (existing) {
      await client.query('commit');
      return { id: outcomeId, carriedLamports: BigInt(existing.carried_lamports), created: false };
    }
    const source = await sourceAndPool(client, input.competitionType, input.sourceId);
    const participants = await sourceRows(client, input.competitionType, input.sourceId);
    if (participants.length !== 0)
      throw new PayoutPlanError(
        'PAYOUT_PARTICIPANTS_PRESENT',
        'Competition has payout participants.',
      );
    const carried = BigInt(source.prize_pool);
    await client.query(
      `insert into reward_buffer_state (id,balance_lamports) values ('PRIMARY',0)
       on conflict (id) do nothing`,
    );
    const buffer = (
      await client.query<{ balance_lamports: string }>(
        `select balance_lamports::text from reward_buffer_state where id='PRIMARY' for update`,
      )
    ).rows[0]!;
    const starting = BigInt(buffer.balance_lamports);
    const ending = starting + carried;
    const movementId =
      carried > 0n
        ? `buffer:${input.competitionType.toLowerCase()}:${input.sourceId}:ZERO_PARTICIPANT_CARRY_FORWARD`
        : null;
    if (movementId) {
      await client.query(
        input.competitionType === 'HOURLY'
          ? `insert into reward_buffer_movements
             (id,hourly_reward_pool_id,reason,amount_lamports,starting_balance_lamports,ending_balance_lamports,created_at)
             values ($1,$2,'ZERO_PARTICIPANT_CARRY_FORWARD',$3,$4,$5,$6)`
          : `insert into reward_buffer_movements
             (id,daily_reward_pool_id,reason,amount_lamports,starting_balance_lamports,ending_balance_lamports,created_at)
             values ($1,$2,'ZERO_PARTICIPANT_CARRY_FORWARD',$3,$4,$5,$6)`,
        [
          movementId,
          source.pool_id,
          carried.toString(),
          starting.toString(),
          ending.toString(),
          input.now,
        ],
      );
      await client.query(
        `update reward_buffer_state set balance_lamports=$1,updated_at=$2 where id='PRIMARY'`,
        [ending.toString(), input.now],
      );
    }
    await client.query(
      `insert into no_participant_reward_outcomes
       (id,competition_type,hourly_round_id,daily_competition_id,carried_lamports,reward_buffer_movement_id,recorded_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        outcomeId,
        input.competitionType,
        input.competitionType === 'HOURLY' ? input.sourceId : null,
        input.competitionType === 'DAILY' ? input.sourceId : null,
        carried.toString(),
        movementId,
        input.now,
      ],
    );
    await client.query('commit');
    return { id: outcomeId, carriedLamports: carried, created: true };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function runPayoutPlanGenerationTick(database: DatabaseService, now: Date) {
  const hourly = await database.pool.query<{ id: string }>(
    `select r.id from hourly_rounds r join hourly_reward_pools p on p.hourly_round_id=r.id
     where r.state='FINALIZED' and p.status in ('FROZEN','FINAL')
       and not exists (select 1 from payout_plans x where x.hourly_round_id=r.id)
       and not exists (select 1 from no_participant_reward_outcomes x where x.hourly_round_id=r.id)
     order by r.starts_at`,
  );
  const daily = await database.pool.query<{ id: string }>(
    `select d.id from daily_competitions d join daily_reward_pools p on p.daily_competition_id=d.id
     where d.state='FINALIZED' and p.status in ('FROZEN','FINAL')
       and not exists (select 1 from payout_plans x where x.daily_competition_id=d.id)
       and not exists (select 1 from no_participant_reward_outcomes x where x.daily_competition_id=d.id)
     order by d.starts_at`,
  );
  const generated: string[] = [];
  for (const row of hourly.rows) {
    const participants = await database.pool.query<{ count: string }>(
      'select count(*)::text count from hourly_results where hourly_round_id=$1',
      [row.id],
    );
    if (participants.rows[0]!.count === '0') {
      await carryZeroParticipantPoolToRewardBuffer(database, {
        competitionType: 'HOURLY',
        sourceId: row.id,
        now,
      });
      continue;
    }
    const plan = await generateHourlyShadowPayoutPlan(database, { hourlyRoundId: row.id, now });
    generated.push(plan.id);
  }
  for (const row of daily.rows) {
    const participants = await database.pool.query<{ count: string }>(
      'select count(*)::text count from daily_results where daily_competition_id=$1',
      [row.id],
    );
    if (participants.rows[0]!.count === '0') {
      await carryZeroParticipantPoolToRewardBuffer(database, {
        competitionType: 'DAILY',
        sourceId: row.id,
        now,
      });
      continue;
    }
    const plan = await generateDailyShadowPayoutPlan(database, { dailyCompetitionId: row.id, now });
    generated.push(plan.id);
  }
  return generated;
}

export async function getPayoutPlanAudit(database: DatabaseService, planId: string) {
  const plan = (
    await database.pool.query<{
      id: string;
      competition_type: PayoutCompetitionType;
      hourly_round_id: string | null;
      daily_competition_id: string | null;
      prize_pool_lamports: string;
      curve_version: string;
      tie_policy_version: string;
      participant_count: number;
      nominal_winner_count: number;
      actual_winner_count: number;
      state: string;
      calculated_at: Date;
      frozen_at: Date | null;
      validated_at: Date | null;
      config_snapshot: Record<string, unknown>;
      source_result_snapshot: readonly Record<string, unknown>[];
      total_allocated_lamports: string;
      conservation_holds: boolean;
    }>('select * from payout_plans where id=$1', [planId])
  ).rows[0];
  if (!plan) return null;
  const buckets = (
    await database.pool.query<{
      ordinal: number;
      weight_ppm: string;
      floor_allocation_lamports: string;
      remainder_basis: string;
      final_allocation_lamports: string;
    }>(
      `select ordinal,weight_ppm::text,floor_allocation_lamports::text,remainder_basis::text,
              final_allocation_lamports::text from payout_rank_buckets
       where payout_plan_id=$1 order by ordinal`,
      [planId],
    )
  ).rows;
  const allocations = (
    await database.pool.query<{
      user_id: string;
      wallet_address: string;
      competitive_rank: number;
      tie_group_size: number;
      ordinal_start: number;
      ordinal_end: number;
      funded_ordinal_count: number;
      allocated_lamports: string;
      dust_adjustment_lamports: string;
      allocation_explanation: Record<string, unknown>;
    }>(
      `select a.user_id,u.wallet_address,a.competitive_rank,a.tie_group_size,a.ordinal_start,
              a.ordinal_end,a.funded_ordinal_count,a.allocated_lamports::text,
              a.dust_adjustment_lamports::text,a.allocation_explanation
       from payout_allocations a join users u on u.id=a.user_id
       where a.payout_plan_id=$1 order by a.competitive_rank,a.user_id`,
      [planId],
    )
  ).rows;
  return {
    id: plan.id,
    competitionType: plan.competition_type,
    hourlyRoundId: plan.hourly_round_id,
    dailyCompetitionId: plan.daily_competition_id,
    prizePoolLamports: BigInt(plan.prize_pool_lamports),
    curveVersion: plan.curve_version,
    tiePolicyVersion: plan.tie_policy_version,
    participantCount: plan.participant_count,
    nominalWinnerCount: plan.nominal_winner_count,
    actualWinnerCount: plan.actual_winner_count,
    state: plan.state,
    calculatedAt: plan.calculated_at,
    frozenAt: plan.frozen_at,
    validatedAt: plan.validated_at,
    configSnapshot: plan.config_snapshot,
    sourceLeaderboard: plan.source_result_snapshot,
    rankBuckets: buckets.map((row) => ({
      ordinal: row.ordinal,
      weightPpm: BigInt(row.weight_ppm),
      floorAllocationLamports: BigInt(row.floor_allocation_lamports),
      remainderBasis: BigInt(row.remainder_basis),
      finalAllocationLamports: BigInt(row.final_allocation_lamports),
    })),
    allocations: allocations.map((row) => ({
      userId: row.user_id,
      walletAddress: row.wallet_address,
      competitiveRank: row.competitive_rank,
      tied: row.tie_group_size > 1,
      tieGroupSize: row.tie_group_size,
      ordinalStart: row.ordinal_start,
      ordinalEnd: row.ordinal_end,
      fundedOrdinalCount: row.funded_ordinal_count,
      allocatedLamports: BigInt(row.allocated_lamports),
      dustAdjustmentLamports: BigInt(row.dust_adjustment_lamports),
      explanation: row.allocation_explanation,
    })),
    conservation: {
      totalAllocatedLamports: BigInt(plan.total_allocated_lamports),
      prizePoolLamports: BigInt(plan.prize_pool_lamports),
      holds: plan.conservation_holds,
    },
  };
}

export async function validatePayoutPlan(database: DatabaseService, planId: string) {
  const audit = await getPayoutPlanAudit(database, planId);
  if (!audit) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
  const sourceId = audit.hourlyRoundId ?? audit.dailyCompetitionId!;
  const curve = curveFor(audit.competitionType);
  const rows = await sourceRows(
    database.pool as unknown as PoolClient,
    audit.competitionType,
    sourceId,
  );
  const currentLeaderboard = leaderboardFromRows(rows);
  const expected = allocatePayouts({
    prizePoolLamports: audit.prizePoolLamports,
    leaderboard: currentLeaderboard,
    payoutCurve: curve.entries,
  });
  const source = await database.pool.query<{
    source_state: string;
    pool_state: string;
    prize_pool: string;
  }>(
    audit.competitionType === 'HOURLY'
      ? `select r.state source_state,p.status pool_state,
                p.final_hourly_prize_lamports::text prize_pool from hourly_rounds r
         join hourly_reward_pools p on p.hourly_round_id=r.id where r.id=$1`
      : `select d.state source_state,p.status pool_state,p.accumulated_lamports::text prize_pool
         from daily_competitions d
         join daily_reward_pools p on p.daily_competition_id=d.id where d.id=$1`,
    [sourceId],
  );
  const sourceFinal =
    source.rows[0]?.source_state === 'FINALIZED' &&
    ['FROZEN', 'FINAL'].includes(source.rows[0]?.pool_state ?? '');
  const currentSourceSnapshot = sourceSnapshot(currentLeaderboard);
  const persistedSourceSnapshot = audit.sourceLeaderboard.map((row) => ({
    resultId: row['resultId'],
    userId: row['userId'],
    walletAddress: row['walletAddress'],
    score: row['score'],
    competitiveRank: row['competitiveRank'],
    tieGroupSize: row['tieGroupSize'],
  }));
  const bucketsMatch =
    expected.ok &&
    JSON.stringify(
      expected.rankBuckets.map((row) => [
        row.ordinal,
        row.weightPpm.toString(),
        row.floorAllocationLamports.toString(),
        row.remainderBasis.toString(),
        row.finalAllocationLamports.toString(),
      ]),
    ) ===
      JSON.stringify(
        audit.rankBuckets.map((row) => [
          row.ordinal,
          row.weightPpm.toString(),
          row.floorAllocationLamports.toString(),
          row.remainderBasis.toString(),
          row.finalAllocationLamports.toString(),
        ]),
      );
  const allocationsMatch =
    expected.ok &&
    JSON.stringify(
      expected.allocations.map((row) => [
        row.userId,
        row.rank,
        row.tieGroupSize,
        row.ordinalStart,
        row.ordinalEnd,
        row.fundedOrdinalCount,
        row.payoutLamports.toString(),
        row.dustAdjustmentLamports.toString(),
      ]),
    ) ===
      JSON.stringify(
        audit.allocations.map((row) => [
          row.userId,
          row.competitiveRank,
          row.tieGroupSize,
          row.ordinalStart,
          row.ordinalEnd,
          row.fundedOrdinalCount,
          row.allocatedLamports.toString(),
          row.dustAdjustmentLamports.toString(),
        ]),
      );
  const checks = {
    sourceFinal,
    sourcePrizeMatches: BigInt(source.rows[0]?.prize_pool ?? -1) === audit.prizePoolLamports,
    sourceSnapshotMatches:
      JSON.stringify(currentSourceSnapshot) === JSON.stringify(persistedSourceSnapshot),
    planStateValid: [
      'CALCULATED',
      'FROZEN',
      'VALIDATED',
      'APPROVED',
      'SIGNED',
      'BROADCAST',
      'VERIFIED',
      'FAILED_RETRYABLE',
      'FAILED_FINAL',
      'RECONCILIATION_REQUIRED',
    ].includes(audit.state),
    curveVersionKnown: audit.curveVersion === curve.version,
    tiePolicyVersionKnown: audit.tiePolicyVersion === PAYOUT_TIE_POLICY_VERSION,
    participantCountMatches: audit.participantCount === rows.length,
    winnerCountMatches: expected.ok && audit.actualWinnerCount === expected.actualWinnerCount,
    ranksAndTiesMatch: allocationsMatch,
    rankBucketsMatch: bucketsMatch,
    noDuplicateUsers:
      new Set(audit.allocations.map((row) => row.userId)).size === audit.allocations.length,
    noNegativePayouts: audit.allocations.every((row) => row.allocatedLamports >= 0n),
    conservation:
      audit.allocations.reduce((sum, row) => sum + row.allocatedLamports, 0n) ===
        audit.prizePoolLamports && audit.conservation.holds,
  };
  return { planId, valid: Object.values(checks).every(Boolean), checks };
}

export async function getHourlyPayoutWinners(database: DatabaseService, hourlyRoundId: string) {
  const plan = (
    await database.pool.query<{ id: string }>(
      `select id from payout_plans where hourly_round_id=$1 order by calculated_at desc limit 1`,
      [hourlyRoundId],
    )
  ).rows[0];
  return plan ? getPayoutPlanAudit(database, plan.id) : null;
}

export async function getDailyPayoutWinners(database: DatabaseService, idOrDate: string) {
  const plan = (
    await database.pool.query<{ id: string }>(
      `select p.id from payout_plans p join daily_competitions d on d.id=p.daily_competition_id
       where d.id=$1 or d.utc_date::text=$1 order by p.calculated_at desc limit 1`,
      [idOrDate],
    )
  ).rows[0];
  return plan ? getPayoutPlanAudit(database, plan.id) : null;
}

export async function getUserRewardAllocations(database: DatabaseService, userId: string) {
  const rows = await database.pool.query<{ id: string }>(
    `select id from payout_plans p
     where exists (
       select 1 from jsonb_array_elements(p.source_result_snapshot) source
       where source->>'userId'=$1
     ) order by calculated_at desc`,
    [userId],
  );
  const results = [];
  for (const row of rows.rows) {
    const audit = await getPayoutPlanAudit(database, row.id);
    const source = audit?.sourceLeaderboard.find((item) => item['userId'] === userId);
    const allocation = audit?.allocations.find((item) => item.userId === userId);
    if (audit && source) {
      results.push({
        payoutPlanId: audit.id,
        competitionType: audit.competitionType,
        hourlyRoundId: audit.hourlyRoundId,
        dailyCompetitionId: audit.dailyCompetitionId,
        competitiveRank: Number(source['competitiveRank']),
        tied: Number(source['tieGroupSize']) > 1,
        tieGroupSize: Number(source['tieGroupSize']),
        won: Boolean(allocation),
        rewardAllocationLamports: allocation?.allocatedLamports ?? 0n,
        status: allocation
          ? audit.state === 'VERIFIED'
            ? 'PAID'
            : ['SIGNED', 'BROADCAST'].includes(audit.state)
              ? 'PROCESSING'
              : ['FAILED_RETRYABLE', 'FAILED_FINAL', 'RECONCILIATION_REQUIRED'].includes(
                    audit.state,
                  )
                ? 'FAILED_REVIEW'
                : audit.state === 'APPROVED'
                  ? 'APPROVED'
                  : 'PENDING'
          : 'NOT_A_WINNER',
        payoutPlanState: audit.state,
      });
    }
  }
  return results;
}
