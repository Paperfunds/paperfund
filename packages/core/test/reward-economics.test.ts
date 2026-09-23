import { describe, expect, it } from 'vitest';

import {
  accumulateDailyPrizePool,
  allocateCreatorFees,
  applyRewardBufferMovement,
  basisPoints,
  calculateDynamicHourlyReward,
  calculateHourlyRewardBaseline,
  competitionConfig,
  identifier,
  isCreatorFeeAllocationConserved,
  isHourlyRewardEconomicsConserved,
  lamports,
  processHourlyRewardEconomics,
  utcInstant,
  validateCompetitionConfig,
  type CompletedNaturalHourlyReward,
  type DailyCompetitionId,
  type HourlyRoundId,
  type Lamports,
} from '../src/index.js';

const SOL = 1_000_000_000n;
const dailyId = identifier('daily-2026-09-23', 'DailyCompetitionId') as DailyCompetitionId;

function history(values: readonly bigint[]): readonly CompletedNaturalHourlyReward[] {
  return values.map((value, index) => {
    const start = Date.UTC(2026, 8, 22, index);
    return {
      hourlyRoundId: identifier(`hour-${index.toString()}`, 'HourlyRoundId') as HourlyRoundId,
      startsAt: utcInstant(start),
      endsAtExclusive: utcInstant(start + 3_600_000),
      naturalHourlyLamports: lamports(value),
    };
  });
}

function activeBaseline(value: bigint) {
  return calculateHourlyRewardBaseline({
    history: history(Array(12).fill(value)),
    windowCompletedHours: 12,
  });
}

describe('creator-fee allocation', () => {
  it('splits 100 SOL exactly in NORMAL mode', () => {
    const result = allocateCreatorFees({
      creatorFeeLamports: 100n * SOL,
      mode: 'NORMAL',
      config: competitionConfig,
    });
    expect(result).toMatchObject({
      ok: true,
      allocation: {
        currentHourly: 63n * SOL,
        daily: 27n * SOL,
        rewardBuffer: 0n,
        platform: 10n * SOL,
      },
    });
    expect(result.ok && isCreatorFeeAllocationConserved(result.allocation)).toBe(true);
  });

  it('splits 100 SOL exactly in BUFFER_ACCUMULATION mode', () => {
    const result = allocateCreatorFees({
      creatorFeeLamports: 100n * SOL,
      mode: 'BUFFER_ACCUMULATION',
      config: competitionConfig,
    });
    expect(result).toMatchObject({
      ok: true,
      allocation: {
        currentHourly: 58n * SOL,
        rewardBuffer: 5n * SOL,
        daily: 27n * SOL,
        platform: 10n * SOL,
      },
    });
    expect(result.ok && isCreatorFeeAllocationConserved(result.allocation)).toBe(true);
  });

  it.each([0n, 1n, 2n, 7n, 101n, 9_999_999_999_999_999_999_999n])(
    'conserves an indivisible or large input of %s lamports',
    (amount) => {
      for (const mode of ['NORMAL', 'BUFFER_ACCUMULATION'] as const) {
        const result = allocateCreatorFees({
          creatorFeeLamports: amount,
          mode,
          config: competitionConfig,
        });
        expect(result.ok && isCreatorFeeAllocationConserved(result.allocation)).toBe(true);
      }
    },
  );

  it('uses largest remainder and canonical hourly-first tie priority', () => {
    const one = allocateCreatorFees({
      creatorFeeLamports: 1n,
      mode: 'NORMAL',
      config: competitionConfig,
    });
    expect(one).toMatchObject({ ok: true, allocation: { currentHourly: 1n, daily: 0n } });

    const equalQuarterConfig = validateCompetitionConfig({
      ...competitionConfig,
      creatorFees: {
        normal: {
          hourlyBps: 2_500n,
          dailyBps: 2_500n,
          bufferContributionBps: 0n,
          platformBps: 5_000n,
        },
        bufferAccumulation: {
          hourlyBps: 2_000n,
          dailyBps: 2_500n,
          bufferContributionBps: 500n,
          platformBps: 5_000n,
        },
      },
    });
    const tied = allocateCreatorFees({
      creatorFeeLamports: 2n,
      mode: 'NORMAL',
      config: equalQuarterConfig,
    });
    expect(tied).toMatchObject({
      ok: true,
      allocation: { currentHourly: 1n, daily: 0n, platform: 1n },
    });
  });

  it('rejects negative fees and unknown modes with stable codes', () => {
    expect(
      allocateCreatorFees({ creatorFeeLamports: -1n, mode: 'NORMAL', config: competitionConfig }),
    ).toEqual({ ok: false, reason: 'INVALID_CREATOR_FEE_AMOUNT' });
    expect(
      allocateCreatorFees({ creatorFeeLamports: 1n, mode: 'OTHER', config: competitionConfig }),
    ).toEqual({ ok: false, reason: 'INVALID_REWARD_ALLOCATION_MODE' });
  });
});

