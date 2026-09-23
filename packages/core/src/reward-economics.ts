import type { CompetitionConfig } from './configuration.js';
import type { DailyCompetitionId, HourlyRoundId } from './identifiers.js';
import { lamports, type Lamports } from './money.js';
import { BASIS_POINTS_PER_WHOLE, type BasisPoints } from './percentages.js';
import type { CreatorFeeAllocation, CreatorFeeAllocationMode } from './types.js';
import type { UtcInstant } from './time.js';

export type CreatorFeeAllocationFailure =
  | { readonly ok: false; readonly reason: 'INVALID_CREATOR_FEE_AMOUNT' }
  | { readonly ok: false; readonly reason: 'INVALID_REWARD_ALLOCATION_MODE' };

export type CreatorFeeAllocationResult =
  { readonly ok: true; readonly allocation: CreatorFeeAllocation } | CreatorFeeAllocationFailure;

type AllocationBucket = 'hourly' | 'daily' | 'rewardBuffer' | 'platform';

const BUCKET_PRIORITY: readonly AllocationBucket[] = [
  'hourly',
  'daily',
  'rewardBuffer',
  'platform',
];

function allocationRates(
  mode: string,
  config: CompetitionConfig,
):
  | {
      readonly mode: CreatorFeeAllocationMode;
      readonly hourly: BasisPoints;
      readonly daily: BasisPoints;
      readonly rewardBuffer: BasisPoints;
      readonly platform: BasisPoints;
    }
  | undefined {
  const configured =
    mode === 'NORMAL'
      ? config.creatorFees.normal
      : mode === 'BUFFER_ACCUMULATION'
        ? config.creatorFees.bufferAccumulation
        : undefined;
  if (!configured) return undefined;
  return {
    mode: mode as CreatorFeeAllocationMode,
    hourly: configured.hourlyBps,
    daily: configured.dailyBps,
    rewardBuffer: configured.bufferContributionBps,
    platform: configured.platformBps,
  };
}

export function allocateCreatorFees(input: {
  readonly creatorFeeLamports: bigint;
  readonly mode: CreatorFeeAllocationMode | string;
  readonly config: CompetitionConfig;
}): CreatorFeeAllocationResult {
  if (input.creatorFeeLamports < 0n) {
    return { ok: false, reason: 'INVALID_CREATOR_FEE_AMOUNT' };
  }
  const rates = allocationRates(input.mode, input.config);
  if (!rates) return { ok: false, reason: 'INVALID_REWARD_ALLOCATION_MODE' };

  const weights: Readonly<Record<AllocationBucket, BasisPoints>> = {
    hourly: rates.hourly,
    daily: rates.daily,
    rewardBuffer: rates.rewardBuffer,
    platform: rates.platform,
  };
  const floors: Record<AllocationBucket, bigint> = {
    hourly: 0n,
    daily: 0n,
    rewardBuffer: 0n,
    platform: 0n,
  };
  const remainders: Record<AllocationBucket, bigint> = { ...floors };

  for (const bucket of BUCKET_PRIORITY) {
    const numerator = input.creatorFeeLamports * weights[bucket];
    floors[bucket] = numerator / BASIS_POINTS_PER_WHOLE;
    remainders[bucket] = numerator % BASIS_POINTS_PER_WHOLE;
  }

  const floorTotal = BUCKET_PRIORITY.reduce((total, bucket) => total + floors[bucket], 0n);
  const dust = input.creatorFeeLamports - floorTotal;
  const rankedBuckets = [...BUCKET_PRIORITY].sort((left, right) => {
    if (remainders[left] > remainders[right]) return -1;
    if (remainders[left] < remainders[right]) return 1;
    return BUCKET_PRIORITY.indexOf(left) - BUCKET_PRIORITY.indexOf(right);
  });
  let remainingDust = dust;
  for (const bucket of rankedBuckets) {
    if (remainingDust === 0n) break;
    floors[bucket] += 1n;
    remainingDust -= 1n;
  }

  return {
    ok: true,
    allocation: {
      mode: rates.mode,
      total: lamports(input.creatorFeeLamports),
      currentHourly: lamports(floors.hourly),
      daily: lamports(floors.daily),
      platform: lamports(floors.platform),
      rewardBuffer: lamports(floors.rewardBuffer),
      hourlyRateBps: rates.hourly,
      dailyRateBps: rates.daily,
      platformRateBps: rates.platform,
      rewardBufferRateBps: rates.rewardBuffer,
    },
  };
}

export function isCreatorFeeAllocationConserved(allocation: CreatorFeeAllocation): boolean {
  return (
    allocation.currentHourly + allocation.daily + allocation.platform + allocation.rewardBuffer ===
    allocation.total
  );
}

