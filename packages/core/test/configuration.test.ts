import { describe, expect, it } from 'vitest';

import {
  BASIS_POINTS_PER_WHOLE,
  PARTS_PER_MILLION_PER_WHOLE,
  basisPoints,
  competitionConfig,
  partsPerMillion,
  validateCompetitionConfig,
  validatePayoutCurve,
} from '../src/index.js';

describe('competition configuration', () => {
  it('validates the canonical configuration with exact product defaults', () => {
    expect(validateCompetitionConfig(competitionConfig)).toBeDefined();
    expect(competitionConfig.startingPaperSolBaseUnits).toBe(10_000_000_000n);
    expect(competitionConfig.hourlyRoundDurationSeconds).toBe(3_600);
    expect(competitionConfig.authoritativeTimezone).toBe('UTC');
    expect(competitionConfig.maxUniqueTokensPerRound).toBe(5);
    expect(competitionConfig.maxBuyRatioBps).toBe(2_000n);
    expect(competitionConfig.hourlyWinnerCount).toBe(10);
    expect(competitionConfig.dailyWinnerCount).toBe(25);
    expect(competitionConfig.rewardFinalizationGracePeriodSeconds).toBe(60);
  });

  it('rejects a non-positive starting Paper SOL balance', () => {
    expect(() =>
      validateCompetitionConfig({
        ...competitionConfig,
        startingPaperSolBaseUnits: 0n,
      }),
    ).toThrow();
  });

  it('rejects max buy ratios outside (0, 1]', () => {
    expect(() => validateCompetitionConfig({ ...competitionConfig, maxBuyRatioBps: 0n })).toThrow();
    expect(() =>
      validateCompetitionConfig({ ...competitionConfig, maxBuyRatioBps: 10_001n }),
    ).toThrow();
  });

  it('rejects zero token slots', () => {
    expect(() =>
      validateCompetitionConfig({ ...competitionConfig, maxUniqueTokensPerRound: 0 }),
    ).toThrow();
  });

  it('rejects lambda outside [0, 1]', () => {
    expect(() =>
      validateCompetitionConfig({
        ...competitionConfig,
        rewardBuffer: { ...competitionConfig.rewardBuffer, lambdaBps: 10_001n },
      }),
    ).toThrow();
  });

  it('rejects a non-positive baseline window', () => {
    expect(() =>
      validateCompetitionConfig({
        ...competitionConfig,
        rewardBuffer: { ...competitionConfig.rewardBuffer, baselineWindowCompletedHours: 0 },
      }),
    ).toThrow();
  });

  it('rejects a negative reward finalization grace period', () => {
    expect(() =>
      validateCompetitionConfig({
        ...competitionConfig,
        rewardFinalizationGracePeriodSeconds: -1,
      }),
    ).toThrow();
  });
});

describe('creator-fee modes', () => {
  it('totals Normal Mode to exactly 100% in basis points', () => {
    const mode = competitionConfig.creatorFees.normal;
    expect(mode.hourlyBps + mode.bufferContributionBps + mode.dailyBps + mode.platformBps).toBe(
      BASIS_POINTS_PER_WHOLE,
    );
    expect(mode).toEqual({
      hourlyBps: 6_300n,
      bufferContributionBps: 0n,
      dailyBps: 2_700n,
      platformBps: 1_000n,
    });
  });

  it('totals Buffer Accumulation Mode to exactly 100% in basis points', () => {
    const mode = competitionConfig.creatorFees.bufferAccumulation;
    expect(mode.hourlyBps + mode.bufferContributionBps + mode.dailyBps + mode.platformBps).toBe(
      BASIS_POINTS_PER_WHOLE,
    );
    expect(mode).toEqual({
      hourlyBps: 5_800n,
      bufferContributionBps: 500n,
      dailyBps: 2_700n,
      platformBps: 1_000n,
    });
  });

  it('rejects an allocation mode that does not total exactly 100%', () => {
    expect(() =>
      validateCompetitionConfig({
        ...competitionConfig,
        creatorFees: {
          ...competitionConfig.creatorFees,
          normal: {
            ...competitionConfig.creatorFees.normal,
            hourlyBps: basisPoints(6_200n),
          },
        },
      }),
    ).toThrow(/exactly 100%/);
  });

  it('requires the explicit buffer contribution to come out of hourly allocation', () => {
    expect(() =>
      validateCompetitionConfig({
        ...competitionConfig,
        creatorFees: {
          ...competitionConfig.creatorFees,
          bufferAccumulation: {
            ...competitionConfig.creatorFees.bufferAccumulation,
            hourlyBps: 5_700n,
            platformBps: 1_100n,
          },
        },
      }),
    ).toThrow(/deducted from the hourly allocation/);
  });
});

describe('payout curves', () => {
  it('has exactly 10 sequential hourly ranks totaling 100.00%', () => {
    expect(competitionConfig.hourlyPayoutCurve).toHaveLength(10);
    expect(competitionConfig.hourlyPayoutCurve.map(({ rank }) => rank)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    expect(
      competitionConfig.hourlyPayoutCurve.reduce((total, { sharePpm }) => total + sharePpm, 0n),
    ).toBe(PARTS_PER_MILLION_PER_WHOLE);
  });

  it('has exactly 25 sequential daily ranks totaling 100.000%', () => {
    expect(competitionConfig.dailyPayoutCurve).toHaveLength(25);
    expect(competitionConfig.dailyPayoutCurve.map(({ rank }) => rank)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    expect(
      competitionConfig.dailyPayoutCurve.reduce((total, { sharePpm }) => total + sharePpm, 0n),
    ).toBe(PARTS_PER_MILLION_PER_WHOLE);
  });

  it('rejects duplicate or non-sequential ranks', () => {
    const invalid = competitionConfig.hourlyPayoutCurve.map((entry) => ({ ...entry }));
    invalid[1] = { ...invalid[1]!, rank: 1 };
    expect(() => validatePayoutCurve(invalid, 10)).toThrow(/duplicate/);
  });

  it('rejects a curve whose winner count or exact total is wrong', () => {
    expect(() => validatePayoutCurve(competitionConfig.hourlyPayoutCurve, 9)).toThrow(/expected 9/);
    const invalid = competitionConfig.hourlyPayoutCurve.map((entry) => ({ ...entry }));
    invalid[9] = { ...invalid[9]!, sharePpm: partsPerMillion(23_099n) };
    expect(() => validatePayoutCurve(invalid, 10)).toThrow(/exactly 100%/);
  });
});
