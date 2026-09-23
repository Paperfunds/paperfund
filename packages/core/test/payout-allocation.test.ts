import { describe, expect, it } from 'vitest';

import {
  allocateDailyPayouts,
  allocateHourlyPayouts,
  buildDailyLeaderboard,
  buildHourlyLeaderboard,
  competitionConfig,
  identifier,
  paperSolBaseUnits,
  paperSolDelta,
  utcInstant,
  type CompetitionAccountId,
  type DailyCompetition,
  type DailyCompetitionId,
  type DailyResult,
  type HourlyResult,
  type HourlyRound,
  type HourlyRoundId,
  type UserId,
} from '../src/index.js';

const hourlyRoundId = identifier('payout-hour', 'HourlyRoundId') as HourlyRoundId;
const dailyCompetitionId = identifier('payout-day', 'DailyCompetitionId') as DailyCompetitionId;

function user(index: number): UserId {
  return identifier(`user-${index.toString().padStart(2, '0')}`, 'UserId') as UserId;
}

const round: HourlyRound = {
  id: hourlyRoundId,
  state: 'FINALIZED',
  startsAt: utcInstant('2026-09-23T15:00:00Z'),
  endsAtExclusive: utcInstant('2026-09-23T16:00:00Z'),
  configurationVersion: competitionConfig.version,
};

const day: DailyCompetition = {
  id: dailyCompetitionId,
  state: 'FINALIZED',
  startsAt: utcInstant('2026-09-23T00:00:00Z'),
  endsAtExclusive: utcInstant('2026-09-24T00:00:00Z'),
  configurationVersion: competitionConfig.version,
};

function hourly(index: number, score: bigint): HourlyResult {
  return {
    hourlyRoundId,
    competitionAccountId: identifier(
      `account-${index.toString()}`,
      'CompetitionAccountId',
    ) as CompetitionAccountId,
    userId: user(index),
    finalSettledPaperSol: paperSolBaseUnits(10_000_000_000n + score),
    pnl: paperSolDelta(score),
    finalizedAt: utcInstant('2026-09-23T16:00:01Z'),
  };
}

function daily(index: number, score: bigint): DailyResult {
  return {
    dailyCompetitionId,
    userId: user(index),
    cumulativePnl: paperSolDelta(score),
    completedHourlyRoundIds: [
      identifier(`user-round-${index.toString()}`, 'HourlyRoundId') as HourlyRoundId,
    ],
    completedHourlyResultCount: 1,
  };
}

function hourlyAllocation(scores: readonly bigint[], pool: bigint) {
  const built = buildHourlyLeaderboard({
    round,
    results: scores.map((score, index) => hourly(index + 1, score)),
    winnerCount: competitionConfig.hourlyWinnerCount,
  });
  if (!built.ok) throw new Error(built.reason);
  return allocateHourlyPayouts({
    prizePoolLamports: pool,
    leaderboard: built.leaderboard,
    winnerSelection: built.winnerSelection,
    payoutCurve: competitionConfig.hourlyPayoutCurve,
  });
}

function dailyAllocation(scores: readonly bigint[], pool: bigint) {
  const built = buildDailyLeaderboard({
    dailyCompetition: day,
    results: scores.map((score, index) => daily(index + 1, score)),
    winnerCount: competitionConfig.dailyWinnerCount,
  });
  if (!built.ok) throw new Error(built.reason);
  return allocateDailyPayouts({
    prizePoolLamports: pool,
    leaderboard: built.leaderboard,
    winnerSelection: built.winnerSelection,
    payoutCurve: competitionConfig.dailyPayoutCurve,
  });
}

function payoutTotal(result: ReturnType<typeof hourlyAllocation>): bigint {
  return result.ok
    ? result.allocations.reduce((total, allocation) => total + allocation.payoutLamports, 0n)
    : -1n;
}