export interface RewardBufferMovement {
  readonly previousBalance: Lamports;
  readonly explicitContribution: Lamports;
  readonly dynamicDeposit: Lamports;
  readonly dynamicWithdrawal: Lamports;
  readonly nextBalance: Lamports;
}

export type RewardBufferMovementResult =
  | { readonly ok: true; readonly movement: RewardBufferMovement }
  | { readonly ok: false; readonly reason: 'INVALID_REWARD_BUFFER_BALANCE' };

export function applyRewardBufferMovement(input: {
  readonly previousBalance: bigint;
  readonly explicitContribution: bigint;
  readonly dynamicDeposit: bigint;
  readonly dynamicWithdrawal: bigint;
}): RewardBufferMovementResult {
  if (
    input.previousBalance < 0n ||
    input.explicitContribution < 0n ||
    input.dynamicDeposit < 0n ||
    input.dynamicWithdrawal < 0n
  ) {
    return { ok: false, reason: 'INVALID_REWARD_BUFFER_BALANCE' };
  }
  const available = input.previousBalance + input.explicitContribution + input.dynamicDeposit;
  if (input.dynamicWithdrawal > available) {
    return { ok: false, reason: 'INVALID_REWARD_BUFFER_BALANCE' };
  }
  return {
    ok: true,
    movement: {
      previousBalance: lamports(input.previousBalance),
      explicitContribution: lamports(input.explicitContribution),
      dynamicDeposit: lamports(input.dynamicDeposit),
      dynamicWithdrawal: lamports(input.dynamicWithdrawal),
      nextBalance: lamports(available - input.dynamicWithdrawal),
    },
  };
}

export interface CompletedNaturalHourlyReward {
  readonly hourlyRoundId: HourlyRoundId;
  readonly startsAt: UtcInstant;
  readonly endsAtExclusive: UtcInstant;
  readonly naturalHourlyLamports: Lamports;
}

export type HourlyRewardBaselineResult =
  | {
      readonly ok: true;
      readonly status: 'ACTIVE';
      readonly requiredHours: number;
      readonly availableHours: number;
      readonly includedHourlyRoundIds: readonly HourlyRoundId[];
      readonly baselineLamports: Lamports;
    }
  | {
      readonly ok: true;
      readonly status: 'INSUFFICIENT_HISTORY';
      readonly reason: 'INSUFFICIENT_BASELINE_HISTORY';
      readonly requiredHours: number;
      readonly availableHours: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'DUPLICATE_BASELINE_HOUR' | 'INVALID_BASELINE_HISTORY';
    };

export function calculateHourlyRewardBaseline(input: {
  readonly history: readonly CompletedNaturalHourlyReward[];
  readonly windowCompletedHours: number;
}): HourlyRewardBaselineResult {
  if (!Number.isInteger(input.windowCompletedHours) || input.windowCompletedHours <= 0) {
    return { ok: false, reason: 'INVALID_BASELINE_HISTORY' };
  }
  const roundIds = new Set<string>();
  const startTimestamps = new Set<string>();
  const endTimestamps = new Set<string>();
  for (const record of input.history) {
    const duplicate =
      roundIds.has(record.hourlyRoundId) ||
      startTimestamps.has(record.startsAt) ||
      endTimestamps.has(record.endsAtExclusive);
    if (
      record.naturalHourlyLamports < 0n ||
      record.startsAt >= record.endsAtExclusive ||
      duplicate
    ) {
      return {
        ok: false,
        reason: duplicate ? 'DUPLICATE_BASELINE_HOUR' : 'INVALID_BASELINE_HISTORY',
      };
    }
    roundIds.add(record.hourlyRoundId);
    startTimestamps.add(record.startsAt);
    endTimestamps.add(record.endsAtExclusive);
  }
  if (input.history.length < input.windowCompletedHours) {
    return {
      ok: true,
      status: 'INSUFFICIENT_HISTORY',
      reason: 'INSUFFICIENT_BASELINE_HISTORY',
      requiredHours: input.windowCompletedHours,
      availableHours: input.history.length,
    };
  }
  const selected = [...input.history]
    .sort((left, right) =>
      left.startsAt < right.startsAt ? -1 : left.startsAt > right.startsAt ? 1 : 0,
    )
    .slice(-input.windowCompletedHours);
  const sum = selected.reduce<bigint>((total, record) => total + record.naturalHourlyLamports, 0n);
  return {
    ok: true,
    status: 'ACTIVE',
    requiredHours: input.windowCompletedHours,
    availableHours: input.history.length,
    includedHourlyRoundIds: selected.map(({ hourlyRoundId }) => hourlyRoundId),
    baselineLamports: lamports(sum / BigInt(input.windowCompletedHours)),
  };
}

