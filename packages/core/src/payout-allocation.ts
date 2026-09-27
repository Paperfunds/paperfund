import type { PayoutCurveEntry } from './configuration.js';
import type { UserId } from './identifiers.js';
import type { Leaderboard, WinnerSelection } from './leaderboards.js';
import { lamports, type Lamports } from './money.js';
import type { PartsPerMillion } from './percentages.js';
import type { DailyResult, HourlyResult } from './types.js';

export const HOURLY_PAYOUT_CURVE_VERSION = 'hourly-top10-v1';
export const DAILY_PAYOUT_CURVE_VERSION = 'daily-top25-v1';
export const PAYOUT_TIE_POLICY_VERSION = 'combined-funded-ordinals-v1';

export interface PayoutRankBucket {
  readonly ordinal: number;
  readonly weightPpm: PartsPerMillion;
  readonly floorAllocationLamports: Lamports;
  readonly remainderBasis: bigint;
  readonly finalAllocationLamports: Lamports;
}

export interface PayoutTieGroup {
  readonly competitiveRank: number;
  readonly tieGroupSize: number;
  readonly ordinalStart: number;
  readonly ordinalEnd: number;
  readonly fundedOrdinals: readonly number[];
  readonly fundedOrdinalCount: number;
  readonly combinedFundedLamports: Lamports;
  readonly equalFloorLamports: Lamports;
  readonly tieDustLamports: Lamports;
  readonly userIdsInDustOrder: readonly UserId[];
}

export interface PayoutAllocation {
  readonly userId: UserId;
  readonly rank: number;
  readonly tieGroupSize: number;
  readonly ordinalStart: number;
  readonly ordinalEnd: number;
  readonly fundedOrdinalCount: number;
  readonly payoutLamports: Lamports;
  readonly dustAdjustmentLamports: Lamports;
  readonly curveWeightPpm: PartsPerMillion;
}

export type PayoutAllocationResult =
  | {
      readonly ok: true;
      readonly prizePoolLamports: Lamports;
      readonly occupiedWeightPpm: bigint;
      readonly nominalWinnerCount: number;
      readonly actualWinnerCount: number;
      readonly rankBuckets: readonly PayoutRankBucket[];
      readonly tieGroups: readonly PayoutTieGroup[];
      readonly allocations: readonly PayoutAllocation[];
    }
  | {
      readonly ok: false;
      readonly reason: 'INVALID_PRIZE_POOL' | 'INVALID_LEADERBOARD_FOR_PAYOUT';
    };

