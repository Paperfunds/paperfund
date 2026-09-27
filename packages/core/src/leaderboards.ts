import type { CompetitionConfig } from './configuration.js';
import type { DailyCompetition, DailyResult, HourlyResult, HourlyRound } from './types.js';

export interface LeaderboardRankGroup<Result> {
  /** Competition rank: 1, 2, 2, 4. */
  readonly rank: number;
  readonly tied: boolean;
  readonly tieGroupSize: number;
  /** User-ID order is serialization-only and has no competitive meaning. */
  readonly results: readonly Result[];
}

export interface Leaderboard<Result> {
  readonly participantCount: number;
  readonly rankGroups: readonly LeaderboardRankGroup<Result>[];
}

export type WinnerSelection<Result> =
  | {
      readonly ok: true;
      readonly winnerCount: number;
      readonly cutoffBlocked: false;
      readonly provisionalWinners: readonly Result[];
    }
  | {
      readonly ok: false;
      readonly reason: 'INVALID_WINNER_COUNT';
    };

export type HourlyLeaderboardResult =
  | {
      readonly ok: true;
      readonly leaderboard: Leaderboard<HourlyResult>;
      readonly winnerSelection: WinnerSelection<HourlyResult>;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'HOURLY_RESULT_NOT_FINALIZED'
        | 'HOURLY_RESULT_ROUND_MISMATCH'
        | 'DUPLICATE_LEADERBOARD_USER';
    };

export type DailyLeaderboardResult =
  | {
      readonly ok: true;
      readonly leaderboard: Leaderboard<DailyResult>;
      readonly winnerSelection: WinnerSelection<DailyResult>;
    }
  | {
      readonly ok: false;
      readonly reason: 'DAILY_COMPETITION_MISMATCH' | 'DUPLICATE_LEADERBOARD_USER';
    };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rankByScore<Result>(
  results: readonly Result[],
  score: (result: Result) => bigint,
  userId: (result: Result) => string,
): Leaderboard<Result> {
  const sorted = [...results].sort(
    (left, right) =>
      (score(left) > score(right) ? -1 : score(left) < score(right) ? 1 : 0) ||
      compareText(userId(left), userId(right)),
  );
  const rankGroups: LeaderboardRankGroup<Result>[] = [];

  for (const result of sorted) {
    const previous = rankGroups.at(-1);
    if (previous && score(previous.results[0]!) === score(result)) {
      const groupedResults = [...previous.results, result];
      rankGroups[rankGroups.length - 1] = {
        ...previous,
        tied: true,
        tieGroupSize: groupedResults.length,
        results: groupedResults,
      };
    } else {
      rankGroups.push({
        rank: rankGroups.reduce((count, group) => count + group.tieGroupSize, 0) + 1,
        tied: false,
        tieGroupSize: 1,
        results: [result],
      });
    }
  }

  return { participantCount: sorted.length, rankGroups };
}

function hasDuplicateUsers<Result>(
  results: readonly Result[],
  userId: (result: Result) => string,
): boolean {
  return new Set(results.map(userId)).size !== results.length;
}

export function selectProvisionalWinners<Result>(
  leaderboard: Leaderboard<Result>,
  winnerCount: number,
): WinnerSelection<Result> {
  if (!Number.isInteger(winnerCount) || winnerCount <= 0) {
    return { ok: false, reason: 'INVALID_WINNER_COUNT' };
  }

  const provisionalWinners: Result[] = [];
  for (const group of leaderboard.rankGroups) {
    const groupEnd = group.rank + group.tieGroupSize - 1;
    if (group.rank > winnerCount) break;
    if (groupEnd > winnerCount) {
      provisionalWinners.push(...group.results);
      break;
    }
    provisionalWinners.push(...group.results);
  }

  return { ok: true, winnerCount, cutoffBlocked: false, provisionalWinners };
}

export function buildHourlyLeaderboard(input: {
  readonly round: HourlyRound;
  readonly results: readonly HourlyResult[];
  readonly winnerCount: CompetitionConfig['hourlyWinnerCount'];
}): HourlyLeaderboardResult {
  if (input.round.state !== 'FINALIZED') {
    return { ok: false, reason: 'HOURLY_RESULT_NOT_FINALIZED' };
  }
  if (input.results.some(({ hourlyRoundId }) => hourlyRoundId !== input.round.id)) {
    return { ok: false, reason: 'HOURLY_RESULT_ROUND_MISMATCH' };
  }
  if (hasDuplicateUsers(input.results, ({ userId }) => userId)) {
    return { ok: false, reason: 'DUPLICATE_LEADERBOARD_USER' };
  }
  const leaderboard = rankByScore(
    input.results,
    ({ pnl }) => pnl,
    ({ userId }) => userId,
  );
  return {
    ok: true,
    leaderboard,
    winnerSelection: selectProvisionalWinners(leaderboard, input.winnerCount),
  };
}

export function buildDailyLeaderboard(input: {
  readonly dailyCompetition: DailyCompetition;
  readonly results: readonly DailyResult[];
  readonly winnerCount: CompetitionConfig['dailyWinnerCount'];
}): DailyLeaderboardResult {
  if (
    input.results.some(({ dailyCompetitionId }) => dailyCompetitionId !== input.dailyCompetition.id)
  ) {
    return { ok: false, reason: 'DAILY_COMPETITION_MISMATCH' };
  }
  if (hasDuplicateUsers(input.results, ({ userId }) => userId)) {
    return { ok: false, reason: 'DUPLICATE_LEADERBOARD_USER' };
  }
  const leaderboard = rankByScore(
    input.results,
    ({ cumulativePnl }) => cumulativePnl,
    ({ userId }) => userId,
  );
  return {
    ok: true,
    leaderboard,
    winnerSelection: selectProvisionalWinners(leaderboard, input.winnerCount),
  };
}