export interface DynamicHourlyRewardResult {
  readonly dynamicApplied: boolean;
  readonly reason: 'DYNAMIC_CURVE_DISABLED' | 'INSUFFICIENT_BASELINE_HISTORY' | null;
  readonly lambdaBps: BasisPoints;
  readonly targetLamports: Lamports;
  readonly actualHourlyPrizeLamports: Lamports;
  readonly dynamicDepositLamports: Lamports;
  readonly dynamicWithdrawalLamports: Lamports;
}

export function calculateDynamicHourlyReward(input: {
  readonly naturalHourlyLamports: Lamports;
  readonly availableBufferLamports: Lamports;
  readonly baseline: HourlyRewardBaselineResult;
  readonly dynamicCurveEnabled: boolean;
  readonly lambdaBps: BasisPoints;
}):
  | { readonly ok: true; readonly reward: DynamicHourlyRewardResult }
  | { readonly ok: false; readonly reason: 'INVALID_BASELINE_HISTORY' } {
  if (!input.baseline.ok) return { ok: false, reason: 'INVALID_BASELINE_HISTORY' };
  if (!input.dynamicCurveEnabled || input.baseline.status === 'INSUFFICIENT_HISTORY') {
    return {
      ok: true,
      reward: {
        dynamicApplied: false,
        reason: input.dynamicCurveEnabled
          ? 'INSUFFICIENT_BASELINE_HISTORY'
          : 'DYNAMIC_CURVE_DISABLED',
        lambdaBps: input.lambdaBps,
        targetLamports: input.naturalHourlyLamports,
        actualHourlyPrizeLamports: input.naturalHourlyLamports,
        dynamicDepositLamports: lamports(0n),
        dynamicWithdrawalLamports: lamports(0n),
      },
    };
  }

  const target =
    ((BASIS_POINTS_PER_WHOLE - input.lambdaBps) * input.baseline.baselineLamports +
      input.lambdaBps * input.naturalHourlyLamports) /
    BASIS_POINTS_PER_WHOLE;
  const deposit = input.naturalHourlyLamports > target ? input.naturalHourlyLamports - target : 0n;
  const requestedSupport =
    target > input.naturalHourlyLamports ? target - input.naturalHourlyLamports : 0n;
  const withdrawal =
    requestedSupport < input.availableBufferLamports
      ? requestedSupport
      : input.availableBufferLamports;
  return {
    ok: true,
    reward: {
      dynamicApplied: true,
      reason: null,
      lambdaBps: input.lambdaBps,
      targetLamports: lamports(target),
      actualHourlyPrizeLamports: lamports(input.naturalHourlyLamports - deposit + withdrawal),
      dynamicDepositLamports: lamports(deposit),
      dynamicWithdrawalLamports: lamports(withdrawal),
    },
  };
}

export interface HourlyRewardEconomics {
  readonly creatorFeeTotalLamports: Lamports;
  readonly allocationMode: CreatorFeeAllocationMode;
  readonly naturalHourlyLamports: Lamports;
  readonly explicitBufferLamports: Lamports;
  readonly baseline: HourlyRewardBaselineResult;
  readonly lambdaBps: BasisPoints;
  readonly dynamicTargetLamports: Lamports;
  readonly dynamicApplied: boolean;
  readonly dynamicReason: DynamicHourlyRewardResult['reason'];
  readonly dynamicDepositLamports: Lamports;
  readonly dynamicWithdrawalLamports: Lamports;
  readonly actualHourlyPrizeLamports: Lamports;
  readonly dailyContributionLamports: Lamports;
  readonly platformContributionLamports: Lamports;
  readonly startingBufferLamports: Lamports;
  readonly endingBufferLamports: Lamports;
  readonly bufferMovement: RewardBufferMovement;
}

export type HourlyRewardEconomicsResult =
  | { readonly ok: true; readonly economics: HourlyRewardEconomics }
  | CreatorFeeAllocationFailure
  | {
      readonly ok: false;
      readonly reason:
        'INVALID_REWARD_BUFFER_BALANCE' | 'DUPLICATE_BASELINE_HOUR' | 'INVALID_BASELINE_HISTORY';
    };