interface RankedUser {
  readonly userId: UserId;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function allocatePayouts<Result extends RankedUser>(input: {
  readonly prizePoolLamports: bigint;
  readonly leaderboard: Leaderboard<Result>;
  readonly payoutCurve: readonly PayoutCurveEntry[];
}): PayoutAllocationResult {
  if (input.prizePoolLamports < 0n) return { ok: false, reason: 'INVALID_PRIZE_POOL' };

  let expectedRank = 1;
  const users = new Set<string>();
  const structurallyInvalid = input.leaderboard.rankGroups.some((group) => {
    const invalid =
      group.rank !== expectedRank ||
      group.results.length === 0 ||
      group.tieGroupSize !== group.results.length ||
      group.tied !== group.results.length > 1 ||
      group.results.some(({ userId }) => {
        if (users.has(userId)) return true;
        users.add(userId);
        return false;
      });
    expectedRank += group.results.length;
    return invalid;
  });
  const invalidCurve = input.payoutCurve.some(
    ({ rank, sharePpm }, index) => rank !== index + 1 || sharePpm < 0n,
  );
  const participantsFromGroups = input.leaderboard.rankGroups.reduce(
    (count, group) => count + group.results.length,
    0,
  );
  if (
    structurallyInvalid ||
    invalidCurve ||
    input.payoutCurve.length === 0 ||
    input.leaderboard.participantCount !== participantsFromGroups
  ) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  if (participantsFromGroups === 0) {
    return input.prizePoolLamports === 0n
      ? {
          ok: true,
          prizePoolLamports: lamports(0n),
          occupiedWeightPpm: 0n,
          nominalWinnerCount: input.payoutCurve.length,
          actualWinnerCount: 0,
          rankBuckets: [],
          tieGroups: [],
          allocations: [],
        }
      : { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  const fundedOrdinalCount = Math.min(participantsFromGroups, input.payoutCurve.length);
  const fundedCurve = input.payoutCurve.slice(0, fundedOrdinalCount);
  const occupiedWeightPpm = fundedCurve.reduce((sum, entry) => sum + entry.sharePpm, 0n);
  if (occupiedWeightPpm <= 0n) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  const mutableBuckets = fundedCurve.map(({ rank, sharePpm }) => {
    const numerator = input.prizePoolLamports * sharePpm;
    const floor = numerator / occupiedWeightPpm;
    return {
      ordinal: rank,
      weightPpm: sharePpm,
      floorAllocationLamports: floor,
      remainderBasis: numerator % occupiedWeightPpm,
      finalAllocationLamports: floor,
    };
  });
  const floorTotal = mutableBuckets.reduce(
    (sum, bucket) => sum + bucket.floorAllocationLamports,
    0n,
  );
  let bucketDust = input.prizePoolLamports - floorTotal;
  const largestRemainderOrder = [...mutableBuckets].sort(
    (left, right) =>
      (left.remainderBasis > right.remainderBasis
        ? -1
        : left.remainderBasis < right.remainderBasis
          ? 1
          : 0) || left.ordinal - right.ordinal,
  );
  for (const bucket of largestRemainderOrder) {
    if (bucketDust === 0n) break;
    bucket.finalAllocationLamports += 1n;
    bucketDust -= 1n;
  }
  if (bucketDust !== 0n) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  const bucketByOrdinal = new Map(mutableBuckets.map((bucket) => [bucket.ordinal, bucket]));
  const allocations: PayoutAllocation[] = [];
  const tieGroups: PayoutTieGroup[] = [];

  for (const group of input.leaderboard.rankGroups) {
    const ordinalStart = group.rank;
    const ordinalEnd = ordinalStart + group.tieGroupSize - 1;
    const lastFundedOrdinal = Math.min(ordinalEnd, fundedOrdinalCount);
    const fundedOrdinals =
      ordinalStart <= lastFundedOrdinal
        ? Array.from(
            { length: lastFundedOrdinal - ordinalStart + 1 },
            (_, index) => ordinalStart + index,
          )
        : [];
    if (fundedOrdinals.length === 0) continue;

    const combinedFundedLamports = fundedOrdinals.reduce(
      (sum, ordinal) => sum + bucketByOrdinal.get(ordinal)!.finalAllocationLamports,
      0n,
    );
    const groupWeightPpm = fundedOrdinals.reduce(
      (sum, ordinal) => sum + bucketByOrdinal.get(ordinal)!.weightPpm,
      0n,
    );
    const groupSize = BigInt(group.tieGroupSize);
    const equalFloorLamports = combinedFundedLamports / groupSize;
    const originalTieDust = combinedFundedLamports % groupSize;
    let remainingTieDust = originalTieDust;
    const usersInDustOrder = [...group.results].sort((left, right) =>
      compareText(left.userId, right.userId),
    );
    tieGroups.push({
      competitiveRank: group.rank,
      tieGroupSize: group.tieGroupSize,
      ordinalStart,
      ordinalEnd,
      fundedOrdinals,
      fundedOrdinalCount: fundedOrdinals.length,
      combinedFundedLamports: lamports(combinedFundedLamports),
      equalFloorLamports: lamports(equalFloorLamports),
      tieDustLamports: lamports(originalTieDust),
      userIdsInDustOrder: usersInDustOrder.map(({ userId }) => userId),
    });
    for (const result of usersInDustOrder) {
      const dustAdjustment = remainingTieDust > 0n ? 1n : 0n;
      if (remainingTieDust > 0n) remainingTieDust -= 1n;
      allocations.push({
        userId: result.userId,
        rank: group.rank,
        tieGroupSize: group.tieGroupSize,
        ordinalStart,
        ordinalEnd,
        fundedOrdinalCount: fundedOrdinals.length,
        payoutLamports: lamports(equalFloorLamports + dustAdjustment),
        dustAdjustmentLamports: lamports(dustAdjustment),
        curveWeightPpm: groupWeightPpm as PartsPerMillion,
      });
    }
  }

  const allocated = allocations.reduce((sum, allocation) => sum + allocation.payoutLamports, 0n);
  if (allocated !== input.prizePoolLamports) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  return {
    ok: true,
    prizePoolLamports: lamports(input.prizePoolLamports),
    occupiedWeightPpm,
    nominalWinnerCount: input.payoutCurve.length,
    actualWinnerCount: allocations.length,
    rankBuckets: mutableBuckets.map((bucket) => ({
      ...bucket,
      floorAllocationLamports: lamports(bucket.floorAllocationLamports),
      finalAllocationLamports: lamports(bucket.finalAllocationLamports),
    })),
    tieGroups,
    allocations,
  };
}

export function allocateHourlyPayouts(input: {
  readonly prizePoolLamports: bigint;
  readonly leaderboard: Leaderboard<HourlyResult>;
  readonly winnerSelection: WinnerSelection<HourlyResult>;
  readonly payoutCurve: readonly PayoutCurveEntry[];
}): PayoutAllocationResult {
  return allocatePayouts(input);
}

export function allocateDailyPayouts(input: {
  readonly prizePoolLamports: bigint;
  readonly leaderboard: Leaderboard<DailyResult>;
  readonly winnerSelection: WinnerSelection<DailyResult>;
  readonly payoutCurve: readonly PayoutCurveEntry[];
}): PayoutAllocationResult {
  return allocatePayouts(input);
}