describe('hourly payout allocation', () => {
  const distinctTen = Array.from({ length: 10 }, (_, index) => BigInt(100 - index));

  it('allocates a full Top 10 exactly and gives rank 1 its configured largest share', () => {
    const result = hourlyAllocation(distinctTen, 1_000_000n);
    expect(result.ok).toBe(true);
    expect(payoutTotal(result)).toBe(1_000_000n);
    if (!result.ok) return;
    expect(result.occupiedWeightPpm).toBe(1_000_000n);
    expect(result.allocations[0]).toMatchObject({
      rank: 1,
      payoutLamports: 250_000n,
      curveWeightPpm: 250_000n,
    });
    expect(result.allocations[0]!.payoutLamports).toBeGreaterThan(
      result.allocations[1]!.payoutLamports,
    );
  });

  it('assigns all indivisible payout dust to rank 1', () => {
    const result = hourlyAllocation(distinctTen, 11n);
    expect(result.ok).toBe(true);
    expect(payoutTotal(result)).toBe(11n);
    if (!result.ok) return;
    const floorRankOne = (11n * 250_000n) / 1_000_000n;
    const allFloors = competitionConfig.hourlyPayoutCurve.reduce(
      (total, entry) => total + (11n * entry.sharePpm) / 1_000_000n,
      0n,
    );
    expect(result.allocations[0]!.payoutLamports).toBe(floorRankOne + (11n - allFloors));
  });

  it('accepts zero, rejects negative, and still validates ties for zero', () => {
    const zero = hourlyAllocation(distinctTen, 0n);
    expect(zero.ok && zero.allocations.every(({ payoutLamports }) => payoutLamports === 0n)).toBe(
      true,
    );
    expect(hourlyAllocation(distinctTen, -1n)).toEqual({ ok: false, reason: 'INVALID_PRIZE_POOL' });
    expect(hourlyAllocation([10n, 10n], 0n)).toEqual({
      ok: false,
      reason: 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT',
    });
  });

  it('blocks ties within winners and crossing the cutoff', () => {
    expect(hourlyAllocation([100n, 90n, 80n, 80n, 70n], 100n)).toEqual({
      ok: false,
      reason: 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT',
    });
    expect(
      hourlyAllocation([100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 10n], 100n),
    ).toEqual({ ok: false, reason: 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT' });
  });

  it('ignores ties wholly outside Top 10', () => {
    const result = hourlyAllocation(
      [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 0n, 0n],
      1_003n,
    );
    expect(result.ok).toBe(true);
    expect(payoutTotal(result)).toBe(1_003n);
  });

  it('renormalizes two occupied shares and gives a sole participant the full pool', () => {
    const two = hourlyAllocation([2n, 1n], 442n);
    expect(two).toMatchObject({
      ok: true,
      occupiedWeightPpm: 442_000n,
      allocations: [
        { rank: 1, payoutLamports: 250n },
        { rank: 2, payoutLamports: 192n },
      ],
    });
    expect(hourlyAllocation([1n], 999n)).toMatchObject({
      ok: true,
      allocations: [{ rank: 1, payoutLamports: 999n }],
    });
  });

  it('does not mutate leaderboard-owned arrays', () => {
    const scores = [3n, 2n, 1n];
    const built = buildHourlyLeaderboard({
      round,
      results: scores.map((score, index) => hourly(index + 1, score)),
      winnerCount: 10,
    });
    if (!built.ok) throw new Error(built.reason);
    const before = structuredClone(built);
    allocateHourlyPayouts({
      prizePoolLamports: 100n,
      leaderboard: built.leaderboard,
      winnerSelection: built.winnerSelection,
      payoutCurve: competitionConfig.hourlyPayoutCurve,
    });
    expect(built).toEqual(before);
  });
});

describe('daily payout allocation', () => {
  const distinctTwentyFive = Array.from({ length: 25 }, (_, index) => BigInt(100 - index));

  it('allocates a full Top 25 with exact conservation', () => {
    const result = dailyAllocation(distinctTwentyFive, 1_000_003n);
    expect(result.ok).toBe(true);
    expect(payoutTotal(result)).toBe(1_000_003n);
    if (result.ok) expect(result.allocations).toHaveLength(25);
  });

  it('renormalizes an under-filled field over the full daily pool', () => {
    const result = dailyAllocation([3n, 2n, 1n], 999_999n);
    expect(result.ok).toBe(true);
    expect(payoutTotal(result)).toBe(999_999n);
    if (result.ok) {
      expect(result.occupiedWeightPpm).toBe(387_010n);
      expect(result.allocations).toHaveLength(3);
    }
  });

  it('blocks a winning-rank tie but ignores a tie below Top 25', () => {
    expect(dailyAllocation([3n, 2n, 2n], 100n)).toEqual({
      ok: false,
      reason: 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT',
    });
    const below = dailyAllocation([...distinctTwentyFive, 0n, 0n], 100n);
    expect(below.ok).toBe(true);
    expect(payoutTotal(below)).toBe(100n);
  });

  it('rejects a daily cutoff tie safely', () => {
    const crossing = [...Array.from({ length: 24 }, (_, index) => BigInt(100 - index)), 1n, 1n];
    expect(dailyAllocation(crossing, 1_000n)).toEqual({
      ok: false,
      reason: 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT',
    });
  });
});