export function processHourlyRewardEconomics(input: {
  readonly creatorFeeLamports: bigint;
  readonly mode: CreatorFeeAllocationMode | string;
  readonly currentBufferLamports: bigint;
  readonly previousCompletedNaturalHourlyRewards: readonly CompletedNaturalHourlyReward[];
  readonly config: CompetitionConfig;
}): HourlyRewardEconomicsResult {
  if (input.currentBufferLamports < 0n) {
    return { ok: false, reason: 'INVALID_REWARD_BUFFER_BALANCE' };
  }
  const split = allocateCreatorFees({
    creatorFeeLamports: input.creatorFeeLamports,
    mode: input.mode,
    config: input.config,
  });
  if (!split.ok) return split;
  const baseline = calculateHourlyRewardBaseline({
    history: input.previousCompletedNaturalHourlyRewards,
    windowCompletedHours: input.config.rewardBuffer.baselineWindowCompletedHours,
  });
  if (!baseline.ok) return baseline;

  const availableAfterExplicit = lamports(
    input.currentBufferLamports + split.allocation.rewardBuffer,
  );
  const dynamic = calculateDynamicHourlyReward({
    naturalHourlyLamports: split.allocation.currentHourly,
    availableBufferLamports: availableAfterExplicit,
    baseline,
    dynamicCurveEnabled: input.config.rewardBuffer.dynamicCurveEnabled,
    lambdaBps: input.config.rewardBuffer.lambdaBps,
  });
  if (!dynamic.ok) return dynamic;
  const buffer = applyRewardBufferMovement({
    previousBalance: input.currentBufferLamports,
    explicitContribution: split.allocation.rewardBuffer,
    dynamicDeposit: dynamic.reward.dynamicDepositLamports,
    dynamicWithdrawal: dynamic.reward.dynamicWithdrawalLamports,
  });
  if (!buffer.ok) return buffer;

  return {
    ok: true,
    economics: {
      creatorFeeTotalLamports: split.allocation.total,
      allocationMode: split.allocation.mode,
      naturalHourlyLamports: split.allocation.currentHourly,
      explicitBufferLamports: split.allocation.rewardBuffer,
      baseline,
      lambdaBps: dynamic.reward.lambdaBps,
      dynamicTargetLamports: dynamic.reward.targetLamports,
      dynamicApplied: dynamic.reward.dynamicApplied,
      dynamicReason: dynamic.reward.reason,
      dynamicDepositLamports: dynamic.reward.dynamicDepositLamports,
      dynamicWithdrawalLamports: dynamic.reward.dynamicWithdrawalLamports,
      actualHourlyPrizeLamports: dynamic.reward.actualHourlyPrizeLamports,
      dailyContributionLamports: split.allocation.daily,
      platformContributionLamports: split.allocation.platform,
      startingBufferLamports: lamports(input.currentBufferLamports),
      endingBufferLamports: buffer.movement.nextBalance,
      bufferMovement: buffer.movement,
    },
  };
}

export function isHourlyRewardEconomicsConserved(economics: HourlyRewardEconomics): boolean {
  return (
    economics.creatorFeeTotalLamports + economics.startingBufferLamports ===
    economics.actualHourlyPrizeLamports +
      economics.dailyContributionLamports +
      economics.platformContributionLamports +
      economics.endingBufferLamports
  );
}

export interface DailyPrizeContribution {
  readonly dailyCompetitionId: DailyCompetitionId;
  readonly hourlyRoundId: HourlyRoundId;
  readonly amountLamports: Lamports;
}

export type DailyPrizePoolResult =
  | {
      readonly ok: true;
      readonly dailyCompetitionId: DailyCompetitionId;
      readonly totalLamports: Lamports;
      readonly hourlyRoundIds: readonly HourlyRoundId[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'INVALID_DAILY_PRIZE_CONTRIBUTION'
        | 'DUPLICATE_DAILY_PRIZE_CONTRIBUTION'
        | 'DAILY_PRIZE_CONTRIBUTION_DAY_MISMATCH';
    };

export function accumulateDailyPrizePool(input: {
  readonly dailyCompetitionId: DailyCompetitionId;
  readonly contributions: readonly DailyPrizeContribution[];
}): DailyPrizePoolResult {
  const seen = new Set<string>();
  for (const contribution of input.contributions) {
    if (contribution.amountLamports < 0n) {
      return { ok: false, reason: 'INVALID_DAILY_PRIZE_CONTRIBUTION' };
    }
    if (contribution.dailyCompetitionId !== input.dailyCompetitionId) {
      return { ok: false, reason: 'DAILY_PRIZE_CONTRIBUTION_DAY_MISMATCH' };
    }
    if (seen.has(contribution.hourlyRoundId)) {
      return { ok: false, reason: 'DUPLICATE_DAILY_PRIZE_CONTRIBUTION' };
    }
    seen.add(contribution.hourlyRoundId);
  }
  const sorted = [...input.contributions].sort((left, right) =>
    left.hourlyRoundId < right.hourlyRoundId
      ? -1
      : left.hourlyRoundId > right.hourlyRoundId
        ? 1
        : 0,
  );
  return {
    ok: true,
    dailyCompetitionId: input.dailyCompetitionId,
    totalLamports: lamports(
      sorted.reduce<bigint>((total, contribution) => total + contribution.amountLamports, 0n),
    ),
    hourlyRoundIds: sorted.map(({ hourlyRoundId }) => hourlyRoundId),
  };
}
