import { describe, expect, it } from 'vitest';

import {
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

const hourlyRoundId = identifier('round-1', 'HourlyRoundId') as HourlyRoundId;
const dailyCompetitionId = identifier('daily-1', 'DailyCompetitionId') as DailyCompetitionId;

function user(index: number): UserId {
  return identifier(`user-${index.toString().padStart(2, '0')}`, 'UserId') as UserId;
}

function round(state: HourlyRound['state'] = 'FINALIZED'): HourlyRound {
  return {
    id: hourlyRoundId,
    state,
    startsAt: utcInstant('2026-09-23T15:00:00Z'),
    endsAtExclusive: utcInstant('2026-09-23T16:00:00Z'),
    configurationVersion: competitionConfig.version,
  };
}

function dailyCompetition(): DailyCompetition {
  return {
    id: dailyCompetitionId,
    state: 'OPEN',
    startsAt: utcInstant('2026-09-23T00:00:00Z'),
    endsAtExclusive: utcInstant('2026-09-24T00:00:00Z'),
    configurationVersion: competitionConfig.version,
  };
}

function hourly(index: number, score: bigint): HourlyResult {
  return {
    hourlyRoundId,
    competitionAccountId: identifier(
      `account-${index.toString()}`,
      'CompetitionAccountId',
    ) as CompetitionAccountId,
    userId: user(index),
    finalSettledPaperSol: paperSolBaseUnits(
      score >= -10_000_000_000n ? 10_000_000_000n + score : 0n,
    ),
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
      identifier(`round-user-${index.toString()}`, 'HourlyRoundId') as HourlyRoundId,
    ],
    completedHourlyResultCount: 1,
  };
}

function hourlyBoard(results: readonly HourlyResult[], winnerCount = 10) {
  return buildHourlyLeaderboard({ round: round(), results, winnerCount });
}

function dailyBoard(results: readonly DailyResult[], winnerCount = 25) {
  return buildDailyLeaderboard({
    dailyCompetition: dailyCompetition(),
    results,
    winnerCount,
  });
}

