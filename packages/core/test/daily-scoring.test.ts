import { describe, expect, it } from 'vitest';

import {
  accumulateHourlyResult,
  buildDailyResults,
  identifier,
  initializeDailyResult,
  paperSolBaseUnits,
  paperSolDelta,
  utcHourlyBoundaries,
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

const dailyId = identifier('daily-2026-09-23', 'DailyCompetitionId') as DailyCompetitionId;

function user(value: string): UserId {
  return identifier(value, 'UserId') as UserId;
}

function dailyCompetition(id = dailyId, start = '2026-09-23T00:00:00Z'): DailyCompetition {
  const startInstant = utcInstant(start);
  const end = new Date(startInstant);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    id,
    state: 'OPEN',
    startsAt: startInstant,
    endsAtExclusive: utcInstant(end),
    configurationVersion: 'phase-1a-v1',
  };
}

function hourlyRound(
  label: string,
  start: string,
  state: HourlyRound['state'] = 'FINALIZED',
): HourlyRound {
  const boundaries = utcHourlyBoundaries(start);
  return {
    id: identifier(`round-${label}`, 'HourlyRoundId') as HourlyRoundId,
    state,
    startsAt: boundaries.start,
    endsAtExclusive: boundaries.endExclusive,
    configurationVersion: 'phase-1a-v1',
  };
}

function hourlyResult(
  owner: UserId,
  round: HourlyRound,
  pnl: bigint,
  finalizedAt = round.endsAtExclusive,
): HourlyResult {
  return {
    hourlyRoundId: round.id,
    competitionAccountId: identifier(
      `account-${owner}-${round.id}`,
      'CompetitionAccountId',
    ) as CompetitionAccountId,
    userId: owner,
    finalSettledPaperSol: paperSolBaseUnits(pnl >= -10_000_000_000n ? 10_000_000_000n + pnl : 0n),
    pnl: paperSolDelta(pnl),
    finalizedAt,
  };
}

function accumulate(
  result: DailyResult,
  competition: DailyCompetition,
  round: HourlyRound,
  hourly: HourlyResult,
) {
  return accumulateHourlyResult({
    dailyCompetition: competition,
    dailyResult: result,
    hourlyRound: round,
    hourlyResult: hourly,
  });
}

