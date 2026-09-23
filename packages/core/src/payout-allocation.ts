import type { PayoutCurveEntry } from './configuration.js';
import type { UserId } from './identifiers.js';
import type { Leaderboard, WinnerSelection } from './leaderboards.js';
import { lamports, type Lamports } from './money.js';
import type { PartsPerMillion } from './percentages.js';
import type { DailyResult, HourlyResult } from './types.js';

export interface PayoutAllocation {
  readonly userId: UserId;
  readonly rank: number;
  readonly payoutLamports: Lamports;
  readonly curveWeightPpm: PartsPerMillion;
}

export type PayoutAllocationResult =
  | {
      readonly ok: true;
      readonly prizePoolLamports: Lamports;
      readonly occupiedWeightPpm: bigint;
      readonly allocations: readonly PayoutAllocation[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'INVALID_PRIZE_POOL'
        | 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT'
        | 'INVALID_LEADERBOARD_FOR_PAYOUT';
    };

interface RankedUser {
  readonly userId: UserId;
}

function allocatePayouts<Result extends RankedUser>(input: {
  readonly prizePoolLamports: bigint;
  readonly leaderboard: Leaderboard<Result>;
  readonly winnerSelection: WinnerSelection<Result>;
  readonly payoutCurve: readonly PayoutCurveEntry[];
}): PayoutAllocationResult {
  if (input.prizePoolLamports < 0n) return { ok: false, reason: 'INVALID_PRIZE_POOL' };
  if (!input.winnerSelection.ok) {
    return {
      ok: false,
      reason:
        input.winnerSelection.reason === 'UNRESOLVED_TIE_AT_WINNER_CUTOFF'
          ? 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT'
          : 'INVALID_LEADERBOARD_FOR_PAYOUT',
    };
  }
  const winnerSelection = input.winnerSelection;
  const winnerCount = winnerSelection.winnerCount;
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
  if (
    structurallyInvalid ||
    invalidCurve ||
    winnerCount !== input.payoutCurve.length ||
    input.leaderboard.participantCount !==
      input.leaderboard.rankGroups.reduce((count, group) => count + group.results.length, 0)
  ) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  const winningGroups = input.leaderboard.rankGroups.filter(({ rank }) => rank <= winnerCount);
  if (winningGroups.some(({ tied }) => tied)) {
    return { ok: false, reason: 'UNRESOLVED_WINNER_TIE_FOR_PAYOUT' };
  }
  const winners = winningGroups.flatMap((group) =>
    group.results.map((result) => ({ rank: group.rank, result })),
  );
  if (
    winners.length !== winnerSelection.provisionalWinners.length ||
    winners.length !== Math.min(input.leaderboard.participantCount, winnerCount) ||
    winners.some(({ rank }, index) => rank !== index + 1) ||
    winners.some(
      ({ result }, index) => result.userId !== winnerSelection.provisionalWinners[index]?.userId,
    )
  ) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }
  if (winners.length === 0) {
    return input.prizePoolLamports === 0n
      ? {
          ok: true,
          prizePoolLamports: lamports(0n),
          occupiedWeightPpm: 0n,
          allocations: [],
        }
      : { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }

  const curveByRank = new Map(input.payoutCurve.map((entry) => [entry.rank, entry]));
  const occupiedWeightPpm = winners.reduce(
    (total, { rank }) => total + (curveByRank.get(rank)?.sharePpm ?? 0n),
    0n,
  );
  if (occupiedWeightPpm <= 0n) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }
  const floors = winners.map(({ rank, result }) => {
    const weight = curveByRank.get(rank)?.sharePpm;
    if (weight === undefined) return undefined;
    return {
      userId: result.userId,
      rank,
      payoutLamports: (input.prizePoolLamports * weight) / occupiedWeightPpm,
      curveWeightPpm: weight,
    };
  });
  if (floors.some((value) => value === undefined)) {
    return { ok: false, reason: 'INVALID_LEADERBOARD_FOR_PAYOUT' };
  }
  const exactFloors = floors as Array<{
    userId: UserId;
    rank: number;
    payoutLamports: bigint;
    curveWeightPpm: PartsPerMillion;
  }>;
  const allocated = exactFloors.reduce((total, payout) => total + payout.payoutLamports, 0n);
  exactFloors[0]!.payoutLamports += input.prizePoolLamports - allocated;
  return {
    ok: true,
    prizePoolLamports: lamports(input.prizePoolLamports),
    occupiedWeightPpm,
    allocations: exactFloors.map((payout) => ({
      ...payout,
      payoutLamports: lamports(payout.payoutLamports),
    })),
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