describe('baseline calculation', () => {
  it.each([0, 11])('reports %s prior hours as insufficient', (count) => {
    expect(
      calculateHourlyRewardBaseline({
        history: history(Array(count).fill(1n)),
        windowCompletedHours: 12,
      }),
    ).toMatchObject({
      ok: true,
      status: 'INSUFFICIENT_HISTORY',
      reason: 'INSUFFICIENT_BASELINE_HISTORY',
      availableHours: count,
    });
  });

  it('activates at 12 and floors the exact arithmetic mean', () => {
    const result = calculateHourlyRewardBaseline({
      history: history([1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 2n]),
      windowCompletedHours: 12,
    });
    expect(result).toMatchObject({ ok: true, status: 'ACTIVE', baselineLamports: 1n });
  });

  it('uses only the most recent 12 and ignores input order', () => {
    const records = history([1_000n, ...Array<bigint>(12).fill(24n)]);
    const ordered = calculateHourlyRewardBaseline({ history: records, windowCompletedHours: 12 });
    const unordered = calculateHourlyRewardBaseline({
      history: [...records].reverse(),
      windowCompletedHours: 12,
    });
    expect(ordered).toEqual(unordered);
    expect(ordered).toMatchObject({ ok: true, status: 'ACTIVE', baselineLamports: 24n });
  });

  it('rejects duplicate round identity or authoritative start time without mutation', () => {
    const records = history([1n, 2n]);
    const duplicateId = [
      { ...records[0]! },
      { ...records[1]!, hourlyRoundId: records[0]!.hourlyRoundId },
    ];
    const duplicateTime = [{ ...records[0]! }, { ...records[1]!, startsAt: records[0]!.startsAt }];
    const snapshot = [...records];
    expect(
      calculateHourlyRewardBaseline({ history: duplicateId, windowCompletedHours: 1 }),
    ).toEqual({
      ok: false,
      reason: 'DUPLICATE_BASELINE_HOUR',
    });
    expect(
      calculateHourlyRewardBaseline({ history: duplicateTime, windowCompletedHours: 1 }),
    ).toEqual({
      ok: false,
      reason: 'DUPLICATE_BASELINE_HOUR',
    });
    expect(records).toEqual(snapshot);
  });

  it('handles huge bigint values exactly', () => {
    const huge = 10n ** 40n;
    expect(
      calculateHourlyRewardBaseline({
        history: history(Array(12).fill(huge)),
        windowCompletedHours: 12,
      }),
    ).toMatchObject({ ok: true, baselineLamports: huge });
  });
});

