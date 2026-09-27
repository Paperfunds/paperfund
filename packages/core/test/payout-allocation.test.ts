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

function user(index: number): UserId {
  return identifier(`user-${index.toString().padStart(2, '0')}`, 'UserId') as UserId;
}
function hourly(index: number, score: bigint): HourlyResult {
  return {
    hourlyRoundId,
    competitionAccountId: identifier(
      `account-${index}`,
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
    completedHourlyRoundIds: [identifier(`round-${index}`, 'HourlyRoundId') as HourlyRoundId],
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
function total(result: ReturnType<typeof hourlyAllocation>): bigint {
  return result.ok ? result.allocations.reduce((sum, row) => sum + row.payoutLamports, 0n) : -1n;
}

describe('Phase 5C exact payout allocation', () => {
  it('allocates normal hourly Top 10 and daily Top 25 fields exactly', () => {
    const hourlyResult = hourlyAllocation(
      Array.from({ length: 12 }, (_, i) => BigInt(100 - i)),
      1_000_003n,
    );
    expect(hourlyResult.ok).toBe(true);
    expect(total(hourlyResult)).toBe(1_000_003n);
    if (hourlyResult.ok) {
      expect(hourlyResult.allocations).toHaveLength(10);
      expect(hourlyResult.rankBuckets).toHaveLength(10);
    }
    const dailyResult = dailyAllocation(
      Array.from({ length: 27 }, (_, i) => BigInt(100 - i)),
      2_000_003n,
    );
    expect(dailyResult.ok).toBe(true);
    expect(total(dailyResult)).toBe(2_000_003n);
    if (dailyResult.ok) expect(dailyResult.allocations).toHaveLength(25);
  });

  it('pools two-way and three-way ties across their occupied ordinals', () => {
    const two = hourlyAllocation([100n, 90n, 90n, 80n], 1_000_000n);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    const tied = two.allocations.filter(({ rank }) => rank === 2);
    expect(tied).toHaveLength(2);
    expect(tied[0]!.payoutLamports + tied[1]!.payoutLamports).toBe(
      two.rankBuckets[1]!.finalAllocationLamports + two.rankBuckets[2]!.finalAllocationLamports,
    );

    const three = hourlyAllocation([100n, 90n, 80n, 70n, 70n, 70n, 60n], 1_000_007n);
    expect(three.ok).toBe(true);
    if (!three.ok) return;
    const group = three.allocations.filter(({ rank }) => rank === 4);
    expect(group).toHaveLength(3);
    expect(group.reduce((sum, row) => sum + row.payoutLamports, 0n)).toBe(
      three.rankBuckets
        .slice(3, 6)
        .reduce((sum, bucket) => sum + bucket.finalAllocationLamports, 0n),
    );
  });

  it('shares only funded buckets when a tie crosses the cutoff', () => {
    const twoWay = hourlyAllocation(
      [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 10n],
      1_000_000n,
    );
    expect(twoWay.ok).toBe(true);
    if (!twoWay.ok) return;
    const cutoff = twoWay.allocations.filter(({ rank }) => rank === 10);
    expect(cutoff).toHaveLength(2);
    expect(cutoff.reduce((sum, row) => sum + row.payoutLamports, 0n)).toBe(
      twoWay.rankBuckets[9]!.finalAllocationLamports,
    );
    expect(total(twoWay)).toBe(1_000_000n);

    const fourWay = hourlyAllocation(
      [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 20n, 20n, 20n],
      1_000_001n,
    );
    expect(fourWay.ok).toBe(true);
    if (!fourWay.ok) return;
    const cutoffFour = fourWay.allocations.filter(({ rank }) => rank === 9);
    expect(cutoffFour).toHaveLength(4);
    expect(cutoffFour.reduce((sum, row) => sum + row.payoutLamports, 0n)).toBe(
      fourWay.rankBuckets[8]!.finalAllocationLamports +
        fourWay.rankBuckets[9]!.finalAllocationLamports,
    );
  });

  it('does not allocate a tie entirely below the cutoff', () => {
    const result = hourlyAllocation(
      [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 0n, 0n],
      100n,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allocations.some(({ rank }) => rank === 11)).toBe(false);
  });

  it('renormalizes underfilled hourly and daily fields before tie pooling', () => {
    const hourlyResult = hourlyAllocation([3n, 2n, 2n], 997n);
    expect(hourlyResult.ok).toBe(true);
    expect(total(hourlyResult)).toBe(997n);
    if (hourlyResult.ok) {
      expect(hourlyResult.occupiedWeightPpm).toBe(589_400n);
      expect(hourlyResult.allocations).toHaveLength(3);
      expect(hourlyResult.allocations.filter(({ rank }) => rank === 2)).toHaveLength(2);
    }
    const dailyResult = dailyAllocation([7n, 6n, 5n, 4n, 3n, 2n, 1n], 7_777n);
    expect(dailyResult.ok).toBe(true);
    expect(total(dailyResult)).toBe(7_777n);
  });

  it('allows negative-score winners in a small field', () => {
    const result = hourlyAllocation([-1n, -2n, -3n], 300n);
    expect(result.ok).toBe(true);
    expect(result.ok && result.allocations).toHaveLength(3);
    expect(total(result)).toBe(300n);
  });

  it('uses largest remainder for rank buckets and stable user ID only for tie dust', () => {
    const first = hourlyAllocation([10n, 10n], 5n);
    const second = hourlyAllocation([10n, 10n], 5n);
    expect(first).toEqual(second);
    expect(total(first)).toBe(5n);
    if (!first.ok) return;
    expect(first.rankBuckets.reduce((sum, row) => sum + row.finalAllocationLamports, 0n)).toBe(5n);
    expect(first.allocations.map(({ payoutLamports }) => payoutLamports)).toEqual([3n, 2n]);
    expect(first.allocations.map(({ dustAdjustmentLamports }) => dustAdjustmentLamports)).toEqual([
      1n,
      0n,
    ]);
    expect(first.allocations.map(({ rank }) => rank)).toEqual([1, 1]);
  });

  it('accepts an empty zero pool and rejects negative pools', () => {
    expect(hourlyAllocation([], 0n)).toMatchObject({ ok: true, allocations: [] });
    expect(hourlyAllocation([1n], -1n)).toEqual({ ok: false, reason: 'INVALID_PRIZE_POOL' });
  });
});
