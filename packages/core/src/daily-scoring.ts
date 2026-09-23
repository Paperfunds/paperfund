import { paperSolDelta } from './money.js';
import type { DailyCompetition, DailyResult, HourlyResult, HourlyRound } from './types.js';
import type { UserId } from './identifiers.js';

export const DAILY_SCORING_REJECTION_REASONS = [
  'HOURLY_RESULT_NOT_FINALIZED',
  'DUPLICATE_HOURLY_RESULT',
  'HOURLY_RESULT_USER_MISMATCH',
  'HOURLY_RESULT_OUTSIDE_DAILY_WINDOW',
  'HOURLY_ROUND_NOT_FOUND',
  'HOURLY_ROUND_DUPLICATE',
  'HOURLY_RESULT_ROUND_MISMATCH',
  'DAILY_COMPETITION_MISMATCH',
] as const;

export type DailyScoringRejectionReason = (typeof DAILY_SCORING_REJECTION_REASONS)[number];

export type DailyScoringResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DailyScoringRejectionReason };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRoundStartInsideDailyWindow(
  dailyCompetition: DailyCompetition,
  hourlyRound: HourlyRound,
): boolean {
  const start = new Date(hourlyRound.startsAt).getTime();
  return (
    start >= new Date(dailyCompetition.startsAt).getTime() &&
    start < new Date(dailyCompetition.endsAtExclusive).getTime()
  );
}

export function initializeDailyResult(input: {
  readonly dailyCompetition: DailyCompetition;
  readonly userId: UserId;
}): DailyResult {
  return {
    dailyCompetitionId: input.dailyCompetition.id,
    userId: input.userId,
    cumulativePnl: paperSolDelta(0n),
    completedHourlyRoundIds: [],
    completedHourlyResultCount: 0,
  };
}

export function accumulateHourlyResult(input: {
  readonly dailyCompetition: DailyCompetition;
  readonly dailyResult: DailyResult;
  readonly hourlyResult: HourlyResult;
  readonly hourlyRound: HourlyRound;
}): DailyScoringResult<DailyResult> {
  if (input.dailyResult.dailyCompetitionId !== input.dailyCompetition.id) {
    return { ok: false, reason: 'DAILY_COMPETITION_MISMATCH' };
  }
  if (input.hourlyResult.userId !== input.dailyResult.userId) {
    return { ok: false, reason: 'HOURLY_RESULT_USER_MISMATCH' };
  }
  if (input.hourlyRound.id !== input.hourlyResult.hourlyRoundId) {
    return { ok: false, reason: 'HOURLY_RESULT_ROUND_MISMATCH' };
  }
  if (input.hourlyRound.state !== 'FINALIZED') {
    return { ok: false, reason: 'HOURLY_RESULT_NOT_FINALIZED' };
  }
  if (!isRoundStartInsideDailyWindow(input.dailyCompetition, input.hourlyRound)) {
    return { ok: false, reason: 'HOURLY_RESULT_OUTSIDE_DAILY_WINDOW' };
  }
  if (input.dailyResult.completedHourlyRoundIds.includes(input.hourlyResult.hourlyRoundId)) {
    return { ok: false, reason: 'DUPLICATE_HOURLY_RESULT' };
  }

  const completedHourlyRoundIds = [
    ...input.dailyResult.completedHourlyRoundIds,
    input.hourlyResult.hourlyRoundId,
  ].sort(compareText);
  return {
    ok: true,
    value: {
      ...input.dailyResult,
      cumulativePnl: paperSolDelta(input.dailyResult.cumulativePnl + input.hourlyResult.pnl),
      completedHourlyRoundIds,
      completedHourlyResultCount: completedHourlyRoundIds.length,
    },
  };
}

export function buildDailyResults(input: {
  readonly dailyCompetition: DailyCompetition;
  readonly hourlyResults: readonly HourlyResult[];
  readonly hourlyRounds: readonly HourlyRound[];
}): DailyScoringResult<readonly DailyResult[]> {
  const roundsById = new Map(input.hourlyRounds.map((round) => [round.id, round]));
  if (roundsById.size !== input.hourlyRounds.length) {
    return { ok: false, reason: 'HOURLY_ROUND_DUPLICATE' };
  }

  const sortedResults = [...input.hourlyResults].sort(
    (left, right) =>
      compareText(left.userId, right.userId) ||
      compareText(left.hourlyRoundId, right.hourlyRoundId),
  );
  const dailyResults = new Map<UserId, DailyResult>();

  for (const hourlyResult of sortedResults) {
    const hourlyRound = roundsById.get(hourlyResult.hourlyRoundId);
    if (!hourlyRound) {
      return { ok: false, reason: 'HOURLY_ROUND_NOT_FOUND' };
    }
    const current =
      dailyResults.get(hourlyResult.userId) ??
      initializeDailyResult({
        dailyCompetition: input.dailyCompetition,
        userId: hourlyResult.userId,
      });
    const accumulated = accumulateHourlyResult({
      dailyCompetition: input.dailyCompetition,
      dailyResult: current,
      hourlyResult,
      hourlyRound,
    });
    if (!accumulated.ok) {
      return accumulated;
    }
    dailyResults.set(hourlyResult.userId, accumulated.value);
  }

  return {
    ok: true,
    value: [...dailyResults.values()].sort((left, right) => compareText(left.userId, right.userId)),
  };
}