describe('hourly leaderboard rank groups', () => {
  it('orders distinct positive scores descending with ranks 1, 2, 3', () => {
    const result = hourlyBoard([hourly(1, 3n), hourly(2, 1n), hourly(3, 5n)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.leaderboard.rankGroups.map(({ rank, results }) => [rank, results[0]?.pnl]),
    ).toEqual([
      [1, 5n],
      [2, 3n],
      [3, 1n],
    ]);
  });

  it('represents equal scores as one unresolved competition-rank group', () => {
    const result = hourlyBoard([hourly(2, 5n), hourly(3, 1n), hourly(1, 5n)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaderboard.rankGroups).toMatchObject([
      { rank: 1, tied: true, tieGroupSize: 2, results: [{ userId: user(1) }, { userId: user(2) }] },
      { rank: 3, tied: false, tieGroupSize: 1 },
    ]);
  });

  it('orders negative scores correctly without positive-score eligibility', () => {
    const result = hourlyBoard([hourly(1, -5n), hourly(2, -1n), hourly(3, -2n)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaderboard.rankGroups.map(({ results }) => results[0]?.pnl)).toEqual([
      -1n,
      -2n,
      -5n,
    ]);
  });

  it('is input-order independent, including serialization within ties', () => {
    const values = [hourly(3, 1n), hourly(2, 5n), hourly(1, 5n)];
    expect(hourlyBoard(values)).toEqual(hourlyBoard([...values].reverse()));
  });

  it('rejects non-finalized rounds, wrong rounds, and duplicate users', () => {
    expect(
      buildHourlyLeaderboard({ round: round('SETTLING'), results: [], winnerCount: 10 }),
    ).toEqual({ ok: false, reason: 'HOURLY_RESULT_NOT_FINALIZED' });
    expect(
      hourlyBoard([
        {
          ...hourly(1, 1n),
          hourlyRoundId: identifier('other-round', 'HourlyRoundId') as HourlyRoundId,
        },
      ]),
    ).toEqual({ ok: false, reason: 'HOURLY_RESULT_ROUND_MISMATCH' });
    expect(hourlyBoard([hourly(1, 2n), hourly(1, 1n)])).toEqual({
      ok: false,
      reason: 'DUPLICATE_LEADERBOARD_USER',
    });
  });
});

describe('daily leaderboard rank groups', () => {
  it('orders cumulative scores and represents ties identically to hourly ranking', () => {
    const result = dailyBoard([daily(1, 5n), daily(2, 5n), daily(3, -1n)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaderboard.rankGroups).toMatchObject([
      { rank: 1, tied: true, tieGroupSize: 2 },
      { rank: 3, tied: false, tieGroupSize: 1, results: [{ cumulativePnl: -1n }] },
    ]);
  });

  it('orders negative cumulative scores from least negative to most negative', () => {
    const result = dailyBoard([daily(1, -5n), daily(2, -1n), daily(3, -2n)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaderboard.rankGroups.map(({ results }) => results[0]?.cumulativePnl)).toEqual([
      -1n,
      -2n,
      -5n,
    ]);
  });

  it('is input-order independent and rejects competition/user inconsistencies', () => {
    const results = [daily(3, 1n), daily(1, 5n), daily(2, 5n)];
    expect(dailyBoard(results)).toEqual(dailyBoard([...results].reverse()));
    expect(
      dailyBoard([
        {
          ...daily(1, 1n),
          dailyCompetitionId: identifier('other-daily', 'DailyCompetitionId') as DailyCompetitionId,
        },
      ]),
    ).toEqual({ ok: false, reason: 'DAILY_COMPETITION_MISMATCH' });
    expect(dailyBoard([daily(1, 2n), daily(1, 1n)])).toEqual({
      ok: false,
      reason: 'DUPLICATE_LEADERBOARD_USER',
    });
  });
});

describe('configured provisional winner cutoffs', () => {
  it('selects ten unique hourly scores and all participants when fewer than ten', () => {
    const ten = hourlyBoard(
      Array.from({ length: 10 }, (_, index) => hourly(index + 1, BigInt(10 - index))),
    );
    expect(ten.ok && ten.winnerSelection.ok && ten.winnerSelection.provisionalWinners).toHaveLength(
      10,
    );

    const fiveLosing = hourlyBoard(
      Array.from({ length: 5 }, (_, index) => hourly(index + 1, BigInt(-index - 1))),
    );
    expect(
      fiveLosing.ok &&
        fiveLosing.winnerSelection.ok &&
        fiveLosing.winnerSelection.provisionalWinners,
    ).toHaveLength(5);
  });

  it('allows hourly ties fully inside or outside Top 10', () => {
    const insideScores = [100n, 90n, 80n, 70n, 70n, 60n, 50n, 40n, 30n, 20n];
    const inside = hourlyBoard(insideScores.map((score, index) => hourly(index + 1, score)));
    expect(inside.ok && inside.winnerSelection).toMatchObject({ ok: true, cutoffBlocked: false });

    const outsideScores = [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 0n, 0n];
    const outside = hourlyBoard(outsideScores.map((score, index) => hourly(index + 1, score)));
    expect(outside.ok && outside.winnerSelection).toMatchObject({ ok: true, cutoffBlocked: false });
    expect(
      outside.ok && outside.winnerSelection.ok && outside.winnerSelection.provisionalWinners,
    ).toHaveLength(10);
  });

  it('blocks an unresolved hourly tie crossing rank 10', () => {
    const scores = [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 10n];
    const result = hourlyBoard(scores.map((score, index) => hourly(index + 1, score)));
    expect(result.ok && result.winnerSelection).toMatchObject({
      ok: false,
      reason: 'UNRESOLVED_TIE_AT_WINNER_CUTOFF',
      cutoffBlocked: true,
      provisionalWinners: expect.any(Array),
      cutoffTie: { rank: 10, tied: true, tieGroupSize: 2 },
    });
    if (result.ok && !result.winnerSelection.ok && 'cutoffTie' in result.winnerSelection) {
      expect(result.winnerSelection.provisionalWinners).toHaveLength(9);
    }
  });

  it('selects daily Top 25, all fewer participants, and allows safe ties', () => {
    const twentyFive = dailyBoard(
      Array.from({ length: 25 }, (_, index) => daily(index + 1, BigInt(25 - index))),
    );
    expect(
      twentyFive.ok &&
        twentyFive.winnerSelection.ok &&
        twentyFive.winnerSelection.provisionalWinners,
    ).toHaveLength(25);

    const five = dailyBoard(
      Array.from({ length: 5 }, (_, index) => daily(index + 1, -BigInt(index))),
    );
    expect(
      five.ok && five.winnerSelection.ok && five.winnerSelection.provisionalWinners,
    ).toHaveLength(5);

    const safeTie = dailyBoard(
      Array.from({ length: 25 }, (_, index) =>
        daily(index + 1, index === 3 ? 21n : BigInt(25 - index)),
      ),
    );
    expect(safeTie.ok && safeTie.winnerSelection).toMatchObject({ ok: true });
    if (safeTie.ok) {
      expect(safeTie.leaderboard.rankGroups.some(({ tied }) => tied)).toBe(true);
    }
  });

  it('blocks a daily tie crossing rank 25 but ignores one wholly below it', () => {
    const crossingScores = [
      ...Array.from({ length: 24 }, (_, index) => BigInt(100 - index)),
      1n,
      1n,
    ];
    const crossing = dailyBoard(crossingScores.map((score, index) => daily(index + 1, score)));
    expect(crossing.ok && crossing.winnerSelection).toMatchObject({
      ok: false,
      reason: 'UNRESOLVED_TIE_AT_WINNER_CUTOFF',
      cutoffTie: { rank: 25, tieGroupSize: 2 },
    });

    const belowScores = [...Array.from({ length: 25 }, (_, index) => BigInt(100 - index)), 1n, 1n];
    const below = dailyBoard(belowScores.map((score, index) => daily(index + 1, score)));
    expect(below.ok && below.winnerSelection).toMatchObject({ ok: true });
  });

  it('uses exact bigint comparison beyond Number safe range', () => {
    const huge = 9_999_999_999_999_999_999_999_999n;
    const result = hourlyBoard([hourly(1, huge - 1n), hourly(2, -huge), hourly(3, huge)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaderboard.rankGroups.map(({ results }) => results[0]?.userId)).toEqual([
      user(3),
      user(1),
      user(2),
    ]);
  });
});