describe('dynamic hourly curve and Reward Buffer', () => {
  it('withholds 4.8 SOL from an 18 SOL strong hour against a 6 SOL baseline', () => {
    const result = calculateDynamicHourlyReward({
      naturalHourlyLamports: lamports(18n * SOL),
      availableBufferLamports: lamports(0n),
      baseline: activeBaseline(6n * SOL),
      dynamicCurveEnabled: true,
      lambdaBps: basisPoints(6_000n),
    });
    expect(result).toMatchObject({
      ok: true,
      reward: {
        targetLamports: 13_200_000_000n,
        actualHourlyPrizeLamports: 13_200_000_000n,
        dynamicDepositLamports: 4_800_000_000n,
      },
    });
  });

  it('fully supports a weak hour when funded and caps support when underfunded', () => {
    const common = {
      naturalHourlyLamports: lamports(2n * SOL),
      baseline: activeBaseline(6n * SOL),
      dynamicCurveEnabled: true,
      lambdaBps: basisPoints(6_000n),
    } as const;
    expect(
      calculateDynamicHourlyReward({ ...common, availableBufferLamports: lamports(2n * SOL) }),
    ).toMatchObject({
      ok: true,
      reward: {
        actualHourlyPrizeLamports: 3_600_000_000n,
        dynamicWithdrawalLamports: 1_600_000_000n,
      },
    });
    expect(
      calculateDynamicHourlyReward({ ...common, availableBufferLamports: lamports(400_000_000n) }),
    ).toMatchObject({
      ok: true,
      reward: {
        actualHourlyPrizeLamports: 2_400_000_000n,
        dynamicWithdrawalLamports: 400_000_000n,
      },
    });
  });

  it('handles equal, disabled, insufficient, zero, alternate lambda, and lamport flooring', () => {
    const baseline = activeBaseline(6n);
    expect(
      calculateDynamicHourlyReward({
        naturalHourlyLamports: lamports(6n),
        availableBufferLamports: lamports(9n),
        baseline,
        dynamicCurveEnabled: true,
        lambdaBps: basisPoints(6_000n),
      }),
    ).toMatchObject({ ok: true, reward: { targetLamports: 6n, dynamicDepositLamports: 0n } });
    expect(
      calculateDynamicHourlyReward({
        naturalHourlyLamports: lamports(18n),
        availableBufferLamports: lamports(0n),
        baseline,
        dynamicCurveEnabled: false,
        lambdaBps: basisPoints(6_000n),
      }),
    ).toMatchObject({
      ok: true,
      reward: { dynamicApplied: false, actualHourlyPrizeLamports: 18n },
    });
    const insufficient = calculateHourlyRewardBaseline({ history: [], windowCompletedHours: 12 });
    expect(
      calculateDynamicHourlyReward({
        naturalHourlyLamports: lamports(7n),
        availableBufferLamports: lamports(1n),
        baseline: insufficient,
        dynamicCurveEnabled: true,
        lambdaBps: basisPoints(6_000n),
      }),
    ).toMatchObject({
      ok: true,
      reward: {
        dynamicApplied: false,
        reason: 'INSUFFICIENT_BASELINE_HISTORY',
        actualHourlyPrizeLamports: 7n,
      },
    });
    expect(
      calculateDynamicHourlyReward({
        naturalHourlyLamports: lamports(0n),
        availableBufferLamports: lamports(0n),
        baseline: activeBaseline(0n),
        dynamicCurveEnabled: true,
        lambdaBps: basisPoints(2_500n),
      }),
    ).toMatchObject({ ok: true, reward: { targetLamports: 0n, actualHourlyPrizeLamports: 0n } });
    expect(
      calculateDynamicHourlyReward({
        naturalHourlyLamports: lamports(2n),
        availableBufferLamports: lamports(0n),
        baseline: activeBaseline(1n),
        dynamicCurveEnabled: true,
        lambdaBps: basisPoints(5_000n),
      }),
    ).toMatchObject({ ok: true, reward: { targetLamports: 1n, dynamicDepositLamports: 1n } });
  });

  it('rejects invalid buffer movements and never creates debt', () => {
    expect(
      applyRewardBufferMovement({
        previousBalance: 1n,
        explicitContribution: 2n,
        dynamicDeposit: 3n,
        dynamicWithdrawal: 7n,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_REWARD_BUFFER_BALANCE' });
  });
});

describe('hourly economic processing and conservation', () => {
  it('combines explicit and dynamic deposits in deterministic order', () => {
    const result = processHourlyRewardEconomics({
      creatorFeeLamports: 1_000n,
      mode: 'BUFFER_ACCUMULATION',
      currentBufferLamports: 10n,
      previousCompletedNaturalHourlyRewards: history(Array(12).fill(100n)),
      config: competitionConfig,
    });
    expect(result).toMatchObject({
      ok: true,
      economics: {
        naturalHourlyLamports: 580n,
        explicitBufferLamports: 50n,
        dynamicDepositLamports: 192n,
        startingBufferLamports: 10n,
        endingBufferLamports: 252n,
      },
    });
    expect(result.ok && isHourlyRewardEconomicsConserved(result.economics)).toBe(true);
  });

  it('makes explicit contribution available before same-hour weak support', () => {
    const result = processHourlyRewardEconomics({
      creatorFeeLamports: 1_000n,
      mode: 'BUFFER_ACCUMULATION',
      currentBufferLamports: 0n,
      previousCompletedNaturalHourlyRewards: history(Array(12).fill(1_000n)),
      config: competitionConfig,
    });
    expect(result).toMatchObject({
      ok: true,
      economics: {
        explicitBufferLamports: 50n,
        dynamicWithdrawalLamports: 50n,
        endingBufferLamports: 0n,
        actualHourlyPrizeLamports: 630n,
      },
    });
    expect(result.ok && isHourlyRewardEconomicsConserved(result.economics)).toBe(true);
  });

  it.each(['NORMAL', 'BUFFER_ACCUMULATION'] as const)(
    'conserves creator fees plus buffer in %s mode across representative values',
    (mode) => {
      for (const creatorFeeLamports of [0n, 1n, 101n, 10_000n, 10n ** 30n]) {
        const result = processHourlyRewardEconomics({
          creatorFeeLamports,
          mode,
          currentBufferLamports: 777n,
          previousCompletedNaturalHourlyRewards: history(Array(12).fill(5_000n)),
          config: competitionConfig,
        });
        expect(result.ok && isHourlyRewardEconomicsConserved(result.economics)).toBe(true);
      }
    },
  );

  it('does not smooth an incomplete baseline but still accumulates explicitly', () => {
    const result = processHourlyRewardEconomics({
      creatorFeeLamports: 1_000n,
      mode: 'BUFFER_ACCUMULATION',
      currentBufferLamports: 4n,
      previousCompletedNaturalHourlyRewards: history(Array(11).fill(100n)),
      config: competitionConfig,
    });
    expect(result).toMatchObject({
      ok: true,
      economics: {
        dynamicApplied: false,
        dynamicReason: 'INSUFFICIENT_BASELINE_HISTORY',
        actualHourlyPrizeLamports: 580n,
        endingBufferLamports: 54n,
      },
    });
  });
});

describe('daily prize accounting', () => {
  const contribution = (round: string, amount: bigint, day = dailyId) => ({
    dailyCompetitionId: day,
    hourlyRoundId: identifier(round, 'HourlyRoundId') as HourlyRoundId,
    amountLamports: amount as Lamports,
  });

  it('sums exact contributions independent of input order, including huge values', () => {
    const values = [contribution('b', 2n), contribution('a', 10n ** 35n), contribution('c', 3n)];
    const forward = accumulateDailyPrizePool({
      dailyCompetitionId: dailyId,
      contributions: values,
    });
    const reverse = accumulateDailyPrizePool({
      dailyCompetitionId: dailyId,
      contributions: [...values].reverse(),
    });
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({ ok: true, totalLamports: 10n ** 35n + 5n });
  });

  it('rejects negative, duplicate, and wrong-day contributions', () => {
    expect(
      accumulateDailyPrizePool({
        dailyCompetitionId: dailyId,
        contributions: [contribution('a', -1n)],
      }),
    ).toEqual({ ok: false, reason: 'INVALID_DAILY_PRIZE_CONTRIBUTION' });
    expect(
      accumulateDailyPrizePool({
        dailyCompetitionId: dailyId,
        contributions: [contribution('a', 1n), contribution('a', 2n)],
      }),
    ).toEqual({ ok: false, reason: 'DUPLICATE_DAILY_PRIZE_CONTRIBUTION' });
    expect(
      accumulateDailyPrizePool({
        dailyCompetitionId: dailyId,
        contributions: [
          contribution(
            'a',
            1n,
            identifier('other-day', 'DailyCompetitionId') as DailyCompetitionId,
          ),
        ],
      }),
    ).toEqual({ ok: false, reason: 'DAILY_PRIZE_CONTRIBUTION_DAY_MISMATCH' });
  });
});