describe('Daily Championship accumulation', () => {
  it('initializes an exact zero aggregate without implicit time or fake rank', () => {
    const owner = user('user-a');
    expect(initializeDailyResult({ dailyCompetition: dailyCompetition(), userId: owner })).toEqual({
      dailyCompetitionId: dailyId,
      userId: owner,
      cumulativePnl: 0n,
      completedHourlyRoundIds: [],
      completedHourlyResultCount: 0,
    });
  });

  it('adds one positive finalized hour and increments the completed count', () => {
    const owner = user('user-a');
    const competition = dailyCompetition();
    const round = hourlyRound('10', '2026-09-23T10:00:00Z');
    const initial = initializeDailyResult({ dailyCompetition: competition, userId: owner });
    const result = accumulate(
      initial,
      competition,
      round,
      hourlyResult(owner, round, 4_000_000_000n),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { cumulativePnl: 4_000_000_000n, completedHourlyResultCount: 1 },
    });
  });

  it('sums gains and losses with no filtering or loss protection', () => {
    const owner = user('user-a');
    const rounds = [
      hourlyRound('08', '2026-09-23T08:00:00Z'),
      hourlyRound('09', '2026-09-23T09:00:00Z'),
      hourlyRound('10', '2026-09-23T10:00:00Z'),
    ];
    const result = buildDailyResults({
      dailyCompetition: dailyCompetition(),
      hourlyRounds: rounds,
      hourlyResults: [
        hourlyResult(owner, rounds[0]!, 4_000_000_000n),
        hourlyResult(owner, rounds[1]!, -2_000_000_000n),
        hourlyResult(owner, rounds[2]!, 7_000_000_000n),
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ cumulativePnl: 9_000_000_000n, completedHourlyResultCount: 3 }],
    });
  });

  it('supports loss-only days and counts zero-P&L rounds', () => {
    const owner = user('user-a');
    const rounds = [
      hourlyRound('08', '2026-09-23T08:00:00Z'),
      hourlyRound('09', '2026-09-23T09:00:00Z'),
      hourlyRound('10', '2026-09-23T10:00:00Z'),
    ];
    const result = buildDailyResults({
      dailyCompetition: dailyCompetition(),
      hourlyRounds: rounds,
      hourlyResults: [
        hourlyResult(owner, rounds[0]!, -1_000_000_000n),
        hourlyResult(owner, rounds[1]!, -3_000_000_000n),
        hourlyResult(owner, rounds[2]!, 0n),
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ cumulativePnl: -4_000_000_000n, completedHourlyResultCount: 3 }],
    });
  });

  it('reproduces the +12.6 SOL specification example exactly', () => {
    const owner = user('user-a');
    const scores = [
      3_200_000_000n,
      7_800_000_000n,
      -4_000_000_000n,
      1_100_000_000n,
      -7_500_000_000n,
      12_000_000_000n,
    ].map(paperSolDelta);
    const rounds = scores.map((_, index) =>
      hourlyRound(index.toString(), `2026-09-23T${index.toString().padStart(2, '0')}:00:00Z`),
    );
    const result = buildDailyResults({
      dailyCompetition: dailyCompetition(),
      hourlyRounds: rounds,
      hourlyResults: scores.map((pnl, index) => hourlyResult(owner, rounds[index]!, pnl)),
    });
    expect(result.ok && result.value[0]?.cumulativePnl).toBe(12_600_000_000n);
  });

  it('rejects duplicate hourly results for the same user and round', () => {
    const owner = user('user-a');
    const round = hourlyRound('10', '2026-09-23T10:00:00Z');
    const hourly = hourlyResult(owner, round, 1n);
    expect(
      buildDailyResults({
        dailyCompetition: dailyCompetition(),
        hourlyRounds: [round],
        hourlyResults: [hourly, hourly],
      }),
    ).toEqual({ ok: false, reason: 'DUPLICATE_HOURLY_RESULT' });
  });

  it('rejects user, daily competition, round, and finalization mismatches', () => {
    const competition = dailyCompetition();
    const owner = user('user-a');
    const other = user('user-b');
    const round = hourlyRound('10', '2026-09-23T10:00:00Z');
    const initial = initializeDailyResult({ dailyCompetition: competition, userId: owner });

    expect(accumulate(initial, competition, round, hourlyResult(other, round, 1n))).toEqual({
      ok: false,
      reason: 'HOURLY_RESULT_USER_MISMATCH',
    });
    expect(
      accumulate(
        {
          ...initial,
          dailyCompetitionId: identifier('other-day', 'DailyCompetitionId') as DailyCompetitionId,
        },
        competition,
        round,
        hourlyResult(owner, round, 1n),
      ),
    ).toEqual({ ok: false, reason: 'DAILY_COMPETITION_MISMATCH' });
    const otherRound = hourlyRound('11', '2026-09-23T11:00:00Z');
    expect(accumulate(initial, competition, round, hourlyResult(owner, otherRound, 1n))).toEqual({
      ok: false,
      reason: 'HOURLY_RESULT_ROUND_MISMATCH',
    });
    const openRound = { ...round, state: 'OPEN' as const };
    expect(accumulate(initial, competition, openRound, hourlyResult(owner, openRound, 1n))).toEqual(
      {
        ok: false,
        reason: 'HOURLY_RESULT_NOT_FINALIZED',
      },
    );
  });

  it('attributes a 23:00–00:00 round to its start day despite later finalization', () => {
    const owner = user('user-a');
    const oldDay = dailyCompetition();
    const lateRound = hourlyRound('23', '2026-09-23T23:00:00Z');
    const result = buildDailyResults({
      dailyCompetition: oldDay,
      hourlyRounds: [lateRound],
      hourlyResults: [
        hourlyResult(owner, lateRound, 1_000_000_000n, utcInstant('2026-09-24T00:00:30Z')),
      ],
    });
    expect(result.ok && result.value[0]?.cumulativePnl).toBe(1_000_000_000n);
  });

  it('attributes the 00:00–01:00 round only to the new UTC day', () => {
    const owner = user('user-a');
    const newDayId = identifier('daily-2026-09-24', 'DailyCompetitionId') as DailyCompetitionId;
    const newDay = dailyCompetition(newDayId, '2026-09-24T00:00:00Z');
    const midnightRound = hourlyRound('midnight', '2026-09-24T00:00:00Z');
    const hourly = hourlyResult(owner, midnightRound, 2_000_000_000n);

    expect(
      buildDailyResults({
        dailyCompetition: dailyCompetition(),
        hourlyRounds: [midnightRound],
        hourlyResults: [hourly],
      }),
    ).toEqual({ ok: false, reason: 'HOURLY_RESULT_OUTSIDE_DAILY_WINDOW' });
    expect(
      buildDailyResults({
        dailyCompetition: newDay,
        hourlyRounds: [midnightRound],
        hourlyResults: [hourly],
      }),
    ).toMatchObject({ ok: true, value: [{ cumulativePnl: 2_000_000_000n }] });
  });

  it('rejects an hourly result with no supplied round context', () => {
    const round = hourlyRound('10', '2026-09-23T10:00:00Z');
    expect(
      buildDailyResults({
        dailyCompetition: dailyCompetition(),
        hourlyRounds: [],
        hourlyResults: [hourlyResult(user('user-a'), round, 1n)],
      }),
    ).toEqual({ ok: false, reason: 'HOURLY_ROUND_NOT_FOUND' });
  });

  it('is input-order independent and leaves all inputs immutable', () => {
    const firstUser = user('user-a');
    const secondUser = user('user-b');
    const rounds = [
      hourlyRound('08', '2026-09-23T08:00:00Z'),
      hourlyRound('09', '2026-09-23T09:00:00Z'),
    ];
    const results = [
      hourlyResult(secondUser, rounds[1]!, 3n),
      hourlyResult(firstUser, rounds[0]!, 1n),
      hourlyResult(firstUser, rounds[1]!, 2n),
    ];
    const snapshot = structuredClone({ rounds, results });
    const forward = buildDailyResults({
      dailyCompetition: dailyCompetition(),
      hourlyRounds: rounds,
      hourlyResults: results,
    });
    const reversed = buildDailyResults({
      dailyCompetition: dailyCompetition(),
      hourlyRounds: [...rounds].reverse(),
      hourlyResults: [...results].reverse(),
    });
    expect(forward).toEqual(reversed);
    expect({ rounds, results }).toEqual(snapshot);
  });

  it('uses exact bigint arithmetic for values beyond Number safe range', () => {
    const owner = user('user-a');
    const first = hourlyRound('08', '2026-09-23T08:00:00Z');
    const second = hourlyRound('09', '2026-09-23T09:00:00Z');
    const huge = 99_999_999_999_999_999_999_999n;
    const result = buildDailyResults({
      dailyCompetition: dailyCompetition(),
      hourlyRounds: [first, second],
      hourlyResults: [hourlyResult(owner, first, huge), hourlyResult(owner, second, -1n)],
    });
    expect(result.ok && result.value[0]?.cumulativePnl).toBe(huge - 1n);
  });
});
