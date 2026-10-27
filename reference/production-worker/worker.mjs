var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// apps/worker/isolated/reward-bootstrap.ts
import fs from "node:fs";
import path from "node:path";
import { createHash as createHash25 } from "node:crypto";

// packages/protocols/src/index.ts
var src_exports = {};
__export(src_exports, {
  CUTOFF_CLOCK: () => CUTOFF_CLOCK,
  METEORA_DAMM_V2_PROGRAM: () => METEORA_DAMM_V2_PROGRAM,
  PUMP_AMM_PROGRAM_ID: () => PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID: () => PUMP_FEE_PROGRAM_ID,
  PUMP_FUN_ADAPTER_VERSION: () => PUMP_FUN_ADAPTER_VERSION,
  PUMP_FUN_NORMALIZATION_VERSION: () => PUMP_FUN_NORMALIZATION_VERSION,
  PUMP_FUN_PROTOCOL_ID: () => PUMP_FUN_PROTOCOL_ID,
  PUMP_PROGRAM_ID: () => PUMP_PROGRAM_ID,
  PUMP_SWAP_ADAPTER_VERSION: () => PUMP_SWAP_ADAPTER_VERSION,
  PUMP_SWAP_NORMALIZATION_VERSION: () => PUMP_SWAP_NORMALIZATION_VERSION,
  PUMP_SWAP_PROTOCOL_ID: () => PUMP_SWAP_PROTOCOL_ID,
  PublicMarketCandidates: () => PublicMarketCandidates,
  PumpFunProtocolAdapter: () => PumpFunProtocolAdapter,
  PumpFunSolanaMarketStateSource: () => PumpFunSolanaMarketStateSource,
  PumpMigrationResolver: () => PumpMigrationResolver,
  PumpSwapProtocolAdapter: () => PumpSwapProtocolAdapter,
  PumpSwapSolanaMarketStateSource: () => PumpSwapSolanaMarketStateSource,
  RAYDIUM_CPMM_PROGRAM: () => RAYDIUM_CPMM_PROGRAM,
  RAYDIUM_LAUNCHLAB_PROGRAM: () => RAYDIUM_LAUNCHLAB_PROGRAM,
  REFERENCE_ADAPTER_VERSION: () => REFERENCE_ADAPTER_VERSION,
  REFERENCE_PROTOCOL_ID: () => REFERENCE_PROTOCOL_ID,
  ReferenceProtocolAdapter: () => ReferenceProtocolAdapter,
  SOLANA_ROUTE_PROTOCOL_ID: () => SOLANA_ROUTE_PROTOCOL_ID,
  SPL_TOKEN_PROGRAM_ID: () => SPL_TOKEN_PROGRAM_ID,
  SolanaRouteAdapter: () => SolanaRouteAdapter,
  SolanaRouteSource: () => SolanaRouteSource,
  SolanaRpcClient: () => SolanaRpcClient,
  TOKEN_2022_PROGRAM_ID: () => TOKEN_2022_PROGRAM_ID,
  WRAPPED_SOL_MINT: () => WRAPPED_SOL_MINT,
  advisoryReadContext: () => advisoryReadContext,
  canonicalPumpSwapPoolAddress: () => canonicalPumpSwapPoolAddress,
  captureCutoffState: () => captureCutoffState,
  chartMintSupply: () => chartMintSupply,
  createProductionExecutionRouter: () => createProductionExecutionRouter,
  cutoffBankTime: () => cutoffBankTime,
  cutoffCaptureContext: () => cutoffCaptureContext,
  cutoffHash: () => cutoffHash,
  decodePoolLink: () => decodePoolLink,
  decodePumpBondingCurve: () => decodePumpBondingCurve,
  decodePumpFeeConfig: () => decodePumpFeeConfig,
  decodePumpGlobal: () => decodePumpGlobal,
  decodePumpSwapFeeConfig: () => decodePumpSwapFeeConfig,
  decodePumpSwapGlobalConfig: () => decodePumpSwapGlobalConfig,
  decodePumpSwapPool: () => decodePumpSwapPool,
  genericActor: () => genericActor,
  installSolanaMintResolver: () => installSolanaMintResolver,
  paperSolFeeTotal: () => paperSolFeeTotal,
  pumpBondingCurveAddress: () => pumpBondingCurveAddress,
  pumpFeeConfigAddress: () => pumpFeeConfigAddress,
  pumpGlobalAddress: () => pumpGlobalAddress,
  pumpPaperSolFeeTotal: () => pumpPaperSolFeeTotal,
  pumpPoolAuthorityAddress: () => pumpPoolAuthorityAddress,
  pumpSwapFeeConfigAddress: () => pumpSwapFeeConfigAddress,
  pumpSwapGlobalConfigAddress: () => pumpSwapGlobalConfigAddress,
  pumpSwapPaperSolFeeTotal: () => pumpSwapPaperSolFeeTotal,
  pumpTokenAmount: () => pumpTokenAmount,
  quoteRecordedRoute: () => quoteRecordedRoute,
  rpcProviderIdentity: () => rpcProviderIdentity,
  simulatePumpSwapBuyAmount: () => simulatePumpSwapBuyAmount,
  simulatePumpSwapSellAmount: () => simulatePumpSwapSellAmount,
  solanaRpcClientFromEnvironment: () => solanaRpcClientFromEnvironment,
  tokenAmount: () => tokenAmount,
  validatePumpBondingCurve: () => validatePumpBondingCurve,
  verifyCutoffCapture: () => verifyCutoffCapture,
  verifyDurableQuoteCutoff: () => verifyDurableQuoteCutoff,
  withAdvisoryRead: () => withAdvisoryRead,
  withGenericAccount: () => withGenericAccount,
  withGenericActor: () => withGenericActor,
  withGenericSystemRead: () => withGenericSystemRead
});

// packages/core/src/money.ts
function assertNonNegative(value, name) {
  if (value < 0n) {
    throw new RangeError(`${name} cannot be negative.`);
  }
}
function lamports(value) {
  assertNonNegative(value, "Lamports");
  return value;
}
function paperSolBaseUnits(value) {
  assertNonNegative(value, "Paper SOL");
  return value;
}
function tokenBaseUnits(value) {
  assertNonNegative(value, "Token base units");
  return value;
}

// packages/core/src/percentages.ts
var BASIS_POINTS_PER_WHOLE = 10000n;
var PARTS_PER_MILLION_PER_WHOLE = 1000000n;
function assertRateInRange(value, scale, name) {
  if (value < 0n || value > scale) {
    throw new RangeError(`${name} must be between 0 and ${scale.toString()} inclusive.`);
  }
}
function basisPoints(value) {
  assertRateInRange(value, BASIS_POINTS_PER_WHOLE, "Basis points");
  return value;
}
function partsPerMillion(value) {
  assertRateInRange(value, PARTS_PER_MILLION_PER_WHOLE, "Parts per million");
  return value;
}

// packages/core/src/configuration.ts
import { z } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/zod/index.cjs";
var basisPointsSchema = z.bigint().min(0n).max(BASIS_POINTS_PER_WHOLE).transform(basisPoints);
var payoutShareSchema = z.bigint().min(0n).max(PARTS_PER_MILLION_PER_WHOLE).transform(partsPerMillion);
var feeAllocationSchema = z.object({
  hourlyBps: basisPointsSchema,
  bufferContributionBps: basisPointsSchema,
  dailyBps: basisPointsSchema,
  platformBps: basisPointsSchema
}).readonly();
var payoutCurveEntrySchema = z.object({
  rank: z.number().int().positive(),
  sharePpm: payoutShareSchema
}).readonly();
var payoutCurveSchema = z.array(payoutCurveEntrySchema).readonly();
function sumBasisPoints(values) {
  return values.reduce((total, value) => total + value, 0n);
}
function sumPartsPerMillion(values) {
  return values.reduce((total, value) => total + value, 0n);
}
function validatePayoutCurve(curve, expectedWinnerCount) {
  if (curve.length !== expectedWinnerCount) {
    throw new RangeError(
      `Payout curve has ${curve.length.toString()} ranks; expected ${expectedWinnerCount.toString()}.`
    );
  }
  const uniqueRanks = new Set(curve.map(({ rank }) => rank));
  if (uniqueRanks.size !== curve.length) {
    throw new RangeError("Payout curve ranks must not contain duplicates.");
  }
  curve.forEach(({ rank, sharePpm }, index2) => {
    const expectedRank = index2 + 1;
    if (rank !== expectedRank) {
      throw new RangeError(
        `Payout curve rank ${rank.toString()} is out of sequence; expected ${expectedRank.toString()}.`
      );
    }
    if (sharePpm < 0n) {
      throw new RangeError("Payout curve shares cannot be negative.");
    }
  });
  if (sumPartsPerMillion(curve.map(({ sharePpm }) => sharePpm)) !== PARTS_PER_MILLION_PER_WHOLE) {
    throw new RangeError("Payout curve must total exactly 100%.");
  }
}
var competitionConfigSchema = z.object({
  version: z.string().min(1),
  startingPaperSolBaseUnits: z.bigint().positive().transform(paperSolBaseUnits),
  hourlyRoundDurationSeconds: z.number().int().positive(),
  authoritativeTimezone: z.literal("UTC"),
  maxUniqueTokensPerRound: z.number().int().positive(),
  maxBuyRatioBps: z.bigint().min(1n).max(BASIS_POINTS_PER_WHOLE).transform(basisPoints),
  hourlyWinnerCount: z.number().int().positive(),
  dailyWinnerCount: z.number().int().positive(),
  creatorFees: z.object({
    normal: feeAllocationSchema,
    bufferAccumulation: feeAllocationSchema
  }).readonly(),
  rewardBuffer: z.object({
    dynamicCurveEnabled: z.boolean(),
    lambdaBps: basisPointsSchema,
    baselineWindowCompletedHours: z.number().int().positive(),
    explicitAccumulationEnabled: z.boolean(),
    explicitContributionBps: basisPointsSchema,
    reserveTargetLamports: z.bigint().min(0n).transform(lamports).nullable(),
    dailyBufferSupportEnabled: z.literal(false)
  }).readonly(),
  rewardFinalizationGracePeriodSeconds: z.number().int().min(0),
  hourlyPayoutCurve: payoutCurveSchema,
  dailyPayoutCurve: payoutCurveSchema
}).superRefine((config2, context) => {
  const normalTotal = sumBasisPoints([
    config2.creatorFees.normal.hourlyBps,
    config2.creatorFees.normal.bufferContributionBps,
    config2.creatorFees.normal.dailyBps,
    config2.creatorFees.normal.platformBps
  ]);
  if (normalTotal !== BASIS_POINTS_PER_WHOLE) {
    context.addIssue({
      code: "custom",
      path: ["creatorFees", "normal"],
      message: "Normal creator-fee allocation must total exactly 100%."
    });
  }
  const bufferTotal = sumBasisPoints([
    config2.creatorFees.bufferAccumulation.hourlyBps,
    config2.creatorFees.bufferAccumulation.bufferContributionBps,
    config2.creatorFees.bufferAccumulation.dailyBps,
    config2.creatorFees.bufferAccumulation.platformBps
  ]);
  if (bufferTotal !== BASIS_POINTS_PER_WHOLE) {
    context.addIssue({
      code: "custom",
      path: ["creatorFees", "bufferAccumulation"],
      message: "Buffer Accumulation creator-fee allocation must total exactly 100%."
    });
  }
  if (config2.creatorFees.normal.bufferContributionBps !== 0n) {
    context.addIssue({
      code: "custom",
      path: ["creatorFees", "normal", "bufferContributionBps"],
      message: "Normal Mode cannot make an explicit Reward Buffer contribution."
    });
  }
  if (config2.creatorFees.bufferAccumulation.bufferContributionBps !== config2.rewardBuffer.explicitContributionBps) {
    context.addIssue({
      code: "custom",
      path: ["rewardBuffer", "explicitContributionBps"],
      message: "The explicit contribution must match Buffer Accumulation Mode."
    });
  }
  if (config2.creatorFees.bufferAccumulation.hourlyBps + config2.creatorFees.bufferAccumulation.bufferContributionBps !== config2.creatorFees.normal.hourlyBps) {
    context.addIssue({
      code: "custom",
      path: ["creatorFees", "bufferAccumulation"],
      message: "The explicit buffer contribution must be deducted from the hourly allocation."
    });
  }
  for (const [path2, curve, count] of [
    ["hourlyPayoutCurve", config2.hourlyPayoutCurve, config2.hourlyWinnerCount],
    ["dailyPayoutCurve", config2.dailyPayoutCurve, config2.dailyWinnerCount]
  ]) {
    try {
      validatePayoutCurve(curve, count);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: [path2],
        message: error instanceof Error ? error.message : "Invalid payout curve."
      });
    }
  }
}).readonly();
var canonicalConfigurationInput = {
  version: "phase-1a-v1",
  startingPaperSolBaseUnits: 10000000000n,
  hourlyRoundDurationSeconds: 3600,
  authoritativeTimezone: "UTC",
  maxUniqueTokensPerRound: 5,
  maxBuyRatioBps: 2000n,
  hourlyWinnerCount: 10,
  dailyWinnerCount: 25,
  creatorFees: {
    normal: {
      hourlyBps: 6300n,
      bufferContributionBps: 0n,
      dailyBps: 2700n,
      platformBps: 1000n
    },
    bufferAccumulation: {
      hourlyBps: 5800n,
      bufferContributionBps: 500n,
      dailyBps: 2700n,
      platformBps: 1000n
    }
  },
  rewardBuffer: {
    dynamicCurveEnabled: true,
    lambdaBps: 6000n,
    baselineWindowCompletedHours: 12,
    explicitAccumulationEnabled: false,
    explicitContributionBps: 500n,
    reserveTargetLamports: null,
    dailyBufferSupportEnabled: false
  },
  rewardFinalizationGracePeriodSeconds: 60,
  hourlyPayoutCurve: [
    { rank: 1, sharePpm: 250000n },
    { rank: 2, sharePpm: 192000n },
    { rank: 3, sharePpm: 147400n },
    { rank: 4, sharePpm: 113200n },
    { rank: 5, sharePpm: 86900n },
    { rank: 6, sharePpm: 66700n },
    { rank: 7, sharePpm: 51200n },
    { rank: 8, sharePpm: 39300n },
    { rank: 9, sharePpm: 30200n },
    { rank: 10, sharePpm: 23100n }
  ],
  dailyPayoutCurve: [
    { rank: 1, sharePpm: 150000n },
    { rank: 2, sharePpm: 127920n },
    { rank: 3, sharePpm: 109090n },
    { rank: 4, sharePpm: 93030n },
    { rank: 5, sharePpm: 79340n },
    { rank: 6, sharePpm: 67660n },
    { rank: 7, sharePpm: 57700n },
    { rank: 8, sharePpm: 49210n },
    { rank: 9, sharePpm: 41960n },
    { rank: 10, sharePpm: 35790n },
    { rank: 11, sharePpm: 30520n },
    { rank: 12, sharePpm: 26030n },
    { rank: 13, sharePpm: 22200n },
    { rank: 14, sharePpm: 18930n },
    { rank: 15, sharePpm: 16140n },
    { rank: 16, sharePpm: 13770n },
    { rank: 17, sharePpm: 11740n },
    { rank: 18, sharePpm: 10010n },
    { rank: 19, sharePpm: 8540n },
    { rank: 20, sharePpm: 7280n },
    { rank: 21, sharePpm: 6210n },
    { rank: 22, sharePpm: 5300n },
    { rank: 23, sharePpm: 4520n },
    { rank: 24, sharePpm: 3850n },
    { rank: 25, sharePpm: 3260n }
  ]
};
function validateCompetitionConfig(input) {
  return competitionConfigSchema.parse(input);
}
var competitionConfig = validateCompetitionConfig(canonicalConfigurationInput);

// packages/core/src/identifiers.ts
function identifier(value, name) {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty string without surrounding whitespace.`);
  }
  return value;
}

// packages/core/src/payout-allocation.ts
var HOURLY_PAYOUT_CURVE_VERSION = "hourly-top10-v1";
var DAILY_PAYOUT_CURVE_VERSION = "daily-top25-v1";
var PAYOUT_TIE_POLICY_VERSION = "combined-funded-ordinals-v1";
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function allocatePayouts(input) {
  if (input.prizePoolLamports < 0n) return { ok: false, reason: "INVALID_PRIZE_POOL" };
  let expectedRank = 1;
  const users2 = /* @__PURE__ */ new Set();
  const structurallyInvalid = input.leaderboard.rankGroups.some((group) => {
    const invalid = group.rank !== expectedRank || group.results.length === 0 || group.tieGroupSize !== group.results.length || group.tied !== group.results.length > 1 || group.results.some(({ userId }) => {
      if (users2.has(userId)) return true;
      users2.add(userId);
      return false;
    });
    expectedRank += group.results.length;
    return invalid;
  });
  const invalidCurve = input.payoutCurve.some(
    ({ rank, sharePpm }, index2) => rank !== index2 + 1 || sharePpm < 0n
  );
  const participantsFromGroups = input.leaderboard.rankGroups.reduce(
    (count, group) => count + group.results.length,
    0
  );
  if (structurallyInvalid || invalidCurve || input.payoutCurve.length === 0 || input.leaderboard.participantCount !== participantsFromGroups) {
    return { ok: false, reason: "INVALID_LEADERBOARD_FOR_PAYOUT" };
  }
  if (participantsFromGroups === 0) {
    return input.prizePoolLamports === 0n ? {
      ok: true,
      prizePoolLamports: lamports(0n),
      occupiedWeightPpm: 0n,
      nominalWinnerCount: input.payoutCurve.length,
      actualWinnerCount: 0,
      rankBuckets: [],
      tieGroups: [],
      allocations: []
    } : { ok: false, reason: "INVALID_LEADERBOARD_FOR_PAYOUT" };
  }
  const fundedOrdinalCount = Math.min(participantsFromGroups, input.payoutCurve.length);
  const fundedCurve = input.payoutCurve.slice(0, fundedOrdinalCount);
  const occupiedWeightPpm = fundedCurve.reduce((sum, entry) => sum + entry.sharePpm, 0n);
  if (occupiedWeightPpm <= 0n) {
    return { ok: false, reason: "INVALID_LEADERBOARD_FOR_PAYOUT" };
  }
  const mutableBuckets = fundedCurve.map(({ rank, sharePpm }) => {
    const numerator = input.prizePoolLamports * sharePpm;
    const floor = numerator / occupiedWeightPpm;
    return {
      ordinal: rank,
      weightPpm: sharePpm,
      floorAllocationLamports: floor,
      remainderBasis: numerator % occupiedWeightPpm,
      finalAllocationLamports: floor
    };
  });
  const floorTotal = mutableBuckets.reduce(
    (sum, bucket) => sum + bucket.floorAllocationLamports,
    0n
  );
  let bucketDust = input.prizePoolLamports - floorTotal;
  const largestRemainderOrder = [...mutableBuckets].sort(
    (left, right) => (left.remainderBasis > right.remainderBasis ? -1 : left.remainderBasis < right.remainderBasis ? 1 : 0) || left.ordinal - right.ordinal
  );
  for (const bucket of largestRemainderOrder) {
    if (bucketDust === 0n) break;
    bucket.finalAllocationLamports += 1n;
    bucketDust -= 1n;
  }
  if (bucketDust !== 0n) {
    return { ok: false, reason: "INVALID_LEADERBOARD_FOR_PAYOUT" };
  }
  const bucketByOrdinal = new Map(mutableBuckets.map((bucket) => [bucket.ordinal, bucket]));
  const allocations = [];
  const tieGroups = [];
  for (const group of input.leaderboard.rankGroups) {
    const ordinalStart = group.rank;
    const ordinalEnd = ordinalStart + group.tieGroupSize - 1;
    const lastFundedOrdinal = Math.min(ordinalEnd, fundedOrdinalCount);
    const fundedOrdinals = ordinalStart <= lastFundedOrdinal ? Array.from(
      { length: lastFundedOrdinal - ordinalStart + 1 },
      (_, index2) => ordinalStart + index2
    ) : [];
    if (fundedOrdinals.length === 0) continue;
    const combinedFundedLamports = fundedOrdinals.reduce(
      (sum, ordinal) => sum + bucketByOrdinal.get(ordinal).finalAllocationLamports,
      0n
    );
    const groupWeightPpm = fundedOrdinals.reduce(
      (sum, ordinal) => sum + bucketByOrdinal.get(ordinal).weightPpm,
      0n
    );
    const groupSize = BigInt(group.tieGroupSize);
    const equalFloorLamports = combinedFundedLamports / groupSize;
    const originalTieDust = combinedFundedLamports % groupSize;
    let remainingTieDust = originalTieDust;
    const usersInDustOrder = [...group.results].sort(
      (left, right) => compareText(left.userId, right.userId)
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
      userIdsInDustOrder: usersInDustOrder.map(({ userId }) => userId)
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
        curveWeightPpm: groupWeightPpm
      });
    }
  }
  const allocated = allocations.reduce((sum, allocation) => sum + allocation.payoutLamports, 0n);
  if (allocated !== input.prizePoolLamports) {
    return { ok: false, reason: "INVALID_LEADERBOARD_FOR_PAYOUT" };
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
      finalAllocationLamports: lamports(bucket.finalAllocationLamports)
    })),
    tieGroups,
    allocations
  };
}

// packages/core/src/payout-execution.ts
import { createHash } from "node:crypto";

// packages/core/src/reward-economics.ts
var BUCKET_PRIORITY = [
  "hourly",
  "daily",
  "rewardBuffer",
  "platform"
];
function allocationRates(mode, config2) {
  const configured = mode === "NORMAL" ? config2.creatorFees.normal : mode === "BUFFER_ACCUMULATION" ? config2.creatorFees.bufferAccumulation : void 0;
  if (!configured) return void 0;
  return {
    mode,
    hourly: configured.hourlyBps,
    daily: configured.dailyBps,
    rewardBuffer: configured.bufferContributionBps,
    platform: configured.platformBps
  };
}
function allocateCreatorFees(input) {
  if (input.creatorFeeLamports < 0n) {
    return { ok: false, reason: "INVALID_CREATOR_FEE_AMOUNT" };
  }
  const rates = allocationRates(input.mode, input.config);
  if (!rates) return { ok: false, reason: "INVALID_REWARD_ALLOCATION_MODE" };
  const weights = {
    hourly: rates.hourly,
    daily: rates.daily,
    rewardBuffer: rates.rewardBuffer,
    platform: rates.platform
  };
  const floors = {
    hourly: 0n,
    daily: 0n,
    rewardBuffer: 0n,
    platform: 0n
  };
  const remainders = { ...floors };
  for (const bucket of BUCKET_PRIORITY) {
    const numerator = input.creatorFeeLamports * weights[bucket];
    floors[bucket] = numerator / BASIS_POINTS_PER_WHOLE;
    remainders[bucket] = numerator % BASIS_POINTS_PER_WHOLE;
  }
  const floorTotal = BUCKET_PRIORITY.reduce((total, bucket) => total + floors[bucket], 0n);
  const dust3 = input.creatorFeeLamports - floorTotal;
  const rankedBuckets = [...BUCKET_PRIORITY].sort((left, right) => {
    if (remainders[left] > remainders[right]) return -1;
    if (remainders[left] < remainders[right]) return 1;
    return BUCKET_PRIORITY.indexOf(left) - BUCKET_PRIORITY.indexOf(right);
  });
  let remainingDust = dust3;
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
      rewardBufferRateBps: rates.rewardBuffer
    }
  };
}
function applyRewardBufferMovement(input) {
  if (input.previousBalance < 0n || input.explicitContribution < 0n || input.dynamicDeposit < 0n || input.dynamicWithdrawal < 0n) {
    return { ok: false, reason: "INVALID_REWARD_BUFFER_BALANCE" };
  }
  const available = input.previousBalance + input.explicitContribution + input.dynamicDeposit;
  if (input.dynamicWithdrawal > available) {
    return { ok: false, reason: "INVALID_REWARD_BUFFER_BALANCE" };
  }
  return {
    ok: true,
    movement: {
      previousBalance: lamports(input.previousBalance),
      explicitContribution: lamports(input.explicitContribution),
      dynamicDeposit: lamports(input.dynamicDeposit),
      dynamicWithdrawal: lamports(input.dynamicWithdrawal),
      nextBalance: lamports(available - input.dynamicWithdrawal)
    }
  };
}
function calculateHourlyRewardBaseline(input) {
  if (!Number.isInteger(input.windowCompletedHours) || input.windowCompletedHours <= 0) {
    return { ok: false, reason: "INVALID_BASELINE_HISTORY" };
  }
  const roundIds = /* @__PURE__ */ new Set();
  const startTimestamps = /* @__PURE__ */ new Set();
  const endTimestamps = /* @__PURE__ */ new Set();
  for (const record of input.history) {
    const duplicate = roundIds.has(record.hourlyRoundId) || startTimestamps.has(record.startsAt) || endTimestamps.has(record.endsAtExclusive);
    if (record.naturalHourlyLamports < 0n || record.startsAt >= record.endsAtExclusive || duplicate) {
      return {
        ok: false,
        reason: duplicate ? "DUPLICATE_BASELINE_HOUR" : "INVALID_BASELINE_HISTORY"
      };
    }
    roundIds.add(record.hourlyRoundId);
    startTimestamps.add(record.startsAt);
    endTimestamps.add(record.endsAtExclusive);
  }
  if (input.history.length < input.windowCompletedHours) {
    return {
      ok: true,
      status: "INSUFFICIENT_HISTORY",
      reason: "INSUFFICIENT_BASELINE_HISTORY",
      requiredHours: input.windowCompletedHours,
      availableHours: input.history.length
    };
  }
  const selected = [...input.history].sort(
    (left, right) => left.startsAt < right.startsAt ? -1 : left.startsAt > right.startsAt ? 1 : 0
  ).slice(-input.windowCompletedHours);
  const sum = selected.reduce((total, record) => total + record.naturalHourlyLamports, 0n);
  return {
    ok: true,
    status: "ACTIVE",
    requiredHours: input.windowCompletedHours,
    availableHours: input.history.length,
    includedHourlyRoundIds: selected.map(({ hourlyRoundId: hourlyRoundId2 }) => hourlyRoundId2),
    baselineLamports: lamports(sum / BigInt(input.windowCompletedHours))
  };
}
function calculateDynamicHourlyReward(input) {
  if (!input.baseline.ok) return { ok: false, reason: "INVALID_BASELINE_HISTORY" };
  if (!input.dynamicCurveEnabled || input.baseline.status === "INSUFFICIENT_HISTORY") {
    return {
      ok: true,
      reward: {
        dynamicApplied: false,
        reason: input.dynamicCurveEnabled ? "INSUFFICIENT_BASELINE_HISTORY" : "DYNAMIC_CURVE_DISABLED",
        lambdaBps: input.lambdaBps,
        targetLamports: input.naturalHourlyLamports,
        actualHourlyPrizeLamports: input.naturalHourlyLamports,
        dynamicDepositLamports: lamports(0n),
        dynamicWithdrawalLamports: lamports(0n)
      }
    };
  }
  const target = ((BASIS_POINTS_PER_WHOLE - input.lambdaBps) * input.baseline.baselineLamports + input.lambdaBps * input.naturalHourlyLamports) / BASIS_POINTS_PER_WHOLE;
  const deposit = input.naturalHourlyLamports > target ? input.naturalHourlyLamports - target : 0n;
  const requestedSupport = target > input.naturalHourlyLamports ? target - input.naturalHourlyLamports : 0n;
  const withdrawal = requestedSupport < input.availableBufferLamports ? requestedSupport : input.availableBufferLamports;
  return {
    ok: true,
    reward: {
      dynamicApplied: true,
      reason: null,
      lambdaBps: input.lambdaBps,
      targetLamports: lamports(target),
      actualHourlyPrizeLamports: lamports(input.naturalHourlyLamports - deposit + withdrawal),
      dynamicDepositLamports: lamports(deposit),
      dynamicWithdrawalLamports: lamports(withdrawal)
    }
  };
}
function processHourlyRewardEconomics(input) {
  if (input.currentBufferLamports < 0n) {
    return { ok: false, reason: "INVALID_REWARD_BUFFER_BALANCE" };
  }
  const split = allocateCreatorFees({
    creatorFeeLamports: input.creatorFeeLamports,
    mode: input.mode,
    config: input.config
  });
  if (!split.ok) return split;
  const baseline = calculateHourlyRewardBaseline({
    history: input.previousCompletedNaturalHourlyRewards,
    windowCompletedHours: input.config.rewardBuffer.baselineWindowCompletedHours
  });
  if (!baseline.ok) return baseline;
  const availableAfterExplicit = lamports(
    input.currentBufferLamports + split.allocation.rewardBuffer
  );
  const dynamic = calculateDynamicHourlyReward({
    naturalHourlyLamports: split.allocation.currentHourly,
    availableBufferLamports: availableAfterExplicit,
    baseline,
    dynamicCurveEnabled: input.config.rewardBuffer.dynamicCurveEnabled,
    lambdaBps: input.config.rewardBuffer.lambdaBps
  });
  if (!dynamic.ok) return dynamic;
  const buffer = applyRewardBufferMovement({
    previousBalance: input.currentBufferLamports,
    explicitContribution: split.allocation.rewardBuffer,
    dynamicDeposit: dynamic.reward.dynamicDepositLamports,
    dynamicWithdrawal: dynamic.reward.dynamicWithdrawalLamports
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
      bufferMovement: buffer.movement
    }
  };
}
function isHourlyRewardEconomicsConserved(economics) {
  return economics.creatorFeeTotalLamports + economics.startingBufferLamports === economics.actualHourlyPrizeLamports + economics.dailyContributionLamports + economics.platformContributionLamports + economics.endingBufferLamports;
}

// packages/core/src/time.ts
var EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
function utcInstant(value) {
  if (typeof value === "string" && !EXPLICIT_TIMEZONE.test(value)) {
    throw new TypeError("String timestamps must include an explicit UTC offset or Z suffix.");
  }
  const date2 = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date2.getTime())) {
    throw new TypeError("Invalid timestamp.");
  }
  return date2.toISOString();
}

// packages/core/src/security-diagnostics.ts
var hidden = "[REDACTED]";
var sensitiveKey = /^(?:auth|authentication|authorization|proxyauthorization|authtoken|xauthtoken|cookie|setcookie|apikey|xapikey|apitoken|heliusapikey|credential|credentials|key|token|accesstoken|refreshtoken|sessiontoken|password|passwd|secret|clientsecret|privatekey|seedphrase|solanarpcurl|solanawsurl|rpcurl)$/i;
var normalizeKey = (key3) => key3.replace(/[^a-z0-9]/gi, "");
var maxLength = 1e5;
function variants(text2) {
  const result = [text2.replace(/\\\//g, "/")];
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(result[result.length - 1]);
      if (decoded === result[result.length - 1]) break;
      result.push(decoded);
    } catch {
      break;
    }
  }
  return result;
}
function collectText(text2, secrets) {
  if (text2.length > maxLength) return;
  for (const value of variants(text2)) {
    for (const match of value.matchAll(/(?:https?|wss?):\/\/[^\s"'<>\\]+/gi)) {
      try {
        const url = new URL(match[0].replace(/[),.;\]}]+$/, ""));
        if (url.username) secrets.add(url.username);
        if (url.password) secrets.add(url.password);
        for (const value2 of [url.username, url.password]) {
          try {
            if (value2) secrets.add(decodeURIComponent(value2));
          } catch {
          }
        }
        for (const [key3, token] of url.searchParams)
          if (sensitiveKey.test(normalizeKey(key3)) && token) secrets.add(token);
        if (/helius|quicknode|quiknode|alchemy|chainstack|getblock|triton|ankr/i.test(url.hostname)) {
          for (const token of url.pathname.split("/"))
            if (/^[a-z0-9_-]{24,}$/i.test(token)) secrets.add(token);
        }
      } catch {
      }
    }
    for (const match of value.matchAll(/\b(Bearer|Basic)\s+([a-z0-9._~+/-]+=*)/gi)) {
      secrets.add(match[2]);
      if (match[1].toLowerCase() === "basic") {
        try {
          const decoded = atob(match[2]);
          secrets.add(decoded);
          const colon = decoded.indexOf(":");
          if (colon >= 0) secrets.add(decoded.slice(colon + 1));
        } catch {
        }
      }
    }
    for (const match of value.matchAll(
      /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|password|client[-_]?secret|authorization|auth|token|key|secret)\s*["']?\s*[:=]\s*["']?([^\s"'&,;\]}]+)/gi
    ))
      if (!/^(?:Bearer|Basic)$/i.test(match[1])) secrets.add(match[1]);
  }
}
function descriptors(value) {
  return Object.getOwnPropertyDescriptors(value);
}
function collect(value, secrets, seen, depth = 0) {
  if (depth > 8) return;
  if (typeof value === "string") {
    collectText(value, secrets);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof URL) {
    const href = Object.getOwnPropertyDescriptor(URL.prototype, "href").get.call(value);
    collectText(href, secrets);
    return;
  }
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    for (const [key3, token] of Headers.prototype.entries.call(value)) {
      if (sensitiveKey.test(normalizeKey(key3))) {
        secrets.add(token);
        collectText(token, secrets);
      }
    }
    return;
  }
  const own = descriptors(value);
  for (const [key3, descriptor] of Object.entries(own).slice(0, 200)) {
    if (!("value" in descriptor)) continue;
    const field = descriptor.value;
    if (sensitiveKey.test(normalizeKey(key3)) && typeof field === "string") {
      if (field.length <= maxLength) {
        if (field) secrets.add(field);
        collectText(field, secrets);
      }
    }
    collect(field, secrets, seen, depth + 1);
  }
}
function textRedacted(text2, secrets) {
  if (text2.length > maxLength) return "[Diagnostic text too long]";
  let result = text2;
  const decoded = variants(text2);
  const last = decoded[decoded.length - 1];
  if (/(?:https?|wss?):\/\/|\b(?:Bearer|Basic)\s|api[-_]?key\s*[:=]/i.test(last)) result = last;
  result = result.replace(/(?:https?|wss?):\/\/[^\s"'<>\\]+/gi, "[URL REDACTED]");
  result = result.replace(/\b(Bearer|Basic)\s+[a-z0-9._~+/-]+=*/gi, "$1 [REDACTED]");
  result = result.replace(
    /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|password|client[-_]?secret|authorization|auth|token|key|secret)\s*["']?\s*[:=]\s*["']?)([^\s"'&,;\]}]+)/gi,
    "$1[REDACTED]"
  );
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (!secret) continue;
    result = result.split(secret).join(hidden);
    result = result.split(encodeURIComponent(secret)).join(hidden);
  }
  return result.length > 16e3 ? result.slice(0, 16e3) + "[Truncated]" : result;
}
function clean(value, secrets, seen, depth = 0) {
  if (typeof value === "string") return textRedacted(value, secrets);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === void 0) return void 0;
  if (typeof value !== "object") return "[Nonserializable diagnostic]";
  if (depth > 8) return "[Diagnostic depth limit]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Date) return Date.prototype.toISOString.call(value);
  if (value instanceof URL) return "[URL REDACTED]";
  if (typeof Headers !== "undefined" && value instanceof Headers)
    return clean(
      Object.fromEntries(Headers.prototype.entries.call(value)),
      secrets,
      seen,
      depth + 1
    );
  if (Array.isArray(value))
    return value.slice(0, 200).map((v) => clean(v, secrets, seen, depth + 1));
  const own = descriptors(value);
  const output = /* @__PURE__ */ Object.create(null);
  if (value instanceof Error) output.type = "Error";
  for (const [key3, descriptor] of Object.entries(own).slice(0, 200)) {
    const safeKey = textRedacted(key3, secrets);
    if (sensitiveKey.test(normalizeKey(key3))) {
      output[safeKey] = hidden;
      continue;
    }
    if (!("value" in descriptor)) {
      output[safeKey] = "[Accessor omitted]";
      continue;
    }
    if (typeof descriptor.value === "function") continue;
    output[safeKey] = clean(descriptor.value, secrets, seen, depth + 1);
  }
  return output;
}
function redactDiagnostic(value, sources2 = []) {
  try {
    const secrets = /* @__PURE__ */ new Set();
    for (const source of sources2) collect(source, secrets, /* @__PURE__ */ new WeakSet());
    collect(value, secrets, /* @__PURE__ */ new WeakSet());
    return clean(value, secrets, /* @__PURE__ */ new WeakSet());
  } catch {
    return "[Diagnostic unavailable]";
  }
}
function redactDiagnosticText(value, sources2 = []) {
  const result = redactDiagnostic(value, sources2);
  return typeof result === "string" ? result : "[Diagnostic unavailable]";
}
function safeErrorMessage(error, sources2 = [], fallback = "Unknown error") {
  try {
    const descriptor = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message") : void 0;
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? redactDiagnosticText(descriptor.value, [...sources2, error]) : redactDiagnosticText(fallback, sources2);
  } catch {
    return "[Diagnostic unavailable]";
  }
}

// packages/execution/src/index.ts
import { createHash as createHash2 } from "node:crypto";

// packages/execution/src/cutoff-liquidation.ts
var liquidity = /* @__PURE__ */ new Set(["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"]);
async function planCutoffLiquidation(adapter, initial, quantity, basis, cutoff) {
  if (quantity <= 0n || basis < 0n || createMarketStateEvidence(initial).fingerprint !== initial.fingerprint || adapter.adapterVersion !== initial.adapterVersion)
    throw Error("CUTOFF_PLAN_INPUT");
  const steps = [];
  let remaining = quantity, cost = basis, evidence2 = structuredClone(initial);
  while (remaining > 0n) {
    if (steps.length >= 64) throw Error("CUTOFF_PARTIAL_STEP_BOUND");
    let sold = remaining;
    try {
      const v = await adapter.valuePositionForExit(
        { identity: evidence2.identity, tokenQuantity: tokenBaseUnits(remaining) },
        evidence2
      );
      if (v.paperSolValue <= 0n)
        throw new ExecutionEngineError("ZERO_EXECUTABLE_OUTPUT", "No positive output.");
    } catch (e) {
      if (!(e instanceof Error) || !("code" in e) || !liquidity.has(String(e.code)) || !adapter.maxExecutableSellQuantity)
        throw e;
      sold = await adapter.maxExecutableSellQuantity(
        { identity: evidence2.identity, tokenQuantity: tokenBaseUnits(remaining) },
        evidence2
      );
    }
    if (sold < 0n || sold > remaining) throw Error("CUTOFF_CAPACITY_INVALID");
    if (sold === 0n) {
      steps.push({
        quantity: remaining.toString(),
        basisBefore: cost.toString(),
        output: "0",
        fees: "0",
        writeoff: true,
        evidence: evidence2
      });
      break;
    }
    const execution = await adapter.simulateSell(
      {
        identity: evidence2.identity,
        requestedTokenQuantity: tokenBaseUnits(sold),
        orderId: identifier("cutoff-plan", "OrderId"),
        executionId: identifier("cutoff-plan", "ExecutionId"),
        executedAt: utcInstant(cutoff)
      },
      evidence2
    );
    if (execution.actualInput.amount !== sold || execution.actualInput.asset !== "TOKEN" || execution.actualOutput.asset !== "PAPER_SOL" || execution.actualOutput.amount <= 0n || execution.quote.marketStateFingerprint !== evidence2.fingerprint)
      throw Error("CUTOFF_EXECUTION_INVALID");
    const fees = execution.quote.fees.reduce(
      (n3, f) => n3 + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n),
      0n
    );
    steps.push({
      quantity: sold.toString(),
      basisBefore: cost.toString(),
      output: execution.actualOutput.amount.toString(),
      fees: fees.toString(),
      writeoff: false,
      evidence: evidence2
    });
    cost -= sold === remaining ? cost : cost * sold / remaining;
    remaining -= sold;
    if (remaining === 0n) break;
    const rawPost = execution.executionDetails?.["postTrade"];
    if (!rawPost || Array.isArray(rawPost) || typeof rawPost !== "object")
      throw Error("CUTOFF_PARTIAL_SUCCESSOR_UNAVAILABLE");
    const post = rawPost;
    const fields = adapter.adapterVersion === "pump-bonding-curve-v1" ? ["virtualTokenReserves", "virtualSolReserves", "realTokenReserves", "realSolReserves"] : adapter.adapterVersion === "pump-swap-canonical-v1" ? ["baseReserves", "rawQuoteReserves", "effectiveQuoteReserves"] : [];
    if (!fields.length || fields.some((k) => typeof post[k] !== "string" || !/^\d+$/.test(post[k])))
      throw Error("CUTOFF_PARTIAL_SUCCESSOR_UNAVAILABLE");
    evidence2 = createMarketStateEvidence({
      ...evidence2,
      normalizedState: {
        ...evidence2.normalizedState,
        ...Object.fromEntries(fields.map((k) => [k, post[k]])),
        cutoffSuccessorOf: evidence2.fingerprint
      },
      rawSource: {
        source: "DETERMINISTIC_CUTOFF_SUCCESSOR",
        previousFingerprint: evidence2.fingerprint
      }
    });
  }
  return steps;
}

// packages/execution/src/index.ts
var ExecutionEngineError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ExecutionEngineError";
  }
  code;
};
function canonicalize(value) {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key3, item]) => [key3, canonicalize(item)])
    );
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
function marketStateFingerprint(state) {
  const envelope = {
    adapterVersion: state.adapterVersion,
    chainBlockId: state.chainBlockId,
    chainSlot: state.chainSlot === null ? null : state.chainSlot.toString(),
    identity: {
      marketId: state.identity.marketId,
      protocolId: state.identity.protocolId,
      tokenMint: state.identity.tokenMint
    },
    normalizationVersion: state.normalizationVersion,
    normalizedState: state.normalizedState,
    observedAt: state.observedAt
  };
  return createHash2("sha256").update(canonicalJson(envelope)).digest("hex");
}
function createMarketStateEvidence(state) {
  return { ...state, fingerprint: marketStateFingerprint(state) };
}
function executionRouteRecord(state, buy, quotedHops) {
  const rawHops = quotedHops ?? state.normalizedState["hops"] ?? [
    {
      pool: state.identity.marketId,
      program: state.normalizedState["programId"] ?? state.identity.protocolId,
      mintA: state.identity.tokenMint,
      mintB: state.normalizedState["quoteMint"] ?? "So11111111111111111111111111111111111111112"
    }
  ];
  let currentMint = buy ? "So11111111111111111111111111111111111111112" : state.identity.tokenMint;
  const ordered = Array.isArray(rawHops) ? !quotedHops && buy ? [...rawHops].reverse() : rawHops : [];
  const hops = ordered.map((h) => {
    const hop = h;
    const inputMint = hop["inputMint"] ?? currentMint;
    const outputMint = hop["outputMint"] ?? (inputMint === hop["mintA"] ? hop["mintB"] : hop["mintA"]) ?? null;
    currentMint = outputMint;
    return {
      ...hop,
      inputMint,
      outputMint,
      direction: buy ? "BUY" : "SELL",
      chainSlot: state.chainSlot?.toString() ?? null
    };
  });
  const path2 = {
    mint: state.identity.tokenMint,
    protocol: state.identity.protocolId,
    direction: buy ? "BUY" : "SELL",
    hops: Array.isArray(hops) ? hops.map((h) => {
      const hop = h;
      return {
        pool: hop["pool"] ?? null,
        program: hop["programId"] ?? hop["program"] ?? hop["protocol"] ?? null,
        inputMint: hop["inputMint"] ?? null,
        outputMint: hop["outputMint"] ?? null
      };
    }) : hops
  };
  return {
    ...path2,
    hops,
    topologyHash: createHash2("sha256").update(
      canonicalJson({
        mint: state.identity.tokenMint,
        protocol: state.identity.protocolId,
        hops: (buy ? [...hops].reverse() : hops).map((hop) => ({
          pool: hop.pool ?? null,
          program: hop.programId ?? hop.program ?? hop.protocol ?? null,
          inputMint: (buy ? hop.outputMint : hop.inputMint) ?? null,
          outputMint: (buy ? hop.inputMint : hop.outputMint) ?? null
        }))
      })
    ).digest("hex"),
    routeHash: createHash2("sha256").update(canonicalJson(path2)).digest("hex"),
    direction: buy ? "BUY" : "SELL",
    inputAsset: buy ? "PAPER_SOL" : state.identity.tokenMint,
    outputAsset: buy ? state.identity.tokenMint : "PAPER_SOL",
    observedAt: state.observedAt,
    chainSlot: state.chainSlot?.toString() ?? null,
    stateFingerprint: marketStateFingerprint(state)
  };
}
function validatedAdapter(adapter, log2) {
  const invalid = () => {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "Canonical quote is missing, malformed or not bound to its snapshot."
    );
  };
  const validateFees = (fees) => {
    if (!Array.isArray(fees) || fees.some(
      (f) => !f?.amount || typeof f.category !== "string" || !f.category || typeof f.amount.amount !== "bigint" || f.amount.amount < 0n || !["PAPER_SOL", "TOKEN"].includes(f.amount.asset) || f.amount.asset === "TOKEN" && !f.amount.tokenMint
    ))
      invalid();
  };
  const validateState = (identity, state) => {
    if (identity.marketId !== state.identity.marketId || identity.protocolId !== state.identity.protocolId || identity.tokenMint !== state.identity.tokenMint || state.adapterVersion !== adapter.adapterVersion)
      invalid();
  };
  const valuePositionForExit = async (request, state) => {
    validateState(request.identity, state);
    if (typeof request.tokenQuantity !== "bigint" || request.tokenQuantity <= 0n) invalid();
    const value = await adapter.valuePositionForExit(request, state);
    if (!value || typeof value.paperSolValue !== "bigint" || value.paperSolValue < 0n || value.tokenQuantity !== request.tokenQuantity || value.identity?.marketId !== request.identity.marketId || value.identity?.protocolId !== request.identity.protocolId || value.identity?.tokenMint !== request.identity.tokenMint || value.adapterVersion !== adapter.adapterVersion || value.marketStateFingerprint !== marketStateFingerprint(state) || typeof value.feeBreakdown?.totalPaperSolFees !== "bigint" || value.feeBreakdown.totalPaperSolFees < 0n)
      invalid();
    validateFees(value.feeBreakdown.fees);
    if (value.feeBreakdown.totalPaperSolFees !== value.feeBreakdown.fees.reduce(
      (sum, f) => sum + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n),
      0n
    ))
      invalid();
    log2("EXECUTABLE_VALUATION", {
      ...value.route ?? executionRouteRecord(state, false),
      input: request.tokenQuantity.toString(),
      output: value.paperSolValue.toString(),
      fees: canonicalize(value.feeBreakdown.fees)
    });
    return value;
  };
  const execute = async (request, state, buy) => {
    validateState(request.identity, state);
    const requested = buy ? request.requestedPaperSol : request.requestedTokenQuantity;
    if (typeof requested !== "bigint" || requested <= 0n) invalid();
    const result = buy ? await adapter.simulateBuy(request, state) : await adapter.simulateSell(request, state);
    if (!result || typeof result.actualInput?.amount !== "bigint" || result.actualInput.amount <= 0n || typeof result.actualOutput?.amount !== "bigint" || result.actualOutput.amount <= 0n || result.actualInput.amount > requested || result.quote?.requestedInput?.amount !== requested || result.quote.requestedInput.asset !== (buy ? "PAPER_SOL" : "TOKEN") || result.orderId !== request.orderId || result.id !== request.executionId || result.quote?.marketStateFingerprint !== marketStateFingerprint(state) || result.quote.adapterVersion !== adapter.adapterVersion || result.quote.marketId !== request.identity.marketId || result.quote.protocolId !== request.identity.protocolId)
      invalid();
    validateFees(result.quote.fees);
    if (result.actualInput.asset !== (buy ? "PAPER_SOL" : "TOKEN") || result.actualOutput.asset !== (buy ? "TOKEN" : "PAPER_SOL") || result.actualInput.asset === "TOKEN" && result.actualInput.tokenMint !== request.identity.tokenMint || result.actualOutput.asset === "TOKEN" && result.actualOutput.tokenMint !== request.identity.tokenMint || result.quote.simulatedOutput?.asset !== result.actualOutput.asset || result.quote.simulatedOutput?.amount !== result.actualOutput.amount)
      invalid();
    const record = {
      ...executionRouteRecord(state, buy, result.executionDetails?.["hops"]),
      orderId: request.orderId,
      executionId: request.executionId,
      requestedInput: result.quote.requestedInput.amount.toString(),
      input: result.actualInput.amount.toString(),
      output: result.actualOutput.amount.toString(),
      fees: canonicalize(result.quote.fees)
    };
    log2(buy ? "BUY_ROUTE" : "SELL_ROUTE", record);
    let immediateReverse;
    if (buy) {
      try {
        const valuationRequest = {
          identity: request.identity,
          tokenQuantity: result.actualOutput.amount
        };
        let value;
        try {
          value = await valuePositionForExit(valuationRequest, state);
        } catch (error) {
          if (!(error instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(error.code) || !adapter.maxExecutableSellQuantity)
            throw error;
          const max = await adapter.maxExecutableSellQuantity(valuationRequest, state);
          if (typeof max !== "bigint" || max < 0n || max > valuationRequest.tokenQuantity)
            invalid();
          if (max === 0n) {
            immediateReverse = {
              status: "AVAILABLE",
              executableValue: "0",
              executableQuantity: "0",
              route: executionRouteRecord(state, false)
            };
            log2("EXECUTION_VALUATION_ANOMALY", {
              mint: request.identity.tokenMint,
              basis: result.actualInput.amount.toString(),
              executableValue: "0",
              percentDifferenceBps: "-10000",
              cause: "AUTHORITATIVE_NO_EXECUTABLE_LIQUIDITY",
              buyRoute: record,
              sellRoute: executionRouteRecord(state, false),
              executableQuantity: "0"
            });
            return {
              ...result,
              executionDetails: {
                ...result.executionDetails,
                canonicalRoute: record,
                immediateReverse
              }
            };
          }
          value = await valuePositionForExit({ ...valuationRequest, tokenQuantity: max }, state);
        }
        const basis = result.actualInput.amount;
        immediateReverse = {
          status: "AVAILABLE",
          executableValue: value.paperSolValue.toString(),
          executableQuantity: value.tokenQuantity.toString(),
          fees: canonicalize(value.feeBreakdown.fees),
          route: value.route ?? executionRouteRecord(state, false)
        };
        log2("BUY_REVERSE_VALUATION", { buyRoute: record, ...immediateReverse });
        if (value.paperSolValue * 100n < basis * 75n)
          log2("EXECUTION_VALUATION_ANOMALY", {
            mint: request.identity.tokenMint,
            basis: basis.toString(),
            executableValue: value.paperSolValue.toString(),
            percentDifferenceBps: ((value.paperSolValue - basis) * 10000n / basis).toString(),
            buyRoute: record,
            sellRoute: value.route ?? executionRouteRecord(state, false)
          });
      } catch (error) {
        log2("IMMEDIATE_VALUATION_UNAVAILABLE", {
          mint: request.identity.tokenMint,
          buyRoute: record,
          reason: error instanceof ExecutionEngineError ? error.code : "MARKET_STATE_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Unknown reverse-route failure"
        });
        throw error;
      }
    }
    return {
      ...result,
      executionDetails: {
        ...result.executionDetails,
        canonicalRoute: record,
        ...immediateReverse ? { immediateReverse } : {}
      }
    };
  };
  return {
    protocolId: adapter.protocolId,
    adapterVersion: adapter.adapterVersion,
    loadMarketState: (identity) => adapter.loadMarketState(identity),
    simulateBuy: (request, state) => execute(request, state, true),
    simulateSell: (request, state) => execute(request, state, false),
    valuePositionForExit,
    ...adapter.maxExecutableSellQuantity ? {
      maxExecutableSellQuantity: async (request, state) => {
        validateState(request.identity, state);
        const quantity = await adapter.maxExecutableSellQuantity(request, state);
        if (typeof quantity !== "bigint" || quantity < 0n || quantity > request.tokenQuantity)
          invalid();
        return quantity;
      }
    } : {}
  };
}
var ExecutionRouter = class {
  diagnostic;
  /** Production discovery is independent of the terminal that supplied the mint. */
  mintResolver;
  /** Display identity only. Does not resolve execution or register a market. */
  chartMetadataResolver;
  contextResolver;
  /** Production venue discovery, shared by every caller and independent of trade direction. */
  canonicalResolver;
  #adapters = /* @__PURE__ */ new Map();
  #enabled = /* @__PURE__ */ new Map();
  #routeResolvers = /* @__PURE__ */ new Map();
  /** One uncached state-loading boundary for execution, preflight, equity and settlement. */
  async loadPositionRoute(identity, forSettlement = false) {
    try {
      const resolved = await this.resolvePositionRoute(identity, forSettlement);
      const state = await resolved.adapter.loadMarketState(resolved.route.executionIdentity);
      const expected = resolved.route.executionIdentity;
      if (state.identity.protocolId !== expected.protocolId || state.identity.marketId !== expected.marketId || state.identity.tokenMint !== expected.tokenMint || state.adapterVersion !== resolved.adapter.adapterVersion || state.chainSlot !== null && (typeof state.chainSlot !== "bigint" || state.chainSlot < 0n))
        throw new ExecutionEngineError(
          "INVALID_MARKET_STATE",
          "Canonical route snapshot identity is invalid."
        );
      return { ...resolved, state };
    } catch (error) {
      this.emit("ROUTE_UNAVAILABLE", {
        mint: identity.tokenMint,
        market: identity.marketId,
        reason: error instanceof ExecutionEngineError ? error.code : "MARKET_STATE_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unknown route failure"
      });
      if (error instanceof ExecutionEngineError) throw error;
      throw new ExecutionEngineError(
        "MARKET_STATE_UNAVAILABLE",
        "Canonical route snapshot is unavailable."
      );
    }
  }
  emit(event, metadata) {
    try {
      this.diagnostic?.(event, metadata);
    } catch {
    }
  }
  constructor(adapters = []) {
    for (const adapter of adapters) this.register(adapter);
  }
  register(adapter) {
    if (this.#adapters.has(adapter.protocolId)) {
      throw new ExecutionEngineError(
        "DUPLICATE_PROTOCOL",
        `Protocol ${adapter.protocolId} already has a registered adapter.`
      );
    }
    this.#adapters.set(
      adapter.protocolId,
      validatedAdapter(adapter, (event, data) => this.emit(event, data))
    );
    this.#enabled.set(adapter.protocolId, true);
  }
  registerRouteResolver(resolver) {
    if (this.#routeResolvers.has(resolver.originProtocolId)) {
      throw new ExecutionEngineError(
        "DUPLICATE_PROTOCOL",
        `Protocol ${resolver.originProtocolId} already has an execution-route resolver.`
      );
    }
    this.#routeResolvers.set(resolver.originProtocolId, resolver);
  }
  /** Resolve the current venue without changing the position's economic identity. */
  async resolvePositionRoute(identity, forSettlement = false) {
    const resolver = this.#routeResolvers.get(identity.protocolId);
    let route;
    try {
      route = this.canonicalResolver ? await this.canonicalResolver(identity) : resolver ? await resolver.resolveExecutionRoute(identity) : { originIdentity: identity, executionIdentity: identity, migrated: false };
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      throw new ExecutionEngineError(
        "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
        "The current execution venue for this position could not be resolved."
      );
    }
    if (route.originIdentity.protocolId !== identity.protocolId || route.originIdentity.marketId !== identity.marketId || route.originIdentity.tokenMint !== identity.tokenMint || route.executionIdentity.tokenMint !== identity.tokenMint) {
      throw new ExecutionEngineError(
        "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
        "The resolved execution route does not preserve the position token identity."
      );
    }
    const adapter = forSettlement ? this.resolveForSettlement(route.executionIdentity.protocolId) : this.resolve(route.executionIdentity.protocolId);
    return { route, adapter };
  }
  resolve(protocolId) {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter) {
      throw new ExecutionEngineError(
        "UNSUPPORTED_PROTOCOL",
        `No execution adapter is registered for protocol ${protocolId}.`
      );
    }
    if (this.#enabled.get(protocolId) === false) {
      throw new ExecutionEngineError(
        "PROTOCOL_DISABLED",
        `Protocol ${protocolId} is disabled for new user trading.`
      );
    }
    return adapter;
  }
  /** Operational switch for new user exposure. Forced liquidation remains available. */
  setEnabled(protocolId, enabled) {
    if (!this.#adapters.has(protocolId)) {
      throw new ExecutionEngineError(
        "UNSUPPORTED_PROTOCOL",
        `No execution adapter is registered for protocol ${protocolId}.`
      );
    }
    this.#enabled.set(protocolId, enabled);
  }
  isEnabled(protocolId) {
    return this.#enabled.get(protocolId) === true;
  }
  /** Risk-reducing settlement may use installed code even when new trading is disabled. */
  resolveForSettlement(protocolId) {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter) {
      throw new ExecutionEngineError(
        "UNSUPPORTED_PROTOCOL",
        `No execution adapter is registered for protocol ${protocolId}.`
      );
    }
    return adapter;
  }
  resolveVersion(protocolId, adapterVersion) {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter || adapter.adapterVersion !== adapterVersion) {
      throw new ExecutionEngineError(
        "ADAPTER_VERSION_UNAVAILABLE",
        `Adapter ${protocolId}@${adapterVersion} is unavailable.`
      );
    }
    return adapter;
  }
};
var liquidityCodes = /* @__PURE__ */ new Set(["INSUFFICIENT_EXECUTABLE_LIQUIDITY", "ZERO_EXECUTABLE_OUTPUT"]);
async function canonicalExitPreflight(router2, identity, quantity, basis, forSettlement = false) {
  if (quantity <= 0n || basis < 0n) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "Invalid position quantity or cost basis."
    );
  }
  const { route, adapter, state } = await router2.loadPositionRoute(identity, forSettlement);
  const evidence2 = createMarketStateEvidence(state);
  if (state.identity.marketId !== route.executionIdentity.marketId || state.identity.protocolId !== route.executionIdentity.protocolId || state.identity.tokenMint !== identity.tokenMint || state.adapterVersion !== adapter.adapterVersion) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Exit state identity mismatch.");
  }
  const quote = async (amount) => {
    if (amount <= 0n)
      return {
        executable: false,
        quantityBaseUnits: amount,
        outputLamports: null,
        reason: "ZERO_EXECUTABLE_OUTPUT"
      };
    try {
      const value = await adapter.valuePositionForExit(
        { identity: route.executionIdentity, tokenQuantity: tokenBaseUnits(amount) },
        state
      );
      if (value.marketStateFingerprint !== evidence2.fingerprint || value.adapterVersion !== adapter.adapterVersion || value.identity.marketId !== route.executionIdentity.marketId || value.identity.protocolId !== route.executionIdentity.protocolId || value.identity.tokenMint !== identity.tokenMint || typeof value.paperSolValue !== "bigint" || value.tokenQuantity !== amount || value.paperSolValue < 0n) {
        throw new ExecutionEngineError(
          "INVALID_EXECUTION_RESULT",
          "Exit quote does not match its evidence."
        );
      }
      if (value.paperSolValue === 0n)
        throw new ExecutionEngineError(
          "ZERO_EXECUTABLE_OUTPUT",
          "Exit produces no positive Paper SOL."
        );
      return {
        executable: true,
        quantityBaseUnits: amount,
        outputLamports: value.paperSolValue,
        reason: null
      };
    } catch (error) {
      if (!(error instanceof ExecutionEngineError) || !liquidityCodes.has(error.code)) throw error;
      return {
        executable: false,
        quantityBaseUnits: amount,
        outputLamports: null,
        reason: error.code
      };
    }
  };
  const full = await quote(quantity);
  if (!full.executable && !adapter.maxExecutableSellQuantity)
    throw new ExecutionEngineError(
      "MARKET_STATE_UNAVAILABLE",
      "Protocol does not expose exact exit capacity."
    );
  const maxQuantity = full.executable ? quantity : await adapter.maxExecutableSellQuantity(
    { identity: route.executionIdentity, tokenQuantity: tokenBaseUnits(quantity) },
    state
  );
  if (typeof maxQuantity !== "bigint" || maxQuantity < 0n || maxQuantity > quantity)
    throw new ExecutionEngineError("INVALID_EXECUTION_RESULT", "Invalid exit capacity.");
  const max = maxQuantity === quantity ? full : await quote(maxQuantity);
  if (maxQuantity > 0n && !max.executable)
    throw new ExecutionEngineError("INVALID_EXECUTION_RESULT", "Exit capacity is not executable.");
  const costRemoved = maxQuantity === quantity ? basis : basis * maxQuantity / quantity;
  return {
    status: full.executable ? "FULL" : maxQuantity > 0n ? "LIQUIDITY_LIMITED" : "NO_EXECUTABLE_LIQUIDITY",
    full,
    maxExecutableQuantityBaseUnits: maxQuantity,
    maxExecutableOutputLamports: maxQuantity === 0n ? 0n : max.outputLamports,
    executablePortionCostBasisLamports: costRemoved,
    executablePortionPnlLamports: maxQuantity > 0n ? max.outputLamports - costRemoved : null,
    percentages: {
      "25": await quote(quantity * 25n / 100n),
      "50": await quote(quantity * 50n / 100n),
      "75": await quote(quantity * 75n / 100n),
      "100": full
    },
    currentProtocol: route.executionIdentity.protocolId,
    evidence: evidence2,
    evidenceFingerprint: evidence2.fingerprint,
    observedAt: evidence2.observedAt,
    chainSlot: evidence2.chainSlot
  };
}

// packages/protocols/src/cutoff-capture.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash as createHash3 } from "node:crypto";
var CUTOFF_CLOCK = "SysvarC1ock11111111111111111111111111111111";
var key = /* @__PURE__ */ Symbol.for("paperfund.current-cutoff.capture.v1");
var registry = globalThis;
var storage = registry[key] ?? new AsyncLocalStorage();
registry[key] = storage;
var cutoffCaptureContext = () => storage.getStore();
var cutoffHash = (v) => createHash3("sha256").update(
  canonicalJson(
    JSON.parse(JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x))
  )
).digest("hex");
async function captureCutoffState(load, commitment = "finalized") {
  const batches = [];
  batches.commitment = commitment;
  const state = await storage.run(batches, load);
  const native = state.normalizedState["stage1Snapshot"];
  if (!batches.length && native && BigInt(native.slot) === state.chainSlot) {
    const addresses = Object.keys(native.accounts).sort();
    batches.push({
      addresses,
      result: {
        context: { slot: native.slot },
        value: addresses.map((a) => ({
          owner: native.accounts[a].owner,
          data: [native.accounts[a].base64, "base64"]
        }))
      }
    });
  }
  const matching = batches.filter(
    (b) => BigInt(b.result.context.slot) === state.chainSlot && b.addresses.includes(CUTOFF_CLOCK)
  );
  const batch = matching.at(-1);
  if (!batch) throw Error("CUTOFF_ATOMIC_BANK_MISSING");
  const bankTime = cutoffBankTime(batch);
  const evidence2 = createMarketStateEvidence({
    ...state,
    observedAt: bankTime
  });
  return { evidence: evidence2, batches, bankTime, hash: cutoffHash({ evidence: evidence2, batches, bankTime }) };
}
function cutoffBankTime(batch) {
  const slot = batch.result.context.slot, clock3 = batch.result.value[batch.addresses.indexOf(CUTOFF_CLOCK)];
  const raw = Buffer.from(clock3?.data[0] ?? "", "base64");
  if (!Number.isSafeInteger(slot) || slot < 0 || batch.addresses.length !== batch.result.value.length || clock3?.owner !== "Sysvar1111111111111111111111111111111111111" || raw.length !== 40 || raw.readBigUInt64LE(0) !== BigInt(slot))
    throw Error("CUTOFF_ATOMIC_CLOCK_MISMATCH");
  const seconds = Number(raw.readBigInt64LE(32));
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw Error("CUTOFF_CLOCK_TIME");
  return new Date(seconds * 1e3).toISOString();
}
function verifyCutoffCapture(c, last, next, cutoff) {
  const { hash, ...document } = c;
  if (cutoffHash(document) !== hash || createMarketStateEvidence(c.evidence).fingerprint !== c.evidence.fingerprint)
    throw Error("CUTOFF_CAPTURE_CHANGED");
  if (!Number.isFinite(+cutoff) || +cutoff % 36e5 !== 0 || !Number.isSafeInteger(last.slot) || !Number.isSafeInteger(next.slot) || !Number.isSafeInteger(last.blockTime) || !Number.isSafeInteger(next.blockTime) || !last.blockhash || !next.blockhash || next.slot <= last.slot || next.parentSlot !== last.slot || next.previousBlockhash !== last.blockhash || last.blockTime * 1e3 >= +cutoff || next.blockTime * 1e3 < +cutoff || +cutoff - last.blockTime * 1e3 > 1e4 || c.evidence.chainSlot !== BigInt(last.slot) || Date.parse(c.bankTime) !== last.blockTime * 1e3)
    throw Error("CUTOFF_BOUNDARY_UNPROVEN");
  return verifyCapturedBank(c, last);
}
function verifyCapturedBank(c, last) {
  const { hash, ...document } = c;
  if (cutoffHash(document) !== hash || createMarketStateEvidence(c.evidence).fingerprint !== c.evidence.fingerprint || c.evidence.chainSlot !== BigInt(last.slot) || Date.parse(c.bankTime) !== last.blockTime * 1e3)
    throw Error("CUTOFF_CAPTURE_CHANGED");
  const final = c.batches.filter((b) => b.result.context.slot === last.slot && b.addresses.includes(CUTOFF_CLOCK)).at(-1);
  if (!final || cutoffBankTime(final) !== c.bankTime) throw Error("CUTOFF_BANK_UNPROVEN");
  const model = c.evidence.normalizedState["model"];
  const captured2 = new Map(final.addresses.map((a, i) => [a, final.result.value[i]]));
  const snapshot2 = c.evidence.normalizedState["stage1Snapshot"];
  const accounts = snapshot2?.accounts ?? c.evidence.normalizedState["accounts"];
  if (accounts) {
    if (Object.keys(accounts).some(
      (a) => captured2.get(a)?.owner !== accounts[a].owner || captured2.get(a)?.data[0] !== accounts[a].base64
    ))
      throw Error("CUTOFF_ACCOUNT_BYTES_UNBOUND");
  } else if (model === "PUMP_FUN_BONDING_CURVE") {
    const raw = c.evidence.rawSource;
    if (!raw?.addresses || raw.addresses.length < 4 || raw.addresses.some(
      (a, i) => a !== CUTOFF_CLOCK && captured2.get(a)?.data[0] !== raw.accountDataBase64?.[i]
    ))
      throw Error("CUTOFF_PUMP_BANK_UNBOUND");
  } else if (model === "PUMP_SWAP_CANONICAL_POOL") {
    const n3 = c.evidence.normalizedState;
    if (["poolAddress", "baseMint", "baseVault", "quoteVault"].some(
      (k) => typeof n3[k] !== "string" || !captured2.has(n3[k])
    ) || final.addresses.length < 7)
      throw Error("CUTOFF_POOL_BANK_UNBOUND");
  } else throw Error("CUTOFF_UNSUPPORTED_BANK_BINDING");
  return true;
}
function verifyDurableQuoteCutoff(c, header, cutoff, proof) {
  const { maxAgeMs, uncertaintyMs } = proof, bank = Date.parse(c.bankTime);
  if (!Number.isFinite(+cutoff) || +cutoff % 36e5 !== 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > 1e4 || !Number.isSafeInteger(uncertaintyMs) || uncertaintyMs < 1 || uncertaintyMs > 100 || ![+proof.receivedAt, +proof.certifiedAt, +proof.finalizedAt, bank].every(Number.isFinite) || bank > +proof.receivedAt || +proof.receivedAt > +proof.certifiedAt || +proof.certifiedAt + uncertaintyMs >= +cutoff || bank >= +cutoff || +cutoff - bank > maxAgeMs || +proof.finalizedAt + uncertaintyMs > +cutoff + 6e4 || +proof.finalizedAt < +proof.certifiedAt || !header.blockhash || !Number.isSafeInteger(header.slot) || !Number.isSafeInteger(header.blockTime))
    throw Error("DURABLE_QUOTE_CUTOFF_UNQUALIFIED");
  return verifyCapturedBank(c, header);
}

// packages/protocols/src/rpc-read-context.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var storageKey = /* @__PURE__ */ Symbol.for("paperfund.advisory.read.v1");
var registry2 = globalThis;
var storage2 = registry2[storageKey] ?? new AsyncLocalStorage2();
registry2[storageKey] = storage2;
var advisoryReadContext = () => storage2.getStore();
var withAdvisoryRead = (context, read) => storage2.run(context, read);
function rpcProviderIdentity(url) {
  const host = new URL(url).hostname;
  return host.endsWith(".helius-rpc.com") ? "HELIUS" : host === "api.mainnet-beta.solana.com" || host === "api.mainnet.solana.com" ? "PUBLIC_SOLANA" : "CUSTOM_RPC";
}
var ADVISORY_CLOCK_ACCOUNT = "SysvarC1ock11111111111111111111111111111111";
function advisoryClockTime(account, slot) {
  if (!account || account.owner !== "Sysvar1111111111111111111111111111111111111")
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "SNAPSHOT_CLOCK_UNAVAILABLE");
  const data = Buffer.from(account.data[0], "base64");
  if (data.length < 40 || data.readBigUInt64LE(0) > BigInt(slot))
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "SNAPSHOT_CLOCK_UNAVAILABLE");
  const seconds = data.readBigInt64LE(32);
  if (seconds <= 0n || seconds > 8640000000000n)
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "SNAPSHOT_CLOCK_UNAVAILABLE");
  return new Date(Number(seconds) * 1e3).toISOString();
}

// packages/protocols/src/pump-fun.ts
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@solana/addresses/dist/index.node.cjs";

// packages/protocols/src/sell-capacity.ts
function maximumConstantProductSell(quantity, base, quote, funded, net) {
  let low = 0n;
  let high = quantity;
  const grossFor = (q) => q * quote / (base + q);
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (funded(grossFor(mid))) low = mid;
    else high = mid - 1n;
  }
  while (low > 0n) {
    const gross = grossFor(low);
    if (gross === 0n) return 0n;
    if (net(gross) > 0n) return low;
    low = (gross * base - 1n) / (quote - gross);
  }
  return 0n;
}

// packages/protocols/src/pump-fun.ts
var PUMP_FUN_PROTOCOL_ID = identifier("PUMP_FUN", "ProtocolId");
var PUMP_FUN_ADAPTER_VERSION = "pump-bonding-curve-v1";
var PUMP_FUN_NORMALIZATION_VERSION = "pump-bonding-curve-state-v1";
var PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
var PUMP_FEE_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
var WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
var SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
var ZERO_PUBLIC_KEY = "11111111111111111111111111111111";
var ONE_BILLION_TOKEN_BASE_UNITS = 1000000000000000n;
var BPS_DENOMINATOR = 10000n;
var BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
var GLOBAL_DISCRIMINATOR = Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]);
var FEE_CONFIG_DISCRIMINATOR = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
var addressDecoder = getAddressDecoder();
var addressEncoder = getAddressEncoder();
function requireBytes(data, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} account data is truncated.`);
  }
}
function assertDiscriminator(data, expected, label) {
  requireBytes(data, 0, expected.length, label);
  if (!data.subarray(0, expected.length).equals(expected)) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} discriminator is invalid.`);
  }
}
function readU64(data, offset, label) {
  requireBytes(data, offset, 8, label);
  return data.readBigUInt64LE(offset);
}
function readU128(data, offset, label) {
  requireBytes(data, offset, 16, label);
  return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
}
function readPublicKey(data, offset, label) {
  requireBytes(data, offset, 32, label);
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}
function decodePumpBondingCurve(data) {
  if (data.length < 49) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Bonding curve account is truncated.");
  }
  assertDiscriminator(data, BONDING_CURVE_DISCRIMINATOR, "Bonding curve");
  const optionalPublicKey = (offset) => data.length >= offset + 32 ? readPublicKey(data, offset, "Bonding curve") : ZERO_PUBLIC_KEY;
  const optionalBool = (offset) => data.length > offset ? data[offset] !== 0 : false;
  const optionalU64 = (offset) => data.length >= offset + 8 ? readU64(data, offset, "Bonding curve") : 0n;
  return {
    virtualTokenReserves: readU64(data, 8, "Bonding curve"),
    virtualSolReserves: readU64(data, 16, "Bonding curve"),
    realTokenReserves: readU64(data, 24, "Bonding curve"),
    realSolReserves: readU64(data, 32, "Bonding curve"),
    tokenTotalSupply: readU64(data, 40, "Bonding curve"),
    complete: data[48] !== 0,
    creator: optionalPublicKey(49),
    isMayhemMode: optionalBool(81),
    isCashbackCoin: optionalBool(82),
    quoteMint: optionalPublicKey(83),
    creatorFeeBps: optionalU64(115),
    isHolderReward: optionalBool(124)
  };
}
function decodePumpGlobal(data) {
  if (data.length < 162) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump global account is truncated.");
  }
  assertDiscriminator(data, GLOBAL_DISCRIMINATOR, "Pump global");
  return {
    feeBasisPoints: readU64(data, 105, "Pump global"),
    creatorFeeBasisPoints: readU64(data, 154, "Pump global"),
    creatorFeeConfigurable: data.length > 1045 ? data[1045] !== 0 : false
  };
}
function decodePumpFeeConfig(data) {
  if (data.length < 69) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump fee config account is truncated.");
  }
  assertDiscriminator(data, FEE_CONFIG_DISCRIMINATOR, "Pump fee config");
  const count = data.readUInt32LE(65);
  if (count === 0 || count > 50) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump fee tier count is invalid.");
  }
  const tiers = [];
  let offset = 69;
  for (let index2 = 0; index2 < count; index2 += 1) {
    requireBytes(data, offset, 40, "Pump fee config");
    tiers.push({
      marketCapLamportsThreshold: readU128(data, offset, "Pump fee config"),
      protocolFeeBps: readU64(data, offset + 24, "Pump fee config"),
      creatorFeeBps: readU64(data, offset + 32, "Pump fee config")
    });
    offset += 40;
  }
  for (let index2 = 1; index2 < tiers.length; index2 += 1) {
    if (tiers[index2].marketCapLamportsThreshold < tiers[index2 - 1].marketCapLamportsThreshold) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump fee tiers are not sorted.");
    }
  }
  return { feeTiers: tiers, accountLength: data.length };
}
async function pumpBondingCurveAddress(tokenMint) {
  try {
    return (await getProgramDerivedAddress({
      programAddress: address(PUMP_PROGRAM_ID),
      seeds: [Buffer.from("bonding-curve"), addressEncoder.encode(address(tokenMint))]
    }))[0];
  } catch {
    throw new ExecutionEngineError(
      "INVALID_MARKET_STATE",
      "Pump token mint is not a valid public key."
    );
  }
}
async function pumpGlobalAddress() {
  return (await getProgramDerivedAddress({
    programAddress: address(PUMP_PROGRAM_ID),
    seeds: [Buffer.from("global")]
  }))[0];
}
async function pumpFeeConfigAddress() {
  return (await getProgramDerivedAddress({
    programAddress: address(PUMP_FEE_PROGRAM_ID),
    seeds: [Buffer.from("fee_config"), addressEncoder.encode(address(PUMP_PROGRAM_ID))]
  }))[0];
}
function selectFeeTier(tiers, marketCap) {
  let selected = tiers[0];
  for (const tier of tiers) {
    if (marketCap >= tier.marketCapLamportsThreshold) selected = tier;
  }
  return selected;
}
function ceilDiv(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Invalid integer division operands.");
  }
  return (numerator + denominator - 1n) / denominator;
}
function calculateFee(amount, bps) {
  return ceilDiv(amount * bps, BPS_DENOMINATOR);
}
function validatePumpBondingCurve(curve) {
  if (curve.complete || curve.realTokenReserves === 0n) {
    throw new ExecutionEngineError(
      "MARKET_MIGRATED",
      "Pump bonding curve is complete or migrated."
    );
  }
  if (curve.virtualTokenReserves <= 0n || curve.virtualSolReserves <= 0n || curve.realTokenReserves < 0n || curve.realSolReserves < 0n || curve.tokenTotalSupply <= 0n) {
    throw new ExecutionEngineError(
      "INVALID_MARKET_STATE",
      "Pump bonding curve reserves are invalid."
    );
  }
  if (curve.quoteMint !== ZERO_PUBLIC_KEY && curve.quoteMint !== WRAPPED_SOL_MINT) {
    throw new ExecutionEngineError(
      "UNSUPPORTED_PROTOCOL",
      "Pump quote asset requires composed execution through the canonical router."
    );
  }
}
var discardLog = () => void 0;
var SolanaRpcClient = class {
  #url;
  #commitment;
  #timeoutMs;
  #fetch;
  #log;
  #requestId = 0;
  constructor(options) {
    if (!options.url) throw new ExecutionEngineError("RPC_ERROR", "SOLANA_RPC_URL is required.");
    if ((options.timeoutMs ?? 1e4) <= 0) {
      throw new ExecutionEngineError("RPC_ERROR", "SOLANA_RPC_TIMEOUT_MS must be positive.");
    }
    this.#url = options.url;
    this.#commitment = options.commitment ?? "confirmed";
    this.#timeoutMs = options.timeoutMs ?? 1e4;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#log = options.log ?? discardLog;
  }
  /** Retry the same read at the same commitment; never change venue on transport failure. */
  async request(init) {
    const request = JSON.parse(String(init.body));
    let reason = "Unknown RPC failure";
    const advisory = advisoryReadContext();
    const attempts = advisory ? 2 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      advisory?.signal.throwIfAborted();
      const started = performance.now();
      let retryAfter = 0;
      let networkEnded;
      if (advisory) advisory.metrics.rpcRequests++;
      const rpcRequest = structuredClone(request);
      if (advisory?.minimumSlot !== void 0 && request.method === "getMultipleAccounts")
        rpcRequest.params[1] = {
          ...rpcRequest.params[1],
          minContextSlot: advisory.minimumSlot
        };
      try {
        const response = await this.#fetch(this.#url, {
          ...init,
          body: JSON.stringify(rpcRequest),
          signal: advisory ? AbortSignal.any([
            advisory.signal,
            AbortSignal.timeout(Math.min(1e3, this.#timeoutMs))
          ]) : AbortSignal.timeout(this.#timeoutMs)
        });
        if (advisory && response.status === 429) {
          advisory.metrics.rateLimits++;
          const header = response.headers.get("retry-after");
          retryAfter = header ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1e3 : Math.max(0, Date.parse(header) - Date.now()) : 1e3;
        }
        if (!Number.isFinite(retryAfter) || retryAfter < 0) retryAfter = 1e3;
        if (advisory && retryAfter > 0) advisory.metrics.rateLimitedUntil = Date.now() + retryAfter;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.clone().json();
        if (body.error || body.result === void 0)
          throw new Error(`Rejected JSON-RPC response (${body.error?.code ?? "missing-result"})`);
        if (request.method === "getMultipleAccounts") {
          const result = body.result;
          if (!Array.isArray(result?.value) || result.value.length !== request.params[0].length || !Number.isSafeInteger(result.context?.slot) || result.context.slot < 0 || result.value.some(
            (a) => a !== null && (!a || typeof a.owner !== "string" || !Array.isArray(a.data) || typeof a.data[0] !== "string" || a.data[1] !== "base64")
          ))
            throw new Error("Malformed RPC account snapshot");
        }
        if (advisory && request.method === "getMultipleAccounts") {
          const slot = body.result.context.slot;
          if (advisory.minimumSlot !== void 0 && slot < advisory.minimumSlot)
            throw new Error("RPC slot regression");
          advisory.minimumSlot = slot;
        }
        networkEnded = performance.now();
        return response;
      } catch (error) {
        networkEnded = performance.now();
        reason = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "Request timed out" : error instanceof Error ? safeErrorMessage(error, [this.#url]) : "Transport failure";
        try {
          this.#log("RPC_READ_RETRY", {
            method: request.method,
            attempt: attempt + 1,
            commitment: this.#commitment,
            reason,
            finalCode: attempt === attempts - 1 ? "RPC_UNAVAILABLE" : null
          });
        } catch {
        }
        advisory?.signal.throwIfAborted();
        if (attempt < attempts - 1) {
          if (advisory) advisory.metrics.retries++;
          const delay = advisory ? Math.max(retryAfter, 100 * 2 ** attempt) * (1 + Math.random() * 0.25) : 100 * 2 ** attempt;
          await new Promise((resolve2, reject3) => {
            const abort = () => {
              clearTimeout(timer2);
              reject3(advisory.signal.reason);
            };
            const timer2 = setTimeout(() => {
              advisory?.signal.removeEventListener("abort", abort);
              resolve2();
            }, delay);
            advisory?.signal.addEventListener("abort", abort, { once: true });
          });
        }
      } finally {
        if (advisory) advisory.metrics.rpcMs += (networkEnded ?? performance.now()) - started;
      }
    }
    throw new ExecutionEngineError(
      "RPC_UNAVAILABLE",
      `Solana RPC unavailable after ${attempts} attempts: ${reason}`
    );
  }
  async getMultipleAccounts(addresses) {
    try {
      const capture = cutoffCaptureContext();
      const requested = capture && !addresses.includes(CUTOFF_CLOCK) ? [...addresses, CUTOFF_CLOCK] : addresses;
      const response = await this.request({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.#requestId,
          method: "getMultipleAccounts",
          params: [
            requested,
            { encoding: "base64", commitment: capture ? capture.commitment ?? "finalized" : this.#commitment }
          ]
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
      const body = await response.json();
      if (body.error || !body.result || !Array.isArray(body.result.value) || body.result.value.length !== requested.length || !Number.isSafeInteger(body.result.context?.slot) || body.result.context.slot < 0) {
        throw new Error("Malformed or rejected JSON-RPC response");
      }
      if (capture) capture.push(structuredClone({ addresses: requested, result: body.result }));
      return requested.length === addresses.length ? body.result : { ...body.result, value: body.result.value.slice(0, addresses.length) };
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ExecutionEngineError("RPC_UNAVAILABLE", "Solana RPC request timed out.");
      }
      throw new ExecutionEngineError("RPC_UNAVAILABLE", "Solana RPC request failed.");
    }
  }
  /** Mint discovery only. The caller must verify every candidate against the market PDA. */
  async getProgramAccountAddresses(programId, mint, mintOffset, size) {
    try {
      const response = await this.request({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.#requestId,
          method: "getProgramAccounts",
          params: [
            programId,
            {
              encoding: "base64",
              commitment: this.#commitment,
              filters: [{ dataSize: size }, { memcmp: { offset: mintOffset, bytes: mint } }],
              dataSlice: { offset: 0, length: 0 }
            }
          ]
        })
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.result))
        throw new Error(
          `getProgramAccounts HTTP ${response.status}, RPC code ${body.error?.code ?? "missing-result"}.`
        );
      if (body.result.length > 16) throw new Error("Discovery exceeds bounded pool count.");
      return body.result.map((a) => a.pubkey);
    } catch (error) {
      throw new ExecutionEngineError(
        "RPC_UNAVAILABLE",
        `LAUNCHLAB_STATE_UNAVAILABLE: on-chain pool discovery failed (${safeErrorMessage(error, [this.#url], "unknown error")}).`
      );
    }
  }
  async getOwnedTokenMints(owner) {
    try {
      const mints = [];
      for (const programId of [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const response = await this.request({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.#requestId,
            method: "getTokenAccountsByOwner",
            params: [
              owner,
              { programId },
              {
                encoding: "base64",
                commitment: this.#commitment,
                dataSlice: { offset: 0, length: 32 }
              }
            ]
          })
        });
        const body = await response.json();
        if (!response.ok || !body.result) throw new Error("Token account discovery failed.");
        mints.push(
          ...body.result.value.map(
            ({ account }) => addressDecoder.decode(Buffer.from(account.data[0], "base64"))
          )
        );
      }
      return [...new Set(mints)];
    } catch {
      throw new ExecutionEngineError("RPC_UNAVAILABLE", "Solana token-context discovery failed.");
    }
  }
};
function solanaRpcClientFromEnvironment(environment = process.env) {
  const timeout = environment["SOLANA_RPC_TIMEOUT_MS"];
  const parsedTimeout = timeout === void 0 || timeout === "" ? 1e4 : Number(timeout);
  if (!Number.isSafeInteger(parsedTimeout) || parsedTimeout <= 0) {
    throw new ExecutionEngineError(
      "RPC_ERROR",
      "SOLANA_RPC_TIMEOUT_MS must be a positive integer."
    );
  }
  const commitment = environment["SOLANA_COMMITMENT"];
  if (commitment !== void 0 && commitment !== "" && commitment !== "processed" && commitment !== "confirmed" && commitment !== "finalized") {
    throw new ExecutionEngineError("RPC_ERROR", "SOLANA_COMMITMENT is invalid.");
  }
  return new SolanaRpcClient({
    url: environment["SOLANA_RPC_URL"] ?? "",
    timeoutMs: parsedTimeout,
    ...commitment ? { commitment } : {}
  });
}
function decodeRpcAccount(account, label) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} RPC encoding is invalid.`);
  }
  try {
    return Buffer.from(account.data[0], "base64");
  } catch {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} account data is invalid.`);
  }
}
var PumpFunSolanaMarketStateSource = class {
  constructor(rpc, log2 = discardLog) {
    this.rpc = rpc;
    this.log = log2;
  }
  rpc;
  log;
  async loadMarketState(identity) {
    if (identity.protocolId !== PUMP_FUN_PROTOCOL_ID) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump protocol identity mismatch.");
    }
    const [bondingCurveAddress, globalAddress, feeConfigAddress] = await Promise.all([
      pumpBondingCurveAddress(identity.tokenMint),
      pumpGlobalAddress(),
      pumpFeeConfigAddress()
    ]);
    if (identity.marketId !== bondingCurveAddress) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "Requested market is not the bonding-curve PDA for the requested mint."
      );
    }
    const advisory = advisoryReadContext();
    const addresses = [
      bondingCurveAddress,
      globalAddress,
      feeConfigAddress,
      identity.tokenMint,
      ...advisory ? [ADVISORY_CLOCK_ACCOUNT] : []
    ];
    const response = await this.rpc.getMultipleAccounts(addresses);
    if (response.value.length !== addresses.length) {
      throw new ExecutionEngineError(
        "RPC_ERROR",
        "Solana RPC returned an inconsistent account set."
      );
    }
    const [curveAccount, globalAccount, feeConfigAccount, mintAccount] = response.value;
    if (!curveAccount) {
      throw new ExecutionEngineError(
        "MARKET_ACCOUNT_NOT_FOUND",
        "Pump bonding curve was not found."
      );
    }
    if (!globalAccount || !feeConfigAccount || !mintAccount) {
      throw new ExecutionEngineError(
        "MARKET_STATE_UNAVAILABLE",
        "Required Pump market state is unavailable."
      );
    }
    if (curveAccount.owner !== PUMP_PROGRAM_ID || globalAccount.owner !== PUMP_PROGRAM_ID) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump account owner is invalid.");
    }
    if (feeConfigAccount.owner !== PUMP_FEE_PROGRAM_ID) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump fee config owner is invalid.");
    }
    if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump token mint owner is invalid.");
    }
    const curveBytes = decodeRpcAccount(curveAccount, "Bonding curve");
    const globalBytes = decodeRpcAccount(globalAccount, "Pump global");
    const feeConfigBytes = decodeRpcAccount(feeConfigAccount, "Pump fee config");
    const mintBytes = decodeRpcAccount(mintAccount, "Token mint");
    if (mintBytes.length < 82 || mintBytes[45] === 0) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump token mint account is invalid.");
    }
    const curve = decodePumpBondingCurve(curveBytes);
    validatePumpBondingCurve(curve);
    const global = decodePumpGlobal(globalBytes);
    const feeConfig = decodePumpFeeConfig(feeConfigBytes);
    const mintSupply = readU64(mintBytes, 36, "Token mint");
    const tokenDecimals = mintBytes[44];
    const feeEvaluationMintSupply = curve.isMayhemMode ? mintSupply : ONE_BILLION_TOKEN_BASE_UNITS;
    const marketCap = curve.virtualSolReserves * feeEvaluationMintSupply / curve.virtualTokenReserves;
    const feeTier = selectFeeTier(feeConfig.feeTiers, marketCap);
    const creatorFeeBps = global.creatorFeeConfigurable && curve.creatorFeeBps > 0n ? curve.creatorFeeBps : feeTier.creatorFeeBps;
    if (feeTier.protocolFeeBps > BPS_DENOMINATOR || creatorFeeBps > BPS_DENOMINATOR) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump fee basis points are invalid.");
    }
    const normalizedState = {
      model: "PUMP_FUN_BONDING_CURVE",
      ...advisory ? { chainTime: advisoryClockTime(response.value[4], response.context.slot) } : {},
      programId: PUMP_PROGRAM_ID,
      feeProgramId: PUMP_FEE_PROGRAM_ID,
      bondingCurveAddress,
      globalAddress,
      feeConfigAddress,
      tokenMint: identity.tokenMint,
      tokenProgram: mintAccount.owner,
      tokenDecimals: tokenDecimals.toString(),
      quoteAsset: "SOL",
      virtualTokenReserves: curve.virtualTokenReserves.toString(),
      virtualSolReserves: curve.virtualSolReserves.toString(),
      realTokenReserves: curve.realTokenReserves.toString(),
      realSolReserves: curve.realSolReserves.toString(),
      tokenTotalSupply: curve.tokenTotalSupply.toString(),
      mintSupply: mintSupply.toString(),
      feeEvaluationMintSupply: feeEvaluationMintSupply.toString(),
      complete: curve.complete,
      creator: curve.creator,
      isMayhemMode: curve.isMayhemMode,
      isCashbackCoin: curve.isCashbackCoin,
      isHolderReward: curve.isHolderReward,
      configuredCreatorFeeBps: curve.creatorFeeBps.toString(),
      creatorFeeConfigurable: global.creatorFeeConfigurable,
      protocolFeeBps: feeTier.protocolFeeBps.toString(),
      creatorFeeBps: creatorFeeBps.toString(),
      feeTierMarketCapLamportsThreshold: feeTier.marketCapLamportsThreshold.toString(),
      feeConfigAccountLength: feeConfig.accountLength.toString()
    };
    const state = {
      identity,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      chainSlot: BigInt(response.context.slot),
      chainBlockId: null,
      adapterVersion: PUMP_FUN_ADAPTER_VERSION,
      normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
      normalizedState,
      rawSource: {
        source: "solana-json-rpc:getMultipleAccounts",
        addresses,
        accountDataBase64: [
          curveAccount.data[0],
          globalAccount.data[0],
          feeConfigAccount.data[0],
          mintAccount.data[0]
        ]
      }
    };
    this.log("pump_market_state_loaded", {
      protocol: PUMP_FUN_PROTOCOL_ID,
      market: identity.marketId,
      mint: identity.tokenMint,
      stateSlot: response.context.slot.toString(),
      adapterVersion: PUMP_FUN_ADAPTER_VERSION
    });
    return state;
  }
};
function asPumpState(state) {
  const value = state.normalizedState;
  const requiredStrings = [
    "bondingCurveAddress",
    "tokenMint",
    "virtualTokenReserves",
    "virtualSolReserves",
    "realTokenReserves",
    "realSolReserves",
    "tokenTotalSupply",
    "mintSupply",
    "protocolFeeBps",
    "creatorFeeBps"
  ];
  if (state.adapterVersion !== PUMP_FUN_ADAPTER_VERSION || state.normalizationVersion !== PUMP_FUN_NORMALIZATION_VERSION || value["model"] !== "PUMP_FUN_BONDING_CURVE" || value["programId"] !== PUMP_PROGRAM_ID || value["quoteAsset"] !== "SOL" || value["complete"] !== false || requiredStrings.some((key3) => typeof value[key3] !== "string")) {
    throw new ExecutionEngineError(
      "INVALID_MARKET_STATE",
      "Normalized Pump market state is invalid."
    );
  }
  if (value["tokenMint"] !== state.identity.tokenMint || value["bondingCurveAddress"] !== state.identity.marketId) {
    throw new ExecutionEngineError(
      "INVALID_MARKET_STATE",
      "Normalized Pump market identity is invalid."
    );
  }
  return value;
}
function mathState(state) {
  const normalized = asPumpState(state);
  const result = {
    virtualToken: BigInt(normalized.virtualTokenReserves),
    virtualSol: BigInt(normalized.virtualSolReserves),
    realToken: BigInt(normalized.realTokenReserves),
    realSol: BigInt(normalized.realSolReserves),
    protocolFeeBps: BigInt(normalized.protocolFeeBps),
    creatorFeeBps: BigInt(normalized.creatorFeeBps),
    creatorFeeApplies: normalized.creator !== ZERO_PUBLIC_KEY
  };
  if (result.virtualToken <= 0n || result.virtualSol <= 0n || result.realToken <= 0n) {
    throw new ExecutionEngineError(
      "INVALID_MARKET_STATE",
      "Normalized Pump reserves are impossible."
    );
  }
  return result;
}
function feesFor(amount, state) {
  const protocol2 = calculateFee(amount, state.protocolFeeBps);
  const creator = state.creatorFeeApplies ? calculateFee(amount, state.creatorFeeBps) : 0n;
  return { protocol: protocol2, creator, total: protocol2 + creator };
}
function feeBreakdown(value) {
  const fees = [];
  if (value.protocol > 0n) {
    fees.push({
      category: "PUMP_FUN_PROTOCOL_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits(value.protocol) }
    });
  }
  if (value.creator > 0n) {
    fees.push({
      category: "PUMP_FUN_CREATOR_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits(value.creator) }
    });
  }
  return { fees, totalPaperSolFees: paperSolBaseUnits(value.total) };
}
function simulatePumpBuyAmount(maximumTotalInput, state) {
  if (maximumTotalInput <= 0n) {
    throw new ExecutionEngineError("INVALID_EXECUTION_RESULT", "Pump BUY input must be positive.");
  }
  const totalFeeBps = state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
  const curveBudget = maximumTotalInput <= 1n ? 0n : (maximumTotalInput - 1n) * BPS_DENOMINATOR / (BPS_DENOMINATOR + totalFeeBps);
  const uncappedOutput = curveBudget * state.virtualToken / (state.virtualSol + curveBudget);
  const tokenOutput = uncappedOutput < state.realToken ? uncappedOutput : state.realToken;
  if (tokenOutput <= 0n || tokenOutput >= state.virtualToken) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "Pump BUY produces no valid token output."
    );
  }
  const curveInput = tokenOutput * state.virtualSol / (state.virtualToken - tokenOutput) + 1n;
  const fees = feesFor(curveInput, state);
  const totalInput = curveInput + fees.total;
  if (totalInput > maximumTotalInput) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "Pump BUY exceeds requested total input."
    );
  }
  const postVirtualToken = state.virtualToken - tokenOutput;
  const postVirtualSol = state.virtualSol + curveInput;
  const postRealToken = state.realToken - tokenOutput;
  const postRealSol = state.realSol + curveInput;
  if (postVirtualToken <= 0n || postRealToken < 0n) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "Pump BUY reserve result is invalid."
    );
  }
  const averageVsSpotBps = totalInput * state.virtualToken * BPS_DENOMINATOR / (tokenOutput * state.virtualSol) - BPS_DENOMINATOR;
  return {
    totalInput,
    curveInput,
    tokenOutput,
    fees,
    details: {
      curveInputLamports: curveInput.toString(),
      requestedMaximumTotalLamports: maximumTotalInput.toString(),
      protocolFeeLamports: fees.protocol.toString(),
      creatorFeeLamports: fees.creator.toString(),
      averageVsPreTradeSpotBps: averageVsSpotBps.toString(),
      postTrade: {
        virtualTokenReserves: postVirtualToken.toString(),
        virtualSolReserves: postVirtualSol.toString(),
        realTokenReserves: postRealToken.toString(),
        realSolReserves: postRealSol.toString()
      }
    }
  };
}
function simulatePumpSellAmount(tokenInput, state) {
  if (tokenInput <= 0n) {
    throw new ExecutionEngineError("INVALID_EXECUTION_RESULT", "Pump SELL input must be positive.");
  }
  const grossSolOutput = tokenInput * state.virtualSol / (state.virtualToken + tokenInput);
  const fees = feesFor(grossSolOutput, state);
  const netSolOutput = grossSolOutput - fees.total;
  if (grossSolOutput <= 0n || netSolOutput <= 0n || grossSolOutput > state.realSol) {
    throw new ExecutionEngineError(
      grossSolOutput > state.realSol ? "INSUFFICIENT_EXECUTABLE_LIQUIDITY" : "ZERO_EXECUTABLE_OUTPUT",
      "Pump SELL exceeds real reserves or produces no net SOL."
    );
  }
  const postVirtualToken = state.virtualToken + tokenInput;
  const postVirtualSol = state.virtualSol - grossSolOutput;
  const postRealToken = state.realToken + tokenInput;
  const postRealSol = state.realSol - grossSolOutput;
  if (postVirtualSol <= 0n || postRealSol < 0n) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "Pump SELL reserve result is invalid."
    );
  }
  const spotVsAverageBps = BPS_DENOMINATOR - netSolOutput * state.virtualToken * BPS_DENOMINATOR / (tokenInput * state.virtualSol);
  return {
    tokenInput,
    grossSolOutput,
    netSolOutput,
    fees,
    details: {
      grossSolOutputLamports: grossSolOutput.toString(),
      protocolFeeLamports: fees.protocol.toString(),
      creatorFeeLamports: fees.creator.toString(),
      preTradeSpotVsAverageBps: spotVsAverageBps.toString(),
      postTrade: {
        virtualTokenReserves: postVirtualToken.toString(),
        virtualSolReserves: postVirtualSol.toString(),
        realTokenReserves: postRealToken.toString(),
        realSolReserves: postRealSol.toString()
      }
    }
  };
}
function assertIdentity(expected, actual) {
  if (expected.protocolId !== actual.protocolId || expected.marketId !== actual.marketId || expected.tokenMint !== actual.tokenMint) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Pump market-state identity mismatch.");
  }
}
var PumpFunProtocolAdapter = class {
  constructor(source, log2 = discardLog) {
    this.source = source;
    this.log = log2;
  }
  source;
  log;
  protocolId = PUMP_FUN_PROTOCOL_ID;
  adapterVersion = PUMP_FUN_ADAPTER_VERSION;
  async maxExecutableSellQuantity(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const state = mathState(marketState);
    if (state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n) >= BPS_DENOMINATOR)
      return tokenBaseUnits(0n);
    return tokenBaseUnits(
      maximumConstantProductSell(
        request.tokenQuantity,
        state.virtualToken,
        state.virtualSol,
        (gross) => gross <= state.realSol && gross < state.virtualSol,
        (gross) => gross - feesFor(gross, state).total
      )
    );
  }
  async loadMarketState(identity) {
    try {
      const state = await this.source.loadMarketState(identity);
      assertIdentity(identity, state.identity);
      asPumpState(state);
      return state;
    } catch (error) {
      this.log("pump_market_state_failed", {
        protocol: this.protocolId,
        market: identity.marketId,
        mint: identity.tokenMint,
        adapterVersion: this.adapterVersion,
        errorCode: error instanceof ExecutionEngineError ? error.code : "MARKET_STATE_UNAVAILABLE"
      });
      throw error;
    }
  }
  async simulateBuy(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpBuyAmount(request.requestedPaperSol, mathState(marketState));
    const execution = this.execution(
      request,
      marketState,
      { asset: "PAPER_SOL", amount: request.requestedPaperSol },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits(result.totalInput) },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(result.tokenOutput)
      },
      feeBreakdown(result.fees).fees,
      result.details
    );
    this.log("pump_execution_simulated", {
      protocol: this.protocolId,
      market: request.identity.marketId,
      mint: request.identity.tokenMint,
      stateSlot: marketState.chainSlot?.toString() ?? null,
      adapterVersion: this.adapterVersion,
      executionId: request.executionId,
      evidenceFingerprint: execution.quote.marketStateFingerprint
    });
    return execution;
  }
  async simulateSell(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpSellAmount(request.requestedTokenQuantity, mathState(marketState));
    const execution = this.execution(
      request,
      marketState,
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity
      },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(result.tokenInput)
      },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits(result.netSolOutput) },
      feeBreakdown(result.fees).fees,
      result.details
    );
    this.log("pump_execution_simulated", {
      protocol: this.protocolId,
      market: request.identity.marketId,
      mint: request.identity.tokenMint,
      stateSlot: marketState.chainSlot?.toString() ?? null,
      adapterVersion: this.adapterVersion,
      executionId: request.executionId,
      evidenceFingerprint: execution.quote.marketStateFingerprint
    });
    return execution;
  }
  async valuePositionForExit(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpSellAmount(request.tokenQuantity, mathState(marketState));
    const evidence2 = createMarketStateEvidence(marketState);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(result.netSolOutput),
      feeBreakdown: feeBreakdown(result.fees),
      marketStateFingerprint: evidence2.fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  execution(request, marketState, requestedInput, actualInput, output, fees, executionDetails) {
    const evidence2 = createMarketStateEvidence(marketState);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: marketState.observedAt,
        marketStateFingerprint: evidence2.fingerprint,
        normalizationVersion: marketState.normalizationVersion,
        requestedInput,
        simulatedOutput: output,
        fees
      },
      actualInput,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails
    };
  }
};
function pumpPaperSolFeeTotal(fees) {
  return paperSolBaseUnits(
    fees.reduce(
      (total, fee2) => fee2.amount.asset === "PAPER_SOL" ? total + fee2.amount.amount : total,
      0n
    )
  );
}
function pumpTokenAmount(value) {
  return tokenBaseUnits(value);
}

// packages/protocols/src/solana-routes.ts
import { createHash as createHash4 } from "node:crypto";
import BN2 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bn.js/lib/bn.js";
import { PublicKey as PublicKey2 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import {
  unpackMint,
  unpackAccount,
  getExtensionTypes,
  getTransferFeeConfig,
  calculateEpochFee,
  getTransferHook,
  getDefaultAccountState,
  getPausableConfig
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import {
  CpmmPoolInfoLayout,
  CpmmConfigInfoLayout,
  CurveCalculator,
  LaunchpadPool,
  LaunchpadConfig,
  Curve,
  LaunchConstantProductCurve,
  LinearPriceCurve,
  PlatformConfig,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@raydium-io/raydium-sdk-v2/lib/index.js";
import {
  cpAmmCoder,
  getFeeMode,
  getSwapResultFromExactInput,
  isSwapEnabled,
  derivePoolAuthority,
  InsufficientLiquidityError
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@meteora-ag/cp-amm-sdk/dist/index.js";

// packages/protocols/src/pump-swap.ts
import {
  address as address2,
  getAddressDecoder as getAddressDecoder2,
  getAddressEncoder as getAddressEncoder2,
  getProgramDerivedAddress as getProgramDerivedAddress2
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@solana/addresses/dist/index.node.cjs";
var PUMP_SWAP_PROTOCOL_ID = identifier("PUMP_SWAP", "ProtocolId");
var PUMP_SWAP_ADAPTER_VERSION = "pump-swap-canonical-v1";
var PUMP_SWAP_NORMALIZATION_VERSION = "pump-swap-state-v1";
var PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
var ZERO_PUBLIC_KEY2 = "11111111111111111111111111111111";
var BPS_DENOMINATOR2 = 10000n;
var MAYHEM_TOKEN_SUPPLY = 1000000000000000n;
var POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
var GLOBAL_CONFIG_DISCRIMINATOR = Buffer.from([149, 8, 156, 202, 160, 252, 176, 217]);
var FEE_CONFIG_DISCRIMINATOR2 = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
var addressDecoder2 = getAddressDecoder2();
var addressEncoder2 = getAddressEncoder2();
var discardLog2 = () => void 0;
function requireBytes2(data, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} account data is truncated.`);
  }
}
function assertDiscriminator2(data, expected, label) {
  requireBytes2(data, 0, 8, label);
  if (!data.subarray(0, 8).equals(expected)) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} discriminator is invalid.`);
  }
}
function readU642(data, offset, label) {
  requireBytes2(data, offset, 8, label);
  return data.readBigUInt64LE(offset);
}
function readU1282(data, offset, label) {
  return readU642(data, offset, label) + (readU642(data, offset + 8, label) << 64n);
}
function readI128(data, offset, label) {
  const unsigned = readU1282(data, offset, label);
  return unsigned >= 1n << 127n ? unsigned - (1n << 128n) : unsigned;
}
function readPublicKey2(data, offset, label) {
  requireBytes2(data, offset, 32, label);
  return addressDecoder2.decode(data.subarray(offset, offset + 32));
}
function decodeRpcAccount2(account, label) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} RPC encoding is invalid.`);
  }
  return Buffer.from(account.data[0], "base64");
}
function decodePumpSwapPool(data) {
  if (data.length < 211) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap pool account is truncated.");
  }
  assertDiscriminator2(data, POOL_DISCRIMINATOR, "PumpSwap pool");
  return {
    poolBump: data[8],
    index: data.readUInt16LE(9),
    creator: readPublicKey2(data, 11, "PumpSwap pool"),
    baseMint: readPublicKey2(data, 43, "PumpSwap pool"),
    quoteMint: readPublicKey2(data, 75, "PumpSwap pool"),
    lpMint: readPublicKey2(data, 107, "PumpSwap pool"),
    baseVault: readPublicKey2(data, 139, "PumpSwap pool"),
    quoteVault: readPublicKey2(data, 171, "PumpSwap pool"),
    lpSupply: readU642(data, 203, "PumpSwap pool"),
    coinCreator: data.length >= 243 ? readPublicKey2(data, 211, "PumpSwap pool") : ZERO_PUBLIC_KEY2,
    isMayhemMode: data.length > 243 ? data[243] !== 0 : false,
    isCashbackCoin: data.length > 244 ? data[244] !== 0 : false,
    virtualQuoteReserves: data.length >= 261 ? readI128(data, 245, "PumpSwap pool") : 0n,
    creatorFeeBps: data.length >= 269 ? readU642(data, 261, "PumpSwap pool") : 0n,
    canEditCreatorFee: data.length > 269 ? data[269] !== 0 : false
  };
}
function decodePumpSwapGlobalConfig(data) {
  if (data.length < 321) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap global config is truncated.");
  }
  assertDiscriminator2(data, GLOBAL_CONFIG_DISCRIMINATOR, "PumpSwap global config");
  return {
    lpFeeBps: readU642(data, 40, "PumpSwap global config"),
    protocolFeeBps: readU642(data, 48, "PumpSwap global config"),
    disableFlags: data[56],
    creatorFeeBps: readU642(data, 313, "PumpSwap global config"),
    creatorFeeConfigurable: data.length > 940 ? data[940] !== 0 : false,
    maxConfigurableCreatorFeeBps: data.length >= 949 ? readU642(data, 941, "PumpSwap global config") : 0n
  };
}
function readFees(data, offset, label) {
  return {
    lpFeeBps: readU642(data, offset, label),
    protocolFeeBps: readU642(data, offset + 8, label),
    creatorFeeBps: readU642(data, offset + 16, label)
  };
}
function decodePumpSwapFeeConfig(data) {
  if (data.length < 69) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap fee config is truncated.");
  }
  assertDiscriminator2(data, FEE_CONFIG_DISCRIMINATOR2, "PumpSwap fee config");
  const count = data.readUInt32LE(65);
  if (count === 0 || count > 50) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap fee tier count is invalid.");
  }
  const feeTiers = [];
  let offset = 69;
  for (let index2 = 0; index2 < count; index2 += 1) {
    requireBytes2(data, offset, 40, "PumpSwap fee config");
    feeTiers.push({
      marketCapLamportsThreshold: readU1282(data, offset, "PumpSwap fee config"),
      fees: readFees(data, offset + 16, "PumpSwap fee config")
    });
    offset += 40;
  }
  for (let index2 = 1; index2 < feeTiers.length; index2 += 1) {
    if (feeTiers[index2].marketCapLamportsThreshold < feeTiers[index2 - 1].marketCapLamportsThreshold) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap fee tiers are not sorted.");
    }
  }
  return {
    flatFees: readFees(data, 41, "PumpSwap fee config"),
    feeTiers,
    accountLength: data.length
  };
}
async function derive(programId, seeds) {
  try {
    return (await getProgramDerivedAddress2({
      programAddress: address2(programId),
      seeds
    }))[0];
  } catch {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "A PumpSwap address is invalid.");
  }
}
function pumpPoolAuthorityAddress(tokenMint) {
  return derive(PUMP_PROGRAM_ID, [
    Buffer.from("pool-authority"),
    Buffer.from(addressEncoder2.encode(address2(tokenMint)))
  ]);
}
async function canonicalPumpSwapPoolAddress(tokenMint, quoteMint = WRAPPED_SOL_MINT) {
  const creator = await pumpPoolAuthorityAddress(tokenMint);
  const index2 = Buffer.alloc(2);
  index2.writeUInt16LE(0);
  return derive(PUMP_AMM_PROGRAM_ID, [
    Buffer.from("pool"),
    index2,
    Buffer.from(addressEncoder2.encode(address2(creator))),
    Buffer.from(addressEncoder2.encode(address2(tokenMint))),
    Buffer.from(addressEncoder2.encode(address2(quoteMint)))
  ]);
}
function pumpSwapGlobalConfigAddress() {
  return derive(PUMP_AMM_PROGRAM_ID, [Buffer.from("global_config")]);
}
function pumpSwapFeeConfigAddress() {
  return derive(PUMP_FEE_PROGRAM_ID, [
    Buffer.from("fee_config"),
    Buffer.from(addressEncoder2.encode(address2(PUMP_AMM_PROGRAM_ID)))
  ]);
}
function decodeTokenAccount(data, label) {
  if (data.length < 165 || data[108] === 0) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `${label} token account is invalid.`);
  }
  return {
    mint: readPublicKey2(data, 0, label),
    authority: readPublicKey2(data, 32, label),
    amount: readU642(data, 64, label)
  };
}
function selectFeeTier2(tiers, marketCap) {
  let selected = tiers[0];
  for (const tier of tiers) if (marketCap >= tier.marketCapLamportsThreshold) selected = tier;
  return selected;
}
var PumpSwapSolanaMarketStateSource = class {
  constructor(rpc, log2 = discardLog2) {
    this.rpc = rpc;
    this.log = log2;
  }
  rpc;
  log;
  links = /* @__PURE__ */ new Map();
  async loadMarketState(identity) {
    if (identity.protocolId !== PUMP_SWAP_PROTOCOL_ID) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap protocol identity mismatch."
      );
    }
    const [expectedPool, expectedCreator, globalAddress, feeConfigAddress] = await Promise.all([
      canonicalPumpSwapPoolAddress(identity.tokenMint),
      pumpPoolAuthorityAddress(identity.tokenMint),
      pumpSwapGlobalConfigAddress(),
      pumpSwapFeeConfigAddress()
    ]);
    if (identity.marketId !== expectedPool) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "Requested market is not the canonical PumpSwap pool."
      );
    }
    const advisory = advisoryReadContext();
    let discoveredPool = advisory ? this.links.get(expectedPool) : void 0;
    if (!discoveredPool || discoveredPool.until <= Date.now()) {
      const discovery = await this.rpc.getMultipleAccounts([expectedPool]);
      const account = discovery.value[0];
      if (!account || account.owner !== PUMP_AMM_PROGRAM_ID)
        throw new ExecutionEngineError(
          "MIGRATION_DESTINATION_UNAVAILABLE",
          "Canonical PumpSwap pool was not found."
        );
      const pool2 = decodePumpSwapPool(decodeRpcAccount2(account, "PumpSwap discovery"));
      discoveredPool = {
        until: Date.now() + 6e4,
        baseVault: pool2.baseVault,
        quoteVault: pool2.quoteVault
      };
    }
    const first = await this.rpc.getMultipleAccounts([
      expectedPool,
      globalAddress,
      feeConfigAddress,
      identity.tokenMint,
      discoveredPool.baseVault,
      discoveredPool.quoteVault,
      ...advisory ? [ADVISORY_CLOCK_ACCOUNT] : []
    ]);
    const [
      poolAccount,
      globalAccount,
      feeAccount,
      mintAccount,
      baseVaultAccount,
      quoteVaultAccount
    ] = first.value;
    if (!poolAccount) {
      throw new ExecutionEngineError(
        "MIGRATION_DESTINATION_UNAVAILABLE",
        "Canonical PumpSwap pool was not found."
      );
    }
    if (!globalAccount || !feeAccount || !mintAccount) {
      throw new ExecutionEngineError(
        "MARKET_STATE_UNAVAILABLE",
        "Required PumpSwap market state is unavailable."
      );
    }
    if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || globalAccount.owner !== PUMP_AMM_PROGRAM_ID) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap account owner is invalid.");
    }
    if (feeAccount.owner !== PUMP_FEE_PROGRAM_ID) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap fee config owner is invalid."
      );
    }
    if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap base mint owner is invalid."
      );
    }
    const poolBytes = decodeRpcAccount2(poolAccount, "PumpSwap pool");
    const pool = decodePumpSwapPool(poolBytes);
    if (pool.index !== 0 || pool.creator !== expectedCreator || pool.baseMint !== identity.tokenMint || pool.quoteMint !== WRAPPED_SOL_MINT) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap pool identity is invalid.");
    }
    if (pool.baseVault !== discoveredPool.baseVault || pool.quoteVault !== discoveredPool.quoteVault) {
      this.links.delete(expectedPool);
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap vault linkage changed during discovery."
      );
    }
    const vaults = first;
    if (!baseVaultAccount || !quoteVaultAccount) {
      throw new ExecutionEngineError(
        "MARKET_STATE_UNAVAILABLE",
        "PumpSwap vault state is unavailable."
      );
    }
    if (baseVaultAccount.owner !== mintAccount.owner || quoteVaultAccount.owner !== SPL_TOKEN_PROGRAM_ID) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap vault token program is invalid."
      );
    }
    const baseVault = decodeTokenAccount(
      decodeRpcAccount2(baseVaultAccount, "Base vault"),
      "Base vault"
    );
    const quoteVault = decodeTokenAccount(
      decodeRpcAccount2(quoteVaultAccount, "Quote vault"),
      "Quote vault"
    );
    if (baseVault.mint !== identity.tokenMint || quoteVault.mint !== WRAPPED_SOL_MINT || baseVault.authority !== expectedPool || quoteVault.authority !== expectedPool || baseVault.amount <= 0n || quoteVault.amount <= 0n) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap vault identity or reserves are invalid."
      );
    }
    const mintBytes = decodeRpcAccount2(mintAccount, "Base mint");
    if (mintBytes.length < 82 || mintBytes[45] === 0) {
      throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap base mint is invalid.");
    }
    const mintSupply = readU642(mintBytes, 36, "Base mint");
    const global = decodePumpSwapGlobalConfig(
      decodeRpcAccount2(globalAccount, "PumpSwap global config")
    );
    const feeConfig = decodePumpSwapFeeConfig(decodeRpcAccount2(feeAccount, "PumpSwap fee config"));
    const effectiveQuote = quoteVault.amount + pool.virtualQuoteReserves;
    if (effectiveQuote <= 0n || effectiveQuote > 0xffffffffffffffffn) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap effective quote reserves are invalid."
      );
    }
    const feeSupply = pool.isMayhemMode ? MAYHEM_TOKEN_SUPPLY : mintSupply;
    const marketCap = effectiveQuote * feeSupply / baseVault.amount;
    const selectedTier = selectFeeTier2(feeConfig.feeTiers, marketCap);
    const creatorFeeBps = global.creatorFeeConfigurable && pool.creatorFeeBps > 0n ? pool.creatorFeeBps : selectedTier.fees.creatorFeeBps;
    const fees = { ...selectedTier.fees, creatorFeeBps };
    if (fees.lpFeeBps + fees.protocolFeeBps + fees.creatorFeeBps >= BPS_DENOMINATOR2 || global.creatorFeeConfigurable && creatorFeeBps > global.maxConfigurableCreatorFeeBps) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "PumpSwap fee configuration is invalid."
      );
    }
    const normalizedState = {
      model: "PUMP_SWAP_CANONICAL_POOL",
      ...advisory ? { chainTime: advisoryClockTime(first.value[6], first.context.slot) } : {},
      programId: PUMP_AMM_PROGRAM_ID,
      feeProgramId: PUMP_FEE_PROGRAM_ID,
      poolAddress: expectedPool,
      canonicalCreator: expectedCreator,
      baseMint: identity.tokenMint,
      quoteMint: WRAPPED_SOL_MINT,
      baseVault: pool.baseVault,
      quoteVault: pool.quoteVault,
      baseTokenProgram: mintAccount.owner,
      quoteTokenProgram: quoteVaultAccount.owner,
      tokenDecimals: mintBytes[44].toString(),
      mintSupply: mintSupply.toString(),
      baseReserves: baseVault.amount.toString(),
      rawQuoteReserves: quoteVault.amount.toString(),
      virtualQuoteReserves: pool.virtualQuoteReserves.toString(),
      effectiveQuoteReserves: effectiveQuote.toString(),
      coinCreator: pool.coinCreator,
      isMayhemMode: pool.isMayhemMode,
      isCashbackCoin: pool.isCashbackCoin,
      disableFlags: global.disableFlags.toString(),
      lpFeeBps: fees.lpFeeBps.toString(),
      protocolFeeBps: fees.protocolFeeBps.toString(),
      creatorFeeBps: fees.creatorFeeBps.toString(),
      creatorFeeApplies: pool.coinCreator !== ZERO_PUBLIC_KEY2,
      feeTierMarketCapLamportsThreshold: selectedTier.marketCapLamportsThreshold.toString(),
      feeConfigAccountLength: feeConfig.accountLength.toString(),
      poolAccountLength: poolBytes.length.toString(),
      stateSlots: {
        configuration: first.context.slot.toString(),
        reserves: vaults.context.slot.toString()
      }
    };
    const state = {
      identity,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      chainSlot: BigInt(vaults.context.slot),
      chainBlockId: null,
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
      normalizationVersion: PUMP_SWAP_NORMALIZATION_VERSION,
      normalizedState
    };
    if (advisory) {
      if (this.links.size >= 256) this.links.delete(this.links.keys().next().value);
      this.links.set(expectedPool, discoveredPool);
    }
    this.log("pump_swap_market_state_loaded", {
      protocol: PUMP_SWAP_PROTOCOL_ID,
      market: expectedPool,
      mint: identity.tokenMint,
      slot: vaults.context.slot.toString(),
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION
    });
    return state;
  }
};
function asState(state) {
  const value = state.normalizedState;
  if (state.identity.protocolId !== PUMP_SWAP_PROTOCOL_ID || state.adapterVersion !== PUMP_SWAP_ADAPTER_VERSION || state.normalizationVersion !== PUMP_SWAP_NORMALIZATION_VERSION || value.model !== "PUMP_SWAP_CANONICAL_POOL" || value.programId !== PUMP_AMM_PROGRAM_ID || value.poolAddress !== state.identity.marketId || value.baseMint !== state.identity.tokenMint || value.quoteMint !== WRAPPED_SOL_MINT) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap normalized state is invalid.");
  }
  return value;
}
function bigintField(value, label) {
  if (typeof value !== "string" || !/^-?[0-9]+$/.test(value)) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", `PumpSwap ${label} is invalid.`);
  }
  return BigInt(value);
}
function mathState2(state) {
  const value = asState(state);
  const result = {
    base: bigintField(value.baseReserves, "base reserves"),
    rawQuote: bigintField(value.rawQuoteReserves, "quote reserves"),
    effectiveQuote: bigintField(value.effectiveQuoteReserves, "effective quote reserves"),
    virtualQuote: bigintField(value.virtualQuoteReserves, "virtual quote reserves"),
    lpFeeBps: bigintField(value.lpFeeBps, "LP fee"),
    protocolFeeBps: bigintField(value.protocolFeeBps, "protocol fee"),
    creatorFeeBps: bigintField(value.creatorFeeBps, "creator fee"),
    creatorFeeApplies: value.creatorFeeApplies,
    disableFlags: Number(bigintField(value.disableFlags, "disable flags"))
  };
  if (result.base <= 0n || result.rawQuote <= 0n || result.effectiveQuote <= 0n || result.effectiveQuote !== result.rawQuote + result.virtualQuote || result.effectiveQuote > 0xffffffffffffffffn || [result.lpFeeBps, result.protocolFeeBps, result.creatorFeeBps].some((fee2) => fee2 < 0n) || result.lpFeeBps + result.protocolFeeBps + result.creatorFeeBps >= BPS_DENOMINATOR2) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap reserves are invalid.");
  }
  return result;
}
function ceilDiv2(value, divisor) {
  if (value < 0n || divisor <= 0n)
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Invalid division.");
  return (value + divisor - 1n) / divisor;
}
function fee(amount, bps) {
  return bps === 0n ? 0n : ceilDiv2(amount * bps, BPS_DENOMINATOR2);
}
function feesFor2(amount, state) {
  const lp = fee(amount, state.lpFeeBps);
  const protocol2 = fee(amount, state.protocolFeeBps);
  const creator = state.creatorFeeApplies ? fee(amount, state.creatorFeeBps) : 0n;
  return { lp, protocol: protocol2, creator, total: lp + protocol2 + creator };
}
function feeBreakdown2(fees) {
  const values = [];
  if (fees.lp > 0n)
    values.push({
      category: "PUMP_SWAP_LP_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits(fees.lp) }
    });
  if (fees.protocol > 0n)
    values.push({
      category: "PUMP_SWAP_PROTOCOL_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits(fees.protocol) }
    });
  if (fees.creator > 0n)
    values.push({
      category: "PUMP_SWAP_CREATOR_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits(fees.creator) }
    });
  return { fees: values, totalPaperSolFees: paperSolBaseUnits(fees.total) };
}
function simulatePumpSwapBuyAmount(totalBudget, state) {
  if (totalBudget <= 1n || (state.disableFlags & 8) !== 0) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "PumpSwap BUY is disabled or has no usable input."
    );
  }
  const totalFeeBps = state.lpFeeBps + state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
  let internalQuote = totalBudget * BPS_DENOMINATOR2 / (BPS_DENOMINATOR2 + totalFeeBps);
  let fees = feesFor2(internalQuote, state);
  if (internalQuote + fees.total > totalBudget)
    internalQuote -= internalQuote + fees.total - totalBudget;
  if (internalQuote <= 1n)
    throw new ExecutionEngineError("INVALID_EXECUTION_RESULT", "PumpSwap BUY produces no output.");
  const invariantInput = internalQuote - 1n;
  const tokenOutput = state.base * invariantInput / (state.effectiveQuote + invariantInput);
  if (tokenOutput <= 0n || tokenOutput >= state.base)
    throw new ExecutionEngineError("INVALID_EXECUTION_RESULT", "PumpSwap BUY produces no output.");
  const exactInternalQuote = ceilDiv2(state.effectiveQuote * tokenOutput, state.base - tokenOutput);
  fees = feesFor2(exactInternalQuote, state);
  const totalInput = exactInternalQuote + fees.total;
  if (totalInput > totalBudget)
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "PumpSwap BUY exceeds its input budget."
    );
  return {
    totalInput,
    internalQuote: exactInternalQuote,
    tokenOutput,
    fees,
    details: {
      internalQuoteInputLamports: exactInternalQuote.toString(),
      requestedMaximumTotalLamports: totalBudget.toString(),
      postTrade: {
        baseReserves: (state.base - tokenOutput).toString(),
        rawQuoteReserves: (state.rawQuote + totalInput - fees.protocol - fees.creator).toString(),
        effectiveQuoteReserves: (state.effectiveQuote + totalInput - fees.protocol - fees.creator).toString()
      }
    }
  };
}
function simulatePumpSwapSellAmount(tokenInput, state) {
  if (tokenInput <= 0n || (state.disableFlags & 16) !== 0) {
    throw new ExecutionEngineError(
      "INVALID_EXECUTION_RESULT",
      "PumpSwap SELL is disabled or invalid."
    );
  }
  const gross = state.effectiveQuote * tokenInput / (state.base + tokenInput);
  const fees = feesFor2(gross, state);
  const net = gross - fees.total;
  if (gross <= 0n || net <= 0n || state.rawQuote < gross - fees.lp) {
    throw new ExecutionEngineError(
      state.rawQuote < gross - fees.lp ? "INSUFFICIENT_EXECUTABLE_LIQUIDITY" : "ZERO_EXECUTABLE_OUTPUT",
      "PumpSwap SELL exceeds reserves or produces no output."
    );
  }
  return {
    tokenInput,
    grossQuoteOutput: gross,
    netQuoteOutput: net,
    fees,
    details: {
      grossQuoteOutputLamports: gross.toString(),
      postTrade: {
        baseReserves: (state.base + tokenInput).toString(),
        rawQuoteReserves: (state.rawQuote - gross + fees.lp).toString(),
        effectiveQuoteReserves: (state.effectiveQuote - gross + fees.lp).toString()
      }
    }
  };
}
function assertIdentity2(expected, actual) {
  if (expected.protocolId !== actual.protocolId || expected.marketId !== actual.marketId || expected.tokenMint !== actual.tokenMint) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "PumpSwap identity mismatch.");
  }
}
var PumpSwapProtocolAdapter = class {
  constructor(source, log2 = discardLog2) {
    this.source = source;
    this.log = log2;
  }
  source;
  log;
  protocolId = PUMP_SWAP_PROTOCOL_ID;
  adapterVersion = PUMP_SWAP_ADAPTER_VERSION;
  async maxExecutableSellQuantity(request, marketState) {
    assertIdentity2(request.identity, marketState.identity);
    const state = mathState2(marketState);
    if ((state.disableFlags & 16) !== 0)
      throw new ExecutionEngineError("PROTOCOL_DISABLED", "PumpSwap SELL is disabled.");
    if (state.lpFeeBps + state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n) >= BPS_DENOMINATOR2)
      return tokenBaseUnits(0n);
    return tokenBaseUnits(
      maximumConstantProductSell(
        request.tokenQuantity,
        state.base,
        state.effectiveQuote,
        (gross) => state.rawQuote >= gross - feesFor2(gross, state).lp,
        (gross) => gross - feesFor2(gross, state).total
      )
    );
  }
  async loadMarketState(identity) {
    const state = await this.source.loadMarketState(identity);
    assertIdentity2(identity, state.identity);
    asState(state);
    return state;
  }
  async simulateBuy(request, state) {
    assertIdentity2(request.identity, state.identity);
    const result = simulatePumpSwapBuyAmount(request.requestedPaperSol, mathState2(state));
    return this.execution(
      request,
      state,
      { asset: "PAPER_SOL", amount: request.requestedPaperSol },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits(result.totalInput) },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(result.tokenOutput)
      },
      feeBreakdown2(result.fees).fees,
      result.details
    );
  }
  async simulateSell(request, state) {
    assertIdentity2(request.identity, state.identity);
    const result = simulatePumpSwapSellAmount(request.requestedTokenQuantity, mathState2(state));
    return this.execution(
      request,
      state,
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity
      },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(result.tokenInput)
      },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits(result.netQuoteOutput) },
      feeBreakdown2(result.fees).fees,
      result.details
    );
  }
  async valuePositionForExit(request, state) {
    assertIdentity2(request.identity, state.identity);
    const result = simulatePumpSwapSellAmount(request.tokenQuantity, mathState2(state));
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(result.netQuoteOutput),
      feeBreakdown: feeBreakdown2(result.fees),
      marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  execution(request, state, requestedInput, actualInput, output, fees, executionDetails) {
    const evidence2 = createMarketStateEvidence(state);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: evidence2.fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput,
        simulatedOutput: output,
        fees
      },
      actualInput,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails
    };
  }
};
var PumpMigrationResolver = class {
  constructor(rpc) {
    this.rpc = rpc;
  }
  rpc;
  originProtocolId = PUMP_FUN_PROTOCOL_ID;
  async resolveExecutionRoute(identity) {
    if (identity.protocolId !== PUMP_FUN_PROTOCOL_ID)
      throw new ExecutionEngineError(
        "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
        "Pump migration resolver received another protocol."
      );
    const curveAddress = await pumpBondingCurveAddress(identity.tokenMint);
    if (identity.marketId !== curveAddress)
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "Pump position market is not its bonding curve."
      );
    const response = await this.rpc.getMultipleAccounts([curveAddress]);
    const account = response.value[0];
    if (!account)
      throw new ExecutionEngineError(
        "MARKET_ACCOUNT_NOT_FOUND",
        "Pump bonding curve was not found."
      );
    if (account.owner !== PUMP_PROGRAM_ID)
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "Pump bonding curve owner is invalid."
      );
    const curve = decodePumpBondingCurve(decodeRpcAccount2(account, "Bonding curve"));
    if (!curve.complete && curve.realTokenReserves > 0n)
      return { originIdentity: identity, executionIdentity: identity, migrated: false };
    if (curve.quoteMint !== ZERO_PUBLIC_KEY2 && curve.quoteMint !== WRAPPED_SOL_MINT) {
      throw new ExecutionEngineError(
        "UNSUPPORTED_MIGRATED_PROTOCOL",
        "Pump migration quote asset requires composed execution through the canonical router."
      );
    }
    const pool = await canonicalPumpSwapPoolAddress(identity.tokenMint);
    return {
      originIdentity: identity,
      executionIdentity: {
        protocolId: PUMP_SWAP_PROTOCOL_ID,
        marketId: identifier(pool, "MarketId"),
        tokenMint: identity.tokenMint
      },
      migrated: true
    };
  }
};
function pumpSwapPaperSolFeeTotal(fees) {
  return paperSolBaseUnits(
    fees.reduce(
      (total, item) => item.amount.asset === "PAPER_SOL" ? total + item.amount.amount : total,
      0n
    )
  );
}

// packages/protocols/src/composed-pump-orca.ts
import { WhirlpoolsError, SwapErrorCode } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/errors/errors.js";
import { PublicKey } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { getAssociatedTokenAddressSync } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import BN from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bn.js/lib/bn.js";
import { Percentage } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@orca-so/common-sdk/dist/index.js";
import { createRequire } from "node:module";
import {
  ParsableWhirlpool,
  ParsableTickArray,
  ParsableOracle,
  ParsableWhirlpoolsConfig,
  PoolUtil,
  PDAUtil,
  SwapUtils,
  swapQuoteWithParams,
  NO_TOKEN_EXTENSION_CONTEXT,
  TickUtil
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/index.js";
var { PUMP_SDK, computeFeesBps, getBuyTokenAmountFromSolAmount, getBuySolAmountFromTokenAmount } = createRequire(import.meta.url)("@pump-fun/pump-sdk");
var ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
var key2 = (value) => new PublicKey(value);
var n = (value) => BigInt(value.toString(10));
var info = (a) => ({
  owner: key2(a.owner),
  data: Buffer.from(a.base64, "base64"),
  executable: false,
  lamports: 0,
  rentEpoch: 0
});
function fail(message) {
  throw new ExecutionEngineError("INVALID_MARKET_STATE", message);
}
function orcaLink(pool, account) {
  const data = ParsableWhirlpool.parse(key2(pool), info(account));
  if (!data || account.owner !== ORCA_WHIRLPOOL_PROGRAM) fail("Invalid Orca pool.");
  const ticks = [true, false].flatMap(
    (direction) => SwapUtils.getTickArrayPublicKeys(
      data.tickCurrentIndex,
      data.tickSpacing,
      direction,
      key2(account.owner),
      key2(pool)
    ).map((p) => p.toBase58())
  );
  return {
    pool,
    program: account.owner,
    mintA: data.tokenMintA.toBase58(),
    mintB: data.tokenMintB.toBase58(),
    vaultA: data.tokenVaultA.toBase58(),
    vaultB: data.tokenVaultB.toBase58(),
    config: data.whirlpoolsConfig.toBase58(),
    extraAccounts: [
      .../* @__PURE__ */ new Set([...ticks, PDAUtil.getOracle(key2(account.owner), key2(pool)).publicKey.toBase58()])
    ]
  };
}
function pumpQuoteMint(account) {
  if (account.owner !== PUMP_PROGRAM_ID) fail("Invalid Pump owner.");
  return PUMP_SDK.decodeBondingCurve(info(account)).quoteMint.toBase58();
}
function pumpLink(pool, account, mint, baseProgram, quoteProgram) {
  const curve = PUMP_SDK.decodeBondingCurve(info(account));
  const program2 = key2(PUMP_PROGRAM_ID);
  const expected = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), key2(mint).toBuffer()],
    program2
  )[0];
  if (account.owner !== PUMP_PROGRAM_ID || expected.toBase58() !== pool || curve.quoteMint.equals(PublicKey.default))
    fail("Invalid composed Pump curve identity/quote.");
  return {
    pool,
    program: PUMP_PROGRAM_ID,
    mintA: mint,
    mintB: curve.quoteMint.toBase58(),
    vaultA: getAssociatedTokenAddressSync(key2(mint), expected, true, key2(baseProgram)).toBase58(),
    vaultB: getAssociatedTokenAddressSync(
      curve.quoteMint,
      expected,
      true,
      key2(quoteProgram)
    ).toBase58(),
    config: PublicKey.findProgramAddressSync([Buffer.from("global")], program2)[0].toBase58(),
    platform: PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), program2.toBuffer()],
      key2(PUMP_FEE_PROGRAM_ID)
    )[0].toBase58()
  };
}
function quoteSupplementalHop(hop, accounts, amount, aToB, time, supply, absentAccounts) {
  const need4 = (address3) => {
    const a = accounts[address3];
    if (!a) fail(`Missing composed account ${address3}.`);
    return a;
  };
  const pool = need4(hop.pool);
  if (hop.program === PUMP_PROGRAM_ID) {
    const c = PUMP_SDK.decodeBondingCurve(info(pool));
    const expected = pumpLink(
      hop.pool,
      pool,
      hop.mintA,
      need4(hop.mintA).owner,
      need4(hop.mintB).owner
    );
    if (Object.keys(expected).some((k) => expected[k] !== hop[k]))
      fail("Pump curve linkage changed.");
    if (c.complete || c.virtualTokenReserves.lten(0) || c.virtualQuoteReserves.lten(0) || c.realTokenReserves.isNeg() || c.realQuoteReserves.isNeg())
      fail("Pump curve state is inactive or inconsistent.");
    const globalAccount = need4(hop.config), feeAccount = need4(hop.platform);
    if (globalAccount.owner !== PUMP_PROGRAM_ID || feeAccount.owner !== PUMP_FEE_PROGRAM_ID)
      fail("Pump config owner mismatch.");
    const global = PUMP_SDK.decodeGlobal(info(globalAccount)), feeConfig = PUMP_SDK.decodeFeeConfig(info(feeAccount));
    const fees = computeFeesBps({
      global,
      feeConfig,
      mintSupply: new BN((c.isMayhemMode ? supply : 1000000000000000n).toString()),
      virtualQuoteReserves: c.virtualQuoteReserves,
      virtualTokenReserves: c.virtualTokenReserves,
      quoteMint: c.quoteMint,
      creatorFeeBps: c.creatorFeeBps
    });
    const protocolBps = n(fees.protocolFeeBps), creatorBps = c.creator.equals(PublicKey.default) ? 0n : n(fees.creatorFeeBps);
    if (protocolBps < 0n || creatorBps < 0n || protocolBps + creatorBps >= 10000n)
      fail("Invalid composed Pump fees.");
    const params = {
      global,
      feeConfig,
      mintSupply: new BN((c.isMayhemMode ? supply : 1000000000000000n).toString()),
      bondingCurve: c,
      quoteMint: c.quoteMint
    };
    let gross, output, consumed = amount;
    if (aToB) {
      gross = amount * n(c.virtualQuoteReserves) / (n(c.virtualTokenReserves) + amount);
      if (gross > n(c.realQuoteReserves))
        throw new ExecutionEngineError(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "Pump quote liquidity exhausted."
        );
      output = gross;
    } else {
      output = n(getBuyTokenAmountFromSolAmount({ ...params, amount: new BN(amount.toString()) }));
      consumed = n(
        getBuySolAmountFromTokenAmount({ ...params, amount: new BN(output.toString()) })
      );
      gross = output * n(c.virtualQuoteReserves) / (n(c.virtualTokenReserves) - output) + 1n;
      if (output === n(c.realTokenReserves) && consumed < amount)
        throw new ExecutionEngineError(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "LAUNCHLAB_BUY_CAP: Pump composed input exceeds remaining sale."
        );
    }
    const protocol2 = (gross * protocolBps + 9999n) / 10000n, creator = (gross * creatorBps + 9999n) / 10000n;
    if (aToB) output -= protocol2 + creator;
    return {
      output,
      feeMint: hop.mintB,
      protocol: protocol2,
      creator,
      lp: 0n,
      detail: {
        virtualBase: c.virtualTokenReserves.toString(),
        virtualQuote: c.virtualQuoteReserves.toString(),
        realBase: c.realTokenReserves.toString(),
        realQuote: c.realQuoteReserves.toString(),
        unusedQuoteInput: aToB ? "0" : (amount - consumed).toString()
      }
    };
  }
  const { data, ticks, oracle } = readOrcaSnapshot(hop, accounts, aToB, absentAccounts);
  const q = (() => {
    try {
      return swapQuoteWithParams(
        {
          whirlpoolData: data,
          tokenAmount: new BN(amount.toString()),
          otherAmountThreshold: new BN(0),
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          aToB,
          amountSpecifiedIsInput: true,
          tickArrays: ticks,
          oracleData: oracle,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
          timestampInSeconds: new BN(time.toString())
        },
        Percentage.fromFraction(0, 1)
      );
    } catch (error) {
      if (error instanceof WhirlpoolsError && error.errorCode === SwapErrorCode.TickArraySequenceInvalid)
        throw new ExecutionEngineError(
          "MARKET_STATE_UNAVAILABLE",
          "Orca captured tick range cannot establish this quote."
        );
      throw error;
    }
  })();
  if (n(q.estimatedAmountIn) !== amount)
    throw new ExecutionEngineError(
      "MARKET_STATE_UNAVAILABLE",
      "Orca captured tick range cannot establish the full input quote."
    );
  return {
    output: n(q.estimatedAmountOut),
    feeMint: aToB ? hop.mintA : hop.mintB,
    protocol: 0n,
    creator: 0n,
    lp: n(q.estimatedFeeAmount),
    feeCategory: "AMM_TRADE_FEE",
    detail: {
      tradeFeeRate: data.feeRate,
      protocolShareRate: data.protocolFeeRate,
      totalTradeFee: q.estimatedFeeAmount.toString(),
      sqrtPrice: data.sqrtPrice.toString(),
      endSqrtPrice: q.estimatedEndSqrtPrice.toString(),
      tickCurrentIndex: data.tickCurrentIndex,
      endTick: q.estimatedEndTickIndex
    }
  };
}
function readOrcaSnapshot(hop, accounts, aToB, absentAccounts) {
  const need4 = (address3) => {
    const a = accounts[address3];
    if (!a) fail("Missing composed account " + address3);
    return a;
  };
  const pool = need4(hop.pool);
  const data = ParsableWhirlpool.parse(key2(hop.pool), info(pool));
  if (!data || pool.owner !== ORCA_WHIRLPOOL_PROGRAM) fail("Orca pool is invalid.");
  const config2 = need4(data.whirlpoolsConfig.toBase58());
  const feeTierIndex = data.feeTierIndexSeed[0] + data.feeTierIndexSeed[1] * 256;
  if (config2.owner !== hop.program || !ParsableWhirlpoolsConfig.parse(data.whirlpoolsConfig, info(config2)) || PDAUtil.getWhirlpool(
    key2(hop.program),
    data.whirlpoolsConfig,
    data.tokenMintA,
    data.tokenMintB,
    feeTierIndex
  ).publicKey.toBase58() !== hop.pool)
    fail("Orca config/pool PDA mismatch.");
  const ticks = SwapUtils.getTickArrayPublicKeys(
    data.tickCurrentIndex,
    data.tickSpacing,
    aToB,
    key2(hop.program),
    key2(hop.pool)
  ).map((address3, index2) => {
    const startTickIndex = TickUtil.getStartTickIndex(
      data.tickCurrentIndex + (aToB ? 0 : data.tickSpacing),
      data.tickSpacing,
      aToB ? -index2 : index2
    );
    const raw = accounts[address3.toBase58()];
    if (!raw && absentAccounts.includes(address3.toBase58()))
      return { address: address3, startTickIndex, data: null };
    if (!raw) fail("Required Orca tick snapshot was not captured.");
    if (raw.owner !== hop.program) fail("Orca tick array owner mismatch.");
    const parsed = ParsableTickArray.parse(address3, info(raw));
    if (!parsed || parsed.whirlpool.toBase58() !== hop.pool || PDAUtil.getTickArray(
      key2(hop.program),
      key2(hop.pool),
      parsed.startTickIndex
    ).publicKey.toBase58() !== address3.toBase58())
      fail("Orca tick array linkage invalid.");
    return { address: address3, startTickIndex, data: parsed };
  });
  const oracleAddress = PDAUtil.getOracle(key2(hop.program), key2(hop.pool)).publicKey;
  const rawOracle = accounts[oracleAddress.toBase58()];
  if (rawOracle && rawOracle.owner !== hop.program) fail("Orca oracle owner mismatch.");
  const oracle = rawOracle ? ParsableOracle.parse(oracleAddress, info(rawOracle)) : null;
  if (rawOracle && !oracle || PoolUtil.isInitializedWithAdaptiveFee(data) && !oracle)
    fail("Required Orca oracle state is unavailable.");
  return { data, ticks, oracle };
}
function assertOrcaSnapshot(hop, accounts, absentAccounts) {
  readOrcaSnapshot(hop, accounts, true, absentAccounts);
  readOrcaSnapshot(hop, accounts, false, absentAccounts);
}

// packages/protocols/src/solana-routes.ts
var SOLANA_ROUTE_PROTOCOL_ID = identifier("SOLANA_ROUTE", "ProtocolId");
var RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
var METEORA_DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
var RAYDIUM_LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
var CLOCK = "SysvarC1ock11111111111111111111111111111111";
var VERSION = "solana-composed-route-v1";
function fail2(message) {
  throw new ExecutionEngineError("POSITION_EXECUTION_ROUTE_UNAVAILABLE", message);
}
function bytes(account) {
  return Buffer.from(account.base64, "base64");
}
function camelFields(value) {
  if (Array.isArray(value)) return value.map(camelFields);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key3, item]) => [
        key3.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase()),
        camelFields(item)
      ])
    );
  return value;
}
function dammPool(data) {
  return camelFields(cpAmmCoder.accounts.decode("Pool", data));
}
function discriminator(data, name) {
  if (!data.subarray(0, 8).equals(createHash4("sha256").update(`account:${name}`).digest().subarray(0, 8)))
    fail2(`Invalid ${name} discriminator.`);
}
function decodePoolLink(pool, account) {
  if (account.owner === ORCA_WHIRLPOOL_PROGRAM) return orcaLink(pool, account);
  const data = bytes(account);
  if (account.owner === RAYDIUM_CPMM_PROGRAM) {
    discriminator(data, "PoolState");
    if (data.length !== CpmmPoolInfoLayout.span)
      fail2("Raydium CPMM account version/size is unknown.");
    const p = CpmmPoolInfoLayout.decode(data);
    return {
      pool,
      program: account.owner,
      mintA: p.mintA.toBase58(),
      mintB: p.mintB.toBase58(),
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      config: p.configId.toBase58()
    };
  }
  if (account.owner === RAYDIUM_LAUNCHLAB_PROGRAM) {
    discriminator(data, "PoolState");
    if (data.length !== LaunchpadPool.span)
      fail2("Raydium LaunchLab account version/size is unknown.");
    const p = LaunchpadPool.decode(data);
    return {
      pool,
      program: account.owner,
      mintA: p.mintA.toBase58(),
      mintB: p.mintB.toBase58(),
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      config: p.configId.toBase58(),
      platform: p.platformId.toBase58()
    };
  }
  if (account.owner === METEORA_DAMM_V2_PROGRAM) {
    const p = dammPool(data);
    return {
      pool,
      program: account.owner,
      mintA: p.tokenAMint.toBase58(),
      mintB: p.tokenBMint.toBase58(),
      vaultA: p.tokenAVault.toBase58(),
      vaultB: p.tokenBVault.toBase58(),
      config: null
    };
  }
  return fail2(`No verified decoder for market ${pool}, owner ${account.owner}.`);
}
function accountInfo(a) {
  return {
    data: bytes(a),
    owner: new PublicKey2(a.owner),
    executable: false,
    lamports: 0,
    rentEpoch: 0
  };
}
function mintInfo(address3, a) {
  if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner))
    fail2(`Mint ${address3} has invalid owner.`);
  const mint = unpackMint(new PublicKey2(address3), accountInfo(a), new PublicKey2(a.owner));
  if (!mint.isInitialized) fail2(`Mint ${address3} is uninitialized.`);
  const safe = /* @__PURE__ */ new Set([0, 1, 3, 4, 6, 10, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26, 28]);
  const unknown = getExtensionTypes(mint.tlvData).filter((type) => !safe.has(type));
  if (unknown.length)
    fail2(`Mint ${address3} requires transfer-extension simulation (${unknown.join(",")}).`);
  const hook = getTransferHook(mint);
  if (hook && !hook.programId.equals(PublicKey2.default))
    fail2(`Mint ${address3} has an active transfer hook ${hook.programId.toBase58()}.`);
  if (getDefaultAccountState(mint)?.state === 2 || getPausableConfig(mint)?.paused)
    fail2(`Mint ${address3} is frozen by default or paused.`);
  return mint;
}
function captured(account) {
  return { owner: account.owner, base64: account.data[0] };
}
function snapshot(state) {
  if (state.adapterVersion !== VERSION || state.normalizedState["model"] !== "SOLANA_COMPOSED_ROUTE")
    fail2("Route evidence version mismatch.");
  return state.normalizedState;
}
function need(s, address3) {
  const a = s.accounts[address3];
  if (!a) fail2(`Missing recorded account ${address3}.`);
  return a;
}
var n2 = (value) => BigInt(value.toString(10));
function asset(mint, amount) {
  return mint === WRAPPED_SOL_MINT ? { asset: "PAPER_SOL", amount: paperSolBaseUnits(amount) } : { asset: "TOKEN", tokenMint: identifier(mint, "TokenMint"), amount: tokenBaseUnits(amount) };
}
function quoteRoute(state, input, buy, startMint, endMint) {
  if (input <= 0n || input > 0xffffffffffffffffn)
    throw new ExecutionEngineError("ZERO_EXECUTABLE_OUTPUT", "Swap input must be a positive u64.");
  const s = snapshot(state);
  if (s.tokenDecimals !== mintInfo(state.identity.tokenMint, need(s, state.identity.tokenMint)).decimals.toString())
    fail2("Recorded token decimals differ from authoritative mint.");
  const clock3 = bytes(need(s, CLOCK));
  if (clock3.length < 40 || state.chainSlot === null || clock3.readBigUInt64LE(0) > state.chainSlot)
    fail2("Route Clock/slot snapshot is malformed or incoherent.");
  const epoch = clock3.readBigUInt64LE(16), slot = clock3.readBigUInt64LE(0), time = clock3.readBigInt64LE(32);
  let mint = startMint ?? (buy ? WRAPPED_SOL_MINT : state.identity.tokenMint);
  let amount = input;
  let consumedInput = input;
  const fees = [];
  const details = [];
  const hops = buy ? [...s.hops].reverse() : s.hops;
  for (const hop of hops) {
    if (mint !== hop.mintA && mint !== hop.mintB)
      fail2("Route does not connect the requested mint.");
    const poolAccount = need(s, hop.pool);
    const link2 = hop.program === PUMP_PROGRAM_ID ? pumpLink(
      hop.pool,
      poolAccount,
      hop.mintA,
      need(s, hop.mintA).owner,
      need(s, hop.mintB).owner
    ) : decodePoolLink(hop.pool, poolAccount);
    if (Object.keys(link2).some(
      (key3) => key3 !== "extraAccounts" && !(key3 === "platform" && hop.platform === void 0) && link2[key3] !== hop[key3]
    ))
      fail2("Recorded market linkage changed.");
    const aToB = mint === hop.mintA;
    const outMint = aToB ? hop.mintB : hop.mintA;
    const inputMint = mintInfo(mint, need(s, mint)), outputMint = mintInfo(outMint, need(s, outMint));
    const transfer = (address3, value, info4) => {
      const config2 = getTransferFeeConfig(info4);
      const fee2 = config2 ? calculateEpochFee(config2, epoch, value) : 0n;
      if (fee2 > 0n) fees.push({ category: "TOKEN_TRANSFER_FEE", amount: asset(address3, fee2) });
      return value - fee2;
    };
    const afterTransfer = transfer(mint, amount, inputMint);
    const vault3 = (address3, expectedMint) => {
      const raw = need(s, address3);
      const expectedProgram = need(s, expectedMint).owner;
      if (raw.owner !== expectedProgram) fail2("Vault token program differs from mint.");
      const v = unpackAccount(new PublicKey2(address3), accountInfo(raw), new PublicKey2(raw.owner));
      if (v.mint.toBase58() !== expectedMint || !v.isInitialized || v.isFrozen)
        fail2("Vault mint/state is invalid.");
      return v;
    };
    const va = vault3(hop.vaultA, hop.mintA), vb = vault3(hop.vaultB, hop.mintB);
    const addFee = (category, feeMint, value) => {
      if (value > 0n) fees.push({ category, amount: asset(feeMint, value) });
    };
    let output;
    if ([PUMP_PROGRAM_ID, ORCA_WHIRLPOOL_PROGRAM].includes(hop.program)) {
      const authority = hop.pool;
      if (va.owner.toBase58() !== authority || vb.owner.toBase58() !== authority)
        fail2("Composed vault authority mismatch.");
      const q = quoteSupplementalHop(
        hop,
        s.accounts,
        afterTransfer,
        aToB,
        time,
        mintInfo(hop.mintA, need(s, hop.mintA)).supply,
        state.normalizedState["absentAccounts"] ?? []
      );
      output = q.output;
      addFee("PROTOCOL_FEE", q.feeMint, q.protocol);
      addFee("CREATOR_FEE", q.feeMint, q.creator);
      addFee("feeCategory" in q ? q.feeCategory : "LP_FEE", q.feeMint, q.lp);
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        outputBeforeTransfer: output.toString(),
        ...q.detail
      });
    } else if (hop.program === RAYDIUM_CPMM_PROGRAM) {
      const p = CpmmPoolInfoLayout.decode(bytes(poolAccount));
      const config2 = need(s, hop.config);
      if (config2.owner !== RAYDIUM_CPMM_PROGRAM) fail2("CPMM config owner mismatch.");
      discriminator(bytes(config2), "AmmConfig");
      const c = CpmmConfigInfoLayout.decode(bytes(config2));
      const authority = PublicKey2.findProgramAddressSync(
        [Buffer.from("vault_and_lp_mint_auth_seed")],
        new PublicKey2(hop.program)
      )[0].toBase58();
      if (va.owner.toBase58() !== authority || vb.owner.toBase58() !== authority)
        fail2("CPMM vault authority mismatch.");
      if (p.mintProgramA.toBase58() !== need(s, hop.mintA).owner || p.mintProgramB.toBase58() !== need(s, hop.mintB).owner || p.mintDecimalA !== mintInfo(hop.mintA, need(s, hop.mintA)).decimals || p.mintDecimalB !== mintInfo(hop.mintB, need(s, hop.mintB)).decimals)
        fail2("CPMM mint program/decimals mismatch.");
      if ((p.status & 4) !== 0 || time <= n2(p.openTime))
        fail2("CPMM swaps disabled or pool not open.");
      const ra = va.amount - n2(p.protocolFeesMintA) - n2(p.fundFeesMintA) - n2(p.creatorFeesMintA);
      const rb = vb.amount - n2(p.protocolFeesMintB) - n2(p.fundFeesMintB) - n2(p.creatorFeesMintB);
      if (ra < 0n || rb < 0n)
        fail2("CPMM recorded fees exceed vault balances; reserves are inconsistent.");
      if (ra <= 0n || rb <= 0n)
        throw new ExecutionEngineError(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "CPMM has no available reserves."
        );
      if (![0, 1, 2].includes(p.feeOn)) fail2("CPMM creator fee mode invalid.");
      const creatorOnInput = p.feeOn === 0 || (aToB ? p.feeOn === 1 : p.feeOn === 2);
      const creatorRate = p.enableCreatorFee ? c.creatorFeeRate : new BN2(0);
      if (n2(c.tradeFeeRate) + n2(creatorRate) >= 1000000n) fail2("CPMM fee rate invalid.");
      const q = CurveCalculator.swapBaseInput(
        new BN2(afterTransfer.toString()),
        new BN2((aToB ? ra : rb).toString()),
        new BN2((aToB ? rb : ra).toString()),
        c.tradeFeeRate,
        creatorRate,
        c.protocolFeeRate,
        c.fundFeeRate,
        creatorOnInput
      );
      output = n2(q.outputAmount);
      addFee("LP_FEE", mint, n2(q.tradeFee) - n2(q.protocolFee) - n2(q.fundFee));
      addFee("PROTOCOL_FEE", mint, n2(q.protocolFee));
      addFee("FUND_FEE", mint, n2(q.fundFee));
      addFee("CREATOR_FEE", creatorOnInput ? mint : outMint, n2(q.creatorFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        reserveA: ra.toString(),
        reserveB: rb.toString(),
        outputBeforeTransfer: output.toString()
      });
    } else if (hop.program === RAYDIUM_LAUNCHLAB_PROGRAM && hop.platform === void 0) {
      const p = LaunchpadPool.decode(bytes(poolAccount));
      const configAccount = need(s, hop.config);
      if (configAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail2("LaunchLab config owner mismatch.");
      const config2 = LaunchpadConfig.decode(bytes(configAccount));
      if (config2.mintB.toBase58() !== hop.mintB || p.status !== 0 || ![0, 1].includes(config2.curveType))
        fail2("Legacy LaunchLab state invalid.");
      const fee2 = (afterTransfer * n2(config2.tradeFeeRate) + 999999n) / 1000000n;
      if (afterTransfer <= fee2)
        throw new ExecutionEngineError("ZERO_EXECUTABLE_OUTPUT", "LaunchLab fee consumes input.");
      const curve = config2.curveType === 0 ? LaunchConstantProductCurve : LinearPriceCurve;
      output = n2(
        aToB ? curve.sellExactIn({ poolInfo: p, amount: new BN2((afterTransfer - fee2).toString()) }) : curve.buyExactIn({ poolInfo: p, amount: new BN2((afterTransfer - fee2).toString()) })
      );
      addFee("PROTOCOL_FEE", mint, fee2);
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        virtualA: p.virtualA.toString(),
        virtualB: p.virtualB.toString(),
        realA: p.realA.toString(),
        realB: p.realB.toString(),
        curveType: config2.curveType,
        tradeFeeRate: config2.tradeFeeRate.toString(),
        outputBeforeTransfer: output.toString()
      });
    } else if (hop.program === RAYDIUM_LAUNCHLAB_PROGRAM) {
      const p = LaunchpadPool.decode(bytes(poolAccount));
      const configAccount = need(s, hop.config);
      if (configAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail2("LaunchLab config owner mismatch.");
      if (p.configId.toBase58() !== hop.config) fail2("LaunchLab config linkage changed.");
      if (bytes(configAccount).length !== LaunchpadConfig.span)
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: config size mismatch.");
      const config2 = LaunchpadConfig.decode(bytes(configAccount));
      discriminator(bytes(configAccount), "GlobalConfig");
      const platformAccount = need(s, p.platformId.toBase58());
      if (platformAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM || bytes(platformAccount).length !== PlatformConfig.span)
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: platform config owner/size mismatch.");
      discriminator(bytes(platformAccount), "PlatformConfig");
      const platform = PlatformConfig.decode(bytes(platformAccount));
      if (p.mintA.toBase58() !== hop.mintA || p.mintB.toBase58() !== hop.mintB || config2.mintB.toBase58() !== hop.mintB || p.status !== 0)
        fail2(`LAUNCHLAB_STATE_UNAVAILABLE: pool identity/status ${p.status} is invalid.`);
      const expectedAuthority = getPdaLaunchpadAuth(
        new PublicKey2(hop.program)
      ).publicKey.toBase58();
      if (va.owner.toBase58() !== expectedAuthority || vb.owner.toBase58() !== expectedAuthority)
        fail2("LaunchLab vault authority mismatch.");
      const program2 = new PublicKey2(hop.program);
      if (getPdaLaunchpadPoolId(program2, p.mintA, p.mintB).publicKey.toBase58() !== hop.pool || getPdaLaunchpadVaultId(program2, new PublicKey2(hop.pool), p.mintA).publicKey.toBase58() !== hop.vaultA || getPdaLaunchpadVaultId(program2, new PublicKey2(hop.pool), p.mintB).publicKey.toBase58() !== hop.vaultB)
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: pool/vault PDA mismatch.");
      if (inputMint.decimals !== (aToB ? p.mintDecimalsA : p.mintDecimalsB) || outputMint.decimals !== (aToB ? p.mintDecimalsB : p.mintDecimalsA) || need(s, hop.mintA).owner !== ((p.mintProgramFlag & 1) === 0 ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID) || need(s, hop.mintB).owner !== ((p.mintProgramFlag & 2) === 0 ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID) || ![0, 1, 2, 3].includes(p.mintProgramFlag))
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: mint program/decimals mismatch.");
      if (![0, 1, 2].includes(config2.curveType))
        fail2("LAUNCHLAB_QUOTE_FAILED: unsupported curve type.");
      if (n2(config2.tradeFeeRate) + n2(platform.feeRate) + n2(platform.creatorFeeRate) >= 1000000n)
        fail2("LAUNCHLAB_QUOTE_FAILED: invalid total fee rate.");
      if (n2(p.realA) > n2(p.totalSellA) || config2.curveType === 0 && n2(p.realA) >= n2(p.virtualA))
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: inconsistent curve reserves.");
      if (aToB && afterTransfer > n2(p.realA))
        throw new ExecutionEngineError(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "LAUNCHLAB_QUOTE_FAILED: SELL exceeds sold base quantity."
        );
      const params = {
        poolInfo: p,
        protocolFeeRate: config2.tradeFeeRate,
        platformFeeRate: platform.feeRate,
        creatorFeeRate: platform.creatorFeeRate,
        shareFeeRate: new BN2(0),
        curveType: config2.curveType,
        transferFeeConfigA: void 0,
        slot: 0
      };
      const q = aToB ? Curve.sellExactIn({ ...params, amountA: new BN2(afterTransfer.toString()) }) : Curve.buyExactIn({ ...params, amountB: new BN2(afterTransfer.toString()) });
      output = aToB ? n2(q.amountB) : n2(q.amountA.amount);
      const totalFee = n2(q.splitFee.protocolFee) + n2(q.splitFee.platformFee) + n2(q.splitFee.creatorFee);
      if (aToB && (afterTransfer > n2(p.realA) || output + totalFee > n2(p.realB)))
        throw new ExecutionEngineError(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "LAUNCHLAB_QUOTE_FAILED: SELL exceeds real curve liquidity."
        );
      if (!aToB && n2(q.amountB) < afterTransfer) {
        if (hops.length !== 1)
          throw new ExecutionEngineError(
            "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            "LAUNCHLAB_BUY_CAP: composed input exceeds remaining sale."
          );
        consumedInput = n2(q.amountB);
      }
      addFee("PROTOCOL_FEE", hop.mintB, n2(q.splitFee.protocolFee));
      addFee("PLATFORM_FEE", hop.mintB, n2(q.splitFee.platformFee));
      addFee("CREATOR_FEE", hop.mintB, n2(q.splitFee.creatorFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        virtualA: p.virtualA.toString(),
        virtualB: p.virtualB.toString(),
        realA: p.realA.toString(),
        realB: p.realB.toString(),
        curveType: config2.curveType,
        tradeFeeRate: config2.tradeFeeRate.toString(),
        platformFeeRate: platform.feeRate.toString(),
        creatorFeeRate: platform.creatorFeeRate.toString(),
        stage: "LAUNCHLAB_ACTIVE",
        outputBeforeTransfer: output.toString()
      });
    } else {
      const p = dammPool(bytes(poolAccount));
      const point = p.activationType === 0 ? slot : time;
      if (!isSwapEnabled(p, new BN2(point.toString())))
        fail2("DAMM v2 swaps disabled or activation pending.");
      const mode = getFeeMode(p.collectFeeMode, aToB ? 0 : 1, false);
      if (va.owner.toBase58() !== derivePoolAuthority().toBase58() || vb.owner.toBase58() !== derivePoolAuthority().toBase58())
        fail2("DAMM v2 vault authority mismatch.");
      let q;
      try {
        q = getSwapResultFromExactInput(
          p,
          new BN2(afterTransfer.toString()),
          mode,
          aToB ? 0 : 1,
          new BN2(point.toString())
        );
      } catch (error) {
        if (error instanceof InsufficientLiquidityError)
          throw new ExecutionEngineError(
            "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            "DAMM v2 price range exhausted."
          );
        throw error;
      }
      if (!q.amountLeft.isZero())
        throw new ExecutionEngineError(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "DAMM v2 price range cannot execute all input."
        );
      output = n2(q.outputAmount);
      const feeMint = mode.feesOnInput ? mint : outMint;
      addFee("LP_CLAIM_FEE", feeMint, n2(q.claimingFee));
      addFee("LP_COMPOUND_FEE", feeMint, n2(q.compoundingFee));
      addFee("PROTOCOL_FEE", feeMint, n2(q.protocolFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        outputBeforeTransfer: output.toString(),
        sqrtPrice: p.sqrtPrice.toString(10),
        liquidity: p.liquidity.toString(10),
        reserveA: p.tokenAAmount.toString(10),
        reserveB: p.tokenBAmount.toString(10),
        nextSqrtPrice: q.nextSqrtPrice.toString(10)
      });
    }
    if (output < 0n) fail2("Protocol returned a negative route output.");
    if (output > (aToB ? vb : va).amount)
      throw new ExecutionEngineError(
        "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
        "Output exceeds actual vault liquidity."
      );
    amount = transfer(outMint, output, outputMint);
    const detail = details.at(-1);
    details[details.length - 1] = {
      ...detail,
      inputMint: mint,
      outputMint: outMint,
      inputDecimals: inputMint.decimals,
      outputDecimals: outputMint.decimals,
      inputAfterTransfer: afterTransfer.toString(),
      inputTransferFee: (BigInt(detail["input"]) - afterTransfer).toString(),
      outputTransferFee: (output - amount).toString(),
      direction: aToB ? "A_TO_B" : "B_TO_A",
      outputAfterTransfer: amount.toString(),
      stateSlot: state.chainSlot?.toString() ?? null
    };
    mint = outMint;
    if (amount <= 0n)
      throw new ExecutionEngineError(
        "ZERO_EXECUTABLE_OUTPUT",
        "Route output rounds to zero after fees."
      );
  }
  if (mint !== (endMint ?? (buy ? state.identity.tokenMint : WRAPPED_SOL_MINT)))
    fail2("Route output mint mismatch.");
  return { output: amount, consumedInput, fees, details };
}
function quoteSelectedRoute(state, input, buy) {
  const capped = (error) => error instanceof ExecutionEngineError && error.message.startsWith("LAUNCHLAB_BUY_CAP:");
  try {
    return quoteRoute(state, input, buy);
  } catch (error) {
    if (!(error instanceof ExecutionEngineError) && snapshot(state).hops.some((h) => h.program === RAYDIUM_LAUNCHLAB_PROGRAM))
      fail2(
        `LAUNCHLAB_QUOTE_FAILED: ${error instanceof Error ? error.message : "SDK curve failure."}`
      );
    if (!buy || !capped(error)) throw error;
  }
  let low = 0n, high = input;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    try {
      quoteRoute(state, mid, true);
      low = mid;
    } catch (error) {
      if (capped(error)) high = mid - 1n;
      else if (error instanceof ExecutionEngineError && error.code === "ZERO_EXECUTABLE_OUTPUT")
        low = mid;
      else throw error;
    }
  }
  const q = quoteRoute(state, low, true);
  return { ...q, consumedInput: low };
}
function quoteRecordedRoute(state, input, buy) {
  if (state.normalizedState["routePolicy"] === "FIXED_TOPOLOGY_V1")
    return quoteSelectedRoute(state, input, buy);
  const routes = state.normalizedState["candidateRoutes"];
  if (!routes?.length) return quoteSelectedRoute(state, input, buy);
  let best;
  const failures = [];
  for (const hops of routes) {
    try {
      const quote = quoteSelectedRoute(
        { ...state, normalizedState: { ...state.normalizedState, hops } },
        input,
        buy
      );
      if (!best || quote.output > best.output) best = quote;
    } catch (error2) {
      failures.push(error2);
    }
  }
  if (best) return best;
  const error = failures.find(
    (e) => !(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code)
  ) ?? failures[0];
  throw error ?? new ExecutionEngineError("MARKET_STATE_UNAVAILABLE", "No validated route quote is available.");
}
var PublicMarketCandidates = class {
  cache = /* @__PURE__ */ new Map();
  async json(url) {
    const r = await fetch(url, {
      signal: advisoryReadContext()?.signal ?? AbortSignal.timeout(12e3)
    });
    if (!r.ok) fail2(`Market discovery HTTP ${r.status}.`);
    return r.json();
  }
  async pools(mint) {
    const cached = this.cache.get(mint);
    if (cached && cached.until > Date.now()) return cached.pools;
    const data = await this.json(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    if (!Array.isArray(data)) fail2("Invalid discovery response.");
    const pools = [...new Set(data.map((p) => p.pairAddress))].filter((p) => typeof p === "string").sort().slice(0, 30);
    try {
      const quote = await this.json(
        `https://lite-api.jup.ag/ultra/v1/order?inputMint=${mint}&outputMint=${WRAPPED_SOL_MINT}&amount=1000000`
      );
      for (const step of quote.routePlan ?? []) {
        const info4 = step.swapInfo;
        if (!info4?.ammKey) continue;
        pools.push(info4.ammKey);
      }
    } catch {
    }
    const uniquePools = [...new Set(pools)].sort().slice(0, 40);
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value);
    if (uniquePools.length) this.cache.set(mint, { until: Date.now() + 1e4, pools: uniquePools });
    return uniquePools;
  }
  async context(address3) {
    const data = await this.json(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${address3}`
    );
    const dex = [
      ...new Set((data.pairs ?? []).flatMap((p) => [p.baseToken.address, p.quoteToken.address]))
    ];
    return dex;
  }
};
var SolanaRouteSource = class {
  constructor(rpc, candidates = new PublicMarketCandidates(), log2 = () => void 0) {
    this.rpc = rpc;
    this.candidates = candidates;
    this.log = log2;
  }
  rpc;
  candidates;
  log;
  topology = /* @__PURE__ */ new Map();
  report(event, metadata) {
    try {
      this.log(event, metadata);
    } catch {
    }
  }
  async requireSupportedPumpMigration(mint, curve) {
    if (!curve.complete || [PublicKey2.default.toBase58(), WRAPPED_SOL_MINT].includes(curve.quoteMint))
      return;
    const pool = await canonicalPumpSwapPoolAddress(mint, curve.quoteMint);
    const response = await this.rpc.getMultipleAccounts([pool]);
    const account = response.value[0];
    if (!account) fail2(`Migrated non-SOL PumpSwap state is unavailable: ${pool}.`);
    if (account.owner !== PUMP_AMM_PROGRAM_ID) fail2("Migrated PumpSwap pool owner mismatch.");
    const decoded = decodePumpSwapPool(Buffer.from(account.data[0], "base64"));
    if (decoded.baseMint !== mint || decoded.quoteMint !== curve.quoteMint)
      fail2("Migrated PumpSwap mint linkage mismatch.");
    this.report("UNSUPPORTED_CANONICAL_MIGRATION", {
      mint,
      quoteMint: curve.quoteMint,
      pool,
      slot: response.context.slot
    });
    fail2(
      `Canonical non-SOL PumpSwap execution is not supported yet (${pool}, quote ${curve.quoteMint}).`
    );
  }
  async launchPools(mint) {
    const canonical = getPdaLaunchpadPoolId(
      new PublicKey2(RAYDIUM_LAUNCHLAB_PROGRAM),
      new PublicKey2(mint),
      new PublicKey2(WRAPPED_SOL_MINT)
    ).publicKey.toBase58();
    const direct = await this.rpc.getMultipleAccounts([canonical]);
    let addresses = [canonical];
    if (!direct.value[0] && this.rpc.getProgramAccountAddresses) {
      try {
        addresses = await this.rpc.getProgramAccountAddresses(
          RAYDIUM_LAUNCHLAB_PROGRAM,
          mint,
          LaunchpadPool.offsetOf("mintA"),
          LaunchpadPool.span
        );
      } catch (error) {
        this.report("LAUNCHLAB_DISCOVERY_RPC_FAILED", {
          mint,
          stage: "getProgramAccounts",
          message: error instanceof Error ? error.message : String(error)
        });
        const hints = (await this.candidates.pools(mint)).slice(0, 16);
        const hinted = await this.rpc.getMultipleAccounts(hints);
        addresses = hints.filter((_, i) => hinted.value[i]?.owner === RAYDIUM_LAUNCHLAB_PROGRAM);
        if (!addresses.length) throw error;
        this.report("LAUNCHLAB_DISCOVERY_VERIFIED_HINTS", { mint, pools: addresses });
      }
    }
    if (!addresses.length) return [];
    const response = addresses[0] === canonical ? direct : await this.rpc.getMultipleAccounts(addresses);
    const links = [];
    for (const [i, address3] of addresses.entries()) {
      const account = response.value[i];
      if (!account) continue;
      if (account.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: pool owner mismatch.");
      const link2 = decodePoolLink(address3, captured(account));
      if (link2.mintA !== mint) fail2("LAUNCHLAB_STATE_UNAVAILABLE: base mint mismatch.");
      if (getPdaLaunchpadPoolId(
        new PublicKey2(link2.program),
        new PublicKey2(link2.mintA),
        new PublicKey2(link2.mintB)
      ).publicKey.toBase58() !== address3)
        fail2("LAUNCHLAB_STATE_UNAVAILABLE: discovered pool PDA mismatch.");
      links.push(link2);
    }
    return links;
  }
  async capture(identity, paths) {
    const addresses = [
      .../* @__PURE__ */ new Set([
        CLOCK,
        ...paths.flatMap(
          (hops) => hops.flatMap((h) => [
            h.pool,
            h.mintA,
            h.mintB,
            h.vaultA,
            h.vaultB,
            ...h.config ? [h.config] : [],
            ...h.platform ? [h.platform] : [],
            ...h.extraAccounts ?? []
          ])
        )
      ])
    ];
    if (addresses.length > 100) fail2("Route snapshot exceeds the atomic RPC account limit.");
    const response = await this.rpc.getMultipleAccounts(addresses);
    if (!Number.isSafeInteger(response.context.slot) || response.context.slot < 0 || response.value.length !== addresses.length)
      fail2("Route RPC account cardinality/slot is malformed.");
    const accounts = {};
    for (const [i, address3] of addresses.entries()) {
      const a = response.value[i];
      if (a) accounts[address3] = captured(a);
    }
    const token = mintInfo(
      identity.tokenMint,
      need({ accounts }, identity.tokenMint)
    );
    return paths.map((hops) => ({
      identity,
      observedAt: utcInstant(/* @__PURE__ */ new Date()),
      chainSlot: BigInt(response.context.slot),
      chainBlockId: null,
      adapterVersion: VERSION,
      normalizationVersion: "solana-route-accounts-launchlab-v2",
      normalizedState: {
        model: "SOLANA_COMPOSED_ROUTE",
        ...advisoryReadContext() ? {
          chainTime: advisoryClockTime(
            response.value[addresses.indexOf(CLOCK)],
            response.context.slot
          )
        } : {},
        tokenDecimals: token.decimals.toString(),
        mintSupply: token.supply.toString(),
        hops,
        candidateRoutes: paths,
        accounts,
        absentAccounts: addresses.filter((_, i) => response.value[i] === null)
      }
    }));
  }
  async validateSnapshot(candidate) {
    const state = {
      ...candidate,
      normalizedState: {
        ...candidate.normalizedState,
        routePolicy: "FIXED_TOPOLOGY_V1",
        candidateRoutes: [candidate.normalizedState["hops"]]
      }
    };
    const s = snapshot(state);
    need(s, CLOCK);
    for (const hop of s.hops) {
      for (const address3 of [
        hop.pool,
        hop.mintA,
        hop.mintB,
        hop.vaultA,
        hop.vaultB,
        ...hop.config ? [hop.config] : [],
        ...hop.platform ? [hop.platform] : []
      ])
        need(s, address3);
      mintInfo(hop.mintA, need(s, hop.mintA));
      mintInfo(hop.mintB, need(s, hop.mintB));
      const isolated = { ...state, normalizedState: { ...state.normalizedState, hops: [hop] } };
      for (const [inputMint, outputMint] of [
        [hop.mintA, hop.mintB],
        [hop.mintB, hop.mintA]
      ]) {
        try {
          quoteRoute(isolated, 1000000n, false, inputMint, outputMint);
        } catch (error) {
          if (!(error instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(error.code))
            throw error;
        }
      }
    }
    for (const buy of [true, false]) {
      try {
        quoteSelectedRoute(state, 1000000n, buy);
      } catch (error) {
        if (!(error instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(error.code))
          throw error;
      }
    }
    this.report("ROUTE_SNAPSHOT_READY", {
      mint: state.identity.tokenMint,
      route: executionRouteRecord(state, false),
      hops: s.hops,
      slot: state.chainSlot?.toString() ?? null
    });
    return state;
  }
  async chartMetadata(address3) {
    const context = await this.rpc.getMultipleAccounts([address3]);
    const owner = context.value[0]?.owner;
    const mint = owner && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(owner) ? address3 : await this.resolveContext(address3);
    const response = await this.rpc.getMultipleAccounts([mint]);
    const account = response.value[0];
    if (!account || ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(account.owner))
      throw new Error("CHART_TOKEN_METADATA_MISSING");
    const info4 = unpackMint(new PublicKey2(mint), accountInfo(captured(account)), new PublicKey2(account.owner));
    if (!info4.isInitialized) throw new Error("CHART_TOKEN_METADATA_MISSING");
    if (!Number.isInteger(info4.decimals) || info4.decimals < 0 || info4.decimals > 18)
      throw new Error("INVALID_TOKEN_DECIMALS");
    if (info4.supply <= 0n) throw new Error("AUTHORITATIVE_SUPPLY_UNAVAILABLE");
    return {
      requestedContext: address3,
      mint,
      tokenProgram: account.owner,
      tokenDecimals: info4.decimals,
      tokenSupplyBaseUnits: info4.supply.toString(),
      chainSlot: response.context.slot.toString()
    };
  }
  async resolveContext(address3) {
    const response = await this.rpc.getMultipleAccounts([address3]);
    const a = response.value[0];
    if (!a) fail2("Terminal context account was not found on Solana.");
    if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner)) {
      mintInfo(address3, captured(a));
      return address3;
    }
    if ([RAYDIUM_CPMM_PROGRAM, RAYDIUM_LAUNCHLAB_PROGRAM, METEORA_DAMM_V2_PROGRAM].includes(a.owner)) {
      const link2 = decodePoolLink(address3, captured(a));
      return link2.mintA === WRAPPED_SOL_MINT ? link2.mintB : link2.mintA;
    }
    if (a.owner === "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA")
      return decodePumpSwapPool(Buffer.from(a.data[0], "base64")).baseMint;
    const hints = a.owner === PUMP_PROGRAM_ID ? await this.rpc.getOwnedTokenMints(address3) : await this.candidates.context(address3);
    for (const mint of hints) {
      if (mint === WRAPPED_SOL_MINT) continue;
      if (a.owner === PUMP_PROGRAM_ID && await pumpBondingCurveAddress(mint) === address3)
        return mint;
      if (a.owner === "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" && decodePumpSwapPool(Buffer.from(a.data[0], "base64")).baseMint === mint)
        return mint;
      if ([RAYDIUM_CPMM_PROGRAM, RAYDIUM_LAUNCHLAB_PROGRAM, METEORA_DAMM_V2_PROGRAM].includes(a.owner)) {
        const p = decodePoolLink(address3, captured(a));
        if (p.mintA === mint || p.mintB === mint) return mint;
      }
    }
    return fail2("Terminal market could not be bound to a verified token mint.");
  }
  async loadMarketState(identity) {
    if (identity.protocolId !== SOLANA_ROUTE_PROTOCOL_ID || identity.marketId !== `solana-route:${identity.tokenMint}`)
      fail2("Route identity mismatch.");
    const cached = this.topology.get(identity.tokenMint);
    if (cached && cached.until > Date.now()) {
      try {
        const [state] = await this.capture(identity, [structuredClone(cached.hops)]);
        return await this.validateSnapshot(state);
      } catch (error) {
        this.topology.delete(identity.tokenMint);
        this.report("ROUTE_CACHE_INVALIDATED", {
          mint: identity.tokenMint,
          reason: error instanceof ExecutionEngineError ? error.code : "INVALID_MARKET_STATE"
        });
        throw error;
      }
    }
    const diagnostics = [];
    const curveAddress = await pumpBondingCurveAddress(identity.tokenMint);
    const curveResponse = await this.rpc.getMultipleAccounts([curveAddress]);
    const curveAccount = curveResponse.value[0];
    let pump;
    if (curveAccount?.owner === PUMP_PROGRAM_ID) {
      const curve = decodePumpBondingCurve(Buffer.from(curveAccount.data[0], "base64"));
      await this.requireSupportedPumpMigration(identity.tokenMint, curve);
      if (!curve.complete && ![PublicKey2.default.toBase58(), WRAPPED_SOL_MINT].includes(curve.quoteMint)) {
        const mints = await this.rpc.getMultipleAccounts([identity.tokenMint, curve.quoteMint]);
        if (!mints.value[0] || !mints.value[1]) fail2("Pump route mint state is unavailable.");
        pump = pumpLink(
          curveAddress,
          captured(curveAccount),
          identity.tokenMint,
          mints.value[0].owner,
          mints.value[1].owner
        );
      }
    }
    const launches = pump ? [] : await this.launchPools(identity.tokenMint).catch((error) => {
      this.report("LAUNCHLAB_STATE_UNAVAILABLE", {
        mint: identity.tokenMint,
        message: error instanceof Error ? error.message : "Launch-state discovery failed."
      });
      if (error instanceof ExecutionEngineError)
        throw new ExecutionEngineError(
          error.code,
          `LAUNCHLAB_STATE_UNAVAILABLE: ${error.message}`
        );
      return fail2("LAUNCHLAB_STATE_UNAVAILABLE: launch-state discovery failed.");
    });
    let launchStage = null;
    const active = pump ? [pump] : [];
    for (const link2 of launches) {
      const response = await this.rpc.getMultipleAccounts([link2.pool]);
      const account = response.value[0];
      if (!account) fail2("LAUNCHLAB_STATE_UNAVAILABLE: pool disappeared.");
      const p = LaunchpadPool.decode(bytes(captured(account)));
      const stage = ["LAUNCHLAB_ACTIVE", "LAUNCHLAB_MIGRATING", "LAUNCHLAB_MIGRATED"][p.status] ?? "LAUNCHLAB_STATE_UNAVAILABLE";
      this.report(stage, { mint: identity.tokenMint, pool: link2.pool, status: p.status });
      if (p.status === 0) active.push(link2);
      else if (p.status === 1)
        fail2("LAUNCHLAB_MIGRATING: funding ended; awaiting on-chain migration.");
      else if (p.status === 2) launchStage = "LAUNCHLAB_MIGRATED";
      else fail2(`LAUNCHLAB_STATE_UNAVAILABLE: unknown status ${p.status}.`);
    }
    const find = async (mint, seen, depth) => {
      if (mint === WRAPPED_SOL_MINT) return [[]];
      if (depth === 0) return [];
      const addresses = [...await this.candidates.pools(mint)];
      const curve = await pumpBondingCurveAddress(mint);
      if (!addresses.includes(curve)) addresses.push(curve);
      if (!addresses.length) return [];
      const response = await this.rpc.getMultipleAccounts(addresses);
      const links = [];
      for (const [i, address3] of addresses.entries()) {
        const a = response.value[i];
        if (!a) continue;
        try {
          let p;
          if (a.owner === PUMP_PROGRAM_ID) {
            const raw = captured(a);
            const quoteMint = pumpQuoteMint(raw);
            const mints = await this.rpc.getMultipleAccounts([mint, quoteMint]);
            if (!mints.value[0] || !mints.value[1]) fail2("Pump route mint state is unavailable.");
            p = pumpLink(address3, raw, mint, mints.value[0].owner, mints.value[1].owner);
          } else p = decodePoolLink(address3, captured(a));
          if (p.program === RAYDIUM_LAUNCHLAB_PROGRAM && LaunchpadPool.decode(bytes(captured(a))).status !== 0)
            continue;
          if (p.mintA === mint || p.mintB === mint) links.push(p);
        } catch (error) {
          if (error instanceof ExecutionEngineError && error.code === "RPC_UNAVAILABLE")
            throw error;
          diagnostics.push(error instanceof Error ? error.message : "Invalid pool.");
        }
      }
      links.sort(
        (a, b) => Number(!(a.mintA === WRAPPED_SOL_MINT || a.mintB === WRAPPED_SOL_MINT)) - Number(!(b.mintA === WRAPPED_SOL_MINT || b.mintB === WRAPPED_SOL_MINT)) || a.pool.localeCompare(b.pool)
      );
      const direct = links.filter(
        (p) => p.mintA === WRAPPED_SOL_MINT || p.mintB === WRAPPED_SOL_MINT
      );
      const paths2 = direct.slice(0, 6).map((p) => [p]);
      for (const link2 of links.filter((p) => !direct.includes(p))) {
        const other = link2.mintA === mint ? link2.mintB : link2.mintA;
        if (seen.has(other)) continue;
        const tails = await find(other, /* @__PURE__ */ new Set([...seen, other]), depth - 1);
        for (const tail of tails) paths2.push([link2, ...tail]);
        if (paths2.length >= 8) break;
      }
      return paths2;
    };
    const paths = [];
    if (active.length) {
      for (const link2 of active) {
        const tails = link2.mintB === WRAPPED_SOL_MINT ? [[]] : await find(link2.mintB, /* @__PURE__ */ new Set([identity.tokenMint, link2.mintB]), 2);
        for (const tail of tails) paths.push([link2, ...tail]);
      }
    } else {
      paths.push(...await find(identity.tokenMint, /* @__PURE__ */ new Set([identity.tokenMint]), 3));
    }
    paths.sort(
      (a, b) => a.length - b.length || a.map((h) => h.pool).join("/").localeCompare(b.map((h) => h.pool).join("/"))
    );
    if (!paths.length)
      return fail2(
        `${launchStage ? "MIGRATED_ROUTE_UNAVAILABLE: " : ""}No authoritative SOL route resolved. ${diagnostics.slice(-8).join(" ")}`
      );
    const states = await this.capture(identity, paths.slice(0, 4));
    let best;
    let bestScore = -2n;
    for (const candidate of states) {
      const state = candidate;
      try {
        const validated = await this.validateSnapshot(state);
        let score = -1n;
        try {
          const buy = quoteSelectedRoute(validated, 1000000000n, true);
          const reverse = quoteSelectedRoute(validated, buy.output, false);
          score = reverse.output * 1000000000n / buy.consumedInput;
        } catch (error) {
          if (!(error instanceof ExecutionEngineError) || ![
            "ZERO_EXECUTABLE_OUTPUT",
            "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            "MARKET_STATE_UNAVAILABLE"
          ].includes(error.code))
            throw error;
          this.report("ROUTE_REFERENCE_CAPACITY_UNAVAILABLE", {
            mint: identity.tokenMint,
            hops: validated.normalizedState["hops"],
            code: error.code,
            message: error.message
          });
        }
        if (score > bestScore) {
          best = validated;
          bestScore = score;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid route snapshot";
        diagnostics.push(message);
        this.report("ROUTE_REJECTED", {
          mint: identity.tokenMint,
          hops: state.normalizedState["hops"] ?? null,
          slot: state.chainSlot?.toString() ?? null,
          message,
          code: error instanceof ExecutionEngineError ? error.code : "INVALID_MARKET_STATE"
        });
      }
    }
    if (best) {
      if (this.topology.size >= 256) this.topology.delete(this.topology.keys().next().value);
      this.topology.set(identity.tokenMint, {
        until: Date.now() + 1e4,
        hops: structuredClone(best.normalizedState["hops"])
      });
      this.report("ROUTE_SELECTED", {
        mint: identity.tokenMint,
        route: executionRouteRecord(best, false),
        referenceInput: "1000000000",
        referenceRecoveryRatioPpb: bestScore < 0n ? null : bestScore.toString()
      });
      return best;
    }
    return fail2(`No authoritative SOL route resolved. ${diagnostics.slice(-8).join(" ")}`);
  }
};
var SolanaRouteAdapter = class {
  constructor(source) {
    this.source = source;
  }
  source;
  protocolId = SOLANA_ROUTE_PROTOCOL_ID;
  adapterVersion = VERSION;
  loadMarketState(identity) {
    return this.source.loadMarketState(identity);
  }
  quote(identity, state, amount, buy) {
    if (identity.protocolId !== state.identity.protocolId || identity.marketId !== state.identity.marketId || identity.tokenMint !== state.identity.tokenMint)
      fail2("Quote mint/market does not match evidence.");
    return quoteRecordedRoute(state, amount, buy);
  }
  async simulateBuy(request, state) {
    return this.execute(request, state, request.requestedPaperSol, true);
  }
  async simulateSell(request, state) {
    return this.execute(request, state, request.requestedTokenQuantity, false);
  }
  execute(request, state, amount, buy) {
    const q = this.quote(request.identity, state, amount, buy);
    const input = asset(buy ? WRAPPED_SOL_MINT : request.identity.tokenMint, q.consumedInput), output = asset(buy ? request.identity.tokenMint : WRAPPED_SOL_MINT, q.output);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: asset(buy ? WRAPPED_SOL_MINT : request.identity.tokenMint, amount),
        simulatedOutput: output,
        fees: q.fees
      },
      actualInput: input,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails: { hops: q.details }
    };
  }
  async valuePositionForExit(request, state) {
    const q = this.quote(request.identity, state, request.tokenQuantity, false);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(q.output),
      route: executionRouteRecord(state, false, q.details),
      feeBreakdown: {
        fees: q.fees,
        totalPaperSolFees: paperSolBaseUnits(
          q.fees.reduce(
            (sum, f) => sum + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n),
            0n
          )
        )
      },
      marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  async maxExecutableSellQuantity(request, state) {
    const s = snapshot(state);
    if (!s.hops.some((h) => [RAYDIUM_LAUNCHLAB_PROGRAM, PUMP_PROGRAM_ID].includes(h.program)))
      throw new ExecutionEngineError(
        "MARKET_STATE_UNAVAILABLE",
        "Exact composed-route exit capacity is unavailable."
      );
    let low = 0n, high = request.tokenQuantity;
    while (low < high) {
      const mid = (low + high + 1n) / 2n;
      try {
        this.quote(request.identity, state, mid, false);
        low = mid;
      } catch (error) {
        if (!(error instanceof ExecutionEngineError)) throw error;
        if (error.code === "ZERO_EXECUTABLE_OUTPUT") low = mid;
        else if (error.code === "INSUFFICIENT_EXECUTABLE_LIQUIDITY") high = mid - 1n;
        else throw error;
      }
    }
    if (low > 0n) {
      try {
        this.quote(request.identity, state, low, false);
        return tokenBaseUnits(low);
      } catch (error) {
        if (!(error instanceof ExecutionEngineError) || error.code !== "ZERO_EXECUTABLE_OUTPUT")
          throw error;
      }
    }
    return tokenBaseUnits(0n);
  }
};
function installSolanaMintResolver(router2, source, capability) {
  router2.chartMetadataResolver = (address3) => source.chartMetadata(address3);
  router2.contextResolver = (address3) => source.resolveContext(address3);
  const generic = (mint) => ({
    protocolId: SOLANA_ROUTE_PROTOCOL_ID,
    marketId: identifier(`solana-route:${mint}`, "MarketId"),
    tokenMint: identifier(mint, "TokenMint")
  });
  router2.mintResolver = async (mint) => {
    const route = await router2.canonicalResolver(generic(mint));
    return [PUMP_FUN_PROTOCOL_ID, PUMP_SWAP_PROTOCOL_ID].includes(
      route.executionIdentity.protocolId
    ) ? {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(await pumpBondingCurveAddress(mint), "MarketId"),
      tokenMint: identifier(mint, "TokenMint")
    } : generic(mint);
  };
  router2.canonicalResolver = async (identity) => {
    const mint = identity.tokenMint;
    const curveAddress = await pumpBondingCurveAddress(mint);
    const response = await source.rpc.getMultipleAccounts([curveAddress]);
    const account = response.value[0];
    let executionIdentity = generic(mint);
    if (account) {
      if (account.owner !== PUMP_PROGRAM_ID) fail2("Canonical Pump curve owner mismatch.");
      const curve = decodePumpBondingCurve(Buffer.from(account.data[0], "base64"));
      const nativeQuote = [PublicKey2.default.toBase58(), WRAPPED_SOL_MINT].includes(
        curve.quoteMint
      );
      if (!nativeQuote && curve.complete && capability) {
        executionIdentity = await capability.resolveNonSolPumpSwap(mint, curve.quoteMint);
      } else {
        await source.requireSupportedPumpMigration(mint, curve);
      }
      if (nativeQuote) {
        const active = !curve.complete && curve.realTokenReserves > 0n;
        executionIdentity = {
          protocolId: active ? PUMP_FUN_PROTOCOL_ID : PUMP_SWAP_PROTOCOL_ID,
          marketId: identifier(
            active ? curveAddress : await canonicalPumpSwapPoolAddress(mint),
            "MarketId"
          ),
          tokenMint: mint
        };
      }
    }
    source.report("ROUTE_DISCOVERED", {
      mint,
      origin: identity.marketId,
      protocol: executionIdentity.protocolId,
      market: executionIdentity.marketId,
      discoverySlot: response.context.slot
    });
    return {
      originIdentity: identity,
      executionIdentity,
      migrated: executionIdentity.marketId !== identity.marketId
    };
  };
}

// packages/protocols/src/chart-supply.ts
import { PublicKey as PublicKey3 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { unpackMint as unpackMint2 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
function chartMintSupply(state, mint) {
  if (!state) return null;
  const supply = state["mintSupply"];
  if (typeof supply === "string" && /^[1-9]\d*$/.test(supply)) return supply;
  const accounts = state["accounts"];
  const account = accounts?.[mint];
  if (!account || ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(account.owner))
    return null;
  try {
    const info4 = unpackMint2(
      new PublicKey3(mint),
      {
        owner: new PublicKey3(account.owner),
        data: Buffer.from(account.base64, "base64"),
        executable: false,
        lamports: 0,
        rentEpoch: 0
      },
      new PublicKey3(account.owner)
    );
    return info4.isInitialized && info4.supply > 0n ? info4.supply.toString() : null;
  } catch {
    return null;
  }
}

// packages/protocols/src/generic-access-context.ts
import { AsyncLocalStorage as AsyncLocalStorage3 } from "node:async_hooks";
var DENY_GENERIC = Object.freeze({ discover: false, buy: false });
var actorKey = /* @__PURE__ */ Symbol.for("paperfund.generic.actor.v1");
var operationKey = /* @__PURE__ */ Symbol.for("paperfund.generic.operation.v1");
var globals = globalThis;
var actors = globals[actorKey] ?? new AsyncLocalStorage3();
var operations = globals[operationKey] ?? new AsyncLocalStorage3();
globals[actorKey] = actors;
globals[operationKey] = operations;
var genericActor = () => actors.getStore();
var withGenericActor = (actor, work) => actors.run(Object.freeze({ ...actor }), work);
var withGenericSystemRead = (work, isolateCaptures = false) => withGenericActor({ intent: "READ", systemRead: true, isolateCaptures }, work);
var withGenericAccount = (accountId, work) => withGenericActor({ ...genericActor() ?? { intent: "READ" }, accountId }, work);
var withGenericOperation = (settlement, work) => operations.run({ settlement, permission: DENY_GENERIC }, work);
var genericOperation = () => operations.getStore();
function recordGenericPermission(permission) {
  const op = operations.getStore();
  if (!op) throw Error("GENERIC_OPERATION_SCOPE_MISSING");
  op.permission = Object.freeze({ ...permission });
}

// packages/protocols/src/generic-pump-swap.ts
import { NATIVE_MINT_2022 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import { PublicKey as PublicKey5 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";

// packages/protocols/src/experimental/non-sol-pump-swap.ts
import { createHash as createHash5 } from "node:crypto";
import { PublicKey as PublicKey4 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import {
  unpackMint as unpackMint3,
  unpackAccount as unpackAccount2,
  getExtensionTypes as getExtensionTypes2,
  getTransferFeeConfig as getTransferFeeConfig2,
  getTransferHook as getTransferHook2,
  getDefaultAccountState as getDefaultAccountState2,
  getPausableConfig as getPausableConfig2,
  getAssociatedTokenAddressSync as getAssociatedTokenAddressSync2
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
var CLOCK2 = "SysvarC1ock11111111111111111111111111111111";
var U64 = (1n << 64n) - 1n;
var STAGE1_BRIDGES = Object.freeze({
  XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN: "Bh3njVo6i3UjgmaevEQMGoidphcueNjoPqGkYLbthzV5",
  pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW"
});
function fail3(reason) {
  throw new ExecutionEngineError("INVALID_MARKET_STATE", reason);
}
function liquidity2(reason) {
  throw new ExecutionEngineError("INSUFFICIENT_EXECUTABLE_LIQUIDITY", reason);
}
function dust() {
  throw new ExecutionEngineError("ZERO_EXECUTABLE_OUTPUT", "STAGE1_DUST");
}
function u64(n3) {
  if (typeof n3 !== "bigint" || n3 < 0n || n3 > U64) fail3("STAGE1_INVALID_U64");
  return n3;
}
var ceil = (n3, d) => (n3 + d - 1n) / d;
function checked(s) {
  for (const n3 of [s.base, s.quote, s.protocolBucket, s.creatorBucket]) u64(n3);
  if (s.virtual < -(1n << 127n) || s.virtual >= 1n << 127n) fail3("STAGE1_INVALID_VIRTUAL");
  if (s.base === 0n || s.quote + s.virtual <= 0n || s.quote + s.virtual > U64 || s.protocolBucket + s.creatorBucket > s.quote)
    fail3("STAGE1_INVALID_RESERVES");
  if ([s.lpBps, s.protocolBps, s.creatorBps, s.buybackBps].some(
    (n3) => typeof n3 !== "bigint" || n3 < 0n || n3 > 10000n
  ) || s.lpBps + s.protocolBps + s.creatorBps >= 10000n)
    fail3("STAGE1_INVALID_FEES");
}
function stage1PoolSwap(s, input, buy) {
  checked(s);
  u64(input);
  if (input === 0n) dust();
  const effective = s.quote + s.virtual;
  const fee2 = (n3, b) => ceil(n3 * b, 10000n);
  const pricingBase = buy ? input * 10000n / (10000n + s.lpBps + s.protocolBps + s.creatorBps) : effective * input / (s.base + input);
  const lp = fee2(pricingBase, s.lpBps), protocol2 = fee2(pricingBase, s.protocolBps), creator = fee2(pricingBase, s.creatorBps);
  const net = buy ? input - lp - protocol2 - creator : pricingBase - lp - protocol2 - creator;
  if (net <= 0n || buy && net <= 1n) dust();
  if (!buy && pricingBase - lp > s.quote - s.protocolBucket - s.creatorBucket)
    liquidity2("STAGE1_TARGET_REAL_RESERVES");
  const output = buy ? s.base * (net - 1n) / (effective + net - 1n) : net;
  if (output <= 0n) dust();
  u64(output);
  const buyback = protocol2 * s.buybackBps / 10000n;
  const retained = protocol2 - buyback + creator;
  const post = {
    ...s,
    base: buy ? s.base - output : s.base + input,
    quote: buy ? s.quote + input - buyback : s.quote - output - buyback,
    virtual: s.virtual - retained,
    protocolBucket: s.protocolBucket + protocol2 - buyback,
    creatorBucket: s.creatorBucket + creator
  };
  checked(post);
  return {
    input,
    output,
    grossQuote: buy ? net : pricingBase,
    fees: { lp, protocol: protocol2, creator, buyback },
    post
  };
}
var info2 = (a) => ({
  data: Buffer.from(a.base64, "base64"),
  owner: new PublicKey4(a.owner),
  executable: false,
  lamports: 0,
  rentEpoch: 0
});
function need2(s, address3) {
  const a = s.accounts[address3];
  if (!a) fail3("STAGE1_REQUIRED_ACCOUNT_MISSING: " + address3);
  return a;
}
function validatePumpSwapMint(s, address3) {
  const a = need2(s, address3);
  if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner)) fail3("STAGE1_MINT_OWNER");
  const m = unpackMint3(new PublicKey4(address3), info2(a), new PublicKey4(a.owner));
  if (!m.isInitialized || m.decimals > 18 || m.supply === 0n && address3 !== WRAPPED_SOL_MINT)
    fail3("STAGE1_MINT_STATE");
  const known = /* @__PURE__ */ new Set([0, 1, 3, 4, 6, 10, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26, 28]);
  if (getExtensionTypes2(m.tlvData).some((t) => !known.has(t)))
    fail3("STAGE1_TOKEN_EXTENSION_UNSUPPORTED");
  const tf = getTransferFeeConfig2(m);
  if (tf && (tf.olderTransferFee.transferFeeBasisPoints !== 0 || tf.newerTransferFee.transferFeeBasisPoints !== 0))
    fail3("STAGE1_TRANSFER_FEES_UNSUPPORTED");
  const hook = getTransferHook2(m);
  if (hook && !hook.programId.equals(PublicKey4.default) || getDefaultAccountState2(m)?.state === 2 || getPausableConfig2(m)?.paused)
    fail3("STAGE1_TOKEN_TRANSFER_BLOCKED");
  return m;
}
function vault(s, address3, expectedMint, authority) {
  const a = need2(s, address3), program2 = need2(s, expectedMint).owner;
  if (a.owner !== program2) fail3("STAGE1_VAULT_PROGRAM");
  const v = unpackAccount2(new PublicKey4(address3), info2(a), new PublicKey4(program2));
  if (!v.isInitialized || v.isFrozen || v.mint.toBase58() !== expectedMint || v.owner.toBase58() !== authority)
    fail3("STAGE1_VAULT_IDENTITY");
  return v;
}
var Stage1NonSolPumpSwap = class {
  constructor(options) {
    this.bridgeBinding = options?.bridgeBinding ? Object.freeze({ ...options.bridgeBinding }) : void 0;
    if (options?.purpose !== "READ_ONLY_STAGE1_VALIDATION") fail3("STAGE1_DISABLED");
  }
  bridgeBinding;
  bridgeFor(quote) {
    return this.bridgeBinding ? this.bridgeBinding.quoteMint === quote ? this.bridgeBinding.pool : void 0 : STAGE1_BRIDGES[quote];
  }
  /** Discovery inputs are addresses only. No indexer price, trading method, signing or DB access. */
  async capture(rpc, targetMint) {
    const curve = await pumpBondingCurveAddress(targetMint);
    const first = await rpc.getMultipleAccounts([curve]);
    const a = first.value[0];
    if (!a || a.owner !== PUMP_PROGRAM_ID) fail3("STAGE1_PUMP_ORIGIN_MISSING");
    const c = decodePumpBondingCurve(Buffer.from(a.data[0], "base64"));
    if (!c.complete) fail3("STAGE1_MIGRATION_NOT_COMPLETE");
    const bridge = this.bridgeFor(c.quoteMint);
    if (!bridge) fail3("STAGE1_QUOTE_UNSUPPORTED");
    const target = await canonicalPumpSwapPoolAddress(targetMint, c.quoteMint);
    const discovery = await rpc.getMultipleAccounts([target, bridge]);
    const p = discovery.value[0], b = discovery.value[1];
    if (!p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
      fail3("STAGE1_POOLS_MISSING");
    const pool = decodePumpSwapPool(Buffer.from(p.data[0], "base64"));
    const link2 = orcaLink(bridge, { owner: b.owner, base64: b.data[0] });
    const addresses = [
      .../* @__PURE__ */ new Set([
        curve,
        target,
        targetMint,
        c.quoteMint,
        pool.baseVault,
        pool.quoteVault,
        bridge,
        link2.mintA,
        link2.mintB,
        link2.vaultA,
        link2.vaultB,
        link2.config,
        ...link2.extraAccounts ?? [],
        await pumpSwapGlobalConfigAddress(),
        await pumpSwapFeeConfigAddress(),
        CLOCK2
      ])
    ];
    if (addresses.length > 100) fail3("STAGE1_BATCH_TOO_LARGE");
    const batch = await rpc.getMultipleAccounts(addresses);
    if (!Number.isSafeInteger(batch.context.slot) || batch.context.slot < 0 || batch.value.length !== addresses.length)
      fail3("STAGE1_BATCH_INCONSISTENT");
    const accounts = {}, absentAccounts = [];
    addresses.forEach((address3, i) => {
      const v = batch.value[i];
      if (v) accounts[address3] = { owner: v.owner, base64: v.data[0] };
      else absentAccounts.push(address3);
    });
    const snapshot2 = {
      version: "NON_SOL_PUMPSWAP_STAGE1_V1",
      mint: targetMint,
      quoteMint: c.quoteMint,
      targetPool: target,
      bridgePool: bridge,
      slot: batch.context.slot,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      accounts,
      absentAccounts
    };
    await this.validate(snapshot2, { nowMs: Date.parse(snapshot2.observedAt), maxAgeMs: 1e4 });
    return snapshot2;
  }
  async validate(s, policy) {
    if (s.version !== "NON_SOL_PUMPSWAP_STAGE1_V1" || !Number.isSafeInteger(s.slot) || s.slot < 0 || this.bridgeFor(s.quoteMint) !== s.bridgePool)
      fail3("STAGE1_SNAPSHOT_IDENTITY");
    const now = policy.nowMs, at = Date.parse(s.observedAt);
    if (!Number.isFinite(now) || !Number.isFinite(at) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || at > now || now - at > policy.maxAgeMs)
      fail3("STAGE1_STALE_CAPTURE");
    const clock3 = Buffer.from(need2(s, CLOCK2).base64, "base64");
    if (need2(s, CLOCK2).owner !== "Sysvar1111111111111111111111111111111111111" || clock3.length !== 40 || clock3.readBigUInt64LE(0) > BigInt(s.slot))
      fail3("STAGE1_CLOCK_INCONSISTENT");
    const time = clock3.readBigInt64LE(32), epoch = clock3.readBigUInt64LE(16);
    if (BigInt(Math.floor(now)) < time * 1000n || BigInt(Math.floor(now)) - time * 1000n > BigInt(Math.ceil(policy.maxAgeMs)))
      fail3("STAGE1_STALE_BANK");
    const curveAddress = await pumpBondingCurveAddress(s.mint), curveAccount = need2(s, curveAddress);
    if (curveAccount.owner !== PUMP_PROGRAM_ID) fail3("STAGE1_CURVE_OWNER");
    const curve = decodePumpBondingCurve(Buffer.from(curveAccount.base64, "base64"));
    if (!curve.complete || curve.quoteMint !== s.quoteMint) fail3("STAGE1_MIGRATION_IDENTITY");
    const poolAccount = need2(s, s.targetPool), poolBytes = Buffer.from(poolAccount.base64, "base64");
    if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || ![287, 300, 301].includes(poolBytes.length))
      fail3("STAGE1_POOL_LAYOUT_UNSUPPORTED");
    const p = decodePumpSwapPool(poolBytes);
    if (s.targetPool !== await canonicalPumpSwapPoolAddress(s.mint, s.quoteMint) || p.index !== 0 || p.creator !== await pumpPoolAuthorityAddress(s.mint) || p.baseMint !== s.mint || p.quoteMint !== s.quoteMint)
      fail3("STAGE1_CANONICAL_IDENTITY");
    if ([243, 244, 269, 270].some((i) => poolBytes[i] > 1) || poolBytes.subarray(287).some((b) => b !== 0))
      fail3("STAGE1_POOL_FLAGS_OR_TAIL");
    if (p.isMayhemMode || p.isCashbackCoin || p.canEditCreatorFee || poolBytes[270] > 1)
      fail3("STAGE1_FLAGS_UNSUPPORTED");
    for (const address3 of [s.mint, s.quoteMint, WRAPPED_SOL_MINT]) validatePumpSwapMint(s, address3);
    for (const [address3, m] of [
      [p.baseVault, s.mint],
      [p.quoteVault, s.quoteMint]
    ])
      if (getAssociatedTokenAddressSync2(
        new PublicKey4(m),
        new PublicKey4(s.targetPool),
        true,
        new PublicKey4(need2(s, m).owner)
      ).toBase58() !== address3)
        fail3("STAGE1_TARGET_ATA");
    const base = vault(s, p.baseVault, s.mint, s.targetPool), quote = vault(s, p.quoteVault, s.quoteMint, s.targetPool);
    const globalAddress = await pumpSwapGlobalConfigAddress(), feeAddress = await pumpSwapFeeConfigAddress();
    if (need2(s, globalAddress).owner !== PUMP_AMM_PROGRAM_ID || need2(s, feeAddress).owner !== PUMP_FEE_PROGRAM_ID)
      fail3("STAGE1_CONFIG_OWNER");
    const globalBytes = Buffer.from(need2(s, globalAddress).base64, "base64"), g = decodePumpSwapGlobalConfig(globalBytes);
    if (globalBytes.length !== 949 || g.disableFlags !== 0 || [417, 642, 939, 940].some((i) => globalBytes[i] > 1))
      fail3("STAGE1_GLOBAL_STATE_UNSUPPORTED");
    const fBytes = Buffer.from(need2(s, feeAddress).base64, "base64"), legacy = decodePumpSwapFeeConfig(fBytes);
    let end = 69 + fBytes.readUInt32LE(65) * 40;
    if (fBytes.length >= 4073) {
      if (end + 4 > fBytes.length) fail3("STAGE1_FEE_LAYOUT");
      end += 4 + fBytes.readUInt32LE(end) * 40;
    }
    let fees = legacy.flatFees;
    if (fBytes.length >= 4097) {
      if (end + 24 > fBytes.length) fail3("STAGE1_FEE_LAYOUT");
      const exotic = {
        lpFeeBps: fBytes.readBigUInt64LE(end),
        protocolFeeBps: fBytes.readBigUInt64LE(end + 8),
        creatorFeeBps: fBytes.readBigUInt64LE(end + 16)
      };
      if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) fees = exotic;
    }
    if (![2512, 4073, 4097].includes(fBytes.length)) fail3("STAGE1_FEE_LAYOUT_UNSUPPORTED");
    const creator = g.creatorFeeConfigurable && p.creatorFeeBps > 0n ? p.creatorFeeBps : fees.creatorFeeBps;
    if (g.creatorFeeConfigurable && creator > g.maxConfigurableCreatorFeeBps)
      fail3("STAGE1_CREATOR_FEE_LIMIT");
    const math = {
      base: base.amount,
      quote: quote.amount,
      virtual: p.virtualQuoteReserves,
      protocolBucket: poolBytes.readBigUInt64LE(271),
      creatorBucket: poolBytes.readBigUInt64LE(279),
      lpBps: fees.lpFeeBps,
      protocolBps: fees.protocolFeeBps,
      creatorBps: p.coinCreator === PublicKey4.default.toBase58() ? 0n : creator,
      buybackBps: globalBytes.readBigUInt64LE(899)
    };
    checked(math);
    const bridge = orcaLink(s.bridgePool, need2(s, s.bridgePool));
    if (![bridge.mintA, bridge.mintB].includes(s.quoteMint) || ![bridge.mintA, bridge.mintB].includes(WRAPPED_SOL_MINT))
      fail3("STAGE1_BRIDGE_ORIENTATION");
    if ((bridge.extraAccounts ?? []).some((a) => !s.accounts[a] && !s.absentAccounts.includes(a)))
      fail3("STAGE1_TICK_CAPTURE_CHANGED");
    vault(s, bridge.vaultA, bridge.mintA, s.bridgePool);
    vault(s, bridge.vaultB, bridge.mintB, s.bridgePool);
    if (s.absentAccounts.some((a) => s.accounts[a])) fail3("STAGE1_ABSENT_ACCOUNT_CONFLICT");
    return {
      math,
      bridge,
      time,
      epoch,
      holderReward: poolBytes[270] === 1,
      baseDecimals: validatePumpSwapMint(s, s.mint).decimals,
      quoteDecimals: validatePumpSwapMint(s, s.quoteMint).decimals
    };
  }
  async quote(snapshot2, input, buy, policy) {
    const s = structuredClone(snapshot2);
    const v = await this.validate(s, policy);
    u64(input);
    if (input === 0n) dust();
    const bridgeQuote = (amount, fromSol) => {
      const result = quoteSupplementalHop(
        v.bridge,
        s.accounts,
        amount,
        v.bridge.mintA === (fromSol ? WRAPPED_SOL_MINT : s.quoteMint),
        v.time,
        validatePumpSwapMint(s, s.quoteMint).supply,
        s.absentAccounts
      );
      const outVault = vault(
        s,
        fromSol ? v.bridge.mintA === WRAPPED_SOL_MINT ? v.bridge.vaultB : v.bridge.vaultA : v.bridge.mintA === WRAPPED_SOL_MINT ? v.bridge.vaultA : v.bridge.vaultB,
        fromSol ? s.quoteMint : WRAPPED_SOL_MINT,
        s.bridgePool
      );
      if (result.output > outVault.amount) liquidity2("STAGE1_BRIDGE_RESERVES");
      if (result.output <= 0n) dust();
      return result;
    };
    const bridge = buy ? bridgeQuote(input, true) : null;
    const target = stage1PoolSwap(v.math, bridge?.output ?? input, buy);
    const reverse = buy ? null : bridgeQuote(target.output, false);
    return {
      version: s.version,
      slot: s.slot,
      mint: s.mint,
      quoteMint: s.quoteMint,
      creatorFeeDestination: v.holderReward ? "HOLDER_REWARD" : "CREATOR",
      input,
      output: reverse?.output ?? target.output,
      buy,
      target,
      bridge: bridge ?? reverse,
      baseDecimals: v.baseDecimals,
      quoteDecimals: v.quoteDecimals,
      fingerprint: createHash5("sha256").update(JSON.stringify(s)).digest("hex")
    };
  }
  async exits(snapshot2, quantity, policy) {
    const s = structuredClone(snapshot2);
    u64(quantity);
    if (quantity === 0n) dust();
    const read = async (q) => {
      try {
        return { quantity: q, quote: await this.quote(s, q, false, policy), reason: null };
      } catch (e) {
        if (!(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
          throw e;
        return { quantity: q, quote: null, reason: e.code };
      }
    };
    const full = await read(quantity);
    let max = quantity;
    if (!full.quote) {
      let low = 0n, high = quantity;
      while (low < high) {
        const mid = (low + high + 1n) / 2n, r = await read(mid);
        if (r.reason === "INSUFFICIENT_EXECUTABLE_LIQUIDITY") high = mid - 1n;
        else low = mid;
      }
      max = low;
    }
    const capacity = await read(max);
    if (!capacity.quote) max = 0n;
    return {
      full,
      maxQuantity: max,
      maxOutput: capacity.quote?.output ?? 0n,
      percentages: await Promise.all([25n, 50n, 75n].map((p) => read(quantity * p / 100n)))
    };
  }
};

// packages/config/src/non-sol-pumpswap-routes.ts
var common = {
  targetProgram: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  bridgeProgram: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  baseTokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  quoteTokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
};
var goog = {
  quoteMint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
  bridgePool: "Bh3njVo6i3UjgmaevEQMGoidphcueNjoPqGkYLbthzV5",
  bridgeSolVault: "6vaNc3WqFsfV2ghoQAUWsvEFjwjMVDq8WeMzMpAtqd4y",
  bridgeQuoteVault: "BEfaWzWxdZWjZpdEnMacGmBJ6Hx1YdgBncV6z79dtmtf"
};
var APPROVED_NON_SOL_PUMPSWAP_ROUTES = Object.freeze([
  Object.freeze({
    ...common,
    ...goog,
    mint: "5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep",
    targetPool: "BJN4eK3Sa7XaNzEu73TTonRZfQ3aSzmbEbyCwE51Wb9h",
    targetBaseVault: "4ucYKU6mYiwtxnQWRR1mjpvaNnY7Km6qXoFNbLyJKryh",
    targetQuoteVault: "6kWYHHz6uR62CHWFu3JAgyxQYMpNs9Ck8raEYbEP2bQv"
  }),
  Object.freeze({
    ...common,
    mint: "7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD",
    quoteMint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    targetPool: "3uYAmvTZwsAJbZhxBWRfexESBZCnfzmqjA56nJGCixNw",
    bridgePool: "BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW",
    targetBaseVault: "Vzm9jQHBVFP5LUXUnWHRjmFAg3CAsBDcRJ1ccjpViNF",
    targetQuoteVault: "HsQNWmcfyoVhv9dpcJ9HhXa3A3yY8Z4joYkjTkgBrnJz",
    bridgeSolVault: "BkSYpPsv11UPDLonxBZf2mFndfuN2MrDwYt4gjDEnk8D",
    bridgeQuoteVault: "2wcLHj441NnqiUon4LcmMo6dGAUqwEW84nfFKnfuTnPt"
  }),
  Object.freeze({
    ...common,
    ...goog,
    mint: "9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump",
    targetPool: "2rM6Ep14wYYC9jNR9TtJj3pVggfj2qm7UXkfjd7tUJGK",
    targetBaseVault: "26AK9fNG5uoawcgPPbdXVd2WhegtKi9Gh7YQ9G7JwYs3",
    targetQuoteVault: "4QAJqpNt3K84fUb8ccX32HB1itS87WYE8NK7Cid4TPZt"
  })
]);
function validateNonSolPumpSwapRoutes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3)
    throw Error("NON_SOL_ALLOWLIST_REQUIRED");
  const seen = /* @__PURE__ */ new Set();
  return Object.freeze(
    value.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw Error("NON_SOL_ALLOWLIST_INVALID");
      const row = raw, expected = APPROVED_NON_SOL_PUMPSWAP_ROUTES.find((r) => r.mint === row["mint"]);
      if (!expected || seen.has(expected.mint) || Object.keys(row).length !== Object.keys(expected).length || Object.entries(expected).some(([k, v]) => row[k] !== v))
        throw Error("NON_SOL_ALLOWLIST_IDENTITY_MISMATCH");
      seen.add(expected.mint);
      return expected;
    })
  );
}

// packages/config/src/index.ts
import { z as z2 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/zod/index.cjs";
var logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
var solanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function isSecurePublicOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname) && value === url.origin;
  } catch {
    return false;
  }
}
function isExactExtensionOrigin(value) {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(value);
}
var environmentSchema = z2.object({
  NODE_ENV: z2.enum(["development", "test", "production"]).default("development"),
  API_HOST: z2.string().min(1).default("127.0.0.1"),
  API_PORT: z2.coerce.number().int().min(1).max(65535).default(3e3),
  PRIVATE_BETA_NON_PAYING: z2.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  BETA_INVITE_ONLY: z2.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  BETA_WALLET_ALLOWLIST: z2.string().default("").transform((v, ctx) => {
    const wallets = v.split(",").map((w) => w.trim()).filter(Boolean);
    if (wallets.some((w) => !solanaAddress.test(w)) || new Set(wallets).size !== wallets.length) {
      ctx.addIssue({
        code: "custom",
        message: "Beta allowlist requires unique public Solana addresses."
      });
      return z2.NEVER;
    }
    return wallets;
  }),
  API_PUBLIC_ORIGIN: z2.string().default(""),
  APP_PUBLIC_ORIGIN: z2.string().default(""),
  DATABASE_URL: z2.string().url().startsWith("postgresql://"),
  REDIS_URL: z2.string().url().refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
    message: "REDIS_URL must use the redis:// or rediss:// protocol"
  }),
  NON_SOL_PUMPSWAP_ALLOWED_ROUTES: z2.string().default("").transform((v, ctx) => {
    if (v === "") return [];
    try {
      return validateNonSolPumpSwapRoutes(JSON.parse(v));
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Non-SOL allowlist must contain complete approved route identities"
      });
      return z2.NEVER;
    }
  }),
  NON_SOL_PUMPSWAP_ENABLED: z2.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  GENERIC_PUMPSWAP_ENABLED: z2.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  GENERIC_PUMPSWAP_BUYS_ENABLED: z2.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Explicit rollout gate: legacy operator arming never opens ordinary-user access.
  GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED: z2.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Retained configuration name; IDs authorize administrative controls only.
  GENERIC_PUMPSWAP_OPERATOR_USER_IDS: z2.string().default("").transform((v, ctx) => {
    if (v === "") return [];
    try {
      const ids = JSON.parse(v);
      if (!Array.isArray(ids) || ids.length > 1 || ids.some((id) => typeof id !== "string" || !/^user:[a-f0-9]{64}$/.test(id)))
        throw Error();
      return ids;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Generic control authority requires at most one exact authenticated internal user ID"
      });
      return z2.NEVER;
    }
  }),
  GENERIC_PUMPSWAP_ENTRY_SECONDS: z2.coerce.number().int().min(60).max(3600).default(900),
  SOLANA_RPC_URL: z2.string().url().default("https://api.mainnet-beta.solana.com"),
  SOLANA_WS_URL: z2.string().refine(
    (v) => v === "" || (() => {
      try {
        return new URL(v).protocol === "wss:";
      } catch {
        return false;
      }
    })(),
    { message: "SOLANA_WS_URL must use wss://" }
  ).default(""),
  ADVISORY_MAX_CONCURRENT: z2.coerce.number().int().min(2).max(64).default(4),
  ADVISORY_BACKGROUND_CONCURRENT: z2.coerce.number().int().min(1).max(8).default(2),
  API_RATE_LIMIT_VALUATION_MAX: z2.coerce.number().int().positive().default(240),
  VALUATION_DIAGNOSTICS_ENABLED: z2.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SOLANA_RPC_TIMEOUT_MS: z2.coerce.number().int().positive().default(1e4),
  SOLANA_COMMITMENT: z2.enum(["processed", "confirmed", "finalized"]).default("confirmed"),
  LOG_LEVEL: z2.enum(logLevels).default("info"),
  AUTH_CHALLENGE_TTL_SECONDS: z2.coerce.number().int().min(30).max(900).default(300),
  AUTH_SESSION_TTL_SECONDS: z2.coerce.number().int().min(300).default(86400),
  COOKIE_SECURE: z2.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  COOKIE_SAME_SITE: z2.enum(["strict", "lax", "none"]).default("lax"),
  ALLOWED_ORIGINS: z2.string().refine((value) => !value.split(",").some((origin) => origin.trim() === "*"), {
    message: "ALLOWED_ORIGINS must not use a wildcard"
  }).default("http://127.0.0.1:5173,http://localhost:5173"),
  API_RATE_LIMIT_WINDOW_SECONDS: z2.coerce.number().int().positive().default(60),
  API_RATE_LIMIT_AUTH_MAX: z2.coerce.number().int().positive().default(20),
  API_RATE_LIMIT_TRADE_MAX: z2.coerce.number().int().positive().default(30),
  WORKER_TICK_INTERVAL_MS: z2.coerce.number().int().min(500).default(5e3),
  WORKER_HEARTBEAT_FILE: z2.string().min(1).default("logs/worker-heartbeat.json"),
  REWARD_ALLOCATION_MODE: z2.enum(["NORMAL", "BUFFER_ACCUMULATION"]).default("NORMAL"),
  REWARD_BASELINE_WINDOW: z2.coerce.number().int().positive().default(12),
  REWARD_LAMBDA_BPS: z2.coerce.number().int().min(0).max(1e4).default(6e3),
  REWARD_FINALIZATION_GRACE_SECONDS: z2.coerce.number().int().min(0).default(60),
  CREATOR_FEE_INGESTION_ENABLED: z2.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CREATOR_FEE_SHADOW_MODE: z2.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  CREATOR_FEE_NETWORK: z2.enum(["localnet", "devnet", "mainnet-beta"]).default("mainnet-beta"),
  PAPERFUND_TOKEN_MINT: z2.string().default(""),
  PAPERFUND_CREATOR_WALLET: z2.string().default(""),
  CREATOR_FEE_PAGE_SIZE: z2.coerce.number().int().min(1).max(100).default(50),
  CREATOR_FEE_RPC_MAX_ATTEMPTS: z2.coerce.number().int().min(1).max(10).default(4),
  CREATOR_FEE_RPC_MIN_INTERVAL_MS: z2.coerce.number().int().min(0).default(75),
  PAYOUT_EXECUTION_ENABLED: z2.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAYOUT_NETWORK: z2.enum(["localnet", "devnet", "mainnet-beta"]).default("localnet"),
  PAYOUT_MAINNET_CONFIRM: z2.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAYOUT_TREASURY_PUBLIC_KEY: z2.string().default(""),
  PAYOUT_SIGNER_TYPE: z2.enum(["DISABLED", "LOCAL_KEYPAIR"]).default("DISABLED"),
  PAYOUT_MAX_RECIPIENTS_PER_BATCH: z2.coerce.number().int().min(1).max(12).default(8),
  PAYOUT_MAINNET_MAX_PLAN_LAMPORTS: z2.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n, "Mainnet payout cap must be positive.").default("100000000")
}).superRefine((value, context) => {
  for (const [path2, address3] of [
    ["PAPERFUND_TOKEN_MINT", value.PAPERFUND_TOKEN_MINT],
    ["PAPERFUND_CREATOR_WALLET", value.PAPERFUND_CREATOR_WALLET],
    ["PAYOUT_TREASURY_PUBLIC_KEY", value.PAYOUT_TREASURY_PUBLIC_KEY]
  ]) {
    if (address3 && !solanaAddress.test(address3))
      context.addIssue({
        code: "custom",
        path: [path2],
        message: `${path2} is not a Solana address.`
      });
  }
  if (value.CREATOR_FEE_INGESTION_ENABLED && (!value.PAPERFUND_TOKEN_MINT || !value.PAPERFUND_CREATOR_WALLET))
    context.addIssue({
      code: "custom",
      path: ["CREATOR_FEE_INGESTION_ENABLED"],
      message: "Live creator-fee ingestion requires the token mint and creator wallet."
    });
  if (value.PAYOUT_EXECUTION_ENABLED) {
    if (!value.PAYOUT_TREASURY_PUBLIC_KEY)
      context.addIssue({
        code: "custom",
        path: ["PAYOUT_TREASURY_PUBLIC_KEY"],
        message: "Live payouts require a treasury."
      });
    if (value.PAYOUT_SIGNER_TYPE === "DISABLED")
      context.addIssue({
        code: "custom",
        path: ["PAYOUT_SIGNER_TYPE"],
        message: "Live payouts require a separately authorized signer boundary."
      });
    if (value.PAYOUT_NETWORK === "mainnet-beta" && !value.PAYOUT_MAINNET_CONFIRM)
      context.addIssue({
        code: "custom",
        path: ["PAYOUT_MAINNET_CONFIRM"],
        message: "Mainnet payouts require explicit confirmation."
      });
  }
  if (value.NODE_ENV === "production") {
    if (!isSecurePublicOrigin(value.API_PUBLIC_ORIGIN))
      context.addIssue({
        code: "custom",
        path: ["API_PUBLIC_ORIGIN"],
        message: "Production API origin must be non-loopback HTTPS."
      });
    if (!isSecurePublicOrigin(value.APP_PUBLIC_ORIGIN))
      context.addIssue({
        code: "custom",
        path: ["APP_PUBLIC_ORIGIN"],
        message: "Production app origin must be non-loopback HTTPS."
      });
    if (!value.COOKIE_SECURE)
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "Production cookies must be secure."
      });
    for (const origin of value.ALLOWED_ORIGINS.split(",").map((item) => item.trim())) {
      if (!isSecurePublicOrigin(origin) && !isExactExtensionOrigin(origin))
        context.addIssue({
          code: "custom",
          path: ["ALLOWED_ORIGINS"],
          message: "Production CORS origins must be HTTPS or an exact extension origin."
        });
    }
    if (!value.ALLOWED_ORIGINS.split(",").map((item) => item.trim()).includes(value.APP_PUBLIC_ORIGIN))
      context.addIssue({
        code: "custom",
        path: ["ALLOWED_ORIGINS"],
        message: "Production CORS must include APP_PUBLIC_ORIGIN."
      });
  }
}).readonly();
function parseEnvironment(environment) {
  const parsed = environmentSchema.parse(environment);
  if (parsed.PAYOUT_EXECUTION_ENABLED && !environment.PAYOUT_NETWORK)
    throw new Error("PAYOUT_NETWORK must be explicitly set when live payout execution is enabled.");
  if (parsed.GENERIC_PUMPSWAP_BUYS_ENABLED && parsed.GENERIC_PUMPSWAP_OPERATOR_USER_IDS.length === 0)
    throw Error("Generic entry arming requires explicit administrative control authority");
  if (parsed.GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED && !parsed.GENERIC_PUMPSWAP_ENABLED)
    throw Error("Normal-user generic access requires generic routing enabled");
  if (parsed.GENERIC_PUMPSWAP_BUYS_ENABLED && !parsed.GENERIC_PUMPSWAP_ENABLED)
    throw Error("Generic BUY requires generic routing enabled");
  if (parsed.NON_SOL_PUMPSWAP_ENABLED && parsed.NON_SOL_PUMPSWAP_ALLOWED_ROUTES.length === 0)
    throw Error("Enabled non-SOL capability requires an explicit approved allowlist");
  return parsed;
}
function parseApplicationEnvironment(environment) {
  for (const name of [
    "PAYOUT_SIGNER_SECRET_KEY",
    "PAYOUT_SIGNER_SECRET_FILE",
    "PAYOUT_OPERATOR_PRIVATE_KEY",
    "PAYOUT_OPERATOR_TOKEN"
  ])
    if (Object.prototype.hasOwnProperty.call(environment, name))
      throw new Error(
        "Signer/operator credentials are forbidden in ordinary application processes."
      );
  const parsed = parseEnvironment(environment);
  if (!parsed.BETA_INVITE_ONLY)
    throw new Error(
      "This private beta requires invite-only access. An empty allowlist denies all testers."
    );
  if (!parsed.PRIVATE_BETA_NON_PAYING || parsed.PAYOUT_EXECUTION_ENABLED || parsed.PAYOUT_SIGNER_TYPE !== "DISABLED")
    throw new Error(
      "This release is non-paying only; real-SOL runtime qualification is unavailable."
    );
  return parsed;
}

// packages/protocols/src/non-sol-pump-swap.ts
var NON_SOL_PUMP_SWAP_PROTOCOL_ID = identifier(
  "NON_SOL_PUMP_SWAP",
  "ProtocolId"
);
var NON_SOL_PUMP_SWAP_VERSION = "non-sol-pump-swap-canonical-v1";
function nonSolPumpSwapIdentity(mint, quote) {
  return {
    protocolId: NON_SOL_PUMP_SWAP_PROTOCOL_ID,
    marketId: identifier("non-sol-pump-swap:" + mint + ":" + quote, "MarketId"),
    tokenMint: identifier(mint, "TokenMint")
  };
}
function reject(reason) {
  throw new ExecutionEngineError("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
var json = (value) => JSON.parse(
  JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)
);
function assertNonSolRouteBinding(s) {
  const row = APPROVED_NON_SOL_PUMPSWAP_ROUTES.find((r) => r.mint === s.mint);
  if (!row || s.targetPool !== row.targetPool || s.quoteMint !== row.quoteMint || s.bridgePool !== row.bridgePool)
    reject("NON_SOL_ALLOWLIST_ROUTE_MISMATCH");
  const target = s.accounts[s.targetPool], bridge = s.accounts[s.bridgePool];
  if (target?.owner !== row.targetProgram || bridge?.owner !== row.bridgeProgram || s.accounts[s.mint]?.owner !== row.baseTokenProgram || s.accounts[s.quoteMint]?.owner !== row.quoteTokenProgram || s.accounts[WRAPPED_SOL_MINT]?.owner !== SPL_TOKEN_PROGRAM_ID)
    reject("NON_SOL_ALLOWLIST_PROGRAM_MISMATCH");
  const p = decodePumpSwapPool(Buffer.from(target.base64, "base64")), link2 = orcaLink(s.bridgePool, bridge);
  if (p.baseVault !== row.targetBaseVault || p.quoteVault !== row.targetQuoteVault || (link2.mintA === WRAPPED_SOL_MINT ? link2.vaultA : link2.vaultB) !== row.bridgeSolVault || (link2.mintA === s.quoteMint ? link2.vaultA : link2.vaultB) !== row.bridgeQuoteVault)
    reject("NON_SOL_ALLOWLIST_VAULT_MISMATCH");
}
var NonSolPumpSwapSource = class {
  constructor(rpc, routes = []) {
    this.rpc = rpc;
    this.routes = routes.length ? validateNonSolPumpSwapRoutes(routes) : Object.freeze([]);
  }
  rpc;
  engine = new Stage1NonSolPumpSwap({ purpose: "READ_ONLY_STAGE1_VALIDATION" });
  routes;
  async resolve(mint, quote) {
    const allowed = this.routes.find((r2) => r2.mint === mint && r2.quoteMint === quote);
    if (!allowed) reject("NON_SOL_NOT_ALLOWLISTED");
    const bridge = STAGE1_BRIDGES[quote];
    if (!bridge) reject("NON_SOL_QUOTE_NOT_VALIDATED");
    const target = await canonicalPumpSwapPoolAddress(mint, quote), r = await this.rpc.getMultipleAccounts([target, bridge]);
    if (r.value.length !== 2) reject("NON_SOL_DISCOVERY_CARDINALITY");
    const p = r.value[0], b = r.value[1];
    if (!p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
      reject("NON_SOL_BOUND_POOLS_UNAVAILABLE");
    const pool = decodePumpSwapPool(Buffer.from(p.data[0], "base64"));
    if (pool.index !== 0 || pool.creator !== await pumpPoolAuthorityAddress(mint) || pool.baseMint !== mint || pool.quoteMint !== quote)
      reject("NON_SOL_CANONICAL_LINKAGE");
    const link2 = orcaLink(bridge, { owner: b.owner, base64: b.data[0] });
    if (![link2.mintA, link2.mintB].includes(quote) || ![link2.mintA, link2.mintB].includes(WRAPPED_SOL_MINT))
      reject("NON_SOL_BRIDGE_LINKAGE");
    return nonSolPumpSwapIdentity(mint, quote);
  }
  async loadMarketState(identity) {
    if (!this.routes.some(
      (r) => nonSolPumpSwapIdentity(r.mint, r.quoteMint).marketId === identity.marketId && r.mint === identity.tokenMint
    ))
      reject("NON_SOL_NOT_ALLOWLISTED");
    return this.state(identity, await this.engine.capture(this.rpc, identity.tokenMint));
  }
  async state(identity, snapshot2) {
    const s = structuredClone(snapshot2), expected = nonSolPumpSwapIdentity(s.mint, s.quoteMint);
    if (identity.protocolId !== expected.protocolId || identity.marketId !== expected.marketId || identity.tokenMint !== expected.tokenMint)
      reject("NON_SOL_EXECUTION_IDENTITY");
    assertNonSolRouteBinding(s);
    return pumpSwapStateFromSnapshot(identity, s, this.engine);
  }
};
async function pumpSwapStateFromSnapshot(identity, s, engine2, adapterVersion = NON_SOL_PUMP_SWAP_VERSION, normalizationVersion = "non-sol-pump-swap-accounts-v1") {
  const v = await engine2.validate(s, { nowMs: Date.parse(s.observedAt), maxAgeMs: 1e4 });
  const p = decodePumpSwapPool(Buffer.from(s.accounts[s.targetPool].base64, "base64")), clock3 = s.accounts["SysvarC1ock11111111111111111111111111111111"];
  const hops = [
    {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      mintA: s.mint,
      mintB: s.quoteMint,
      baseVault: p.baseVault,
      quoteVault: p.quoteVault
    },
    {
      pool: s.bridgePool,
      programId: ORCA_WHIRLPOOL_PROGRAM,
      mintA: v.bridge.mintA,
      mintB: v.bridge.mintB,
      baseVault: v.bridge.vaultA,
      quoteVault: v.bridge.vaultB
    }
  ];
  return {
    identity,
    adapterVersion,
    normalizationVersion,
    observedAt: utcInstant(s.observedAt),
    chainSlot: BigInt(s.slot),
    chainBlockId: null,
    normalizedState: {
      model: "NON_SOL_PUMP_SWAP_ROUTE",
      tokenDecimals: v.baseDecimals.toString(),
      accounts: s.accounts,
      stage1Snapshot: json(s),
      hops,
      chainTime: advisoryClockTime({ owner: clock3.owner, data: [clock3.base64, "base64"] }, s.slot)
    }
  };
}
var NonSolPumpSwapAdapter = class {
  constructor(source, policy = {
    protocolId: NON_SOL_PUMP_SWAP_PROTOCOL_ID,
    adapterVersion: NON_SOL_PUMP_SWAP_VERSION,
    normalizationVersion: "non-sol-pump-swap-accounts-v1",
    identity: nonSolPumpSwapIdentity,
    assertBinding: assertNonSolRouteBinding,
    buysEnabled: true
  }) {
    this.source = source;
    this.policy = policy;
    this.protocolId = policy.protocolId;
    this.adapterVersion = policy.adapterVersion;
  }
  source;
  policy;
  protocolId;
  adapterVersion;
  loadMarketState(identity) {
    return this.source.loadMarketState(identity);
  }
  async quote(identity, state, input, buy) {
    const s = state.normalizedState["stage1Snapshot"];
    if (!s || !Number.isSafeInteger(s.slot) || s.slot < 0 || !s.accounts || state.adapterVersion !== this.adapterVersion || state.normalizationVersion !== this.policy.normalizationVersion || state.normalizedState["model"] !== "NON_SOL_PUMP_SWAP_ROUTE" || state.chainSlot !== BigInt(s.slot) || state.observedAt !== s.observedAt || identity.protocolId !== this.protocolId || identity.marketId !== this.policy.identity(s.mint, s.quoteMint, s.bridgePool).marketId || identity.tokenMint !== s.mint || state.identity.protocolId !== identity.protocolId || state.identity.marketId !== identity.marketId || state.identity.tokenMint !== identity.tokenMint)
      reject("NON_SOL_STATE_IDENTITY");
    this.policy.assertBinding(s);
    if (buy && !this.policy.buysEnabled && state.normalizedState["genericBuyAdmissionAllowed"] !== true)
      reject("GENERIC_BUY_DISABLED_EXIT_ONLY");
    const q = await this.source.engine.quote(s, input, buy, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 1e4
    });
    if (state.normalizedState["tokenDecimals"] !== q.baseDecimals.toString())
      reject("NON_SOL_STATE_DECIMALS");
    return q;
  }
  fees(q) {
    const asset2 = (mint, n3) => mint === WRAPPED_SOL_MINT ? { asset: "PAPER_SOL", amount: paperSolBaseUnits(n3) } : { asset: "TOKEN", tokenMint: identifier(mint, "TokenMint"), amount: tokenBaseUnits(n3) };
    return [
      { category: "AMM_TRADE_FEE", amount: asset2(q.bridge.feeMint, q.bridge.lp) },
      ...["lp", "protocol", "creator"].map((k) => ({
        category: k === "creator" && q.creatorFeeDestination === "HOLDER_REWARD" ? "PUMP_SWAP_HOLDER_REWARD_FEE" : "PUMP_SWAP_" + k.toUpperCase() + "_FEE",
        amount: asset2(q.quoteMint, q.target.fees[k])
      }))
    ].filter((f) => f.amount.amount > 0n);
  }
  hops(q, state) {
    const s = state.normalizedState["stage1Snapshot"];
    const target = {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      inputMint: q.buy ? s.quoteMint : s.mint,
      outputMint: q.buy ? s.mint : s.quoteMint,
      input: q.target.input.toString(),
      output: q.target.output.toString(),
      fees: json(q.target.fees),
      postTrade: json(q.target.post)
    };
    const bridge = {
      pool: s.bridgePool,
      programId: ORCA_WHIRLPOOL_PROGRAM,
      inputMint: q.buy ? WRAPPED_SOL_MINT : s.quoteMint,
      outputMint: q.buy ? s.quoteMint : WRAPPED_SOL_MINT,
      input: (q.buy ? q.input : q.target.output).toString(),
      output: q.bridge.output.toString(),
      ...q.bridge.detail
    };
    return q.buy ? [bridge, target] : [target, bridge];
  }
  async execute(request, state, buy) {
    const input = buy ? request.requestedPaperSol : request.requestedTokenQuantity;
    const q = await this.quote(request.identity, state, input, buy), fees = this.fees(q);
    const from = buy ? { asset: "PAPER_SOL", amount: paperSolBaseUnits(q.input) } : { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.input) };
    const to = buy ? { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.output) } : { asset: "PAPER_SOL", amount: paperSolBaseUnits(q.output) };
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: from,
        simulatedOutput: to,
        fees
      },
      actualInput: from,
      actualOutput: to,
      executedAt: request.executedAt,
      executionDetails: { hops: this.hops(q, state) }
    };
  }
  simulateBuy(r, s) {
    return this.execute(r, s, true);
  }
  simulateSell(r, s) {
    return this.execute(r, s, false);
  }
  async valuePositionForExit(r, s) {
    const q = await this.quote(r.identity, s, r.tokenQuantity, false), fees = this.fees(q);
    return {
      identity: r.identity,
      tokenQuantity: r.tokenQuantity,
      paperSolValue: paperSolBaseUnits(q.output),
      adapterVersion: this.adapterVersion,
      marketStateFingerprint: createMarketStateEvidence(s).fingerprint,
      route: executionRouteRecord(s, false, this.hops(q, s)),
      feeBreakdown: {
        fees,
        totalPaperSolFees: paperSolBaseUnits(
          fees.reduce((n3, f) => n3 + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n), 0n)
        )
      }
    };
  }
  async maxExecutableSellQuantity(r, s) {
    try {
      await this.quote(r.identity, s, r.tokenQuantity, false);
    } catch (e) {
      if (!(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
        throw e;
    }
    const snapshot2 = s.normalizedState["stage1Snapshot"];
    const exit = await this.source.engine.exits(snapshot2, r.tokenQuantity, {
      nowMs: Date.parse(snapshot2.observedAt),
      maxAgeMs: 1e4
    });
    return tokenBaseUnits(exit.maxQuantity);
  }
};

// packages/protocols/src/generic-pump-swap.ts
var GENERIC_PUMP_SWAP_PROTOCOL_ID = identifier(
  "GENERIC_PUMP_SWAP",
  "ProtocolId"
);
var GENERIC_PUMP_SWAP_VERSION = "generic-pump-swap-orca-v1";
var NORMALIZATION = "generic-pump-swap-accounts-v1";
var CLOCK3 = "SysvarC1ock11111111111111111111111111111111";
var references = [1000000000n, 100000000n, 10000000n, 1000000n];
function unavailable(reason) {
  throw new ExecutionEngineError("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
function genericPumpSwapIdentity(mint, quote, bridge) {
  return {
    protocolId: GENERIC_PUMP_SWAP_PROTOCOL_ID,
    tokenMint: identifier(mint, "TokenMint"),
    marketId: identifier("generic-pump-swap:" + mint + ":" + quote + ":" + bridge, "MarketId")
  };
}
var OrcaBridgeCandidates = class {
  cache = /* @__PURE__ */ new Map();
  async pools(quote) {
    const cached = this.cache.get(quote);
    if (cached && cached.until > Date.now()) return [...cached.pools];
    const response = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/" + quote, {
      signal: AbortSignal.any([
        advisoryReadContext()?.signal ?? AbortSignal.timeout(8e3),
        AbortSignal.timeout(3e3)
      ])
    });
    if (!response.ok) unavailable("GENERIC_DISCOVERY_HTTP_" + response.status);
    const pairs = await response.json();
    if (!Array.isArray(pairs)) unavailable("GENERIC_DISCOVERY_INVALID");
    const pools = [
      ...new Set(
        pairs.filter(
          (p) => p && [p.baseToken?.address, p.quoteToken?.address].includes(quote) && [p.baseToken?.address, p.quoteToken?.address].includes(WRAPPED_SOL_MINT)
        ).map((p) => p.pairAddress).filter((p) => {
          if (typeof p !== "string") return false;
          try {
            return new PublicKey5(p).toBase58() === p;
          } catch {
            return false;
          }
        })
      )
    ].sort().slice(0, 16);
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value);
    if (pools.length) this.cache.set(quote, { until: Date.now() + 6e4, pools });
    return pools;
  }
};
function assertGenericQuoteMechanics(quote) {
  if (quote === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    unavailable("GENERIC_STABLE_FEE_SCHEDULE_UNSUPPORTED");
  if (quote === NATIVE_MINT_2022.toBase58())
    unavailable("GENERIC_TOKEN2022_NATIVE_FEE_SCHEDULE_UNSUPPORTED");
}
function compareGenericBridges(a, b) {
  if (BigInt(a.reference) !== BigInt(b.reference))
    return BigInt(a.reference) > BigInt(b.reference) ? -1 : 1;
  if (BigInt(a.recoveryPpb) !== BigInt(b.recoveryPpb))
    return BigInt(a.recoveryPpb) > BigInt(b.recoveryPpb) ? -1 : 1;
  return a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : 0;
}
function boundEngine(s) {
  assertGenericQuoteMechanics(s.quoteMint);
  return new Stage1NonSolPumpSwap({
    purpose: "READ_ONLY_STAGE1_VALIDATION",
    bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool }
  });
}
var GenericPumpSwapSource = class {
  constructor(rpc, candidates = new OrcaBridgeCandidates()) {
    this.rpc = rpc;
    this.candidates = candidates;
  }
  rpc;
  candidates;
  topology = /* @__PURE__ */ new Map();
  pinned = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  diagnostics = /* @__PURE__ */ new Map();
  engine = {
    validate: (s, p) => boundEngine(s).validate(s, p),
    quote: (s, input, buy, p) => boundEngine(s).quote(s, input, buy, p),
    exits: (s, q, p) => boundEngine(s).exits(s, q, p)
  };
  key(mint, quote) {
    return mint + ":" + quote;
  }
  async resolve(mint, quote) {
    assertGenericQuoteMechanics(quote);
    if ([WRAPPED_SOL_MINT, PublicKey5.default.toBase58()].includes(quote))
      unavailable("GENERIC_NATIVE_ROUTE_USE_EXISTING_ADAPTER");
    const k = this.key(mint, quote), cached = this.topology.get(k);
    if (cached && cached.until > Date.now())
      return genericPumpSwapIdentity(mint, quote, cached.bridge.pool);
    let promise = this.pending.get(k);
    if (!promise) {
      promise = this.discover(mint, quote).finally(() => {
        if (this.pending.get(k) === promise) this.pending.delete(k);
      });
      this.pending.set(k, promise);
    }
    const t = await promise;
    return genericPumpSwapIdentity(mint, quote, t.bridge.pool);
  }
  /** Only a trusted owner/settlement proof supplies this address. Old reserves are never reused. */
  async resolvePinned(mint, quote, bridgePool) {
    assertGenericQuoteMechanics(quote);
    const identity = genericPumpSwapIdentity(mint, quote, bridgePool), saved = this.pinned.get(identity.marketId);
    if (saved && saved.until > Date.now()) return identity;
    const curve = await pumpBondingCurveAddress(mint), target = await canonicalPumpSwapPoolAddress(mint, quote), r = await this.rpc.getMultipleAccounts([curve, target, bridgePool]);
    const c = r.value[0], p = r.value[1], b = r.value[2];
    if (!c || c.owner !== PUMP_PROGRAM_ID || !p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
      unavailable("GENERIC_EXIT_PIN_UNAVAILABLE");
    const curveState = decodePumpBondingCurve(Buffer.from(c.data[0], "base64")), pool = decodePumpSwapPool(Buffer.from(p.data[0], "base64")), bridge = orcaLink(bridgePool, { owner: b.owner, base64: b.data[0] });
    if (!curveState.complete || curveState.quoteMint !== quote || pool.baseMint !== mint || pool.quoteMint !== quote || pool.creator !== await pumpPoolAuthorityAddress(mint) || pool.index !== 0 || ![bridge.mintA, bridge.mintB].includes(quote) || ![bridge.mintA, bridge.mintB].includes(WRAPPED_SOL_MINT))
      unavailable("GENERIC_EXIT_PIN_LINKAGE");
    const addresses = [
      .../* @__PURE__ */ new Set([
        curve,
        target,
        mint,
        quote,
        WRAPPED_SOL_MINT,
        pool.baseVault,
        pool.quoteVault,
        bridgePool,
        bridge.vaultA,
        bridge.vaultB,
        bridge.config,
        ...bridge.extraAccounts ?? [],
        await pumpSwapGlobalConfigAddress(),
        await pumpSwapFeeConfigAddress(),
        CLOCK3
      ])
    ];
    const t = {
      mint,
      quote,
      target,
      bridge,
      addresses,
      until: Date.now() + 6e4,
      reference: "0",
      recoveryPpb: "0",
      pinned: true
    };
    if (this.pinned.size >= 256) this.pinned.delete(this.pinned.keys().next().value);
    this.pinned.set(identity.marketId, structuredClone(t));
    return identity;
  }
  async eligibility(mint, quote) {
    try {
      const identity = await this.resolve(mint, quote);
      return {
        supported: true,
        identity,
        diagnostics: this.diagnostics.get(this.key(mint, quote)) ?? []
      };
    } catch (e) {
      return {
        supported: false,
        reason: e instanceof ExecutionEngineError ? e.code : "MARKET_STATE_UNAVAILABLE",
        diagnostics: e instanceof Error ? e.message : "GENERIC_STATE_UNAVAILABLE",
        candidates: this.diagnostics.get(this.key(mint, quote)) ?? []
      };
    }
  }
  async discover(mint, quote) {
    const target = await canonicalPumpSwapPoolAddress(mint, quote), curve = await pumpBondingCurveAddress(mint);
    const targetRead = await this.rpc.getMultipleAccounts([
      curve,
      target,
      mint,
      quote,
      WRAPPED_SOL_MINT
    ]);
    const ca = targetRead.value[0], pa = targetRead.value[1];
    if (!ca || ca.owner !== PUMP_PROGRAM_ID || !pa || pa.owner !== PUMP_AMM_PROGRAM_ID)
      unavailable("GENERIC_CANONICAL_POOL_UNAVAILABLE");
    const c = decodePumpBondingCurve(Buffer.from(ca.data[0], "base64")), p = decodePumpSwapPool(Buffer.from(pa.data[0], "base64"));
    if (!c.complete || c.quoteMint !== quote || p.baseMint !== mint || p.quoteMint !== quote || p.index !== 0 || p.creator !== await pumpPoolAuthorityAddress(mint))
      unavailable("GENERIC_CANONICAL_LINKAGE");
    const tokenAccounts = {};
    [mint, quote, WRAPPED_SOL_MINT].forEach((a, i) => {
      const v = targetRead.value[i + 2];
      if (v) tokenAccounts[a] = { owner: v.owner, base64: v.data[0] };
    });
    const tokenSnapshot = {
      version: "NON_SOL_PUMPSWAP_STAGE1_V1",
      mint,
      quoteMint: quote,
      targetPool: target,
      bridgePool: "",
      slot: targetRead.context.slot,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      accounts: tokenAccounts,
      absentAccounts: []
    };
    for (const a of [mint, quote, WRAPPED_SOL_MINT]) validatePumpSwapMint(tokenSnapshot, a);
    const hints = [...new Set(await this.candidates.pools(quote))].sort().slice(0, 16);
    if (!hints.length) unavailable("GENERIC_SOL_BRIDGE_NOT_FOUND");
    const read = await this.rpc.getMultipleAccounts(hints), rejected = [], links = [];
    for (const [i, pool] of hints.entries()) {
      const a = read.value[i];
      if (!a || a.owner !== ORCA_WHIRLPOOL_PROGRAM) {
        rejected.push({ pool, reason: "GENERIC_BRIDGE_PROGRAM_UNSUPPORTED" });
        continue;
      }
      try {
        const link2 = orcaLink(pool, { owner: a.owner, base64: a.data[0] });
        if (![link2.mintA, link2.mintB].includes(quote) || ![link2.mintA, link2.mintB].includes(WRAPPED_SOL_MINT))
          unavailable("GENERIC_BRIDGE_ORIENTATION");
        links.push(link2);
      } catch (e) {
        rejected.push({ pool, reason: e instanceof Error ? e.message : "GENERIC_BRIDGE_INVALID" });
      }
    }
    const attempts = links.slice(0, 4), choices = [];
    const prepared = [];
    for (const bridge of attempts) {
      const addresses = [
        .../* @__PURE__ */ new Set([
          curve,
          target,
          mint,
          quote,
          WRAPPED_SOL_MINT,
          p.baseVault,
          p.quoteVault,
          bridge.pool,
          bridge.vaultA,
          bridge.vaultB,
          bridge.config,
          ...bridge.extraAccounts ?? [],
          await pumpSwapGlobalConfigAddress(),
          await pumpSwapFeeConfigAddress(),
          CLOCK3
        ])
      ];
      if (addresses.length > 100) unavailable("GENERIC_ATOMIC_BATCH_LIMIT");
      const candidate = {
        mint,
        quote,
        target,
        bridge,
        addresses,
        until: 0,
        reference: "0",
        recoveryPpb: "0"
      };
      prepared.push(candidate);
    }
    const snapshots = prepared.length ? await this.captureMany(prepared) : [];
    for (const [index2, candidate] of prepared.entries()) {
      const bridge = candidate.bridge;
      try {
        const snapshot2 = snapshots[index2];
        await this.engine.validate(snapshot2, {
          nowMs: Date.parse(snapshot2.observedAt),
          maxAgeMs: 1e4
        });
        for (const reference of references) {
          try {
            const policy = { nowMs: Date.parse(snapshot2.observedAt), maxAgeMs: 1e4 }, buy = await this.engine.quote(snapshot2, reference, true, policy), sell = await this.engine.quote(snapshot2, buy.output, false, policy);
            choices.push({
              ...candidate,
              reference: reference.toString(),
              recoveryPpb: (sell.output * 1000000000n / reference).toString()
            });
            break;
          } catch (e) {
            if (!(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
              throw e;
          }
        }
        if (!choices.some((t) => t.bridge.pool === bridge.pool))
          rejected.push({ pool: bridge.pool, reason: "GENERIC_REFERENCE_LIQUIDITY_UNAVAILABLE" });
      } catch (e) {
        if (e instanceof ExecutionEngineError && e.code === "RPC_UNAVAILABLE") throw e;
        rejected.push({
          pool: bridge.pool,
          reason: e instanceof Error ? e.message : "GENERIC_CAPTURE_INVALID"
        });
      }
    }
    if (this.diagnostics.size >= 256)
      this.diagnostics.delete(this.diagnostics.keys().next().value);
    this.diagnostics.set(this.key(mint, quote), rejected);
    choices.sort(
      (a, b) => compareGenericBridges(
        { reference: a.reference, recoveryPpb: a.recoveryPpb, pool: a.bridge.pool },
        { reference: b.reference, recoveryPpb: b.recoveryPpb, pool: b.bridge.pool }
      )
    );
    const selected = choices[0];
    if (!selected)
      unavailable(
        rejected.length ? "GENERIC_NO_VALIDATED_BRIDGE: " + rejected.map((r) => r.pool + "=" + r.reason).join("; ") : "GENERIC_SOL_BRIDGE_NOT_FOUND"
      );
    selected.until = Date.now() + 6e4;
    if (this.topology.size >= 256) this.topology.delete(this.topology.keys().next().value);
    this.topology.set(this.key(mint, quote), structuredClone(selected));
    return selected;
  }
  async captureMany(topologies) {
    const addresses = [...new Set(topologies.flatMap((t) => t.addresses))];
    if (addresses.length > 100) unavailable("GENERIC_ATOMIC_BATCH_LIMIT");
    const r = await this.rpc.getMultipleAccounts(addresses);
    if (r.value.length !== addresses.length || !Number.isSafeInteger(r.context.slot) || r.context.slot < 0)
      unavailable("GENERIC_CAPTURE_CARDINALITY_SLOT");
    const all = new Map(addresses.map((a, i) => [a, r.value[i]])), observedAt = (/* @__PURE__ */ new Date()).toISOString();
    return topologies.map((t) => {
      const accounts = {}, absentAccounts = [];
      t.addresses.forEach((a) => {
        const v = all.get(a);
        if (v) accounts[a] = { owner: v.owner, base64: v.data[0] };
        else absentAccounts.push(a);
      });
      return {
        version: "NON_SOL_PUMPSWAP_STAGE1_V1",
        mint: t.mint,
        quoteMint: t.quote,
        targetPool: t.target,
        bridgePool: t.bridge.pool,
        slot: r.context.slot,
        observedAt,
        accounts,
        absentAccounts
      };
    });
  }
  async capture(t) {
    const s = (await this.captureMany([t]))[0];
    await this.engine.validate(s, { nowMs: Date.parse(s.observedAt), maxAgeMs: 1e4 });
    return s;
  }
  async loadMarketState(identity) {
    const parts = identity.marketId.split(":");
    if (identity.protocolId !== GENERIC_PUMP_SWAP_PROTOCOL_ID || parts.length !== 4 || parts[1] !== identity.tokenMint)
      unavailable("GENERIC_EXECUTION_IDENTITY");
    const quote = parts[2], bridge = parts[3], key3 = this.key(identity.tokenMint, quote);
    let t = this.pinned.get(identity.marketId) ?? this.topology.get(key3);
    if (!t || t.until <= Date.now()) {
      if (t?.pinned) await this.resolvePinned(identity.tokenMint, quote, bridge);
      else await this.resolve(identity.tokenMint, quote);
      t = this.pinned.get(identity.marketId) ?? this.topology.get(key3);
    }
    if (!t || t.bridge.pool !== bridge) unavailable("GENERIC_PINNED_ROUTE_CHANGED");
    try {
      const snapshot2 = await this.capture(t), policy = { nowMs: Date.parse(snapshot2.observedAt), maxAgeMs: 1e4 };
      const link2 = orcaLink(snapshot2.bridgePool, snapshot2.accounts[snapshot2.bridgePool]);
      assertOrcaSnapshot(link2, snapshot2.accounts, snapshot2.absentAccounts);
      for (const reference of t.pinned ? [] : references) {
        try {
          const buy = await this.engine.quote(snapshot2, reference, true, policy);
          await this.engine.quote(snapshot2, buy.output, false, policy);
          break;
        } catch (e) {
          if (!(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
            throw e;
        }
      }
      const state = await pumpSwapStateFromSnapshot(
        identity,
        snapshot2,
        this.engine,
        GENERIC_PUMP_SWAP_VERSION,
        NORMALIZATION
      );
      return {
        ...state,
        normalizedState: {
          ...state.normalizedState,
          routePolicy: "GENERIC_FIXED_ORCA_V1",
          referenceInput: t.reference,
          referenceRecoveryPpb: t.recoveryPpb
        }
      };
    } catch (e) {
      this.topology.delete(key3);
      this.pinned.delete(identity.marketId);
      throw e;
    }
  }
};
function assertGenericBinding(s) {
  assertGenericQuoteMechanics(s.quoteMint);
  const target = s.accounts[s.targetPool], bridge = s.accounts[s.bridgePool];
  if (!target || target.owner !== PUMP_AMM_PROGRAM_ID || !bridge || bridge.owner !== ORCA_WHIRLPOOL_PROGRAM)
    unavailable("GENERIC_SNAPSHOT_PROGRAM");
  const p = decodePumpSwapPool(Buffer.from(target.base64, "base64")), b = orcaLink(s.bridgePool, bridge);
  if (p.baseMint !== s.mint || p.quoteMint !== s.quoteMint || ![b.mintA, b.mintB].includes(s.quoteMint) || ![b.mintA, b.mintB].includes(WRAPPED_SOL_MINT))
    unavailable("GENERIC_SNAPSHOT_BINDING");
}
var GenericPumpSwapAdapter = class extends NonSolPumpSwapAdapter {
  constructor(source, buysEnabled = true, permissionProvider) {
    super(source, {
      protocolId: GENERIC_PUMP_SWAP_PROTOCOL_ID,
      adapterVersion: GENERIC_PUMP_SWAP_VERSION,
      normalizationVersion: NORMALIZATION,
      identity: genericPumpSwapIdentity,
      assertBinding: assertGenericBinding,
      buysEnabled: typeof buysEnabled === "boolean" ? buysEnabled : false
    });
    this.buysEnabled = buysEnabled;
    this.permissionProvider = permissionProvider;
  }
  buysEnabled;
  permissionProvider;
  live = /* @__PURE__ */ new WeakMap();
  async loadMarketState(identity) {
    const state = await this.source.loadMarketState(identity);
    const current2 = {
      ...state,
      normalizedState: {
        ...state.normalizedState,
        genericBuyAdmissionAllowed: typeof this.buysEnabled === "function" ? this.buysEnabled() : this.buysEnabled
      }
    };
    const permission = this.permissionProvider?.();
    if (permission) this.live.set(current2, permission);
    return current2;
  }
  async simulateBuy(r, s) {
    await this.live.get(s)?.authorizeLive?.("BUY");
    return super.simulateBuy(r, s);
  }
  async simulateSell(r, s) {
    await this.live.get(s)?.authorizeLive?.("SELL");
    return super.simulateSell(r, s);
  }
};

// packages/protocols/src/production.ts
function createProductionExecutionRouter(options) {
  const rpc = new SolanaRpcClient({
    url: options.rpcUrl,
    timeoutMs: options.rpcTimeoutMs,
    commitment: options.commitment,
    ...options.log ? { log: options.log } : {}
  });
  const log2 = options.log ?? (() => void 0);
  const routes = new SolanaRouteSource(rpc, void 0, log2);
  const allowed = options.nonSolPumpSwapEnabled === true ? validateNonSolPumpSwapRoutes(options.nonSolPumpSwapRoutes) : options.nonSolPumpSwapRoutes ?? [];
  const nonSol = new NonSolPumpSwapSource(rpc, allowed);
  const generic = new GenericPumpSwapSource(rpc);
  const router2 = new ExecutionRouter([
    new PumpFunProtocolAdapter(new PumpFunSolanaMarketStateSource(rpc, log2), log2),
    new PumpSwapProtocolAdapter(new PumpSwapSolanaMarketStateSource(rpc, log2), log2),
    new SolanaRouteAdapter(routes),
    new NonSolPumpSwapAdapter(nonSol),
    new GenericPumpSwapAdapter(
      generic,
      () => options.genericPumpSwapBuysEnabled === true && genericOperation()?.permission.buy === true,
      () => genericOperation()?.permission
    )
  ]);
  if (options.log) router2.diagnostic = options.log;
  router2.setEnabled(NON_SOL_PUMP_SWAP_PROTOCOL_ID, options.nonSolPumpSwapEnabled === true);
  router2.setEnabled(GENERIC_PUMP_SWAP_PROTOCOL_ID, options.genericPumpSwapEnabled === true);
  installSolanaMintResolver(
    router2,
    routes,
    options.nonSolPumpSwapEnabled === true || options.genericPumpSwapEnabled === true ? {
      resolveNonSolPumpSwap: async (mint, quote) => {
        if (options.nonSolPumpSwapEnabled === true && allowed.some((r) => r.mint === mint && r.quoteMint === quote))
          return nonSol.resolve(mint, quote);
        if (options.genericPumpSwapEnabled !== true) return nonSol.resolve(mint, quote);
        const permission = await options.genericAccessResolver?.(
          mint,
          quote,
          genericOperation()?.settlement === true
        ) ?? DENY_GENERIC;
        recordGenericPermission(permission);
        if (permission.exitBinding) {
          if (permission.exitBinding.quoteMint !== quote || permission.exitBinding.targetPool !== await canonicalPumpSwapPoolAddress(mint, quote))
            throw new ExecutionEngineError(
              "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
              "GENERIC_EXIT_QUOTE_CHANGED"
            );
          return generic.resolvePinned(mint, quote, permission.exitBinding.bridgePool);
        }
        if (!permission.discover)
          throw new ExecutionEngineError(
            "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
            "GENERIC_OPERATOR_ENTITLEMENT_REQUIRED"
          );
        return generic.resolve(mint, quote);
      }
    } : void 0
  );
  const load = router2.loadPositionRoute.bind(router2), mintResolver = router2.mintResolver;
  router2.loadPositionRoute = (identity, settlement = false) => withGenericOperation(settlement, () => load(identity, settlement));
  router2.mintResolver = (mint) => withGenericOperation(false, () => mintResolver(mint));
  const resolve2 = router2.canonicalResolver;
  router2.canonicalResolver = async (identity) => {
    const context = advisoryReadContext(), start = performance.now();
    try {
      return await resolve2(identity);
    } finally {
      if (context)
        context.metrics.routeDiscoveryMs = (context.metrics.routeDiscoveryMs ?? 0) + performance.now() - start;
    }
  };
  return router2;
}

// packages/protocols/src/index.ts
var REFERENCE_PROTOCOL_ID = identifier("REFERENCE_TEST_ONLY", "ProtocolId");
var REFERENCE_ADAPTER_VERSION = "reference-constant-price-v1";
function asReferenceState(state) {
  const normalized = state.normalizedState;
  if (state.adapterVersion !== REFERENCE_ADAPTER_VERSION || normalized["model"] !== "CONSTANT_PRICE" || typeof normalized["quoteLamportsPerTokenBaseUnit"] !== "string" || typeof normalized["buyFeeBps"] !== "string" || typeof normalized["sellFeeBps"] !== "string" || typeof normalized["markValueLamportsPerTokenBaseUnit"] !== "string") {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Reference market state is invalid.");
  }
  return normalized;
}
function assertIdentity3(expected, actual) {
  if (expected.protocolId !== actual.protocolId || expected.marketId !== actual.marketId || expected.tokenMint !== actual.tokenMint) {
    throw new ExecutionEngineError("INVALID_MARKET_STATE", "Market-state identity mismatch.");
  }
}
function calculateFee2(amount, basisPoints2) {
  return amount * basisPoints2 / 10000n;
}
function feeDetails(amount) {
  const amountValue = paperSolBaseUnits(amount);
  const fees = amount === 0n ? [] : [
    {
      category: "REFERENCE_PROTOCOL_FEE",
      amount: { asset: "PAPER_SOL", amount: amountValue }
    }
  ];
  return { fees, totalPaperSolFees: amountValue };
}
function cloneState(state) {
  return {
    ...state,
    identity: { ...state.identity },
    normalizedState: { ...state.normalizedState },
    ...state.rawSource ? { rawSource: { ...state.rawSource } } : {}
  };
}
var ReferenceProtocolAdapter = class {
  protocolId = REFERENCE_PROTOCOL_ID;
  adapterVersion = REFERENCE_ADAPTER_VERSION;
  #states = /* @__PURE__ */ new Map();
  constructor(fixtures) {
    for (const fixture of fixtures) {
      if (fixture.identity.protocolId !== this.protocolId) {
        throw new ExecutionEngineError(
          "INVALID_MARKET_STATE",
          "Reference fixtures must use the explicit reference protocol ID."
        );
      }
      if (fixture.quoteLamportsPerTokenBaseUnit <= 0n || fixture.buyFeeBps < 0n || fixture.buyFeeBps > 10000n || fixture.sellFeeBps < 0n || fixture.sellFeeBps > 10000n) {
        throw new ExecutionEngineError(
          "INVALID_MARKET_STATE",
          "Reference fixture math is invalid."
        );
      }
      this.#states.set(fixture.identity.marketId, {
        identity: fixture.identity,
        observedAt: fixture.observedAt,
        chainSlot: fixture.chainSlot ?? null,
        chainBlockId: fixture.chainBlockId ?? null,
        adapterVersion: this.adapterVersion,
        normalizationVersion: "reference-state-v1",
        normalizedState: {
          model: "CONSTANT_PRICE",
          quoteLamportsPerTokenBaseUnit: fixture.quoteLamportsPerTokenBaseUnit.toString(),
          buyFeeBps: fixture.buyFeeBps.toString(),
          sellFeeBps: fixture.sellFeeBps.toString(),
          markValueLamportsPerTokenBaseUnit: (fixture.markValueLamportsPerTokenBaseUnit ?? fixture.quoteLamportsPerTokenBaseUnit).toString()
        }
      });
    }
  }
  async loadMarketState(identity) {
    if (identity.protocolId !== this.protocolId) {
      throw new ExecutionEngineError(
        "INVALID_MARKET_STATE",
        "Reference protocol identity mismatch."
      );
    }
    const state = this.#states.get(identity.marketId);
    if (!state) {
      throw new ExecutionEngineError(
        "MARKET_STATE_UNAVAILABLE",
        `No reference fixture exists for market ${identity.marketId}.`
      );
    }
    assertIdentity3(identity, state.identity);
    return cloneState(state);
  }
  async simulateBuy(request, marketState) {
    assertIdentity3(request.identity, marketState.identity);
    const state = asReferenceState(marketState);
    const input = request.requestedPaperSol;
    const feeAmount = calculateFee2(input, BigInt(state.buyFeeBps));
    const output = tokenBaseUnits(
      (input - feeAmount) / BigInt(state.quoteLamportsPerTokenBaseUnit)
    );
    return this.execution(
      request,
      marketState,
      { asset: "PAPER_SOL", amount: input },
      { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: output },
      feeDetails(feeAmount).fees
    );
  }
  async simulateSell(request, marketState) {
    assertIdentity3(request.identity, marketState.identity);
    const state = asReferenceState(marketState);
    const gross = request.requestedTokenQuantity * BigInt(state.quoteLamportsPerTokenBaseUnit);
    const feeAmount = calculateFee2(gross, BigInt(state.sellFeeBps));
    return this.execution(
      request,
      marketState,
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity
      },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits(gross - feeAmount) },
      feeDetails(feeAmount).fees
    );
  }
  async valuePositionForExit(request, marketState) {
    assertIdentity3(request.identity, marketState.identity);
    const state = asReferenceState(marketState);
    const gross = request.tokenQuantity * BigInt(state.quoteLamportsPerTokenBaseUnit);
    const feeAmount = calculateFee2(gross, BigInt(state.sellFeeBps));
    const evidence2 = createMarketStateEvidence(marketState);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(gross - feeAmount),
      feeBreakdown: feeDetails(feeAmount),
      marketStateFingerprint: evidence2.fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  execution(request, marketState, input, output, fees) {
    const evidence2 = createMarketStateEvidence(marketState);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: marketState.observedAt,
        marketStateFingerprint: evidence2.fingerprint,
        normalizationVersion: marketState.normalizationVersion,
        requestedInput: input,
        simulatedOutput: output,
        fees
      },
      actualInput: input,
      actualOutput: output,
      executedAt: request.executedAt
    };
  }
};
function paperSolFeeTotal(fees) {
  return paperSolBaseUnits(
    fees.reduce(
      (total, item) => item.amount.asset === "PAPER_SOL" ? total + item.amount.amount : total,
      0n
    )
  );
}
function tokenAmount(value) {
  return tokenBaseUnits(value);
}

// apps/api/isolated/verified-routes/finalized-connector.ts
import { mkdir, readFile, writeFile, link, unlink, readdir } from "node:fs/promises";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

// packages/protocols/isolated/linked-pair/epoch-flow.ts
import { EpochSchedule } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";

// apps/api/isolated/verified-routes/finalized-connector.ts
import { join } from "node:path";
import { randomUUID, createHash as createHash14 } from "node:crypto";
import { performance as performance2 } from "node:perf_hooks";

// packages/protocols/isolated/linked-pair/token-2022-flow.ts
import { PublicKey as PublicKey6 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { createHash as createHash6 } from "node:crypto";
import {
  unpackMint as unpackMint4,
  getExtensionTypes as getExtensionTypes3,
  getTransferFeeConfig as getTransferFeeConfig3,
  getEpochFee,
  calculateFee as calculateFee3,
  ExtensionType,
  getTransferHook as getTransferHook3,
  getDefaultAccountState as getDefaultAccountState3,
  TOKEN_2022_PROGRAM_ID as TOKEN_2022_PROGRAM_ID2,
  NATIVE_MINT_2022 as NATIVE_MINT_20222
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import bs58 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bs58/index.js";

// packages/protocols/isolated/linked-pair/pump-curve.ts
import { PublicKey as PublicKey7 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync3, unpackAccount as unpackAccount3 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
var U642 = (1n << 64n) - 1n;
var ZERO = PublicKey7.default.toBase58();

// packages/protocols/isolated/linked-pair/wrapped-sol-flow.ts
import { PublicKey as PublicKey8 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { createHash as createHash7 } from "node:crypto";

// packages/protocols/isolated/linked-pair/pump-multihop.ts
import { PublicKey as PublicKey11 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { createHash as createHash9 } from "node:crypto";
import bs582 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bs58/index.js";

// packages/protocols/isolated/linked-pair/pump-external.ts
import { PublicKey as PublicKey10 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";

// packages/protocols/isolated/linked-pair/engine.ts
import { createHash as createHash8 } from "node:crypto";
import { PublicKey as PublicKey9 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { unpackAccount as unpackAccount4, getAssociatedTokenAddressSync as getAssociatedTokenAddressSync4 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
var CLOCK4 = "SysvarC1ock11111111111111111111111111111111";
var U643 = (1n << 64n) - 1n;
function fail4(reason) {
  throw new ExecutionEngineError("INVALID_MARKET_STATE", reason);
}
function u642(n3) {
  if (typeof n3 !== "bigint" || n3 < 0n || n3 > U643) fail4("STAGE1_INVALID_U64");
  return n3;
}
function dust2() {
  throw new ExecutionEngineError("ZERO_EXECUTABLE_OUTPUT", "STAGE1_DUST");
}
var info3 = (a) => ({
  data: Buffer.from(a.base64, "base64"),
  owner: new PublicKey9(a.owner),
  executable: false,
  lamports: 0,
  rentEpoch: 0
});
function need3(s, address3) {
  const a = s.accounts[address3];
  if (!a) fail4("STAGE1_REQUIRED_ACCOUNT_MISSING: " + address3);
  return a;
}
function vault2(s, address3, expectedMint, authority) {
  const a = need3(s, address3), program2 = need3(s, expectedMint).owner;
  if (a.owner !== program2) fail4("STAGE1_VAULT_PROGRAM");
  const v = unpackAccount4(new PublicKey9(address3), info3(a), new PublicKey9(program2));
  if (!v.isInitialized || v.isFrozen || v.mint.toBase58() !== expectedMint || v.owner.toBase58() !== authority)
    fail4("STAGE1_VAULT_IDENTITY");
  return v;
}
async function validatePumpPool(s, poolAddress, baseMint, quoteMint) {
  if (quoteMint !== WRAPPED_SOL_MINT) {
    const curveAddress = await pumpBondingCurveAddress(baseMint), curveAccount = need3(s, curveAddress);
    if (curveAccount.owner !== PUMP_PROGRAM_ID) fail4("STAGE1_CURVE_OWNER");
    const curve = decodePumpBondingCurve(Buffer.from(curveAccount.base64, "base64"));
    if (!curve.complete || curve.quoteMint !== quoteMint) fail4("STAGE1_MIGRATION_IDENTITY");
  }
  const poolAccount = need3(s, poolAddress), poolBytes = Buffer.from(poolAccount.base64, "base64");
  if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || ![287, 300, 301].includes(poolBytes.length))
    fail4("STAGE1_POOL_LAYOUT_UNSUPPORTED");
  const p = decodePumpSwapPool(poolBytes);
  if (poolAddress !== await canonicalPumpSwapPoolAddress(baseMint, quoteMint) || p.index !== 0 || p.creator !== await pumpPoolAuthorityAddress(baseMint) || p.baseMint !== baseMint || p.quoteMint !== quoteMint)
    fail4("STAGE1_CANONICAL_IDENTITY");
  if ([243, 244, 269, 270].some((i) => poolBytes[i] > 1) || poolBytes.subarray(287).some((b) => b !== 0))
    fail4("STAGE1_POOL_FLAGS_OR_TAIL");
  if (p.isMayhemMode || p.isCashbackCoin || p.canEditCreatorFee || poolBytes[270] > 1)
    fail4("STAGE1_FLAGS_UNSUPPORTED");
  for (const address3 of [baseMint, quoteMint, WRAPPED_SOL_MINT]) validatePumpSwapMint(s, address3);
  for (const [address3, m] of [
    [p.baseVault, baseMint],
    [p.quoteVault, quoteMint]
  ])
    if (getAssociatedTokenAddressSync4(
      new PublicKey9(m),
      new PublicKey9(poolAddress),
      true,
      new PublicKey9(need3(s, m).owner)
    ).toBase58() !== address3)
      fail4("STAGE1_TARGET_ATA");
  const base = vault2(s, p.baseVault, baseMint, poolAddress), quote = vault2(s, p.quoteVault, quoteMint, poolAddress);
  const globalAddress = await pumpSwapGlobalConfigAddress(), feeAddress = await pumpSwapFeeConfigAddress();
  if (need3(s, globalAddress).owner !== PUMP_AMM_PROGRAM_ID || need3(s, feeAddress).owner !== PUMP_FEE_PROGRAM_ID)
    fail4("STAGE1_CONFIG_OWNER");
  const globalBytes = Buffer.from(need3(s, globalAddress).base64, "base64"), g = decodePumpSwapGlobalConfig(globalBytes);
  if (globalBytes.length !== 949 || g.disableFlags !== 0 || [417, 642, 939, 940].some((i) => globalBytes[i] > 1))
    fail4("STAGE1_GLOBAL_STATE_UNSUPPORTED");
  const fBytes = Buffer.from(need3(s, feeAddress).base64, "base64"), legacy = decodePumpSwapFeeConfig(fBytes);
  let end = 69 + fBytes.readUInt32LE(65) * 40;
  if (fBytes.length >= 4073) {
    if (end + 4 > fBytes.length) fail4("STAGE1_FEE_LAYOUT");
    end += 4 + fBytes.readUInt32LE(end) * 40;
  }
  let fees = legacy.flatFees;
  if (fBytes.length >= 4097) {
    if (end + 24 > fBytes.length) fail4("STAGE1_FEE_LAYOUT");
    const exotic = {
      lpFeeBps: fBytes.readBigUInt64LE(end),
      protocolFeeBps: fBytes.readBigUInt64LE(end + 8),
      creatorFeeBps: fBytes.readBigUInt64LE(end + 16)
    };
    if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) fees = exotic;
  }
  if (![2512, 4073, 4097].includes(fBytes.length)) fail4("STAGE1_FEE_LAYOUT_UNSUPPORTED");
  if (quoteMint === WRAPPED_SOL_MINT) {
    const cap = (quote.amount + p.virtualQuoteReserves) * validatePumpSwapMint(s, baseMint).supply / base.amount;
    fees = legacy.feeTiers[0].fees;
    for (const tier of legacy.feeTiers)
      if (cap >= tier.marketCapLamportsThreshold) fees = tier.fees;
  }
  const creator = g.creatorFeeConfigurable && p.creatorFeeBps > 0n ? p.creatorFeeBps : fees.creatorFeeBps;
  if (g.creatorFeeConfigurable && creator > g.maxConfigurableCreatorFeeBps)
    fail4("STAGE1_CREATOR_FEE_LIMIT");
  const math = {
    base: base.amount,
    quote: quote.amount,
    virtual: p.virtualQuoteReserves,
    protocolBucket: poolBytes.readBigUInt64LE(271),
    creatorBucket: poolBytes.readBigUInt64LE(279),
    lpBps: fees.lpFeeBps,
    protocolBps: fees.protocolFeeBps,
    creatorBps: p.coinCreator === PublicKey9.default.toBase58() ? 0n : creator,
    buybackBps: globalBytes.readBigUInt64LE(899)
  };
  for (const value of [math.base, math.quote, math.protocolBucket, math.creatorBucket]) u642(value);
  if (math.base === 0n || math.quote + math.virtual <= 0n || math.quote + math.virtual > U643 || math.protocolBucket + math.creatorBucket > math.quote || math.virtual < -(1n << 127n) || math.virtual >= 1n << 127n)
    fail4("STAGE1_INVALID_RESERVES");
  if ([math.lpBps, math.protocolBps, math.creatorBps, math.buybackBps].some(
    (n3) => n3 < 0n || n3 > 10000n
  ) || math.lpBps + math.protocolBps + math.creatorBps >= 10000n)
    fail4("STAGE1_INVALID_FEES");
  return {
    math,
    pool: p,
    holderReward: poolBytes[270] === 1,
    baseDecimals: validatePumpSwapMint(s, baseMint).decimals,
    quoteDecimals: validatePumpSwapMint(s, quoteMint).decimals
  };
}
var LinkedEngine = class {
  legacy;
  binding;
  constructor(options) {
    this.legacy = new Stage1NonSolPumpSwap(options);
    this.binding = options?.bridgeBinding ? { ...options.bridgeBinding } : void 0;
  }
  async validate(s, policy) {
    const capturedClock = Buffer.from(s.accounts[CLOCK4]?.base64 ?? "", "base64");
    if (capturedClock.length !== 40 || capturedClock.readBigUInt64LE(0) !== BigInt(s.slot))
      fail4("STAGE1_CLOCK_INCONSISTENT");
    const direct = s.quoteMint === WRAPPED_SOL_MINT && s.targetPool === s.bridgePool;
    const owner = s.accounts[s.bridgePool]?.owner;
    if (owner === ORCA_WHIRLPOOL_PROGRAM) return this.legacy.validate(s, policy);
    if (owner !== PUMP_AMM_PROGRAM_ID) fail4("LINKED_BRIDGE_PROGRAM_UNSUPPORTED");
    if (!this.binding || this.binding.quoteMint !== s.quoteMint || this.binding.pool !== s.bridgePool)
      fail4("LINKED_BRIDGE_BINDING_REQUIRED");
    if (s.version !== "NON_SOL_PUMPSWAP_STAGE1_V1" || !Number.isSafeInteger(s.slot) || s.slot < 0 || s.mint === s.quoteMint || !direct && (s.quoteMint === WRAPPED_SOL_MINT || s.targetPool === s.bridgePool))
      fail4("LINKED_PUMP_ROUTE_IDENTITY");
    const at = Date.parse(s.observedAt);
    if (!Number.isFinite(at) || !Number.isFinite(policy.nowMs) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || at > policy.nowMs || policy.nowMs - at > policy.maxAgeMs)
      fail4("STAGE1_STALE_CAPTURE");
    const clock3 = Buffer.from(need3(s, CLOCK4).base64, "base64");
    if (need3(s, CLOCK4).owner !== "Sysvar1111111111111111111111111111111111111" || clock3.length !== 40 || clock3.readBigUInt64LE(0) > BigInt(s.slot))
      fail4("STAGE1_CLOCK_INCONSISTENT");
    const time = clock3.readBigInt64LE(32), epoch = clock3.readBigUInt64LE(16);
    if (BigInt(Math.floor(policy.nowMs)) < time * 1000n || BigInt(Math.floor(policy.nowMs)) - time * 1000n > BigInt(Math.ceil(policy.maxAgeMs)))
      fail4("STAGE1_STALE_BANK");
    if (s.absentAccounts.some((a) => s.accounts[a])) fail4("STAGE1_ABSENT_ACCOUNT_CONFLICT");
    const target = await validatePumpPool(s, s.targetPool, s.mint, s.quoteMint), bridgePool = direct ? target : await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT);
    const bridge = {
      pool: s.bridgePool,
      program: PUMP_AMM_PROGRAM_ID,
      mintA: direct ? s.mint : s.quoteMint,
      mintB: WRAPPED_SOL_MINT,
      vaultA: bridgePool.pool.baseVault,
      vaultB: bridgePool.pool.quoteVault,
      config: await pumpSwapGlobalConfigAddress()
    };
    return {
      math: target.math,
      bridge,
      time,
      epoch,
      holderReward: target.holderReward,
      baseDecimals: target.baseDecimals,
      quoteDecimals: target.quoteDecimals
    };
  }
  async bridgeQuote(s, input, buy, policy) {
    const v = await this.validate(s, policy);
    if (v.bridge.program !== PUMP_AMM_PROGRAM_ID)
      return quoteSupplementalHop(
        v.bridge,
        s.accounts,
        input,
        v.bridge.mintA === (buy ? WRAPPED_SOL_MINT : s.quoteMint),
        v.time,
        validatePumpSwapMint(s, s.quoteMint).supply,
        s.absentAccounts
      );
    const bridge = await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT), q = stage1PoolSwap(bridge.math, input, buy);
    return {
      output: q.output,
      feeMint: WRAPPED_SOL_MINT,
      lp: q.fees.lp,
      protocol: q.fees.protocol,
      creator: q.fees.creator,
      detail: {
        bridgeKind: "PUMP_SWAP",
        nativeInstruction: buy ? "buy_exact_quote_in_v2" : "sell_v2",
        bridgeCreatorFeeDestination: bridge.holderReward ? "HOLDER_REWARD" : "CREATOR",
        input: input.toString(),
        output: q.output.toString(),
        fees: Object.fromEntries(Object.entries(q.fees).map(([k, v2]) => [k, v2.toString()])),
        postTrade: Object.fromEntries(Object.entries(q.post).map(([k, v2]) => [k, v2.toString()]))
      }
    };
  }
  async quote(s, input, buy, policy) {
    if (s.accounts[s.bridgePool]?.owner === ORCA_WHIRLPOOL_PROGRAM)
      return this.legacy.quote(s, input, buy, policy);
    const v = await this.validate(s, policy);
    u642(input);
    if (input === 0n) dust2();
    if (s.quoteMint === WRAPPED_SOL_MINT && s.targetPool === s.bridgePool) {
      const target2 = stage1PoolSwap(v.math, input, buy);
      return {
        version: s.version,
        slot: s.slot,
        mint: s.mint,
        quoteMint: s.quoteMint,
        creatorFeeDestination: v.holderReward ? "HOLDER_REWARD" : "CREATOR",
        input,
        output: target2.output,
        buy,
        target: target2,
        bridge: {
          output: buy ? input : target2.output,
          feeMint: WRAPPED_SOL_MINT,
          lp: 0n,
          protocol: 0n,
          creator: 0n,
          detail: { bridgeKind: "DIRECT" }
        },
        baseDecimals: v.baseDecimals,
        quoteDecimals: v.quoteDecimals,
        fingerprint: createHash8("sha256").update(JSON.stringify(s)).digest("hex")
      };
    }
    const bridge = buy ? await this.bridgeQuote(s, input, true, policy) : null, target = stage1PoolSwap(v.math, bridge?.output ?? input, buy), reverse = buy ? null : await this.bridgeQuote(s, target.output, false, policy);
    return {
      version: s.version,
      slot: s.slot,
      mint: s.mint,
      quoteMint: s.quoteMint,
      creatorFeeDestination: v.holderReward ? "HOLDER_REWARD" : "CREATOR",
      input,
      output: reverse?.output ?? target.output,
      buy,
      target,
      bridge: bridge ?? reverse,
      baseDecimals: v.baseDecimals,
      quoteDecimals: v.quoteDecimals,
      fingerprint: createHash8("sha256").update(JSON.stringify(s)).digest("hex")
    };
  }
  async exits(snapshot2, quantity, policy) {
    const s = structuredClone(snapshot2);
    u642(quantity);
    if (quantity === 0n) dust2();
    const read = async (q) => {
      try {
        return { quantity: q, quote: await this.quote(s, q, false, policy), reason: null };
      } catch (e) {
        if (!(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
          throw e;
        return { quantity: q, quote: null, reason: e.code };
      }
    };
    const full = await read(quantity);
    let max = quantity;
    if (!full.quote) {
      let low = 0n, high = quantity;
      while (low < high) {
        const mid = (low + high + 1n) / 2n, r = await read(mid);
        if (r.reason === "INSUFFICIENT_EXECUTABLE_LIQUIDITY") high = mid - 1n;
        else low = mid;
      }
      max = low;
    }
    const capacity = await read(max);
    if (!capacity.quote) max = 0n;
    return {
      full,
      maxQuantity: max,
      maxOutput: capacity.quote?.output ?? 0n,
      percentages: await Promise.all([25n, 50n, 75n].map((p) => read(quantity * p / 100n)))
    };
  }
};

// packages/protocols/isolated/linked-pair/pump-multihop.ts
var disc = createHash9("sha256").update("global:multi_hop_swap").digest().subarray(0, 8);

// packages/protocols/isolated/linked-pair/pump-sweep.ts
import { createHash as createHash10 } from "node:crypto";
import bs583 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bs58/index.js";
import { PublicKey as PublicKey12 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync5 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
var program = new PublicKey12(PUMP_AMM_PROGRAM_ID);

// packages/protocols/isolated/linked-pair/native-transition.ts
import BN3 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bn.js/lib/bn.js";
import { PublicKey as PublicKey13 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { BorshAccountsCoder } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@coral-xyz/anchor/dist/cjs/index.js";
import { convertIdlToCamelCase } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@coral-xyz/anchor/dist/cjs/idl.js";
import { WHIRLPOOL_IDL, PriceMath, SwapUtils as SwapUtils2, PoolUtil as PoolUtil2, PDAUtil as PDAUtil2 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/index.js";
import { TickArraySequence } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/quotes/swap/tick-array-sequence.js";
import { FeeRateManager } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/quotes/swap/fee-rate-manager.js";
import { computeSwapStep } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/utils/math/swap-math.js";
import { createHash as createHash11 } from "node:crypto";
var U644 = (1n << 64n) - 1n;
var U128 = (1n << 128n) - 1n;
var codec = new BorshAccountsCoder(convertIdlToCamelCase(WHIRLPOOL_IDL));
var LinkedTransitionError = class extends Error {
  code = "LINKED_STATE_TRANSITION_UNAVAILABLE";
};

// packages/protocols/isolated/linked-pair/shared-bridge.ts
function linkedBindings(s) {
  return s.linkedRoutes ?? [
    { mint: s.mint, quoteMint: s.quoteMint, targetPool: s.targetPool, bridgePool: s.bridgePool }
  ];
}

// packages/protocols/isolated/linked-pair/footprint.ts
import { createHash as createHash12 } from "node:crypto";

// packages/protocols/isolated/linked-pair/external-flow.ts
import { createHash as createHash13 } from "node:crypto";
import bs584 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/packages/protocols/node_modules/bs58/index.js";
var registry3 = globalThis;
var immutableKey = /* @__PURE__ */ Symbol.for("paperfund.immutable.provider.intervals.v1");
var immutableHashes = registry3[immutableKey] ?? /* @__PURE__ */ new WeakMap();
registry3[immutableKey] = immutableHashes;
var jsonKey = /* @__PURE__ */ Symbol.for("paperfund.immutable.provider.intervals.json.v1");
var immutableJSON = registry3[jsonKey] ?? /* @__PURE__ */ new WeakMap();
registry3[jsonKey] = immutableJSON;
var frozenKey = /* @__PURE__ */ Symbol.for("paperfund.immutable.provider.deep-frozen.v1");
var deepFrozen = registry3[frozenKey] ?? /* @__PURE__ */ new WeakSet();
registry3[frozenKey] = deepFrozen;
function freezeProviderDocument(v) {
  if (!v || typeof v !== "object" || deepFrozen.has(v)) return;
  for (const child of Object.values(v)) freezeProviderDocument(child);
  Object.freeze(v);
  deepFrozen.add(v);
}
function retainProviderInterval(e) {
  if (immutableHashes.has(e)) return e;
  let json4, hash;
  if (e.blocks.length > 128) {
    const h = createHash13("sha256");
    h.update("{");
    let first = true;
    const keys = Object.keys(Object.fromEntries(Object.entries(e).sort(([a], [b]) => a.localeCompare(b))));
    for (const key3 of keys) {
      const value = e[key3];
      if (value === void 0) continue;
      if (!first) h.update(",");
      first = false;
      h.update(JSON.stringify(key3) + ":");
      if (key3 === "blocks") {
        h.update("[");
        e.blocks.forEach((b, i) => {
          if (i) h.update(",");
          h.update(canonicalJSON(b));
        });
        h.update("]");
      } else h.update(canonicalJSON(value));
    }
    h.update("}");
    hash = h.digest("hex");
  } else {
    json4 = canonicalJSON(e);
    hash = createHash13("sha256").update(json4).digest("hex");
  }
  freezeProviderDocument(e);
  immutableHashes.set(e, hash);
  if (json4 !== void 0) immutableJSON.set(e, json4);
  return e;
}
function serializeProviderInterval(e) {
  retainProviderInterval(e);
  let json4 = immutableJSON.get(e);
  if (json4 === void 0) {
    json4 = canonicalJSON(e);
    if (createHash13("sha256").update(json4).digest("hex") !== digest(e)) fail5("IMMUTABLE_ENCODING_CONFLICT");
    immutableJSON.set(e, json4);
  }
  return json4;
}
function digest(v) {
  if (v && typeof v === "object") {
    const retained = immutableHashes.get(v);
    if (retained) return retained;
  }
  return createHash13("sha256").update(canonicalJSON(v)).digest("hex");
}
var canonicalOrders = /* @__PURE__ */ new Map();
function canonicalJSON(v) {
  const object = (x) => {
    const keys = Object.keys(x), shape = JSON.stringify(keys);
    let ordered = canonicalOrders.get(shape);
    if (!ordered) {
      ordered = keys.sort((a, b) => a.localeCompare(b));
      canonicalOrders.set(shape, ordered);
      if (canonicalOrders.size > 256) canonicalOrders.delete(canonicalOrders.keys().next().value);
    }
    const result = /* @__PURE__ */ Object.create(null);
    for (const key3 of ordered) result[key3] = sort(x[key3]);
    return result;
  };
  const sort = (x) => typeof x === "bigint" ? x.toString() : Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? object(x) : x;
  return JSON.stringify(sort(v));
}
var fail5 = (reason) => {
  throw new LinkedTransitionError(reason);
};

// apps/api/isolated/verified-routes/finalized-connector.ts
var compress = promisify(gzip);
var inflate = promisify(gunzip);
var CLOCK5 = "SysvarC1ock11111111111111111111111111111111";
var timing = (name, start, detail) => {
  performance2.measure(name, { start, detail });
  performance2.clearMeasures(name);
};
var fail6 = (m) => {
  throw Error("LINKED_CONNECTOR_" + m);
};
var FinalizedRpc = class {
  constructor(url, timeoutMs = 15e3) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
  url;
  timeoutMs;
  get providerIdentity() {
    return rpcProviderIdentity(this.url);
  }
  async call(method, params) {
    const cutoffCapture = cutoffCaptureContext();
    if (method === "getMultipleAccounts" && cutoffCapture?.commitment === "confirmed") params = [params[0], { ...params[1], commitment: "confirmed" }];
    if (!["getMultipleAccounts", "getSlot", "getBlocks", "getBlock", "getTransaction", "getTransactionsForAddress"].includes(method))
      fail6("READ_ONLY_METHOD");
    const started = performance2.now();
    const r = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    timing("linked.rpc.headers", started, { method });
    const decoding = performance2.now();
    if (!r.ok) fail6("HTTP_" + r.status);
    const text2 = await r.text();
    timing("linked.rpc.bodyRead", decoding, { method, bytes: Buffer.byteLength(text2) });
    const parsing = performance2.now();
    const v = JSON.parse(text2);
    timing("linked.rpc.jsonParse", parsing, { method });
    timing("linked.rpc.bodyDecode", decoding, { method });
    if (v.error || v.result === void 0) fail6("RPC_" + (v.error?.code ?? "MISSING_RESULT"));
    return v.result;
  }
};
function clock(s) {
  const a = s.accounts[CLOCK5], b = Buffer.from(a?.base64 ?? "", "base64");
  if (a?.owner !== "Sysvar1111111111111111111111111111111111111" || b.length !== 40 || !Number.isSafeInteger(s.slot) || b.readBigUInt64LE(0) !== BigInt(s.slot))
    fail6("CLOCK_CONTEXT");
  const seconds = Number(b.readBigInt64LE(32));
  if (!Number.isSafeInteger(seconds) || seconds < 0) fail6("CLOCK_TIME");
  return seconds;
}
var bankKey = (s) => digest({
  routes: linkedBindings(s),
  accounts: Object.keys(s.accounts).sort(),
  absent: s.absentAccounts
});
var bankValue = (s) => digest({ ...s, observedAt: "" });
var FinalizedBankArchive = class {
  constructor(directory, compressIntervals = false) {
    this.directory = directory;
    this.compressIntervals = compressIntervals;
  }
  directory;
  compressIntervals;
  async get(key3) {
    if (!/^[a-z0-9-]+$/.test(key3)) fail6("ARCHIVE_KEY");
    try {
      const reading = performance2.now();
      let raw;
      try {
        raw = await readFile(join(this.directory, key3 + ".json"), "utf8");
      } catch (e) {
        if (e.code !== "ENOENT" || !this.compressIntervals) throw e;
        raw = (await inflate(await readFile(join(this.directory, key3 + ".json.gz")))).toString();
      }
      timing("linked.archive.readInflate", reading, { kind: key3.split("-")[0] });
      const decoding = performance2.now();
      const v = JSON.parse(raw);
      if (v.serialization !== void 0) {
        if (v.serialization !== "JSON_BYTES_SHA256_V1" || !key3.startsWith("block-") || typeof v.json !== "string" || createHash14("sha256").update(v.json).digest("hex") !== v.hash)
          fail6("ARCHIVE_HASH");
        const block = JSON.parse(v.json);
        timing("linked.archive.decode", decoding, { key: key3 });
        return block;
      }
      if (key3.startsWith("interval-")) retainProviderInterval(v.document);
      if (digest(v.document) !== v.hash) fail6("ARCHIVE_HASH");
      return v.document;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async put(key3, document) {
    const encoding = performance2.now();
    await mkdir(this.directory, { recursive: true });
    if (!/^[a-z0-9-]+$/.test(key3)) fail6("ARCHIVE_KEY");
    const canonicalizing = performance2.now();
    if (key3.startsWith("interval-")) retainProviderInterval(document);
    timing("linked.archive.canonicalize", canonicalizing, { kind: key3.split("-")[0] });
    const blockBytes = this.compressIntervals && key3.startsWith("block-");
    const compressed = this.compressIntervals && (key3.startsWith("interval-") || blockBytes), suffix = compressed ? ".json.gz" : ".json";
    const temp = join(this.directory, "pending-" + randomUUID() + suffix), target = join(this.directory, key3 + suffix);
    const serializing = performance2.now();
    const json4 = blockBytes ? JSON.stringify(document) : void 0;
    const raw = blockBytes ? JSON.stringify({
      serialization: "JSON_BYTES_SHA256_V1",
      hash: createHash14("sha256").update(json4).digest("hex"),
      json: json4
    }) : key3.startsWith("interval-") ? '{"hash":"' + digest(document) + '","document":' + serializeProviderInterval(document) + "}" : JSON.stringify({ hash: digest(document), document });
    timing("linked.archive.serialize", serializing, { kind: key3.split("-")[0], bytes: Buffer.byteLength(raw) });
    const compressing = performance2.now();
    const encoded = compressed ? await compress(Buffer.from(raw), { level: 1 }) : raw;
    timing("linked.archive.compress", compressing, { kind: key3.split("-")[0] });
    timing("linked.archive.encode", encoding, { kind: key3.split("-")[0], bytes: Buffer.byteLength(encoded) });
    const writing = performance2.now();
    await writeFile(temp, encoded, {
      flag: "wx"
    });
    try {
      await link(temp, target);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (digest(await this.get(key3)) !== digest(document)) fail6("ARCHIVE_CONFLICT");
    } finally {
      await unlink(temp);
      timing("linked.archive.write", writing, { kind: key3.split("-")[0] });
    }
  }
  async bank(s) {
    clock(s);
    const key3 = "bank-" + bankKey(s) + "-" + s.slot, old = await this.get(key3);
    if (old) {
      if (bankValue(old) !== bankValue(s)) fail6("BANK_CONFLICT");
      return old;
    }
    await this.put(key3, s);
    return s;
  }
  async bankAt(anchor, slot) {
    return this.get("bank-" + bankKey(anchor) + "-" + slot);
  }
  /** Retained atomic banks only. Never synthesize an intermediate provider state. */
  async nextBank(anchor, maxSpan = 8) {
    const prefix = "bank-" + bankKey(anchor) + "-";
    const slots = (await readdir(this.directory)).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).map((f) => Number(f.slice(prefix.length, -5))).filter((s) => Number.isSafeInteger(s) && s > anchor.slot).sort((a, b) => a - b);
    const slot = slots.filter((s) => s <= anchor.slot + maxSpan).at(-1) ?? slots[0];
    return slot === void 0 ? null : this.bankAt(anchor, slot);
  }
};

// packages/protocols/isolated/linked-pair/adapter.ts
var reject2 = (reason) => {
  throw new ExecutionEngineError("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
};
var json2 = (v) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
async function linkedState(identity, s, engine2, version, normalization) {
  const state = await pumpSwapStateFromSnapshot(identity, s, engine2, version, normalization);
  const hops = state.normalizedState["hops"];
  return {
    ...state,
    normalizedState: {
      ...state.normalizedState,
      hops: (s.targetPool === s.bridgePool ? hops.slice(0, 1) : hops).map(
        (h, i) => i === 1 ? { ...h, programId: s.accounts[s.bridgePool].owner } : h
      )
    }
  };
}
var LinkedPoolAdapter = class {
  constructor(source, policy) {
    this.source = source;
    this.policy = policy;
    this.protocolId = policy.protocolId;
    this.adapterVersion = policy.adapterVersion;
  }
  source;
  policy;
  protocolId;
  adapterVersion;
  loadMarketState(identity) {
    return this.source.loadMarketState(identity);
  }
  async quote(identity, state, input, buy) {
    const s = state.normalizedState["stage1Snapshot"];
    if (!s || !Number.isSafeInteger(s.slot) || s.slot < 0 || !s.accounts || state.adapterVersion !== this.adapterVersion || state.normalizationVersion !== this.policy.normalizationVersion || state.normalizedState["model"] !== "NON_SOL_PUMP_SWAP_ROUTE" || state.chainSlot !== BigInt(s.slot) || state.observedAt !== s.observedAt || identity.protocolId !== this.protocolId || identity.marketId !== this.policy.identity(s.mint, s.quoteMint, s.bridgePool).marketId || identity.tokenMint !== s.mint || state.identity.protocolId !== identity.protocolId || state.identity.marketId !== identity.marketId || state.identity.tokenMint !== identity.tokenMint)
      reject2("NON_SOL_STATE_IDENTITY");
    this.policy.assertBinding(s);
    if (buy && !this.policy.buysEnabled && state.normalizedState["genericBuyAdmissionAllowed"] !== true)
      reject2("GENERIC_BUY_DISABLED_EXIT_ONLY");
    const q = await this.source.engine.quote(s, input, buy, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 1e4
    });
    if (state.normalizedState["tokenDecimals"] !== q.baseDecimals.toString())
      reject2("NON_SOL_STATE_DECIMALS");
    return q;
  }
  fees(q) {
    const asset2 = (mint, n3) => mint === WRAPPED_SOL_MINT ? { asset: "PAPER_SOL", amount: paperSolBaseUnits(n3) } : { asset: "TOKEN", tokenMint: identifier(mint, "TokenMint"), amount: tokenBaseUnits(n3) };
    return [
      ...q.bridge.detail["bridgeKind"] === "PUMP_SWAP" ? ["lp", "protocol", "creator"].map((k) => ({
        category: k === "creator" && q.bridge.detail["bridgeCreatorFeeDestination"] === "HOLDER_REWARD" ? "PUMP_SWAP_HOLDER_REWARD_FEE" : "PUMP_SWAP_" + k.toUpperCase() + "_FEE",
        amount: asset2(q.bridge.feeMint, q.bridge[k])
      })) : [{ category: "AMM_TRADE_FEE", amount: asset2(q.bridge.feeMint, q.bridge.lp) }],
      ...["lp", "protocol", "creator"].map((k) => ({
        category: k === "creator" && q.creatorFeeDestination === "HOLDER_REWARD" ? "PUMP_SWAP_HOLDER_REWARD_FEE" : "PUMP_SWAP_" + k.toUpperCase() + "_FEE",
        amount: asset2(q.quoteMint, q.target.fees[k])
      }))
    ].filter((f) => f.amount.amount > 0n);
  }
  hops(q, state) {
    const s = state.normalizedState["stage1Snapshot"];
    const target = {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      inputMint: q.buy ? s.quoteMint : s.mint,
      outputMint: q.buy ? s.mint : s.quoteMint,
      input: q.target.input.toString(),
      output: q.target.output.toString(),
      fees: json2(q.target.fees),
      postTrade: json2(q.target.post)
    };
    if (s.targetPool === s.bridgePool) return [target];
    const bridge = {
      pool: s.bridgePool,
      programId: s.accounts[s.bridgePool].owner,
      inputMint: q.buy ? WRAPPED_SOL_MINT : s.quoteMint,
      outputMint: q.buy ? s.quoteMint : WRAPPED_SOL_MINT,
      input: (q.buy ? q.input : q.target.output).toString(),
      output: q.bridge.output.toString(),
      ...q.bridge.detail
    };
    return q.buy ? [bridge, target] : [target, bridge];
  }
  async execute(request, state, buy) {
    const input = buy ? request.requestedPaperSol : request.requestedTokenQuantity;
    const q = await this.quote(request.identity, state, input, buy), fees = this.fees(q);
    const from = buy ? { asset: "PAPER_SOL", amount: paperSolBaseUnits(q.input) } : { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.input) };
    const to = buy ? { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.output) } : { asset: "PAPER_SOL", amount: paperSolBaseUnits(q.output) };
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: from,
        simulatedOutput: to,
        fees
      },
      actualInput: from,
      actualOutput: to,
      executedAt: request.executedAt,
      executionDetails: { hops: this.hops(q, state) }
    };
  }
  simulateBuy(r, s) {
    return this.execute(r, s, true);
  }
  simulateSell(r, s) {
    return this.execute(r, s, false);
  }
  async valuePositionForExit(r, s) {
    const q = await this.quote(r.identity, s, r.tokenQuantity, false), fees = this.fees(q);
    return {
      identity: r.identity,
      tokenQuantity: r.tokenQuantity,
      paperSolValue: paperSolBaseUnits(q.output),
      adapterVersion: this.adapterVersion,
      marketStateFingerprint: createMarketStateEvidence(s).fingerprint,
      route: executionRouteRecord(s, false, this.hops(q, s)),
      feeBreakdown: {
        fees,
        totalPaperSolFees: paperSolBaseUnits(
          fees.reduce((n3, f) => n3 + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n), 0n)
        )
      }
    };
  }
  async maxExecutableSellQuantity(r, s) {
    try {
      await this.quote(r.identity, s, r.tokenQuantity, false);
    } catch (e) {
      if (!(e instanceof ExecutionEngineError) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
        throw e;
    }
    const snapshot2 = s.normalizedState["stage1Snapshot"];
    const exit = await this.source.engine.exits(snapshot2, r.tokenQuantity, {
      nowMs: Date.parse(snapshot2.observedAt),
      maxAgeMs: 1e4
    });
    return tokenBaseUnits(exit.maxQuantity);
  }
};

// apps/api/isolated/current-quotes/router.ts
var CURRENT_QUOTE_VERSION = "paper-current-executable-v1";
var CURRENT_QUOTE_NORMALIZATION = "paper-current-accounts-v1";
var protocol = identifier("GENERIC_PUMP_SWAP", "ProtocolId");
var currentQuoteIdentity = (mint) => ({ protocolId: protocol, marketId: identifier("paper-current-quote:" + mint, "MarketId"), tokenMint: identifier(mint, "TokenMint") });
var fail7 = (reason) => {
  throw new ExecutionEngineError("MARKET_STATE_UNAVAILABLE", "CURRENT_QUOTE_" + reason);
};
var engine = (s) => new LinkedEngine({ purpose: "READ_ONLY_STAGE1_VALIDATION", bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool } });
function currentQuoteRouter(o) {
  if (!o.enabled) return { router: o.baseline, source: null, adapter: null };
  const now = o.now ?? Date.now, maxDeviation = o.maxDeviationBps ?? 1000n;
  if (maxDeviation <= 0n || maxDeviation > 1000n || !o.mints.length) fail7("POLICY");
  const owns = (id) => id.protocolId === protocol && o.mints.includes(id.tokenMint), snapshots = /* @__PURE__ */ new WeakMap();
  const native = {
    async quote(s, input, buy, policy) {
      const q = await engine(s).quote(s, input, buy, { ...policy, maxAgeMs: 1e4 });
      if (buy) {
        const reverse = await engine(s).quote(s, q.output, false, { ...policy, maxAgeMs: 1e4 });
        if (reverse.output > input) fail7("INSTANT_ROUND_TRIP_PROFIT");
        return q;
      }
      const peak = BigInt(s.paperQuotePeakQuantity ?? "0");
      if (peak < input && peak !== 0n) fail7("POSITION_CHANGED_RETRY");
      if (peak <= input) return q;
      const full = await engine(s).quote(s, peak, false, { ...policy, maxAgeMs: 1e4 }), scale = (n3) => n3 * input / peak;
      return { ...full, input, output: scale(full.output), target: { ...full.target, input: scale(full.target.input), output: scale(full.target.output), fees: Object.fromEntries(Object.entries(full.target.fees).map(([k, v]) => [k, scale(v)])) }, bridge: { ...full.bridge, output: scale(full.bridge.output), lp: scale(full.bridge.lp), protocol: scale(full.bridge.protocol), creator: scale(full.bridge.creator) } };
    },
    async exits(s, quantity, policy) {
      return engine(s).exits(s, quantity, { ...policy, maxAgeMs: 1e4 });
    }
  };
  const source = { engine: native, async loadMarketState(id) {
    if (!owns(id) || id.marketId !== currentQuoteIdentity(id.tokenMint).marketId) fail7("IDENTITY");
    const permission = await o.permission(id.tokenMint);
    if (!permission.discover) fail7("DISCOVERY_DISABLED");
    const candidates = await o.snapshots(id.tokenMint);
    if (candidates.length > 16) fail7("CANDIDATE_BOUND");
    const outcomes = await Promise.all(candidates.map(async (s) => {
      try {
        if (s.mint !== id.tokenMint) fail7("MINT_BINDING");
        const q = await native.quote(s, 10000000n, true, { nowMs: now(), maxAgeMs: 1e4 });
        const state2 = await linkedState(id, s, engine(s), CURRENT_QUOTE_VERSION, CURRENT_QUOTE_NORMALIZATION);
        return { state: state2, s, output: q.output };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "UNAVAILABLE" };
      }
    }));
    const valid = outcomes.filter((r) => "state" in r).sort((a, b) => a.output === b.output ? a.s.bridgePool.localeCompare(b.s.bridgePool) : a.output > b.output ? -1 : 1);
    const best = valid[0] ?? fail7("NO_EXECUTABLE_ROUTE:" + outcomes.map((r) => "error" in r ? r.error : "").join(","));
    const prior = await o.priorReference?.(id.tokenMint);
    if (prior) {
      const previous = BigInt(prior.output);
      if (best.s.slot < prior.slot || previous <= 0n || (best.output > previous ? best.output - previous : previous - best.output) * 10000n > previous * maxDeviation) fail7("PRICE_DEVIATION_REVIEW");
    }
    const peak = await o.peakQuantity?.(id.tokenMint) ?? 0n;
    const state = { ...best.state, normalizedState: { ...best.state.normalizedState, stage1Snapshot: { ...best.state.normalizedState["stage1Snapshot"], paperQuotePeakQuantity: peak.toString() }, currentQuotePolicy: CURRENT_QUOTE_VERSION, referenceBuyOutput: best.output.toString(), genericBuyAdmissionAllowed: permission.buy, executionModel: "FRESH_NATIVE_QUOTES_NO_HISTORICAL_REPLAY", partialExitPolicy: "FRESH_PEAK_PROPORTIONAL", quoteProvenance: { kind: "NATIVE_EXECUTABLE_CURRENT_BANK", commitment: "finalized", historicalReplayRequired: false } } };
    snapshots.set(state, best.s);
    return state;
  } };
  const adapter = new LinkedPoolAdapter(source, { protocolId: protocol, adapterVersion: CURRENT_QUOTE_VERSION, normalizationVersion: CURRENT_QUOTE_NORMALIZATION, identity: (mint) => currentQuoteIdentity(mint), assertBinding: (s) => {
    if (!o.mints.includes(s.mint)) fail7("MINT_SCOPE");
  }, buysEnabled: false });
  const current2 = new ExecutionRouter([adapter]);
  class Router extends ExecutionRouter {
    resolve(id) {
      return id === protocol ? current2.resolve(id) : o.baseline.resolve(id);
    }
    resolveForSettlement(id) {
      return id === protocol ? current2.resolveForSettlement(id) : o.baseline.resolveForSettlement(id);
    }
    resolveVersion(id, version) {
      return id === protocol && version === CURRENT_QUOTE_VERSION ? current2.resolveVersion(id, version) : o.baseline.resolveVersion(id, version);
    }
    isEnabled(id) {
      return id === protocol || o.baseline.isEnabled(id);
    }
    async resolvePositionRoute(id, settlement = false) {
      if (!owns(id)) return o.baseline.resolvePositionRoute(id, settlement);
      if (settlement) fail7("CUTOFF_EVIDENCE_REQUIRED");
      return { route: { originIdentity: id, executionIdentity: currentQuoteIdentity(id.tokenMint), migrated: id.marketId !== currentQuoteIdentity(id.tokenMint).marketId }, adapter: current2.resolve(protocol) };
    }
    async loadPositionRoute(id, settlement = false) {
      if (!owns(id)) return o.baseline.loadPositionRoute(id, settlement);
      const resolved = await this.resolvePositionRoute(id, settlement), state = await resolved.adapter.loadMarketState(resolved.route.executionIdentity);
      return { ...resolved, state };
    }
  }
  const router2 = new Router();
  router2.mintResolver = async (mint) => o.mints.includes(mint) ? currentQuoteIdentity(mint) : o.baseline.mintResolver ? o.baseline.mintResolver(mint) : fail7("DISCOVERY_UNAVAILABLE");
  router2.canonicalResolver = async (id) => (await router2.loadPositionRoute(id)).route;
  if (o.baseline.contextResolver) router2.contextResolver = o.baseline.contextResolver;
  if (o.baseline.chartMetadataResolver) router2.chartMetadataResolver = o.baseline.chartMetadataResolver;
  return { router: router2, source, adapter, async prospective(mint) {
    const state = await source.loadMarketState(currentQuoteIdentity(mint)), s = snapshots.get(state);
    const buy = await engine(s).quote(s, 10000000n, true, { nowMs: now(), maxAgeMs: 1e4 }), partial = await engine(s).quote(s, buy.output / 4n, false, { nowMs: now(), maxAgeMs: 1e4 }), full = await engine(s).quote(s, buy.output - buy.output / 4n, false, { nowMs: now(), maxAgeMs: 1e4 });
    const all = await engine(s).quote(s, buy.output, false, { nowMs: now(), maxAgeMs: 1e4 });
    return { state, buy, partial: { ...partial, output: all.output * (buy.output / 4n) / buy.output }, fullResidual: { ...full, output: all.output * (buy.output - buy.output / 4n) / buy.output }, buyAuthorized: false };
  } };
}

// apps/api/isolated/current-quotes/capture.ts
var clock2 = "SysvarC1ock11111111111111111111111111111111";
async function captureCurrentPumpRoute(rpc, archive, binding, now = Date.now) {
  const header = await rpc.call("getMultipleAccounts", [[binding.targetPool, binding.bridgePool], { commitment: "finalized", encoding: "base64" }]);
  if (!Number.isSafeInteger(header?.context?.slot) || header.value?.some((a) => a?.owner !== PUMP_AMM_PROGRAM_ID) || header.value?.length !== 2) throw Error("CURRENT_PUMP_BRIDGE_UNAVAILABLE");
  const descriptors2 = header.value.map((a) => decodePumpSwapPool(Buffer.from(a.data[0], "base64")));
  const addresses = [.../* @__PURE__ */ new Set([binding.targetPool, binding.bridgePool, binding.mint, binding.quoteMint, WRAPPED_SOL_MINT, ...descriptors2.flatMap((p) => [p.baseVault, p.quoteVault]), ...binding.quoteMint !== WRAPPED_SOL_MINT ? [await pumpBondingCurveAddress(binding.mint)] : [], await pumpSwapGlobalConfigAddress(), await pumpSwapFeeConfigAddress(), clock2])].sort();
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await rpc.call("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64", minContextSlot: header.context.slot }]);
    if (!Number.isSafeInteger(r?.context?.slot) || r.context.slot < header.context.slot || r.value?.length !== addresses.length || r.value.some((a) => !a || a.data?.[1] !== "base64")) throw Error("CURRENT_ROUTE_INCOMPLETE");
    const c = r.value[addresses.indexOf(clock2)], raw = Buffer.from(c.data[0], "base64");
    if (c.owner !== "Sysvar1111111111111111111111111111111111111" || raw.length !== 40 || raw.readBigUInt64LE(0) !== BigInt(r.context.slot)) {
      if (attempt < 2) continue;
      throw Error("CURRENT_CLOCK_CONTEXT");
    }
    const at = Number(raw.readBigInt64LE(32)) * 1e3;
    if (at > now() || now() - at > 1e4) throw Error("CURRENT_ROUTE_STALE");
    const s = { version: "NON_SOL_PUMPSWAP_STAGE1_V1", ...binding, slot: r.context.slot, observedAt: new Date(at).toISOString(), accounts: Object.fromEntries(addresses.map((a, i) => [a, { owner: r.value[i].owner, base64: r.value[i].data[0] }])), absentAccounts: [] };
    await archive.bank(s);
    return s;
  }
  throw Error("CURRENT_CLOCK_CONTEXT");
}

// apps/api/isolated/current-quotes/production-public/discovery.mjs
function currentSnapshots(h, p, rpc, archive, baseline, { candidates } = {}) {
  const SOL = p.WRAPPED_SOL_MINT;
  const metadata = /* @__PURE__ */ new Map();
  candidates ??= { async pools(mint) {
    const cached = metadata.get(mint);
    if (cached && cached.until > Date.now()) return cached.pools;
    const r = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/" + mint, { signal: AbortSignal.timeout(3e3) });
    if (!r.ok) throw Error("PUBLIC_DISCOVERY_HTTP");
    const data = await r.json();
    if (!Array.isArray(data)) throw Error("PUBLIC_DISCOVERY_RESPONSE");
    const pools = [...new Set(data.map((x) => x.pairAddress).filter((x) => typeof x === "string"))].sort().slice(0, 40);
    if (metadata.size >= 256) metadata.delete(metadata.keys().next().value);
    metadata.set(mint, { pools, until: Date.now() + 1e4 });
    return pools;
  } };
  async function pump(mint) {
    const curve = await p.pumpBondingCurveAddress(mint), read = await rpc.call("getMultipleAccounts", [[curve], { commitment: "finalized", encoding: "base64" }]);
    const account = read?.value?.[0];
    if (!account) return [];
    if (account.owner !== p.PUMP_PROGRAM_ID) throw Error("PUBLIC_CURVE_OWNER");
    const c = p.decodePumpBondingCurve(Buffer.from(account.data[0], "base64"));
    if (!c.complete || !c.quoteMint || c.quoteMint === SOL) return [];
    const targetPool = await p.canonicalPumpSwapPoolAddress(mint, c.quoteMint);
    const hints = await candidates.pools(c.quoteMint);
    const addresses = [.../* @__PURE__ */ new Set([await p.canonicalPumpSwapPoolAddress(c.quoteMint, SOL), ...hints])];
    if (addresses.length > 41) throw Error("PUBLIC_DISCOVERY_BOUND");
    const headers = await rpc.call("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64" }]);
    if (headers?.value?.length !== addresses.length || !Number.isSafeInteger(headers?.context?.slot)) throw Error("PUBLIC_DISCOVERY_INCOMPLETE");
    const bindings = [];
    for (let i = 0; i < addresses.length; i++) {
      const a = headers.value[i];
      if (a?.owner !== p.PUMP_AMM_PROGRAM_ID) continue;
      try {
        const pool = p.decodePumpSwapPool(Buffer.from(a.data[0], "base64"));
        if (pool.baseMint === c.quoteMint && pool.quoteMint === SOL || pool.quoteMint === c.quoteMint && pool.baseMint === SOL) bindings.push({ mint, quoteMint: c.quoteMint, targetPool, bridgePool: addresses[i] });
      } catch {
      }
    }
    if (bindings.length > 16) throw Error("PUBLIC_EXECUTABLE_CANDIDATE_BOUND");
    const captures = await Promise.allSettled(bindings.map(async (b) => {
      const s = await h.captureCurrentPumpRoute(rpc, archive, b);
      const check2 = h.currentQuoteRouter({ enabled: true, baseline, mints: [mint], snapshots: async () => [s], permission: async () => ({ discover: true, buy: false }) });
      await check2.prospective(mint);
      return s;
    }));
    return captures.filter((r) => r.status === "fulfilled").map((r) => r.value);
  }
  return async (mint) => {
    let pumpError;
    try {
      const s = await pump(mint);
      if (s.length) return s;
    } catch (e) {
      pumpError = e;
    }
    try {
      const id = await baseline.mintResolver(mint);
      if (id.protocolId !== "GENERIC_PUMP_SWAP") return [];
      const loaded = await baseline.loadPositionRoute(id), s = loaded.state.normalizedState.stage1Snapshot;
      if (!s || s.mint !== mint) throw Error("PUBLIC_GENERIC_SNAPSHOT");
      await archive.bank(s);
      return [s];
    } catch (error) {
      if (pumpError) throw pumpError;
      throw error;
    }
  };
}

// packages/db/src/legacy-settlement.ts
import { createHash as createHash15 } from "node:crypto";

// packages/db/src/payout-service.ts
var PayoutPlanError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
function compareText2(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function leaderboardFromRows(rows) {
  const sorted = [...rows].map((row) => ({
    userId: identifier(row.user_id, "UserId"),
    walletAddress: row.wallet_address,
    score: BigInt(row.score),
    resultId: row.result_id
  })).sort(
    (left, right) => (left.score > right.score ? -1 : left.score < right.score ? 1 : 0) || compareText2(left.userId, right.userId)
  );
  const rankGroups = [];
  for (const row of sorted) {
    const previous = rankGroups.at(-1);
    if (previous && previous.results[0].score === row.score) {
      const results = [...previous.results, row];
      rankGroups[rankGroups.length - 1] = {
        ...previous,
        tied: true,
        tieGroupSize: results.length,
        results
      };
    } else {
      rankGroups.push({
        rank: rankGroups.reduce((sum, group) => sum + group.tieGroupSize, 0) + 1,
        tied: false,
        tieGroupSize: 1,
        results: [row]
      });
    }
  }
  return { participantCount: sorted.length, rankGroups };
}
async function sourceRows(client, competitionType, sourceId) {
  return competitionType === "HOURLY" ? (await client.query(
    `select hr.id result_id,hr.user_id,u.wallet_address,hr.hourly_pnl_lamports::text score
           from hourly_results hr join users u on u.id=hr.user_id
           where hr.hourly_round_id=$1 order by hr.hourly_pnl_lamports desc,hr.user_id`,
    [sourceId]
  )).rows : (await client.query(
    `select dr.id result_id,dr.user_id,u.wallet_address,dr.cumulative_pnl_lamports::text score
           from daily_results dr join users u on u.id=dr.user_id
           where dr.daily_competition_id=$1 order by dr.cumulative_pnl_lamports desc,dr.user_id`,
    [sourceId]
  )).rows;
}
function curveFor(type) {
  return type === "HOURLY" ? {
    version: HOURLY_PAYOUT_CURVE_VERSION,
    entries: competitionConfig.hourlyPayoutCurve,
    nominalWinnerCount: competitionConfig.hourlyWinnerCount
  } : {
    version: DAILY_PAYOUT_CURVE_VERSION,
    entries: competitionConfig.dailyPayoutCurve,
    nominalWinnerCount: competitionConfig.dailyWinnerCount
  };
}
function sourceSnapshot(leaderboard) {
  return leaderboard.rankGroups.flatMap(
    (group) => group.results.map((result) => ({
      resultId: result.resultId,
      userId: result.userId,
      walletAddress: result.walletAddress,
      score: result.score.toString(),
      competitiveRank: group.rank,
      tieGroupSize: group.tieGroupSize
    }))
  );
}
async function sourceAndPool(client, type, sourceId) {
  if (type === "HOURLY") {
    const row2 = (await client.query(
      `select r.state source_state,p.status pool_state,p.final_hourly_prize_lamports::text prize_pool,p.id pool_id
         from hourly_rounds r join hourly_reward_pools p on p.hourly_round_id=r.id
         where r.id=$1 for update of r,p`,
      [sourceId]
    )).rows[0];
    if (!row2)
      throw new PayoutPlanError(
        "PAYOUT_SOURCE_NOT_READY",
        "Hourly result or reward pool is missing."
      );
    if (row2.source_state !== "FINALIZED" || !["FROZEN", "FINAL"].includes(row2.pool_state)) {
      throw new PayoutPlanError(
        "PAYOUT_SOURCE_NOT_FINAL",
        "Hourly result and reward pool must be final."
      );
    }
    return row2;
  }
  const row = (await client.query(
    `select d.state source_state,p.status pool_state,p.accumulated_lamports::text prize_pool,p.id pool_id
       from daily_competitions d join daily_reward_pools p on p.daily_competition_id=d.id
       where d.id=$1 for update of d,p`,
    [sourceId]
  )).rows[0];
  if (!row)
    throw new PayoutPlanError("PAYOUT_SOURCE_NOT_READY", "Daily result or reward pool is missing.");
  if (row.source_state !== "FINALIZED" || !["FROZEN", "FINAL"].includes(row.pool_state)) {
    throw new PayoutPlanError(
      "PAYOUT_SOURCE_NOT_FINAL",
      "Daily result and reward pool must be final."
    );
  }
  return row;
}
async function finalizeDailyRewardPool(database2, input) {
  const client = await database2.pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
      `daily-reward-freeze:${input.dailyCompetitionId}`
    ]);
    const daily = (await client.query(
      "select id,state from daily_competitions where id=$1 for update",
      [input.dailyCompetitionId]
    )).rows[0];
    if (!daily)
      throw new PayoutPlanError("PAYOUT_SOURCE_NOT_FOUND", "Daily competition not found.");
    if (daily.state !== "FINALIZED") {
      throw new PayoutPlanError("PAYOUT_SOURCE_NOT_FINAL", "Daily competition is not finalized.");
    }
    const incomplete = (await client.query(
      `select count(*)::text count from hourly_rounds r
         where r.starts_at >= (select starts_at from daily_competitions where id=$1)
           and r.starts_at < (select ends_at_exclusive from daily_competitions where id=$1)
           and (r.state <> 'FINALIZED' or not exists (
             select 1 from hourly_reward_pools p where p.hourly_round_id=r.id
           ))`,
      [input.dailyCompetitionId]
    )).rows[0];
    if (BigInt(incomplete.count) > 0n) {
      throw new PayoutPlanError(
        "DAILY_REWARD_NOT_READY",
        "Hourly reward pools are not all frozen."
      );
    }
    const poolId = `daily-reward:${input.dailyCompetitionId}`;
    await client.query(
      `insert into daily_reward_pools (id,daily_competition_id) values ($1,$2)
       on conflict (daily_competition_id) do nothing`,
      [poolId, input.dailyCompetitionId]
    );
    await client.query(
      `update daily_reward_pools set status='FROZEN',finalized_at=$2,updated_at=$2
       where daily_competition_id=$1 and status='OPEN'`,
      [input.dailyCompetitionId, input.now]
    );
    const frozen = (await client.query(
      `select id,accumulated_lamports::text,status,finalized_at
         from daily_reward_pools where daily_competition_id=$1`,
      [input.dailyCompetitionId]
    )).rows[0];
    await client.query("commit");
    return {
      id: frozen.id,
      dailyCompetitionId: input.dailyCompetitionId,
      accumulatedLamports: BigInt(frozen.accumulated_lamports),
      status: frozen.status,
      finalizedAt: frozen.finalized_at
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
async function runDailyRewardFinalizationTick(database2, now) {
  const rows = await database2.pool.query(
    `select d.id from daily_competitions d
     where d.state='FINALIZED'
       and not exists (
         select 1 from daily_reward_pools p
         where p.daily_competition_id=d.id and p.status in ('FROZEN','FINAL')
       ) order by d.starts_at`
  );
  const finalized = [];
  for (const row of rows.rows) {
    try {
      await finalizeDailyRewardPool(database2, { dailyCompetitionId: row.id, now });
      finalized.push(row.id);
    } catch (error) {
      if (!(error instanceof PayoutPlanError) || error.code !== "DAILY_REWARD_NOT_READY")
        throw error;
    }
  }
  return finalized;
}
async function generateShadowPayoutPlan(database2, input) {
  await assertLegacySource(database2, input.competitionType, input.sourceId);
  const curve = curveFor(input.competitionType);
  const planId = `payout:${input.competitionType.toLowerCase()}:${input.sourceId}:${curve.version}`;
  const client = await database2.pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [planId]);
    const existing = (await client.query("select id from payout_plans where id=$1", [planId])).rows[0];
    if (existing) {
      await client.query("commit");
      return await getPayoutPlanAudit(database2, existing.id);
    }
    const source = await sourceAndPool(client, input.competitionType, input.sourceId);
    const rows = await sourceRows(client, input.competitionType, input.sourceId);
    const leaderboard = leaderboardFromRows(rows);
    const calculated = allocatePayouts({
      prizePoolLamports: BigInt(source.prize_pool),
      leaderboard,
      payoutCurve: curve.entries
    });
    if (!calculated.ok) {
      throw new PayoutPlanError(calculated.reason, "Authoritative payout allocation failed.");
    }
    const total = calculated.allocations.reduce((sum, row) => sum + row.payoutLamports, 0n);
    const configSnapshot = {
      curveVersion: curve.version,
      tiePolicyVersion: PAYOUT_TIE_POLICY_VERSION,
      nominalWinnerCount: curve.nominalWinnerCount,
      curve: curve.entries.map(({ rank, sharePpm }) => ({ rank, sharePpm: sharePpm.toString() })),
      occupiedWeightPpm: calculated.occupiedWeightPpm.toString(),
      dustPolicy: "largest-remainder-by-ordinal; tie-dust-by-user-id-ascending"
    };
    await client.query(
      `insert into payout_plans
       (id,competition_type,hourly_round_id,daily_competition_id,prize_pool_lamports,
        curve_version,tie_policy_version,participant_count,nominal_winner_count,
        actual_winner_count,state,calculated_at,config_snapshot,source_result_snapshot,
        total_allocated_lamports,conservation_holds)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CALCULATED',$11,$12,$13,$14,true)`,
      [
        planId,
        input.competitionType,
        input.competitionType === "HOURLY" ? input.sourceId : null,
        input.competitionType === "DAILY" ? input.sourceId : null,
        calculated.prizePoolLamports.toString(),
        curve.version,
        PAYOUT_TIE_POLICY_VERSION,
        leaderboard.participantCount,
        curve.nominalWinnerCount,
        calculated.actualWinnerCount,
        input.now,
        JSON.stringify(configSnapshot),
        JSON.stringify(sourceSnapshot(leaderboard)),
        total.toString()
      ]
    );
    for (const bucket of calculated.rankBuckets) {
      await client.query(
        `insert into payout_rank_buckets
         (id,payout_plan_id,ordinal,weight_ppm,floor_allocation_lamports,remainder_basis,final_allocation_lamports)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          `${planId}:bucket:${bucket.ordinal}`,
          planId,
          bucket.ordinal,
          bucket.weightPpm.toString(),
          bucket.floorAllocationLamports.toString(),
          bucket.remainderBasis.toString(),
          bucket.finalAllocationLamports.toString()
        ]
      );
    }
    for (const allocation of calculated.allocations) {
      const tie = calculated.tieGroups.find((group) => group.competitiveRank === allocation.rank);
      await client.query(
        `insert into payout_allocations
         (id,payout_plan_id,user_id,competitive_rank,tie_group_size,ordinal_start,ordinal_end,
          funded_ordinal_count,allocated_lamports,dust_adjustment_lamports,allocation_explanation)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `${planId}:user:${allocation.userId}`,
          planId,
          allocation.userId,
          allocation.rank,
          allocation.tieGroupSize,
          allocation.ordinalStart,
          allocation.ordinalEnd,
          allocation.fundedOrdinalCount,
          allocation.payoutLamports.toString(),
          allocation.dustAdjustmentLamports.toString(),
          JSON.stringify({
            fundedOrdinals: tie.fundedOrdinals,
            combinedFundedLamports: tie.combinedFundedLamports.toString(),
            equalFloorLamports: tie.equalFloorLamports.toString(),
            tieDustLamports: tie.tieDustLamports.toString(),
            dustOrder: tie.userIdsInDustOrder
          })
        ]
      );
    }
    await client.query(
      `update payout_plans set state='FROZEN',frozen_at=$2 where id=$1 and state='CALCULATED'`,
      [planId, input.now]
    );
    await client.query(
      `update payout_plans set state='VALIDATED',validated_at=$2 where id=$1 and state='FROZEN'`,
      [planId, input.now]
    );
    await client.query("commit");
    return await getPayoutPlanAudit(database2, planId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
function generateHourlyShadowPayoutPlan(database2, input) {
  return generateShadowPayoutPlan(database2, {
    competitionType: "HOURLY",
    sourceId: input.hourlyRoundId,
    now: input.now
  });
}
function generateDailyShadowPayoutPlan(database2, input) {
  return generateShadowPayoutPlan(database2, {
    competitionType: "DAILY",
    sourceId: input.dailyCompetitionId,
    now: input.now
  });
}
async function carryZeroParticipantPoolToRewardBuffer(database2, input) {
  const outcomeId = `no-participants:${input.competitionType.toLowerCase()}:${input.sourceId}`;
  const client = await database2.pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [outcomeId]);
    const existing = (await client.query(
      "select carried_lamports::text from no_participant_reward_outcomes where id=$1",
      [outcomeId]
    )).rows[0];
    if (existing) {
      await client.query("commit");
      return { id: outcomeId, carriedLamports: BigInt(existing.carried_lamports), created: false };
    }
    const source = await sourceAndPool(client, input.competitionType, input.sourceId);
    const participants = await sourceRows(client, input.competitionType, input.sourceId);
    if (participants.length !== 0)
      throw new PayoutPlanError(
        "PAYOUT_PARTICIPANTS_PRESENT",
        "Competition has payout participants."
      );
    const carried = BigInt(source.prize_pool);
    await client.query(
      `insert into reward_buffer_state (id,balance_lamports) values ('PRIMARY',0)
       on conflict (id) do nothing`
    );
    const buffer = (await client.query(
      `select balance_lamports::text from reward_buffer_state where id='PRIMARY' for update`
    )).rows[0];
    const starting = BigInt(buffer.balance_lamports);
    const ending = starting + carried;
    const movementId = carried > 0n ? `buffer:${input.competitionType.toLowerCase()}:${input.sourceId}:ZERO_PARTICIPANT_CARRY_FORWARD` : null;
    if (movementId) {
      await client.query(
        input.competitionType === "HOURLY" ? `insert into reward_buffer_movements
             (id,hourly_reward_pool_id,reason,amount_lamports,starting_balance_lamports,ending_balance_lamports,created_at)
             values ($1,$2,'ZERO_PARTICIPANT_CARRY_FORWARD',$3,$4,$5,$6)` : `insert into reward_buffer_movements
             (id,daily_reward_pool_id,reason,amount_lamports,starting_balance_lamports,ending_balance_lamports,created_at)
             values ($1,$2,'ZERO_PARTICIPANT_CARRY_FORWARD',$3,$4,$5,$6)`,
        [
          movementId,
          source.pool_id,
          carried.toString(),
          starting.toString(),
          ending.toString(),
          input.now
        ]
      );
      await client.query(
        `update reward_buffer_state set balance_lamports=$1,updated_at=$2 where id='PRIMARY'`,
        [ending.toString(), input.now]
      );
    }
    await client.query(
      `insert into no_participant_reward_outcomes
       (id,competition_type,hourly_round_id,daily_competition_id,carried_lamports,reward_buffer_movement_id,recorded_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        outcomeId,
        input.competitionType,
        input.competitionType === "HOURLY" ? input.sourceId : null,
        input.competitionType === "DAILY" ? input.sourceId : null,
        carried.toString(),
        movementId,
        input.now
      ]
    );
    await client.query("commit");
    return { id: outcomeId, carriedLamports: carried, created: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
async function runPayoutPlanGenerationTick(database2, now) {
  const hourly = await database2.pool.query(
    `select r.id from hourly_rounds r join hourly_reward_pools p on p.hourly_round_id=r.id
     where r.state='FINALIZED' and p.status in ('FROZEN','FINAL')
       and not exists (select 1 from payout_plans x where x.hourly_round_id=r.id)
       and not exists (select 1 from no_participant_reward_outcomes x where x.hourly_round_id=r.id)
     order by r.starts_at`
  );
  const daily = await database2.pool.query(
    `select d.id from daily_competitions d join daily_reward_pools p on p.daily_competition_id=d.id
     where d.state='FINALIZED' and p.status in ('FROZEN','FINAL')
       and not exists (select 1 from payout_plans x where x.daily_competition_id=d.id)
       and not exists (select 1 from no_participant_reward_outcomes x where x.daily_competition_id=d.id)
     order by d.starts_at`
  );
  const generated = [];
  for (const row of hourly.rows) {
    const participants = await database2.pool.query(
      "select count(*)::text count from hourly_results where hourly_round_id=$1",
      [row.id]
    );
    if (participants.rows[0].count === "0") {
      await carryZeroParticipantPoolToRewardBuffer(database2, {
        competitionType: "HOURLY",
        sourceId: row.id,
        now
      });
      continue;
    }
    const plan = await generateHourlyShadowPayoutPlan(database2, { hourlyRoundId: row.id, now });
    generated.push(plan.id);
  }
  for (const row of daily.rows) {
    const participants = await database2.pool.query(
      "select count(*)::text count from daily_results where daily_competition_id=$1",
      [row.id]
    );
    if (participants.rows[0].count === "0") {
      await carryZeroParticipantPoolToRewardBuffer(database2, {
        competitionType: "DAILY",
        sourceId: row.id,
        now
      });
      continue;
    }
    const plan = await generateDailyShadowPayoutPlan(database2, { dailyCompetitionId: row.id, now });
    generated.push(plan.id);
  }
  return generated;
}
async function getPayoutPlanAudit(database2, planId) {
  const plan = (await database2.pool.query("select * from payout_plans where id=$1", [planId])).rows[0];
  if (!plan) return null;
  const buckets = (await database2.pool.query(
    `select ordinal,weight_ppm::text,floor_allocation_lamports::text,remainder_basis::text,
              final_allocation_lamports::text from payout_rank_buckets
       where payout_plan_id=$1 order by ordinal`,
    [planId]
  )).rows;
  const allocations = (await database2.pool.query(
    `select a.user_id,u.wallet_address,a.competitive_rank,a.tie_group_size,a.ordinal_start,
              a.ordinal_end,a.funded_ordinal_count,a.allocated_lamports::text,
              a.dust_adjustment_lamports::text,a.allocation_explanation
       from payout_allocations a join users u on u.id=a.user_id
       where a.payout_plan_id=$1 order by a.competitive_rank,a.user_id`,
    [planId]
  )).rows;
  return {
    id: plan.id,
    competitionType: plan.competition_type,
    hourlyRoundId: plan.hourly_round_id,
    dailyCompetitionId: plan.daily_competition_id,
    prizePoolLamports: BigInt(plan.prize_pool_lamports),
    curveVersion: plan.curve_version,
    tiePolicyVersion: plan.tie_policy_version,
    participantCount: plan.participant_count,
    nominalWinnerCount: plan.nominal_winner_count,
    actualWinnerCount: plan.actual_winner_count,
    state: plan.state,
    calculatedAt: plan.calculated_at,
    frozenAt: plan.frozen_at,
    validatedAt: plan.validated_at,
    configSnapshot: plan.config_snapshot,
    sourceLeaderboard: plan.source_result_snapshot,
    rankBuckets: buckets.map((row) => ({
      ordinal: row.ordinal,
      weightPpm: BigInt(row.weight_ppm),
      floorAllocationLamports: BigInt(row.floor_allocation_lamports),
      remainderBasis: BigInt(row.remainder_basis),
      finalAllocationLamports: BigInt(row.final_allocation_lamports)
    })),
    allocations: allocations.map((row) => ({
      userId: row.user_id,
      walletAddress: row.wallet_address,
      competitiveRank: row.competitive_rank,
      tied: row.tie_group_size > 1,
      tieGroupSize: row.tie_group_size,
      ordinalStart: row.ordinal_start,
      ordinalEnd: row.ordinal_end,
      fundedOrdinalCount: row.funded_ordinal_count,
      allocatedLamports: BigInt(row.allocated_lamports),
      dustAdjustmentLamports: BigInt(row.dust_adjustment_lamports),
      explanation: row.allocation_explanation
    })),
    conservation: {
      totalAllocatedLamports: BigInt(plan.total_allocated_lamports),
      prizePoolLamports: BigInt(plan.prize_pool_lamports),
      holds: plan.conservation_holds
    }
  };
}

// packages/db/src/legacy-settlement.ts
var LEGACY_SETTLEMENT_POLICY = "legacy-single-liquidation-v1";
async function recordSettlementReview(client, round, position, reason) {
  await client.query(
    `insert into legacy_source_reviews(id,hourly_round_id,position_id,reason)
  values($1,$2,$3,$4) on conflict do nothing`,
    [
      "review:" + createHash15("sha256").update(JSON.stringify([round, position, reason])).digest("hex"),
      round,
      position,
      reason
    ]
  );
}
async function assertLegacySource(database2, kind, source) {
  const row = (await database2.pool.query("select legacy_source_allowed($1,$2) allowed", [
    kind,
    source
  ])).rows[0];
  if (!row?.allowed)
    throw new PayoutPlanError(
      "PAYOUT_SETTLEMENT_REVIEW",
      "Settlement is REVIEW/non-payable or lacks qualified policy evidence."
    );
}

// packages/db/src/financial-service.ts
import { createHash as createHash16 } from "node:crypto";
var DEFAULT_STARTING_PAPER_SOL_LAMPORTS = 10000000000n;
var FinancialServiceError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "FinancialServiceError";
    this.code = code;
  }
};
function canonicalize2(value) {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize2);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key3, item]) => [key3, canonicalize2(item)])
    );
  }
  return value;
}
function fingerprint(value) {
  return createHash16("sha256").update(JSON.stringify(canonicalize2(value))).digest("hex");
}
function assertNonEmpty(value, name) {
  if (value.length === 0 || value.trim() !== value) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", `${name} must be non-empty.`);
  }
}
function firstRow(result, entity) {
  const row = result.rows[0];
  if (!row) throw new FinancialServiceError("ENTITY_NOT_FOUND", `${entity} was not found.`);
  return row;
}
function toCompetitionAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    hourlyRoundId: row.hourly_round_id,
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    paperSolBalanceLamports: BigInt(row.paper_sol_balance_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    finalSettledBalanceLamports: row.final_settled_balance_lamports === null ? null : BigInt(row.final_settled_balance_lamports),
    hourlyPnlLamports: row.hourly_pnl_lamports === null ? null : BigInt(row.hourly_pnl_lamports)
  };
}
function toPosition(row) {
  return {
    id: row.id,
    competitionAccountId: row.competition_account_id,
    marketId: row.market_id,
    assetId: row.asset_id,
    remainingBaseUnits: BigInt(row.remaining_base_units),
    costBasisLamports: BigInt(row.cost_basis_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    status: row.status
  };
}
function toHourlyResult(row) {
  return {
    id: row.id,
    hourlyRoundId: row.hourly_round_id,
    competitionAccountId: row.competition_account_id,
    userId: row.user_id,
    finalSettledBalanceLamports: BigInt(row.final_settled_balance_lamports),
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    hourlyPnlLamports: BigInt(row.hourly_pnl_lamports),
    finalizedAt: row.finalized_at
  };
}
function toDailyResult(row) {
  return {
    id: row.id,
    dailyCompetitionId: row.daily_competition_id,
    userId: row.user_id,
    cumulativePnlLamports: BigInt(row.cumulative_pnl_lamports),
    completedHourlyRoundCount: row.completed_hourly_round_count
  };
}
async function runFinancialTransaction(database2, operation) {
  const client = await database2.pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
async function claimIdempotency(client, input) {
  assertNonEmpty(input.idempotencyKey, "Idempotency key");
  const recordId = `idempotency:${input.operationClass}:${input.idempotencyKey}`;
  await client.query(
    `insert into idempotency_records
      (id, operation_class, idempotency_key, request_hash, competition_account_id)
     values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [
      recordId,
      input.operationClass,
      input.idempotencyKey,
      input.requestHash,
      input.competitionAccountId ?? null
    ]
  );
  const record = firstRow(
    await client.query(
      `select id, request_hash, status, result_entity_type, result_entity_id
       from idempotency_records
       where operation_class = $1 and idempotency_key = $2
       for update`,
      [input.operationClass, input.idempotencyKey]
    ),
    "Idempotency record"
  );
  if (record.request_hash !== input.requestHash) {
    throw new FinancialServiceError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used with a different request."
    );
  }
  return { record, replay: record.status === "COMPLETED" };
}
async function completeIdempotency(client, recordId, resultEntityType, resultEntityId, competitionAccountId) {
  await client.query(
    `update idempotency_records
     set status = 'COMPLETED', result_entity_type = $2, result_entity_id = $3,
         competition_account_id = coalesce(competition_account_id, $4), completed_at = now()
     where id = $1`,
    [recordId, resultEntityType, resultEntityId, competitionAccountId ?? null]
  );
}
async function insertJournal(client, input) {
  const debit = input.entries.filter(({ direction }) => direction === "DEBIT").reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const credit = input.entries.filter(({ direction }) => direction === "CREDIT").reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const zeroCostWriteoff = input.operationType === "FORCED_HOURLY_SETTLEMENT_WRITEOFF" && input.entries.length === 0 && input.metadata?.["costBasisLamports"] === "0";
  if (!zeroCostWriteoff && (input.entries.length < 2 || debit !== credit || debit <= 0n)) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Journal entries must balance.");
  }
  await client.query(
    `insert into journal_transactions
      (id, competition_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.competitionAccountId,
      input.operationType,
      input.sourceEntityType,
      input.sourceEntityId,
      input.idempotencyRecordId,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  for (const [index2, entry] of input.entries.entries()) {
    await client.query(
      `insert into ledger_entries
        (id, journal_transaction_id, competition_account_id, account_code, direction, amount_lamports)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        `${input.id}:entry:${index2.toString()}`,
        input.id,
        input.competitionAccountId,
        entry.accountCode,
        entry.direction,
        entry.amountLamports
      ]
    );
  }
}
async function getAccountStateWithClient(client, accountId, forUpdate = false) {
  return toCompetitionAccount(
    firstRow(
      await client.query(
        `select id, user_id, hourly_round_id, starting_paper_sol_lamports,
                paper_sol_balance_lamports, realized_pnl_lamports,
                final_settled_balance_lamports, hourly_pnl_lamports
         from competition_accounts where id = $1${forUpdate ? " for update" : ""}`,
        [accountId]
      ),
      "Competition account"
    )
  );
}
async function getAccountFinancialState(database2, accountId) {
  const client = await database2.pool.connect();
  try {
    return await getAccountStateWithClient(client, accountId);
  } finally {
    client.release();
  }
}
async function getPositionWithClient(client, positionId) {
  return toPosition(
    firstRow(
      await client.query(
        `select id, competition_account_id, market_id, asset_id, remaining_base_units,
                cost_basis_lamports, realized_pnl_lamports, status
         from positions where id = $1`,
        [positionId]
      ),
      "Position"
    )
  );
}
async function getHourlyResultWithClient(client, resultId) {
  return toHourlyResult(
    firstRow(
      await client.query(
        `select id, hourly_round_id, competition_account_id, user_id,
                final_settled_balance_lamports, starting_paper_sol_lamports,
                hourly_pnl_lamports, finalized_at
         from hourly_results where id = $1`,
        [resultId]
      ),
      "Hourly result"
    )
  );
}
async function finalizeHourlyResult(database2, input) {
  if (input.finalSettledBalanceLamports < 0n) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Final balance cannot be negative.");
  }
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database2, async (client) => {
    const account = await getAccountStateWithClient(client, input.accountId, true);
    const claimed = await claimIdempotency(client, {
      operationClass: "HOURLY_RESULT_FINALIZATION",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.accountId
    });
    if (claimed.replay) return getHourlyResultWithClient(client, claimed.record.result_entity_id);
    if (account.finalSettledBalanceLamports !== null || account.paperSolBalanceLamports !== input.finalSettledBalanceLamports) {
      throw new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        "Final balance does not match the unsettled competition account."
      );
    }
    const openPositions = firstRow(
      await client.query(
        `select count(*)::int as count from positions
         where competition_account_id = $1 and status = 'OPEN'`,
        [input.accountId]
      ),
      "Open-position aggregate"
    );
    if (openPositions.count !== 0) {
      throw new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        "All positions must be closed before hourly finalization."
      );
    }
    const hourlyPnl = input.finalSettledBalanceLamports - account.startingPaperSolLamports;
    await client.query(
      `update competition_accounts
       set final_settled_balance_lamports = $2, hourly_pnl_lamports = $3, finalized_at = $4
       where id = $1`,
      [input.accountId, input.finalSettledBalanceLamports, hourlyPnl, input.finalizedAt]
    );
    await client.query(
      `insert into hourly_results
        (id, hourly_round_id, competition_account_id, user_id,
         final_settled_balance_lamports, starting_paper_sol_lamports,
         hourly_pnl_lamports, idempotency_record_id, finalized_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.resultId,
        account.hourlyRoundId,
        input.accountId,
        account.userId,
        input.finalSettledBalanceLamports,
        account.startingPaperSolLamports,
        hourlyPnl,
        claimed.record.id,
        input.finalizedAt
      ]
    );
    await completeIdempotency(
      client,
      claimed.record.id,
      "HOURLY_RESULT",
      input.resultId,
      input.accountId
    );
    return getHourlyResultWithClient(client, input.resultId);
  });
}
async function getDailyResultWithClient(client, resultId) {
  return toDailyResult(
    firstRow(
      await client.query(
        `select id, daily_competition_id, user_id, cumulative_pnl_lamports,
                completed_hourly_round_count
         from daily_results where id = $1`,
        [resultId]
      ),
      "Daily result"
    )
  );
}
async function contributeHourlyResultToDailyCompetition(database2, input) {
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database2, async (client) => {
    const hourly = firstRow(
      await client.query(
        `select h.user_id, h.competition_account_id, h.hourly_pnl_lamports, r.starts_at
         from hourly_results h join hourly_rounds r on r.id = h.hourly_round_id
         where h.id = $1 for share of h, r`,
        [input.hourlyResultId]
      ),
      "Hourly result"
    );
    const daily = firstRow(
      await client.query(
        `select starts_at, ends_at_exclusive from daily_competitions where id = $1 for update`,
        [input.dailyCompetitionId]
      ),
      "Daily competition"
    );
    if (hourly.starts_at < daily.starts_at || hourly.starts_at >= daily.ends_at_exclusive) {
      throw new FinancialServiceError(
        "DAILY_ATTRIBUTION_MISMATCH",
        "The hourly round start time does not belong to this UTC day."
      );
    }
    const claimed = await claimIdempotency(client, {
      operationClass: "DAILY_RESULT_CONTRIBUTION",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: hourly.competition_account_id
    });
    if (claimed.replay) return getDailyResultWithClient(client, claimed.record.result_entity_id);
    const insertedDaily = await client.query(
      `insert into daily_results (id, daily_competition_id, user_id)
       values ($1, $2, $3)
       on conflict (daily_competition_id, user_id) do nothing returning id`,
      [input.dailyResultId, input.dailyCompetitionId, hourly.user_id]
    );
    const dailyResultId = insertedDaily.rows[0]?.id ?? firstRow(
      await client.query(
        `select id from daily_results where daily_competition_id = $1 and user_id = $2`,
        [input.dailyCompetitionId, hourly.user_id]
      ),
      "Daily result"
    ).id;
    const link2 = await client.query(
      `insert into daily_result_hourly_results
        (id, daily_result_id, hourly_result_id, idempotency_record_id)
       values ($1, $2, $3, $4)
       on conflict (hourly_result_id) do nothing returning id`,
      [input.contributionId, dailyResultId, input.hourlyResultId, claimed.record.id]
    );
    if (link2.rowCount === 1) {
      await client.query(
        `update daily_results
         set cumulative_pnl_lamports = cumulative_pnl_lamports + $2,
             completed_hourly_round_count = completed_hourly_round_count + 1,
             updated_at = now()
         where id = $1`,
        [dailyResultId, BigInt(hourly.hourly_pnl_lamports)]
      );
    } else {
      const existing = firstRow(
        await client.query(
          `select daily_result_id from daily_result_hourly_results where hourly_result_id = $1`,
          [input.hourlyResultId]
        ),
        "Daily contribution"
      );
      if (existing.daily_result_id !== dailyResultId) {
        throw new FinancialServiceError(
          "DAILY_ATTRIBUTION_MISMATCH",
          "The hourly result was already attributed to another daily result."
        );
      }
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      "DAILY_RESULT",
      dailyResultId,
      hourly.competition_account_id
    );
    return getDailyResultWithClient(client, dailyResultId);
  });
}
async function reconcileAccountLedger(database2, accountId) {
  const account = await getAccountFinancialState(database2, accountId);
  const positionAggregate = firstRow(
    await database2.pool.query(
      `select coalesce(sum(cost_basis_lamports), 0)::text as cost,
              coalesce(sum(remaining_base_units), 0)::text as quantity
       from positions where competition_account_id = $1`,
      [accountId]
    ),
    "Position aggregate"
  );
  const fillAggregate = firstRow(
    await database2.pool.query(
      `select coalesce(sum(case when f.side = 'BUY' then f.base_quantity else -f.base_quantity end), 0)::text as quantity
       from fills f join orders o on o.id = f.order_id where o.competition_account_id = $1`,
      [accountId]
    ),
    "Fill aggregate"
  );
  const writeoffAggregate = firstRow(
    await database2.pool.query(
      `select coalesce(sum(coalesce(r.token_quantity, (j.metadata->>'tokenQuantity')::numeric)), 0)::text as quantity
       from journal_transactions j left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id = j.id
       where j.competition_account_id = $1 and j.source_entity_type = 'SETTLEMENT_WRITEOFF'`,
      [accountId]
    ),
    "Settlement write-off aggregate"
  );
  const ledger = await database2.pool.query(
    `select account_code,
            sum(case when direction = 'DEBIT' then amount_lamports else -amount_lamports end)::text as balance
     from ledger_entries where competition_account_id = $1 group by account_code`,
    [accountId]
  );
  const balance = (code) => BigInt(ledger.rows.find(({ account_code }) => account_code === code)?.balance ?? "0");
  const journals = firstRow(
    await database2.pool.query(
      `select count(*)::text as total,
              count(*) filter (where debit = credit)::text as balanced
       from (
         select j.id,
                coalesce(sum(e.amount_lamports) filter (where e.direction = 'DEBIT'), 0) as debit,
                coalesce(sum(e.amount_lamports) filter (where e.direction = 'CREDIT'), 0) as credit
         from journal_transactions j
         left join ledger_entries e on e.journal_transaction_id = j.id
         where j.competition_account_id = $1 group by j.id
       ) journal_balances`,
      [accountId]
    ),
    "Journal aggregate"
  );
  const cash = balance("CASH");
  const positionCost = balance("POSITION_COST");
  const startingCapital = -balance("HOURLY_STARTING_CAPITAL");
  const grossTradingPnl = -balance("TRADING_PNL");
  const tradingFees = balance("TRADING_FEES");
  const realizedPnl = grossTradingPnl - tradingFees;
  const materializedPositionCost = BigInt(positionAggregate.cost);
  const materializedQuantity = BigInt(positionAggregate.quantity);
  const quantityFromFills = BigInt(fillAggregate.quantity) - BigInt(writeoffAggregate.quantity);
  const journalCount = Number(journals.total);
  const balancedJournalCount = Number(journals.balanced);
  return {
    accountId,
    cashFromLedgerLamports: cash,
    materializedCashLamports: account.paperSolBalanceLamports,
    positionCostFromLedgerLamports: positionCost,
    materializedPositionCostLamports: materializedPositionCost,
    quantityFromFills,
    materializedQuantity,
    startingCapitalLamports: startingCapital,
    grossTradingPnlLamports: grossTradingPnl,
    tradingFeesLamports: tradingFees,
    realizedPnlLamports: realizedPnl,
    balancedJournalCount,
    journalCount,
    reconciled: cash === account.paperSolBalanceLamports && positionCost === materializedPositionCost && quantityFromFills === materializedQuantity && startingCapital === account.startingPaperSolLamports && realizedPnl === account.realizedPnlLamports && cash + positionCost === startingCapital + grossTradingPnl - tradingFees && balancedJournalCount === journalCount
  };
}
function deterministicEntityId(kind, idempotencyKey) {
  return `${kind}:${createHash16("sha256").update(idempotencyKey).digest("hex")}`;
}
function executionPrice(numerator, denominator) {
  const scale = 10n ** 18n;
  const scaled = numerator * scale / denominator;
  if (scaled <= 0n) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "Execution price is below supported precision."
    );
  }
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(18, "0");
  return `${whole.toString()}.${fraction}`;
}
function normalizedFeeBreakdown(execution) {
  return {
    canonicalRoute: execution.executionDetails?.["canonicalRoute"] ?? null,
    executionDetails: execution.executionDetails ?? null,
    fees: execution.quote.fees.map((item) => ({
      category: item.category,
      asset: item.amount.asset,
      amount: item.amount.amount.toString(),
      ...item.amount.asset === "TOKEN" ? { tokenMint: item.amount.tokenMint } : {}
    }))
  };
}
function paperSolFeeTotal2(execution) {
  return execution.quote.fees.reduce(
    (total, item) => item.amount.asset === "PAPER_SOL" ? total + item.amount.amount : total,
    0n
  );
}
async function persistMarketStateEvidence(client, evidence2) {
  const id = `market-state:${evidence2.fingerprint}`;
  const rawSource = evidence2.rawSource ?? null;
  if (rawSource && Buffer.byteLength(JSON.stringify(rawSource), "utf8") > 65536) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "Raw market-state evidence exceeds the 64 KiB safety limit."
    );
  }
  await client.query(
    `insert into market_state_evidence
      (id, protocol_id, market_id, observed_at, chain_slot, chain_block_id,
       adapter_version, normalization_version, normalized_state, raw_source, state_fingerprint)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
     on conflict (state_fingerprint) do nothing`,
    [
      id,
      evidence2.identity.protocolId,
      evidence2.identity.marketId,
      new Date(evidence2.observedAt),
      evidence2.chainSlot,
      evidence2.chainBlockId,
      evidence2.adapterVersion,
      evidence2.normalizationVersion,
      JSON.stringify(evidence2.normalizedState),
      rawSource === null ? null : JSON.stringify(rawSource),
      evidence2.fingerprint
    ]
  );
  const persisted = firstRow(
    await client.query(
      `select id, protocol_id, market_id from market_state_evidence where state_fingerprint = $1`,
      [evidence2.fingerprint]
    ),
    "Market-state evidence"
  );
  if (persisted.protocol_id !== evidence2.identity.protocolId || persisted.market_id !== evidence2.identity.marketId) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The persisted evidence fingerprint has a conflicting identity."
    );
  }
  return persisted.id;
}
function translateExecutionError(error, valuation) {
  if (error instanceof FinancialServiceError) throw error;
  if (error instanceof ExecutionEngineError) {
    if (valuation) {
      throw new FinancialServiceError("POSITION_VALUATION_FAILED", error.message);
    }
    if (error.code === "UNSUPPORTED_PROTOCOL") {
      throw new FinancialServiceError("UNSUPPORTED_PROTOCOL", error.message);
    }
    if (error.code === "MARKET_STATE_UNAVAILABLE") {
      throw new FinancialServiceError("MARKET_STATE_UNAVAILABLE", error.message);
    }
    if (error.code === "PROTOCOL_DISABLED" || error.code === "INSUFFICIENT_EXECUTABLE_LIQUIDITY" || error.code === "ZERO_EXECUTABLE_OUTPUT" || error.code === "ADAPTER_VERSION_UNAVAILABLE" || error.code === "EVIDENCE_CORRUPTED") {
      throw new FinancialServiceError(error.code, error.message);
    }
    if (error.code === "MARKET_ACCOUNT_NOT_FOUND" || error.code === "MARKET_MIGRATED" || error.code === "MIGRATION_DESTINATION_UNAVAILABLE" || error.code === "UNSUPPORTED_MIGRATED_PROTOCOL" || error.code === "POSITION_EXECUTION_ROUTE_UNAVAILABLE" || error.code === "RPC_TIMEOUT" || error.code === "RPC_UNAVAILABLE" || error.code === "RPC_ERROR") {
      throw new FinancialServiceError(error.code, error.message);
    }
    throw new FinancialServiceError("INVALID_EXECUTION_RESULT", error.message);
  }
  throw new FinancialServiceError(
    valuation ? "POSITION_VALUATION_FAILED" : "MARKET_STATE_UNAVAILABLE",
    valuation ? "An open position could not be authoritatively valued." : "Authoritative market state is unavailable."
  );
}
async function getAuthoritativePaperSellResult(client, fillId) {
  const row = firstRow(
    await client.query(
      `select f.id as fill_id, f.order_id, f.execution_id, o.competition_account_id,
              f.market_id, f.protocol_id, o.execution_context,
              f.market_state_evidence_id, e.state_fingerprint, o.requested_base_units,
              f.base_quantity, f.actual_output_lamports, f.fee_lamports,
              f.cost_basis_lamports_removed, f.realized_pnl_lamports,
              f.adapter_version, a.paper_sol_balance_lamports,
              p.id as position_id, f.executed_at
       from fills f
       join orders o on o.id = f.order_id
       join competition_accounts a on a.id = o.competition_account_id
       join order_market_state_evidence oe on oe.order_id = o.id
                       and oe.evidence_id = f.market_state_evidence_id
                       and oe.purpose = 'SELL_EXECUTION'
       join positions p on p.id = oe.position_id
       join market_state_evidence e on e.id = f.market_state_evidence_id
       where f.id = $1`,
      [fillId]
    ),
    "Authoritative paper sell"
  );
  return {
    orderId: row.order_id,
    fillId: row.fill_id,
    executionId: row.execution_id,
    competitionAccountId: row.competition_account_id,
    marketId: row.market_id,
    protocolId: row.protocol_id,
    executionContext: row.execution_context,
    marketStateEvidenceId: row.market_state_evidence_id,
    marketStateFingerprint: row.state_fingerprint,
    requestedTokenQuantity: BigInt(row.requested_base_units),
    actualTokenInputBaseUnits: BigInt(row.base_quantity),
    actualNetPaperSolOutputLamports: BigInt(row.actual_output_lamports),
    feeLamports: BigInt(row.fee_lamports),
    costBasisLamportsRemoved: BigInt(row.cost_basis_lamports_removed),
    fillRealizedPnlLamports: BigInt(row.realized_pnl_lamports),
    adapterVersion: row.adapter_version,
    paperSolBalanceLamports: BigInt(row.paper_sol_balance_lamports),
    position: await getPositionWithClient(client, row.position_id),
    executedAt: row.executed_at
  };
}
function validateAuthoritativeSellExecution(input) {
  const { execution } = input;
  if (execution.id !== input.executionId || execution.orderId !== input.orderId || execution.quote.orderId !== input.orderId || execution.quote.protocolId !== input.identity.protocolId || execution.quote.marketId !== input.identity.marketId || execution.quote.adapterVersion !== input.adapterVersion || execution.quote.marketStateFingerprint !== input.evidence.fingerprint || execution.quote.normalizationVersion !== input.evidence.normalizationVersion || input.evidence.identity.protocolId !== input.identity.protocolId || input.evidence.identity.marketId !== input.identity.marketId || input.evidence.identity.tokenMint !== input.identity.tokenMint || input.evidence.adapterVersion !== input.adapterVersion || execution.actualInput.asset !== "TOKEN" || execution.actualInput.tokenMint !== input.identity.tokenMint || execution.actualInput.amount !== input.requestedTokenQuantity || execution.actualOutput.asset !== "PAPER_SOL" || typeof execution.actualOutput.amount !== "bigint" || execution.actualOutput.amount <= 0n) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The adapter returned an invalid or mismatched SELL execution result."
    );
  }
  const fees = paperSolFeeTotal2(execution);
  if (fees < 0n) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The SELL fee breakdown is invalid."
    );
  }
}
async function prepareAuthoritativeSell(database2, router2, input, ids, pinned) {
  const market = firstRow(
    await database2.pool.query(
      `select m.id, m.venue, m.base_asset_id, a.mint_address
       from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
      [input.marketId]
    ),
    "Market"
  );
  const identity = {
    protocolId: identifier(market.venue, "ProtocolId"),
    marketId: identifier(market.id, "MarketId"),
    tokenMint: identifier(market.mint_address, "TokenMint")
  };
  try {
    if (pinned && (pinned.identity.tokenMint !== identity.tokenMint || createMarketStateEvidence(pinned).fingerprint !== pinned.fingerprint))
      throw new FinancialServiceError("EVIDENCE_CORRUPTED", "Pinned liquidation evidence is invalid.");
    const { route, adapter, state } = pinned ? {
      route: {
        originIdentity: identity,
        executionIdentity: pinned.identity,
        migrated: pinned.identity.marketId !== identity.marketId
      },
      adapter: router2.resolveVersion(pinned.identity.protocolId, pinned.adapterVersion),
      state: pinned
    } : await withGenericAccount(
      input.competitionAccountId,
      () => router2.loadPositionRoute(identity, input.executionContext === "FORCED_HOURLY_SETTLEMENT")
    );
    if (route.migrated) {
      await database2.pool.query(
        `insert into markets
          (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
         select $1, base_asset_id, quote_asset_id, $2, $1,
                jsonb_build_object('migrationResolvedFromMarketId', id)
         from markets where id = $3
         on conflict do nothing`,
        [route.executionIdentity.marketId, route.executionIdentity.protocolId, identity.marketId]
      );
    }
    const executionMarket = (await database2.pool.query(
      `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
      [route.executionIdentity.marketId]
    )).rows[0];
    if (!executionMarket || executionMarket.venue !== route.executionIdentity.protocolId || executionMarket.base_asset_id !== market.base_asset_id || executionMarket.mint_address !== market.mint_address) {
      throw new ExecutionEngineError(
        "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
        "The resolved execution market is not registered for this position asset."
      );
    }
    const evidence2 = createMarketStateEvidence(state);
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && pinned)
      await database2.bindMarketSettlementEvidence?.(input.competitionAccountId, pinned);
    const execution = await adapter.simulateSell(
      {
        orderId: identifier(ids.orderId, "OrderId"),
        executionId: identifier(ids.executionId, "ExecutionId"),
        identity: route.executionIdentity,
        requestedTokenQuantity: tokenBaseUnits(input.requestedTokenQuantity),
        executedAt: utcInstant(input.authoritativeTimestamp)
      },
      state
    );
    validateAuthoritativeSellExecution({
      execution,
      orderId: ids.orderId,
      executionId: ids.executionId,
      identity: route.executionIdentity,
      requestedTokenQuantity: input.requestedTokenQuantity,
      evidence: evidence2,
      adapterVersion: adapter.adapterVersion
    });
    return {
      identity: route.executionIdentity,
      state,
      evidence: evidence2,
      execution,
      adapterVersion: adapter.adapterVersion
    };
  } catch (error) {
    translateExecutionError(error, false);
  }
}
async function executeAuthoritativePaperSell(database2, router2, input) {
  if (input.requestedTokenQuantity <= 0n) {
    throw new FinancialServiceError(
      "INVALID_SELL_QUANTITY",
      "Requested token quantity must be positive."
    );
  }
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Timestamp is invalid.");
  }
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedTokenQuantity: input.idempotencyIntent ?? input.requestedTokenQuantity,
    executionContext: input.executionContext
  });
  const prefix = input.idempotencyIntent === "ALL" ? "authoritative-sell-all" : input.executionContext === "FORCED_HOURLY_SETTLEMENT" ? "forced-settlement-sell" : "authoritative-sell";
  const orderId = deterministicEntityId(`${prefix}-order`, input.idempotencyKey);
  const fillId = deterministicEntityId(`${prefix}-fill`, input.idempotencyKey);
  const executionId = deterministicEntityId(`${prefix}-execution`, input.idempotencyKey);
  const operationClass = input.idempotencyIntent === "ALL" ? "AUTHORITATIVE_PAPER_SELL_ALL" : input.executionContext === "FORCED_HOURLY_SETTLEMENT" ? "FORCED_HOURLY_SETTLEMENT_SELL" : "AUTHORITATIVE_PAPER_SELL";
  const existingClient = await database2.pool.connect();
  try {
    const existing = await existingClient.query(
      `select id, request_hash, status, result_entity_type, result_entity_id
       from idempotency_records where operation_class = $1 and idempotency_key = $2`,
      [operationClass, input.idempotencyKey]
    );
    const record = existing.rows[0];
    if (record) {
      if (record.request_hash !== requestHash) {
        throw new FinancialServiceError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used with a different request."
        );
      }
      if (record.status === "COMPLETED" && record.result_entity_id) {
        return await getAuthoritativePaperSellResult(existingClient, record.result_entity_id);
      }
    }
  } finally {
    existingClient.release();
  }
  const prepared = await prepareAuthoritativeSell(database2, router2, input, {
    orderId,
    executionId
  }, input.settlementEvidence);
  if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && (!input.settlementEvidence || prepared.execution.actualOutput.amount !== input.settlementNetLimit))
    throw new FinancialServiceError("SETTLEMENT_REVIEW", "Forced execution must match its one pinned capacity quote.");
  return runFinancialTransaction(database2, async (client) => {
    await database2.lockMarketExecution?.(client, input.competitionAccountId);
    const claimed = await claimIdempotency(client, {
      operationClass,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId
    });
    if (claimed.replay) {
      return getAuthoritativePaperSellResult(client, claimed.record.result_entity_id);
    }
    const authority = firstRow(
      await client.query(
        `select a.hourly_round_id, r.state, r.starts_at, r.ends_at_exclusive
         from competition_accounts a join hourly_rounds r on r.id = a.hourly_round_id
         where a.id = $1 for share of r`,
        [input.competitionAccountId]
      ),
      "Competition account"
    );
    if (input.executionContext === "NORMAL_USER") {
      if (authority.state !== "OPEN") {
        throw new FinancialServiceError("ROUND_NOT_OPEN", "The hourly round is not open.");
      }
      if (input.authoritativeTimestamp < authority.starts_at || input.authoritativeTimestamp >= authority.ends_at_exclusive) {
        throw new FinancialServiceError(
          "OUTSIDE_ROUND_WINDOW",
          "The authoritative timestamp is outside the hourly round window."
        );
      }
    } else if (authority.state !== "SETTLING") {
      throw new FinancialServiceError(
        "SETTLEMENT_EXECUTION_FAILED",
        "Forced liquidation requires the round to be SETTLING."
      );
    }
    const account = await getAccountStateWithClient(client, input.competitionAccountId, true);
    if (account.finalSettledBalanceLamports !== null) {
      throw new FinancialServiceError("ROUND_NOT_OPEN", "The competition account is finalized.");
    }
    const positionRow = firstRow(
      await client.query(
        `select id, competition_account_id, market_id, asset_id, remaining_base_units,
                cost_basis_lamports, realized_pnl_lamports, status
         from positions where competition_account_id = $1 and market_id = $2 for update`,
        [input.competitionAccountId, input.marketId]
      ),
      "Position"
    );
    const quantityBefore = BigInt(positionRow.remaining_base_units);
    const costBefore = BigInt(positionRow.cost_basis_lamports);
    if (input.idempotencyIntent === "ALL" && input.requestedTokenQuantity !== quantityBefore) {
      throw new FinancialServiceError(
        "INVALID_SELL_QUANTITY",
        "The position changed while preparing SELL ALL; retry the same idempotent request."
      );
    }
    if (positionRow.status !== "OPEN" || input.requestedTokenQuantity > quantityBefore) {
      throw new FinancialServiceError(
        "INSUFFICIENT_TOKEN_BALANCE",
        "Requested SELL quantity exceeds the open token balance."
      );
    }
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && !input.persistedSettlementStep) {
      const prior = await client.query(`select 1 from fills f join orders o on o.id=f.order_id
        join order_market_state_evidence e on e.order_id=o.id
        where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' limit 1`, [positionRow.id]);
      if (prior.rowCount) throw new FinancialServiceError("SETTLEMENT_REVIEW", "A prior forced liquidation requires independent review; capacity cannot be reused.");
    }
    const netProceeds = prepared.execution.actualOutput.amount;
    const feeLamports = paperSolFeeTotal2(prepared.execution);
    const grossProceeds = netProceeds + feeLamports;
    const isFullSell = input.requestedTokenQuantity === quantityBefore;
    const costRemoved = isFullSell ? costBefore : costBefore * input.requestedTokenQuantity / quantityBefore;
    const fillPnl = netProceeds - costRemoved;
    const remainingQuantity = quantityBefore - input.requestedTokenQuantity;
    const remainingCost = costBefore - costRemoved;
    const evidenceId = await persistMarketStateEvidence(client, prepared.evidence);
    await client.query(
      `insert into orders
        (id, competition_account_id, market_id, side, requested_base_units,
         execution_context, status, idempotency_record_id, requested_at)
       values ($1, $2, $3, 'SELL', $4, $5, 'COMPLETED', $6, $7)`,
      [
        orderId,
        input.competitionAccountId,
        prepared.identity.marketId,
        input.requestedTokenQuantity,
        input.executionContext,
        claimed.record.id,
        input.authoritativeTimestamp
      ]
    );
    await client.query(
      `insert into order_market_state_evidence
        (id, order_id, evidence_id, purpose, position_id)
       values ($1, $2, $3, 'SELL_EXECUTION', $4)`,
      [`${orderId}:sell-execution`, orderId, evidenceId, positionRow.id]
    );
    await client.query(
      `update positions
       set remaining_base_units = $2, cost_basis_lamports = $3,
           realized_pnl_lamports = realized_pnl_lamports + $4,
           status = $5, closed_at = $6, updated_at = $7
       where id = $1`,
      [
        positionRow.id,
        remainingQuantity,
        remainingCost,
        fillPnl,
        remainingQuantity === 0n ? "CLOSED" : "OPEN",
        remainingQuantity === 0n ? input.authoritativeTimestamp : null,
        input.authoritativeTimestamp
      ]
    );
    await client.query(
      `insert into fills
        (id, order_id, market_id, execution_id, side, base_quantity, quote_lamports,
         execution_price, fee_lamports, actual_output_lamports, fee_breakdown,
         protocol_id, adapter_version, market_state_evidence_id,
         cost_basis_lamports_removed, realized_pnl_lamports, idempotency_record_id, executed_at)
       values ($1, $2, $3, $4, 'SELL', $5, $6, $7, $8, $9, $10::jsonb,
               $11, $12, $13, $14, $15, $16, $17)`,
      [
        fillId,
        orderId,
        prepared.identity.marketId,
        executionId,
        input.requestedTokenQuantity,
        grossProceeds,
        executionPrice(netProceeds, input.requestedTokenQuantity),
        feeLamports,
        netProceeds,
        JSON.stringify(normalizedFeeBreakdown(prepared.execution)),
        prepared.identity.protocolId,
        prepared.adapterVersion,
        evidenceId,
        costRemoved,
        fillPnl,
        claimed.record.id,
        input.authoritativeTimestamp
      ]
    );
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && !input.persistedSettlementStep) {
      await client.query(`insert into legacy_settlement_liquidations
       (position_id,hourly_round_id,policy_version,quantity_before,basis_before,sold_quantity,net_proceeds,fee_lamports,evidence_id,fill_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        positionRow.id,
        authority.hourly_round_id,
        LEGACY_SETTLEMENT_POLICY,
        quantityBefore.toString(),
        costBefore,
        input.requestedTokenQuantity.toString(),
        netProceeds,
        feeLamports,
        evidenceId,
        fillId
      ]);
      if (remainingQuantity > 0n) await recordSettlementReview(client, authority.hourly_round_id, positionRow.id, "PARTIAL_LIQUIDATION_REMAINDER");
    }
    await client.query(
      `update competition_accounts
       set paper_sol_balance_lamports = paper_sol_balance_lamports + $2,
           realized_pnl_lamports = realized_pnl_lamports + $3
       where id = $1`,
      [input.competitionAccountId, netProceeds, fillPnl]
    );
    const entries = [];
    if (netProceeds > 0n) {
      entries.push({ accountCode: "CASH", direction: "DEBIT", amountLamports: netProceeds });
    }
    if (feeLamports > 0n) {
      entries.push({
        accountCode: "TRADING_FEES",
        direction: "DEBIT",
        amountLamports: feeLamports
      });
    }
    if (costRemoved > 0n) {
      entries.push({
        accountCode: "POSITION_COST",
        direction: "CREDIT",
        amountLamports: costRemoved
      });
    }
    const grossPnl = grossProceeds - costRemoved;
    if (grossPnl > 0n) {
      entries.push({ accountCode: "TRADING_PNL", direction: "CREDIT", amountLamports: grossPnl });
    } else if (grossPnl < 0n) {
      entries.push({ accountCode: "TRADING_PNL", direction: "DEBIT", amountLamports: -grossPnl });
    }
    await insertJournal(client, {
      id: `journal:${prefix}:${fillId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: input.executionContext === "FORCED_HOURLY_SETTLEMENT" ? "FORCED_HOURLY_SETTLEMENT_SELL" : "AUTHORITATIVE_SIMULATED_SELL",
      sourceEntityType: "FILL",
      sourceEntityId: fillId,
      idempotencyRecordId: claimed.record.id,
      entries
    });
    await database2.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, fillId, execution: prepared.execution, executionContext: input.executionContext });
    if (input.persistedSettlementStep) {
      if (input.executionContext !== "FORCED_HOURLY_SETTLEMENT" || !database2.commitPersistedSettlementStep)
        throw new FinancialServiceError("SETTLEMENT_REVIEW", "Persisted settlement participant is required.");
      await database2.commitPersistedSettlementStep(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, positionId: positionRow.id, quantityBefore, basisBefore: costBefore, fillId, idempotencyKey: input.idempotencyKey, execution: prepared.execution, evidence: prepared.evidence });
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      "AUTHORITATIVE_SELL_FILL",
      fillId,
      input.competitionAccountId
    );
    return getAuthoritativePaperSellResult(client, fillId);
  });
}
async function repairLegacySettlementWriteoffMetadata(database2, accountId) {
  await runFinancialTransaction(database2, async (client) => {
    await client.query("select id from competition_accounts where id = $1 for update", [accountId]);
    const legacy = await client.query(
      `select j.id, j.source_entity_id, j.idempotency_record_id from journal_transactions j
       left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id = j.id
       where j.competition_account_id = $1 and j.operation_type = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'
         and j.source_entity_type = 'SETTLEMENT_WRITEOFF' and j.metadata = '{}'::jsonb
         and r.journal_transaction_id is null order by j.id`,
      [accountId]
    );
    for (const journal of legacy.rows) {
      const invalid = () => new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        `Legacy write-off ${journal.id} cannot be reconstructed uniquely from immutable fills and ledger.`
      );
      const position = (await client.query("select * from positions where id = $1 and competition_account_id = $2 for update", [
        journal.source_entity_id,
        accountId
      ])).rows[0];
      if (!position || position.status !== "CLOSED" || BigInt(position.remaining_base_units) !== 0n || BigInt(position.cost_basis_lamports) !== 0n)
        throw invalid();
      const peers = await client.query(
        "select id from positions where competition_account_id = $1 and asset_id = $2",
        [accountId, position.asset_id]
      );
      const writeoffs = await client.query(
        `select id from journal_transactions where competition_account_id = $1
         and source_entity_type = 'SETTLEMENT_WRITEOFF' and source_entity_id = $2`,
        [accountId, journal.source_entity_id]
      );
      const idempotency = (await client.query(
        `select * from idempotency_records where id = $1
          and competition_account_id = $2 and operation_class = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'`,
        [journal.idempotency_record_id, accountId]
      )).rows[0];
      if (peers.rowCount !== 1 || writeoffs.rowCount !== 1 || idempotency?.status !== "COMPLETED" || idempotency.result_entity_type !== "SETTLEMENT_WRITEOFF" || idempotency.result_entity_id !== journal.source_entity_id)
        throw invalid();
      const fills2 = await client.query(
        `select f.* from fills f join orders o on o.id = f.order_id
          join markets m on m.id = f.market_id
          where o.competition_account_id = $1 and m.base_asset_id = $2 order by f.id`,
        [accountId, position.asset_id]
      );
      let quantity = 0n, cost = 0n, pnl = 0n;
      for (const fill of fills2.rows) {
        quantity += (fill.side === "BUY" ? 1n : -1n) * BigInt(fill.base_quantity);
        cost += fill.side === "BUY" ? BigInt(
          fill.actual_input_lamports ?? (BigInt(fill.quote_lamports) + BigInt(fill.fee_lamports)).toString()
        ) : -BigInt(fill.cost_basis_lamports_removed);
        pnl += BigInt(fill.realized_pnl_lamports);
      }
      const entries = await client.query(
        "select account_code, direction, amount_lamports from ledger_entries where journal_transaction_id = $1",
        [journal.id]
      );
      if (quantity <= 0n || cost <= 0n || BigInt(position.realized_pnl_lamports) !== pnl - cost || entries.rowCount !== 2 || !entries.rows.some(
        (e) => e.account_code === "TRADING_PNL" && e.direction === "DEBIT" && BigInt(e.amount_lamports) === cost
      ) || !entries.rows.some(
        (e) => e.account_code === "POSITION_COST" && e.direction === "CREDIT" && BigInt(e.amount_lamports) === cost
      ))
        throw invalid();
      await client.query(
        `insert into settlement_writeoff_metadata_repairs
         (journal_transaction_id, token_quantity, cost_basis_lamports, evidence) values ($1, $2, $3, $4::jsonb)`,
        [
          journal.id,
          quantity,
          cost,
          JSON.stringify({
            reason: "LEGACY_WRITEOFF_METADATA_RECOVERY_V1",
            positionId: journal.source_entity_id,
            marketId: position.market_id,
            fillIds: fills2.rows.map((f) => f.id),
            method: "Immutable BUY quantity minus SELL quantity; capitalized BUY cost minus removed SELL basis; matching write-off ledger and closed-position P&L."
          })
        ]
      );
    }
  });
}
async function writeOffSettlementRemainder(database2, input) {
  if (input.tokenQuantity <= 0n) return;
  const applyWriteoff = async (client) => {
    await client.query("select id from competition_accounts where id = $1 for update", [
      input.competitionAccountId
    ]);
    const round = firstRow(
      await client.query(
        `select r.state from hourly_rounds r join competition_accounts a on a.hourly_round_id = r.id
       where a.id = $1 for share of r`,
        [input.competitionAccountId]
      ),
      "Hourly round"
    );
    if (round.state !== "SETTLING")
      throw new FinancialServiceError("FINALIZATION_CONFLICT", "Write-off requires SETTLING.");
    const requestHash = fingerprint({
      positionId: input.positionId,
      marketId: input.marketId,
      competitionAccountId: input.competitionAccountId,
      authoritativeTimestamp: input.authoritativeTimestamp
    });
    const claimed = await claimIdempotency(client, {
      operationClass: "FORCED_HOURLY_SETTLEMENT_WRITEOFF",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId
    });
    if (claimed.replay) return;
    const position = firstRow(
      await client.query(
        `select status, remaining_base_units, cost_basis_lamports from positions where id = $1 and competition_account_id = $2 for update`,
        [input.positionId, input.competitionAccountId]
      ),
      "Position"
    );
    const quantity = BigInt(position.remaining_base_units);
    const cost = BigInt(position.cost_basis_lamports);
    if (position.status !== "OPEN" || quantity === 0n) {
      await completeIdempotency(
        client,
        claimed.record.id,
        "SETTLEMENT_WRITEOFF",
        input.positionId,
        input.competitionAccountId
      );
      return;
    }
    if (quantity !== input.tokenQuantity || cost !== input.costBasis) {
      throw new FinancialServiceError(
        "SETTLEMENT_INCOMPLETE",
        "Position changed after zero-capacity observation; reload before write-off."
      );
    }
    await client.query(
      `update positions set remaining_base_units = 0, cost_basis_lamports = 0,
         realized_pnl_lamports = realized_pnl_lamports - $2, status = 'CLOSED',
         closed_at = $3, updated_at = $3 where id = $1`,
      [input.positionId, cost, input.authoritativeTimestamp]
    );
    await client.query(
      `update competition_accounts set realized_pnl_lamports = realized_pnl_lamports - $2 where id = $1`,
      [input.competitionAccountId, cost]
    );
    await insertJournal(client, {
      id: `journal:forced-writeoff:${input.positionId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: "FORCED_HOURLY_SETTLEMENT_WRITEOFF",
      sourceEntityType: "SETTLEMENT_WRITEOFF",
      sourceEntityId: input.positionId,
      idempotencyRecordId: claimed.record.id,
      metadata: {
        tokenQuantity: quantity.toString(),
        costBasisLamports: cost.toString(),
        marketId: input.marketId,
        reason: input.operatorResolution ? "OPERATOR_APPROVED_DUST_RESOLUTION_V1" : "NO_POSITIVE_AUTHORITATIVE_EXECUTABLE_EXIT",
        ...input.operatorResolution ? { operatorResolution: input.operatorResolution } : {},
        marketStateEvidence: JSON.parse(
          JSON.stringify(
            input.evidence,
            (_, value) => typeof value === "bigint" ? value.toString() : value
          )
        )
      },
      entries: cost === 0n ? [] : [
        { accountCode: "TRADING_PNL", direction: "DEBIT", amountLamports: cost },
        { accountCode: "POSITION_COST", direction: "CREDIT", amountLamports: cost }
      ]
    });
    if (input.persistedCutoff) {
      if (!database2.commitPersistedSettlementWriteoff) throw new FinancialServiceError("SETTLEMENT_REVIEW", "Persisted cutoff write-off participant is required.");
      await database2.commitPersistedSettlementWriteoff(client, {
        accountId: input.competitionAccountId,
        roundId: input.persistedCutoff.roundId,
        positionId: input.positionId,
        identity: input.persistedCutoff.identity,
        quantity,
        basis: cost,
        idempotencyKey: input.idempotencyKey,
        evidence: input.evidence,
        journalId: `journal:forced-writeoff:${input.positionId}`
      });
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      "SETTLEMENT_WRITEOFF",
      input.positionId,
      input.competitionAccountId
    );
  };
  if (input.transactionClient) await applyWriteoff(input.transactionClient);
  else await runFinancialTransaction(database2, applyWriteoff);
}
async function enterHourlySettlement(database2, hourlyRoundId2, authoritativeTimestamp) {
  return runFinancialTransaction(database2, async (client) => {
    const round = firstRow(
      await client.query(
        `select state, ends_at_exclusive from hourly_rounds where id = $1 for update`,
        [hourlyRoundId2]
      ),
      "Hourly round"
    );
    if (round.state === "FINALIZED") {
      return { state: round.state, endsAtExclusive: round.ends_at_exclusive };
    }
    if (authoritativeTimestamp < round.ends_at_exclusive) {
      throw new FinancialServiceError(
        "OUTSIDE_ROUND_WINDOW",
        "Hourly settlement cannot begin before the exclusive cutoff."
      );
    }
    if (round.state === "OPEN") {
      await client.query(`update hourly_rounds set state = 'CLOSING' where id = $1`, [
        hourlyRoundId2
      ]);
      round.state = "CLOSING";
    }
    if (round.state === "CLOSING") {
      await client.query(`update hourly_rounds set state = 'SETTLING' where id = $1`, [
        hourlyRoundId2
      ]);
      round.state = "SETTLING";
    }
    if (round.state !== "SETTLING") {
      throw new FinancialServiceError(
        "SETTLEMENT_EXECUTION_FAILED",
        `Round state ${round.state} cannot enter settlement.`
      );
    }
    return { state: round.state, endsAtExclusive: round.ends_at_exclusive };
  });
}
function settlementFailure(error, competitionAccountId, marketId) {
  const retryCodes = /* @__PURE__ */ new Set([
    "RPC_UNAVAILABLE",
    "RPC_TIMEOUT",
    "RPC_ERROR",
    "MARKET_STATE_UNAVAILABLE",
    "MARKET_ACCOUNT_NOT_FOUND",
    "MIGRATION_DESTINATION_UNAVAILABLE",
    "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
    "MARKET_MIGRATED",
    "SETTLEMENT_INCOMPLETE",
    "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
    "ZERO_EXECUTABLE_OUTPUT"
  ]);
  if (error instanceof FinancialServiceError) {
    return {
      competitionAccountId,
      marketId,
      code: error.code,
      message: error.message,
      disposition: retryCodes.has(error.code) ? "RETRY" : "OPERATIONAL_ERROR"
    };
  }
  if (error instanceof ExecutionEngineError) {
    return {
      competitionAccountId,
      marketId,
      code: error.code,
      message: error.message,
      disposition: retryCodes.has(error.code) ? "RETRY" : "OPERATIONAL_ERROR"
    };
  }
  return {
    competitionAccountId,
    marketId,
    code: "SETTLEMENT_EXECUTION_FAILED",
    message: "Forced settlement failed without a safe authoritative result.",
    disposition: "OPERATIONAL_ERROR"
  };
}
async function settleHourlyRound(database2, router2, input) {
  const lock = await database2.pool.connect();
  try {
    await lock.query(
      "select pg_advisory_lock(hashtextextended('hourly-settlement:' || $1::text, 0))",
      [input.hourlyRoundId]
    );
    return await settleHourlyRoundPass(database2, router2, input);
  } finally {
    try {
      await lock.query(
        "select pg_advisory_unlock(hashtextextended('hourly-settlement:' || $1::text, 0))",
        [input.hourlyRoundId]
      );
    } finally {
      lock.release();
    }
  }
}
async function settleHourlyRoundPass(database2, router2, input) {
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Timestamp is invalid.");
  }
  const entered = await enterHourlySettlement(
    database2,
    input.hourlyRoundId,
    input.authoritativeTimestamp
  );
  if (entered.state === "FINALIZED") {
    const existing = await database2.pool.query(
      `select id, hourly_round_id, competition_account_id, user_id,
              final_settled_balance_lamports, starting_paper_sol_lamports,
              hourly_pnl_lamports, finalized_at
       from hourly_results where hourly_round_id = $1 order by competition_account_id`,
      [input.hourlyRoundId]
    );
    return {
      hourlyRoundId: input.hourlyRoundId,
      state: "FINALIZED",
      forcedSells: [],
      hourlyResults: existing.rows.map(toHourlyResult),
      failures: []
    };
  }
  try {
    await database2.prepareMarketSettlement?.(input.hourlyRoundId, entered.endsAtExclusive);
  } catch (error) {
    return {
      hourlyRoundId: input.hourlyRoundId,
      state: "SETTLING",
      forcedSells: [],
      hourlyResults: [],
      failures: [settlementFailure(error, "", null)]
    };
  }
  const positions2 = (await database2.pool.query(
    `select p.id, p.competition_account_id, p.market_id, p.remaining_base_units, p.cost_basis_lamports,
              m.venue, a.mint_address
       from positions p
       join competition_accounts ca on ca.id = p.competition_account_id
       join markets m on m.id = p.market_id
       join assets a on a.id = p.asset_id
       where ca.hourly_round_id = $1 and p.status = 'OPEN'
       order by m.venue, p.market_id, a.mint_address`,
    [input.hourlyRoundId]
  )).rows;
  const forcedSells = [];
  const failures = [];
  for (const position of positions2) {
    try {
      const identity = {
        protocolId: identifier(position.venue, "ProtocolId"),
        marketId: identifier(position.market_id, "MarketId"),
        tokenMint: identifier(position.mint_address, "TokenMint")
      };
      const prior = (await database2.pool.query(`select f.id from fills f join orders o on o.id=f.order_id
        join order_market_state_evidence e on e.order_id=o.id
        where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' limit 1`, [position.id])).rows;
      const persistedParticipant = database2.persistedSettlementAccount?.(position.competition_account_id, identity) ?? !!database2.preparePersistedSettlementStep;
      if (prior.length && !persistedParticipant) {
        await recordSettlementReview(database2.pool, input.hourlyRoundId, position.id, "PRIOR_FORCED_CAPACITY_ALREADY_CONSUMED");
        throw new FinancialServiceError("SETTLEMENT_REVIEW", "Previously consumed forced liquidity cannot be reloaded.");
      }
      const current2 = (await database2.pool.query(
        "select status,remaining_base_units,cost_basis_lamports from positions where id=$1",
        [position.id]
      )).rows[0];
      if (current2.status === "CLOSED") continue;
      const quantity = BigInt(current2.remaining_base_units), basis = BigInt(current2.cost_basis_lamports);
      if (persistedParticipant) {
        if (!database2.preparePersistedSettlementStep || !database2.commitPersistedSettlementStep) throw new FinancialServiceError("SETTLEMENT_REVIEW", "Incomplete persisted settlement participant.");
        const plan = await withGenericAccount(position.competition_account_id, () => database2.preparePersistedSettlementStep({ accountId: position.competition_account_id, roundId: input.hourlyRoundId, positionId: position.id, identity, quantity, basis }));
        if (plan.writeoff === true && plan.output === 0n && plan.quantity === quantity) {
          await writeOffSettlementRemainder(database2, {
            competitionAccountId: position.competition_account_id,
            positionId: position.id,
            marketId: position.market_id,
            tokenQuantity: quantity,
            costBasis: basis,
            evidence: plan.evidence,
            authoritativeTimestamp: entered.endsAtExclusive,
            idempotencyKey: plan.idempotencyKey,
            persistedCutoff: { roundId: input.hourlyRoundId, identity }
          });
          continue;
        }
        if (plan.quantity <= 0n || plan.quantity > quantity || plan.output <= 0n) throw new FinancialServiceError("SETTLEMENT_REVIEW", "No supported positive persisted exit; remainder stays in REVIEW.");
        forcedSells.push(await executeAuthoritativePaperSell(database2, router2, {
          competitionAccountId: position.competition_account_id,
          marketId: position.market_id,
          requestedTokenQuantity: plan.quantity,
          idempotencyKey: plan.idempotencyKey,
          authoritativeTimestamp: entered.endsAtExclusive,
          executionContext: "FORCED_HOURLY_SETTLEMENT",
          settlementEvidence: plan.evidence,
          settlementNetLimit: plan.output,
          persistedSettlementStep: true
        }));
        continue;
      }
      const capacity = await withGenericAccount(position.competition_account_id, () => canonicalExitPreflight(router2, identity, quantity, basis, true));
      if (capacity.maxExecutableQuantityBaseUnits === 0n) {
        await writeOffSettlementRemainder(database2, {
          competitionAccountId: position.competition_account_id,
          positionId: position.id,
          marketId: position.market_id,
          tokenQuantity: quantity,
          costBasis: basis,
          evidence: capacity.evidence,
          authoritativeTimestamp: entered.endsAtExclusive,
          idempotencyKey: `hourly-settlement-writeoff:${input.hourlyRoundId}:${position.id}`
        });
      } else forcedSells.push(await executeAuthoritativePaperSell(database2, router2, {
        competitionAccountId: position.competition_account_id,
        marketId: position.market_id,
        requestedTokenQuantity: capacity.maxExecutableQuantityBaseUnits,
        idempotencyKey: `hourly-settlement-once-v1:${input.hourlyRoundId}:${position.id}`,
        authoritativeTimestamp: entered.endsAtExclusive,
        executionContext: "FORCED_HOURLY_SETTLEMENT",
        settlementEvidence: capacity.evidence,
        settlementNetLimit: capacity.maxExecutableOutputLamports
      }));
    } catch (error) {
      if (error instanceof FinancialServiceError && ["SETTLEMENT_REVIEW", "EVIDENCE_CORRUPTED", "INVALID_EXECUTION_RESULT", "FINALIZATION_CONFLICT"].includes(error.code))
        await recordSettlementReview(database2.pool, input.hourlyRoundId, position.id, error.code);
      failures.push(settlementFailure(error, position.competition_account_id, position.market_id));
    }
  }
  const accounts = (await database2.pool.query(
    `select id from competition_accounts where hourly_round_id = $1 order by id`,
    [input.hourlyRoundId]
  )).rows;
  const hourlyResults2 = [];
  for (const account of accounts) {
    const unresolved = firstRow(
      await database2.pool.query(
        `select count(*)::int as count from positions
         where competition_account_id = $1 and status = 'OPEN'`,
        [account.id]
      ),
      "Open-position aggregate"
    );
    if (unresolved.count !== 0) continue;
    try {
      const existing = await database2.pool.query(
        `select id, hourly_round_id, competition_account_id, user_id,
                final_settled_balance_lamports, starting_paper_sol_lamports,
                hourly_pnl_lamports, finalized_at
         from hourly_results where competition_account_id = $1`,
        [account.id]
      );
      let hourlyResult = existing.rows[0] ? toHourlyResult(existing.rows[0]) : void 0;
      if (!hourlyResult) {
        await repairLegacySettlementWriteoffMetadata(database2, account.id);
        const reconciliation = await reconcileAccountLedger(database2, account.id);
        if (!reconciliation.reconciled || reconciliation.materializedCashLamports < 0n) {
          throw new FinancialServiceError(
            "FINALIZATION_CONFLICT",
            "Account ledger does not reconcile for finalization."
          );
        }
        hourlyResult = await finalizeHourlyResult(database2, {
          resultId: `hourly-result:${account.id}`,
          accountId: account.id,
          finalSettledBalanceLamports: reconciliation.materializedCashLamports,
          finalizedAt: entered.endsAtExclusive,
          idempotencyKey: `hourly-result:${input.hourlyRoundId}:${account.id}`
        });
      }
      hourlyResults2.push(hourlyResult);
      const daily = firstRow(
        await database2.pool.query(
          `select d.id from daily_competitions d
           join hourly_rounds r on r.id = $1
           where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive`,
          [input.hourlyRoundId]
        ),
        "Daily competition"
      );
      await contributeHourlyResultToDailyCompetition(database2, {
        dailyResultId: `daily-result:${daily.id}:${hourlyResult.userId}`,
        contributionId: `daily-contribution:${hourlyResult.id}`,
        dailyCompetitionId: daily.id,
        hourlyResultId: hourlyResult.id,
        idempotencyKey: `daily-contribution:${hourlyResult.id}`
      });
    } catch (error) {
      failures.push(settlementFailure(error, account.id, null));
    }
  }
  const finalState = await runFinancialTransaction(database2, async (client) => {
    const round = firstRow(
      await client.query(
        "select state from hourly_rounds where id = $1 for update",
        [input.hourlyRoundId]
      ),
      "Hourly round"
    );
    if (round.state === "FINALIZED") return "FINALIZED";
    const readiness = firstRow(
      await client.query(
        `select
           (select count(*)::int from competition_accounts where hourly_round_id = $1) accounts,
           (select count(*)::int from hourly_results where hourly_round_id = $1) results,
           (select count(*)::int from positions p join competition_accounts a
              on a.id = p.competition_account_id
            where a.hourly_round_id = $1 and p.status = 'OPEN') open_positions`,
        [input.hourlyRoundId]
      ),
      "Settlement readiness"
    );
    if (round.state === "SETTLING" && readiness.open_positions === 0 && readiness.results === readiness.accounts && failures.length === 0) {
      await client.query(
        `update hourly_rounds set state = 'FINALIZED', finalized_at = $2 where id = $1`,
        [input.hourlyRoundId, input.authoritativeTimestamp]
      );
      return "FINALIZED";
    }
    return "SETTLING";
  });
  return {
    hourlyRoundId: input.hourlyRoundId,
    state: finalState,
    forcedSells,
    hourlyResults: hourlyResults2,
    failures: finalState === "SETTLING" && failures.length === 0 ? [
      {
        competitionAccountId: "",
        marketId: null,
        code: "SETTLEMENT_INCOMPLETE",
        message: "The round remains incomplete and retryable.",
        disposition: "RETRY"
      }
    ] : failures
  };
}
async function replayPersistedFill(database2, router2, fillId) {
  const row = firstRow(
    await database2.pool.query(
      `select f.id fill_id, f.order_id, f.execution_id, f.side,
              o.requested_base_units, o.requested_quote_lamports,
              f.base_quantity, f.actual_input_lamports, f.actual_output_lamports,
              f.fee_lamports, f.executed_at, f.protocol_id, f.adapter_version,
              f.market_id, a.mint_address, e.observed_at, e.chain_slot,
              e.chain_block_id, e.normalization_version, e.normalized_state,
              e.raw_source, e.state_fingerprint
       from fills f
       join orders o on o.id = f.order_id
       join markets m on m.id = f.market_id
       join assets a on a.id = m.base_asset_id
       join market_state_evidence e on e.id = f.market_state_evidence_id
       where f.id = $1`,
      [fillId]
    ),
    "Persisted fill"
  );
  if (!row.protocol_id || !row.adapter_version) {
    throw new FinancialServiceError(
      "ADAPTER_VERSION_UNAVAILABLE",
      "The fill does not identify a replayable adapter version."
    );
  }
  const identity = {
    protocolId: identifier(row.protocol_id, "ProtocolId"),
    marketId: identifier(row.market_id, "MarketId"),
    tokenMint: identifier(row.mint_address, "TokenMint")
  };
  const state = {
    identity,
    observedAt: utcInstant(row.observed_at),
    chainSlot: row.chain_slot === null ? null : BigInt(row.chain_slot),
    chainBlockId: row.chain_block_id,
    adapterVersion: row.adapter_version,
    normalizationVersion: row.normalization_version,
    normalizedState: row.normalized_state,
    ...row.raw_source === null ? {} : { rawSource: row.raw_source }
  };
  const evidence2 = createMarketStateEvidence(state);
  if (evidence2.fingerprint !== row.state_fingerprint) {
    throw new FinancialServiceError(
      "EVIDENCE_CORRUPTED",
      "Persisted market-state evidence fingerprint is invalid."
    );
  }
  let adapter;
  try {
    adapter = router2.resolveVersion(identity.protocolId, row.adapter_version);
  } catch (error) {
    translateExecutionError(error, false);
  }
  let replay;
  try {
    replay = row.side === "BUY" ? await adapter.simulateBuy(
      {
        orderId: identifier(row.order_id, "OrderId"),
        executionId: identifier(row.execution_id, "ExecutionId"),
        identity,
        requestedPaperSol: paperSolBaseUnits(BigInt(row.requested_quote_lamports)),
        executedAt: utcInstant(row.executed_at)
      },
      state
    ) : await adapter.simulateSell(
      {
        orderId: identifier(row.order_id, "OrderId"),
        executionId: identifier(row.execution_id, "ExecutionId"),
        identity,
        requestedTokenQuantity: tokenBaseUnits(BigInt(row.requested_base_units)),
        executedAt: utcInstant(row.executed_at)
      },
      state
    );
  } catch (error) {
    translateExecutionError(error, false);
  }
  const replayFees = paperSolFeeTotal2(replay);
  const matched = replay.quote.marketStateFingerprint === row.state_fingerprint && replayFees === BigInt(row.fee_lamports) && (row.side === "BUY" ? replay.actualInput.asset === "PAPER_SOL" && replay.actualInput.amount === BigInt(row.actual_input_lamports) && replay.actualOutput.asset === "TOKEN" && replay.actualOutput.amount === BigInt(row.base_quantity) : replay.actualInput.asset === "TOKEN" && replay.actualInput.amount === BigInt(row.base_quantity) && replay.actualOutput.asset === "PAPER_SOL" && replay.actualOutput.amount === BigInt(row.actual_output_lamports));
  if (!matched) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "Persisted fill does not match deterministic replay output."
    );
  }
  return {
    fillId,
    matched: true,
    marketStateFingerprint: row.state_fingerprint,
    adapterVersion: row.adapter_version
  };
}
var ONE_TIME_DUST_RESOLUTION = Object.freeze({
  reason: "OPERATOR_APPROVED_DUST_RESOLUTION_V1",
  roundId: "hourly:2026-10-10T23:00:00.000Z",
  marketId: "FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf",
  mint: "FB5ViYXcLNSEcy8R2Jg1DmJwP36mizZsPKvAprM8pump",
  accountId: "account:hourly:2026-10-10T23:00:00.000Z:user:c32d8a836d2b2ffd9a4ebbe5356ce82545189c146964f5e61814af5fba81972e",
  positionId: "position:account:hourly:2026-10-10T23:00:00.000Z:user:c32d8a836d2b2ffd9a4ebbe5356ce82545189c146964f5e61814af5fba81972e:FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf"
});

// packages/db/src/current-quote-proof.ts
import { createHash as createHash17 } from "node:crypto";
async function currentQuoteHourlyProof(database2, router2, roundId) {
  const query = async (sql3, values = []) => (await database2.pool.query(sql3, values)).rows;
  const round = (await query("select * from hourly_rounds where id=$1", [roundId]))[0];
  if (!round) throw Error("CURRENT_QUOTE_ROUND_NOT_FOUND");
  const reasons = [];
  const holds = await query(
    "select * from legacy_source_reviews where hourly_round_id=$1 order by id",
    [roundId]
  );
  if (holds.length) reasons.push("HISTORICAL_REVIEW_PRESERVED");
  const accounts = await query(
    "select * from competition_accounts where hourly_round_id=$1 order by id",
    [roundId]
  );
  const positions2 = await query(
    "select p.* from positions p join competition_accounts a on a.id=p.competition_account_id where a.hourly_round_id=$1 order by p.id",
    [roundId]
  );
  const fills2 = await query(
    `select f.*,o.competition_account_id,o.execution_context
    from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id
    where a.hourly_round_id=$1 order by f.executed_at,f.id`,
    [roundId]
  );
  const results = await query(
    "select * from hourly_results where hourly_round_id=$1 order by competition_account_id",
    [roundId]
  );
  const ledgers = [];
  for (const account of accounts) {
    const ledger = await reconcileAccountLedger(database2, account.id);
    ledgers.push(ledger);
    if (!ledger.reconciled) reasons.push("ACCOUNT_LEDGER_MISMATCH:" + account.id);
    const slots = await query(
      "select * from competition_token_slots where competition_account_id=$1 order by asset_id",
      [account.id]
    );
    const bought = await query(
      `select distinct m.base_asset_id from fills f join orders o on o.id=f.order_id
      join markets m on m.id=f.market_id where o.competition_account_id=$1 and f.side='BUY' and f.base_quantity>0 order by m.base_asset_id`,
      [account.id]
    );
    if (slots.length > round.max_unique_tokens || slots.length !== bought.length || slots.some((s) => !bought.some((b) => b.base_asset_id === s.asset_id)))
      reasons.push("TOKEN_SLOT_MISMATCH:" + account.id);
    const result = results.find((r) => r.competition_account_id === account.id);
    if (result && (result.user_id !== account.user_id || BigInt(result.final_settled_balance_lamports) !== ledger.materializedCashLamports || BigInt(result.starting_paper_sol_lamports) !== ledger.startingCapitalLamports || BigInt(result.hourly_pnl_lamports) !== ledger.materializedCashLamports - ledger.startingCapitalLamports))
      reasons.push("HOURLY_RESULT_MISMATCH:" + account.id);
  }
  const replays = [];
  for (const fill of fills2) {
    const at = +new Date(fill.executed_at), start = +new Date(round.starts_at), end = +new Date(round.ends_at_exclusive);
    if (fill.execution_context === "NORMAL_USER") {
      if (!Number.isFinite(at) || at < start || at >= end)
        reasons.push("USER_FILL_OUTSIDE_ROUND:" + fill.id);
    } else if (!await database2.verifySettlementFill?.(fill.id)) {
      reasons.push("FORCED_CUTOFF_ACCEPTANCE_REQUIRED:" + fill.id);
    }
    try {
      replays.push(await replayPersistedFill(database2, router2, fill.id));
    } catch {
      reasons.push("FILL_REPLAY_FAILED:" + fill.id);
    }
  }
  const open = positions2.filter(
    (p) => p.status === "OPEN" || BigInt(p.remaining_base_units) !== 0n || BigInt(p.cost_basis_lamports) !== 0n
  );
  if (open.length) reasons.push("RETAINED_CUTOFF_EXIT_EVIDENCE_REQUIRED");
  const technicalReasons = [...new Set(reasons)];
  const finalityReasons = round.state !== "FINALIZED" || results.length !== accounts.length ? ["ROUND_AND_ALL_RESULTS_NOT_FINAL"] : [];
  const snapshot2 = { round, accounts, positions: positions2, fills: fills2, results, holds, ledgers };
  const structuralHash = createHash17("sha256").update(
    canonicalJson(
      JSON.parse(JSON.stringify(snapshot2, (_k, v) => typeof v === "bigint" ? v.toString() : v))
    )
  ).digest("hex");
  return {
    roundId,
    structuralHash,
    accountingQualified: technicalReasons.length === 0,
    finalResultsQualified: technicalReasons.length === 0 && finalityReasons.length === 0,
    technicalReasons,
    finalityReasons,
    accountCount: accounts.length,
    fillCount: fills2.length,
    openPositionCount: open.length,
    replays,
    ledgers,
    // Existing accepted-source, funding, custody, approvals and STOP gates remain mandatory.
    realFinancialAccepted: false,
    payable: false
  };
}

// packages/db/src/current-quote-settlement.ts
function fail8(reason) {
  throw new FinancialServiceError("SETTLEMENT_REVIEW", "CURRENT_CUTOFF_" + reason);
}
var json3 = (v) => JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x);
function evidence(v) {
  return { ...v, chainSlot: v.chainSlot === null ? null : BigInt(v.chainSlot) };
}
var CurrentQuoteSettlement = class {
  constructor(base, router2, policyId, provider2) {
    this.base = base;
    this.router = router2;
    this.policyId = policyId;
    this.provider = provider2;
  }
  base;
  router;
  policyId;
  provider;
  async policy(roundId, client = this.base.pool) {
    const r = (await client.query(
      `select r.*,p.id policy_id,to_jsonb(p) settlement_policy from hourly_rounds r join current_quote_settlement_policies p on p.id=$2
   and r.starts_at>=p.effective_from and r.starts_at<p.ends_before and p.recorded_at<r.starts_at where r.id=$1`,
      [roundId, this.policyId]
    )).rows[0];
    if (!r) fail8("FUTURE_POLICY_REQUIRED");
    if ((await client.query("select 1 from legacy_source_reviews where hourly_round_id=$1 limit 1", [
      roundId
    ])).rows.length)
      fail8("HISTORICAL_REVIEW_PRESERVED");
    return {
      ...r,
      ...Object.fromEntries(
        ["selection_version", "max_age_ms", "uncertainty_ms", "provider_id"].map((k) => [
          k,
          r.settlement_policy[k]
        ])
      )
    };
  }
  async captureDue(now) {
    const positions2 = (await this.base.pool.query(
      `select p.id,p.competition_account_id,p.market_id,m.venue,b.mint_address,a.hourly_round_id
   from positions p join competition_accounts a on a.id=p.competition_account_id join hourly_rounds r on r.id=a.hourly_round_id
   join current_quote_settlement_policies q on q.id=$1 and q.recorded_at<r.starts_at and r.starts_at>=q.effective_from and r.starts_at<q.ends_before
   join markets m on m.id=p.market_id join assets b on b.id=p.asset_id
   where p.status='OPEN' and r.state in('OPEN','CLOSING','SETTLING') and r.ends_at_exclusive>$2::timestamptz-interval '15 seconds'
    and r.ends_at_exclusive<=$2::timestamptz+interval '20 seconds' order by p.id`,
      [this.policyId, now]
    )).rows;
    const failures = [];
    for (let i = 0; i < positions2.length; i += 3)
      await Promise.all(
        positions2.slice(i, i + 3).map(async (p) => {
          try {
            const policy = await this.policy(p.hourly_round_id);
            const identity = {
              protocolId: identifier(p.venue, "ProtocolId"),
              marketId: identifier(p.market_id, "MarketId"),
              tokenMint: identifier(p.mint_address, "TokenMint")
            };
            const c = await withGenericSystemRead(
              () => withGenericAccount(
                p.competition_account_id,
                () => this.provider.capture(identity, p.competition_account_id)
              )
            );
            if (c.evidence.identity.tokenMint !== identity.tokenMint || createMarketStateEvidence(c.evidence).fingerprint !== c.evidence.fingerprint)
              fail8("CAPTURE_IDENTITY");
            const id = "current-capture:" + cutoffHash([p.id, c.hash]);
            await this.base.pool.query(
              `insert into current_quote_cutoff_captures(id,position_id,round_id,policy_id,slot,bank_time,document)
    values($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict(position_id,slot) do nothing`,
              [
                id,
                p.id,
                p.hourly_round_id,
                this.policyId,
                c.evidence.chainSlot,
                c.bankTime,
                json3(c)
              ]
            );
            const old = (await this.base.pool.query(
              "select document from current_quote_cutoff_captures where position_id=$1 and slot=$2",
              [p.id, c.evidence.chainSlot]
            )).rows[0];
            if (old?.document.evidence.fingerprint !== c.evidence.fingerprint)
              fail8("SAME_BANK_CONFLICT");
            if (policy.selection_version === "DURABLE_QUOTE_V2") {
              const prior = (await this.base.pool.query(
                "select max(slot)::text slot from current_quote_cutoff_captures where position_id=$1",
                [p.id]
              )).rows[0]?.slot;
              if (prior && BigInt(prior) > c.evidence.chainSlot)
                fail8("PROVIDER_CURSOR_REGRESSION");
              await this.base.pool.query("select certify_current_quote_capture($1)", [
                old ? "current-capture:" + cutoffHash([p.id, old.document.hash]) : id
              ]);
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "CURRENT_CUTOFF_CAPTURE_FAILED";
            failures.push(message);
            if (/SAME_BANK_CONFLICT|CURSOR_REGRESSION|CAPTURE_IDENTITY/.test(message)) {
              const present = (await this.base.pool.query(
                "select to_regclass('public.current_quote_capture_faults') present"
              )).rows[0]?.present;
              if (present)
                await this.base.pool.query(
                  "insert into current_quote_capture_faults(round_id,position_id,reason) values($1,$2,$3)",
                  [p.hourly_round_id, p.id, message]
                );
            }
          }
        })
      );
    return { positions: positions2.length, failures };
  }
  async prepareRound(roundId, cutoff) {
    const enrolled = (await this.base.pool.query(
      `select 1 from hourly_rounds r join current_quote_settlement_policies p on p.id=$2 and r.starts_at>=p.effective_from and r.starts_at<p.ends_before and p.recorded_at<r.starts_at where r.id=$1`,
      [roundId, this.policyId]
    )).rows.length;
    if (!enrolled) {
      const held = (await this.base.pool.query(
        `select 1 from legacy_source_reviews where hourly_round_id=$1 union all select 1 from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.hourly_round_id=$1 limit 1`,
        [roundId]
      )).rows.length;
      if (held) fail8("FUTURE_POLICY_REQUIRED");
      await this.base.prepareMarketSettlement?.(roundId, cutoff);
      return;
    }
    const round = await this.policy(roundId);
    if (round.selection_version === "DURABLE_QUOTE_V2" && (await this.base.pool.query(
      "select 1 from current_quote_capture_faults where round_id=$1 limit 1",
      [roundId]
    )).rows.length)
      fail8("CAPTURE_INTEGRITY_REVIEW");
    if (!["CLOSING", "SETTLING"].includes(round.state) || +new Date(round.ends_at_exclusive) !== +cutoff)
      fail8("ROUND_STATE");
    const db = this.database();
    const proof = await currentQuoteHourlyProof(db, this.router, roundId);
    if (proof.technicalReasons.some((r) => r !== "RETAINED_CUTOFF_EXIT_EVIDENCE_REQUIRED"))
      fail8("ACCOUNT_OR_FILL_QUALIFICATION");
    const positions2 = (await this.base.pool.query(
      `select p.*,m.venue,b.mint_address from positions p join competition_accounts a on a.id=p.competition_account_id
   join markets m on m.id=p.market_id join assets b on b.id=p.asset_id where a.hourly_round_id=$1 and p.status='OPEN' order by p.id`,
      [roundId]
    )).rows;
    for (const p of positions2) {
      if ((await this.base.pool.query(
        "select id from current_quote_cutoff_seals where position_id=$1",
        [p.id]
      )).rows.length)
        continue;
      const captures = (await this.base.pool.query(
        `select * from current_quote_cutoff_captures where position_id=$1 and policy_id=$2
    and bank_time<$3 and bank_time>=$3::timestamptz-interval '10 seconds' order by recorded_at desc,id asc`,
        [p.id, this.policyId, cutoff]
      )).rows;
      let selected;
      for (const row of captures) {
        try {
          const c = {
            ...row.document,
            evidence: evidence(row.document.evidence)
          };
          if (round.selection_version === "DURABLE_QUOTE_V2") {
            const cert = (await this.base.pool.query(
              "select * from current_quote_capture_certificates where capture_id=$1",
              [row.id]
            )).rows[0];
            if (!cert || cert.provider_id !== round.provider_id || !this.provider.finality)
              continue;
            let final = (await this.base.pool.query(
              "select * from current_quote_capture_finality where capture_id=$1",
              [row.id]
            )).rows[0];
            if (!final) {
              const header = await this.provider.finality(Number(row.slot));
              await this.base.pool.query(
                "insert into current_quote_capture_finality(capture_id,header,provider_id) values($1,$2::jsonb,$3) on conflict do nothing",
                [row.id, json3(header), round.provider_id]
              );
              final = (await this.base.pool.query(
                "select * from current_quote_capture_finality where capture_id=$1",
                [row.id]
              )).rows[0];
            }
            if (final.provider_id !== round.provider_id) fail8("PROVIDER_BINDING");
            verifyDurableQuoteCutoff(c, final.header, cutoff, {
              receivedAt: new Date(row.recorded_at),
              certifiedAt: new Date(cert.certified_at),
              finalizedAt: new Date(final.observed_at),
              maxAgeMs: round.max_age_ms,
              uncertaintyMs: round.uncertainty_ms
            });
            selected = { row, capture: c, last: final.header, next: null };
          } else {
            const f = await this.provider.frontier(Number(row.slot), cutoff);
            verifyCutoffCapture(c, f.last, f.next, cutoff);
            selected = { row, capture: c, ...f };
          }
          break;
        } catch {
          if (round.selection_version === "DURABLE_QUOTE_V2")
            throw Error("CURRENT_CUTOFF_SELECTED_QUOTE_UNQUALIFIED");
        }
      }
      if (!selected) fail8("RETAINED_BOUNDARY_BANK_REQUIRED");
      if (round.selection_version === "DURABLE_QUOTE_V2" && (await this.base.pool.query(
        `select 1 from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 and f.executed_at>$2 limit 1`,
        [p.competition_account_id, selected.row.recorded_at]
      )).rows.length)
        fail8("TRADE_AFTER_SELECTED_QUOTE");
      const latest = (await this.base.pool.query(
        `select max(e.chain_slot)::text slot from fills f join orders o on o.id=f.order_id
    join order_market_state_evidence l on l.order_id=o.id and l.position_id=$1 join market_state_evidence e on e.id=f.market_state_evidence_id`,
        [p.id]
      )).rows[0]?.slot;
      if (latest !== null && latest !== void 0 && BigInt(latest) > selected.capture.evidence.chainSlot)
        fail8("TRADE_AFTER_CUTOFF_BANK");
      const adapter = this.router.resolveVersion(
        selected.capture.evidence.identity.protocolId,
        selected.capture.evidence.adapterVersion
      );
      const steps = await planCutoffLiquidation(
        adapter,
        selected.capture.evidence,
        BigInt(p.remaining_base_units),
        BigInt(p.cost_basis_lamports),
        cutoff
      );
      const document = {
        cutoff: cutoff.toISOString(),
        captureHash: selected.capture.hash,
        last: selected.last,
        next: selected.next,
        steps
      };
      const id = "current-seal:" + cutoffHash([p.id, document]);
      await this.base.pool.query(
        `insert into current_quote_cutoff_seals(id,position_id,round_id,policy_id,capture_id,quantity_before,basis_before,document)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) on conflict(position_id) do nothing`,
        [
          id,
          p.id,
          roundId,
          this.policyId,
          selected.row.id,
          p.remaining_base_units,
          p.cost_basis_lamports,
          json3(document)
        ]
      );
    }
  }
  async next(input, client = this.base.pool) {
    await this.policy(input.roundId, client);
    const row = (await client.query(
      `select s.*, (select count(*)::int from current_quote_settlement_steps t where t.seal_id=s.id) cursor
   from current_quote_cutoff_seals s where s.position_id=$1 and s.round_id=$2 and s.policy_id=$3 for update of s`,
      [input.positionId, input.roundId, this.policyId]
    )).rows[0];
    if (!row) fail8("SEAL_REQUIRED");
    const doc = row.document;
    if ("current-seal:" + cutoffHash([input.positionId, doc]) !== row.id) fail8("SEAL_CHANGED");
    const step = doc.steps[row.cursor];
    if (!step) fail8("STEP_REQUIRED");
    const left = doc.steps.slice(row.cursor).reduce((n3, s) => n3 + BigInt(s.quantity), 0n);
    if (left !== input.quantity || BigInt(step.basisBefore) !== input.basis || input.identity.tokenMint !== step.evidence.identity.tokenMint)
      fail8("POSITION_CHANGED");
    return {
      row,
      step: { ...step, evidence: evidence(step.evidence) },
      key: "current-cutoff:" + row.id + ":" + row.cursor
    };
  }
  database() {
    const next = this.next.bind(this), prepareRound = this.prepareRound.bind(this), base = this.base;
    return {
      ...this.base,
      prepareMarketSettlement: prepareRound,
      prepareCurrentQuoteMarketSettlement: prepareRound,
      persistedSettlementAccount: () => true,
      async preparePersistedSettlementStep(input) {
        const n3 = await next(input);
        return {
          quantity: BigInt(n3.step.quantity),
          output: BigInt(n3.step.output),
          evidence: n3.step.evidence,
          idempotencyKey: n3.key,
          writeoff: n3.step.writeoff
        };
      },
      async commitPersistedSettlementStep(client, input) {
        const p = (await client.query(
          "select p.market_id,m.venue,b.mint_address from positions p join markets m on m.id=p.market_id join assets b on b.id=p.asset_id where p.id=$1",
          [input.positionId]
        )).rows[0];
        const n3 = await next(
          {
            accountId: input.accountId,
            roundId: input.roundId,
            positionId: input.positionId,
            quantity: input.quantityBefore,
            basis: input.basisBefore,
            identity: {
              marketId: identifier(p.market_id, "MarketId"),
              protocolId: identifier(p.venue, "ProtocolId"),
              tokenMint: identifier(p.mint_address, "TokenMint")
            }
          },
          client
        );
        const fees = input.execution.quote.fees.reduce(
          (v, f) => v + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n),
          0n
        );
        if (n3.step.writeoff || n3.key !== input.idempotencyKey || input.execution.actualInput.amount !== BigInt(n3.step.quantity) || input.execution.actualOutput.amount !== BigInt(n3.step.output) || fees !== BigInt(n3.step.fees) || input.evidence.fingerprint !== n3.step.evidence.fingerprint)
          fail8("STEP_MISMATCH");
        await client.query(
          "insert into current_quote_settlement_steps(seal_id,step_index,fill_id) values($1,$2,$3)",
          [n3.row.id, n3.row.cursor, input.fillId]
        );
      },
      async commitPersistedSettlementWriteoff(client, input) {
        const n3 = await next(input, client);
        if (!n3.step.writeoff || n3.key !== input.idempotencyKey || input.evidence.fingerprint !== n3.step.evidence.fingerprint || BigInt(n3.step.quantity) !== input.quantity)
          fail8("WRITEOFF_MISMATCH");
        await client.query(
          "insert into current_quote_settlement_steps(seal_id,step_index,writeoff_journal_id) values($1,$2,$3)",
          [n3.row.id, n3.row.cursor, input.journalId]
        );
      },
      async verifySettlementFill(fillId) {
        return (await base.pool.query("select current_quote_forced_fill_valid($1) valid", [fillId])).rows[0]?.valid === true;
      }
    };
  }
};

// packages/db/src/competition-service.ts
var DEFAULT_MAX_UNIQUE_TOKENS = 5;
var DEFAULT_MAX_BUY_RATIO_BPS = 2e3;
var DEFAULT_REWARD_GRACE_SECONDS = 60;
var CURRENT_RULES_VERSION = "phase-4a-v1";
function canonicalHourlyWindow(now) {
  const startsAt = new Date(now);
  startsAt.setUTCMinutes(0, 0, 0);
  return { startsAt, endsAtExclusive: new Date(startsAt.getTime() + 36e5) };
}
function canonicalDailyWindow(now) {
  const startsAt = new Date(now);
  startsAt.setUTCHours(0, 0, 0, 0);
  return {
    utcDate: startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 864e5)
  };
}
function hourlyRoundId(startsAt) {
  return `hourly:${startsAt.toISOString()}`;
}
async function ensureHourlyRound(database2, startsAt, rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS) {
  const endsAtExclusive = new Date(startsAt.getTime() + 36e5);
  const id = hourlyRoundId(startsAt);
  await database2.pool.query(
    `insert into hourly_rounds
      (id, starts_at, ends_at_exclusive, state, starting_paper_sol_lamports,
       max_unique_tokens, max_buy_ratio_bps, reward_finalization_grace_period_seconds, rules_version)
     values ($1, $2, $3, 'SCHEDULED', $4, $5, $6, $7, $8)
     on conflict (starts_at) do nothing`,
    [
      id,
      startsAt,
      endsAtExclusive,
      DEFAULT_STARTING_PAPER_SOL_LAMPORTS,
      DEFAULT_MAX_UNIQUE_TOKENS,
      DEFAULT_MAX_BUY_RATIO_BPS,
      rewardGraceSeconds,
      CURRENT_RULES_VERSION
    ]
  );
  const result = await database2.pool.query(
    "select id from hourly_rounds where starts_at = $1",
    [startsAt]
  );
  return result.rows[0].id;
}
async function ensureDailyCompetition(database2, now) {
  const window = canonicalDailyWindow(now);
  const id = `daily:${window.utcDate}`;
  await database2.pool.query(
    `insert into daily_competitions (id, utc_date, starts_at, ends_at_exclusive, state)
     values ($1, $2, $3, $4, 'OPEN') on conflict (utc_date) do nothing`,
    [id, window.utcDate, window.startsAt, window.endsAtExclusive]
  );
  const result = await database2.pool.query(
    "select id from daily_competitions where utc_date = $1",
    [window.utcDate]
  );
  return result.rows[0].id;
}
async function ensureCurrentAndNextRounds(database2, now, rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS) {
  const { startsAt, endsAtExclusive } = canonicalHourlyWindow(now);
  await ensureDailyCompetition(database2, now);
  const [currentRoundId, nextRoundId] = await Promise.all([
    ensureHourlyRound(database2, startsAt, rewardGraceSeconds),
    ensureHourlyRound(database2, endsAtExclusive, rewardGraceSeconds)
  ]);
  return { currentRoundId, nextRoundId };
}
async function openDueRounds(database2, now) {
  const result = await database2.pool.query(
    `update hourly_rounds set state = 'OPEN'
     where state = 'SCHEDULED' and starts_at <= $1 returning id`,
    [now]
  );
  return result.rows.map(({ id }) => id);
}
async function runHourlyLifecycleTick(database2, router2, now, rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS) {
  const events = [];
  const window = canonicalHourlyWindow(now);
  const existing = await database2.pool.query(
    "select starts_at from hourly_rounds where starts_at in ($1, $2)",
    [window.startsAt, window.endsAtExclusive]
  );
  const existingTimes = new Set(existing.rows.map(({ starts_at }) => starts_at.toISOString()));
  const ensured = await ensureCurrentAndNextRounds(database2, now, rewardGraceSeconds);
  if (!existingTimes.has(window.startsAt.toISOString()))
    events.push({ type: "ROUND_CREATED", roundId: ensured.currentRoundId });
  if (!existingTimes.has(window.endsAtExclusive.toISOString()))
    events.push({ type: "ROUND_CREATED", roundId: ensured.nextRoundId });
  for (const roundId of await openDueRounds(database2, now)) {
    events.push({ type: "ROUND_OPENED", roundId });
  }
  const ended = await database2.pool.query(
    `select id, starts_at from hourly_rounds
     where ends_at_exclusive <= $1 and state in ('OPEN', 'CLOSING', 'SETTLING')
     order by starts_at`,
    [now]
  );
  for (const { id, starts_at } of ended.rows) {
    await ensureDailyCompetition(database2, starts_at);
    const result = await settleHourlyRound(database2, router2, {
      hourlyRoundId: id,
      authoritativeTimestamp: now
    });
    events.push({
      type: result.state === "FINALIZED" ? "ROUND_FINALIZED" : "ROUND_SETTLING",
      roundId: id,
      failures: result.failures.length
    });
    for (const disposition of ["RETRY", "OPERATIONAL_ERROR"]) {
      const details = result.failures.filter((f) => f.disposition === disposition);
      if (details.length > 0)
        events.push({
          type: disposition === "RETRY" ? "SETTLEMENT_RETRY" : "SETTLEMENT_OPERATIONAL_ERROR",
          roundId: id,
          failures: details.length,
          failureDetails: details
        });
    }
  }
  await database2.pool.query(
    `update daily_competitions set state = 'FINALIZING'
     where ends_at_exclusive <= $1 and state in ('OPEN', 'CLOSING')`,
    [now]
  );
  const finalizedDays = await database2.pool.query(
    `update daily_competitions d set state = 'FINALIZED', finalized_at = $1
     where d.state = 'FINALIZING'
       and not exists (select 1 from legacy_source_reviews h join hourly_rounds r on r.id=h.hourly_round_id where r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive)
       and (select count(*) from hourly_rounds r
            where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive) = 24
       and not exists (
         select 1 from hourly_rounds r
         where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive
           and r.state <> 'FINALIZED'
       )
     returning d.id`,
    [now]
  );
  for (const { id } of finalizedDays.rows) events.push({ type: "DAILY_FINALIZED", roundId: id });
  return events;
}

// apps/worker/isolated/current-cutoff.ts
function composePublicCurrentCutoffWorker(database2, baseline, policyId, rpc, snapshots) {
  const mints = ["__WORKER_CAPTURE_DYNAMIC__"];
  const account = () => {
    const id = genericActor()?.accountId;
    if (!id) throw Error("CUTOFF_ACCOUNT_SCOPE_REQUIRED");
    return id;
  };
  const current2 = currentQuoteRouter({
    enabled: true,
    baseline,
    mints,
    snapshots,
    permission: async () => ({ discover: true, buy: false }),
    peakQuantity: async (mint) => {
      const r = await database2.pool.query(
        `with q as(select sum(case when f.side='BUY' then f.base_quantity else -f.base_quantity end) over(order by f.executed_at,f.id rows unbounded preceding) n from fills f join orders o on o.id=f.order_id join markets m on m.id=f.market_id join assets b on b.id=m.base_asset_id where o.competition_account_id=$1 and b.mint_address=$2)select coalesce(max(n),0)::text n from q`,
        [account(), mint]
      );
      return BigInt(r.rows[0].n);
    },
    priorReference: async (mint) => {
      const r = await database2.pool.query(
        `select e.chain_slot,e.normalized_state->>'referenceBuyOutput' output from market_state_evidence e where e.adapter_version='paper-current-executable-v1' and e.normalized_state->'stage1Snapshot'->>'mint'=$1 and exists(select 1 from fills f join orders o on o.id=f.order_id where f.market_state_evidence_id=e.id and o.competition_account_id=$2) order by e.created_at desc limit 1`,
        [mint, account()]
      );
      return r.rows[0] ? { slot: Number(r.rows[0].chain_slot), output: r.rows[0].output } : null;
    }
  });
  return composeCurrentCutoffWorker(database2, current2.router, policyId, rpc, async (identity) => {
    if (!String(identity.marketId).startsWith("paper-current-quote:"))
      return baseline.loadPositionRoute(identity);
    if (!mints.includes(identity.tokenMint)) mints.push(identity.tokenMint);
    const candidates = await snapshots(identity.tokenMint);
    if (candidates.length) return current2.router.loadPositionRoute(identity);
    const migrated = await baseline.mintResolver(identity.tokenMint), loaded = await baseline.loadPositionRoute(migrated);
    return { ...loaded, route: { ...loaded.route, originIdentity: identity, migrated: true } };
  });
}
function composeCurrentCutoffWorker(database2, router2, policyId, rpc, load) {
  const headers = /* @__PURE__ */ new Map();
  const settlement = new CurrentQuoteSettlement(database2, router2, policyId, {
    capture: async (identity, account) => {
      const p = (await database2.pool.query(
        "select to_jsonb(p) policy from current_quote_settlement_policies p where id=$1",
        [policyId]
      )).rows[0]?.policy;
      if (p?.selection_version === "DURABLE_QUOTE_V2" && p.provider_id !== rpc.providerIdentity)
        throw Error("CUTOFF_PROVIDER_BINDING");
      return captureCutoffState(
        async () => (await (load ? load(identity, account) : router2.loadPositionRoute(identity))).state,
        p?.selection_version === "DURABLE_QUOTE_V2" ? "confirmed" : "finalized"
      );
    },
    async finality(slot) {
      const h = await rpc.call("getBlock", [
        slot,
        {
          commitment: "finalized",
          transactionDetails: "none",
          rewards: false,
          maxSupportedTransactionVersion: 0
        }
      ]);
      if (!h) throw Error("CUTOFF_ORIGINAL_SLOT_NOT_FINAL");
      return { ...h, slot };
    },
    async frontier(slot) {
      const slots = await rpc.call("getBlocks", [
        slot,
        slot + 32,
        { commitment: "finalized" }
      ]);
      if (!Array.isArray(slots) || slots[0] !== slot) throw Error("CUTOFF_HEADER_UNAVAILABLE");
      for (const s of slots.slice(0, 2))
        if (!headers.has(s)) {
          const h = await rpc.call("getBlock", [
            s,
            {
              commitment: "finalized",
              transactionDetails: "none",
              rewards: false,
              maxSupportedTransactionVersion: 0
            }
          ]);
          if (!h) throw Error("CUTOFF_HEADER_UNAVAILABLE");
          headers.set(s, { ...h, slot: s });
        }
      if (headers.size > 256) headers.delete(headers.keys().next().value);
      const last = headers.get(slot), next = headers.get(slots[1]);
      if (!last || !next) throw Error("CUTOFF_ADJACENT_HEADER_REQUIRED");
      return { last, next };
    }
  });
  const db = settlement.database();
  return {
    database: db,
    router: router2,
    settlement,
    capture: (now) => settlement.captureDue(now),
    lifecycle: (now, grace = 60) => runHourlyLifecycleTick(db, router2, now, grace)
  };
}

// apps/api/isolated/verified-routes/operational/qualification.ts
import { readFile as readFile2 } from "node:fs/promises";

// apps/api/isolated/verified-routes/footprint-acquisition.ts
import { performance as performance3 } from "node:perf_hooks";

// apps/api/isolated/verified-routes/operational/bootstrap.ts
import { readFile as readFile4, mkdir as mkdir2, rename, writeFile as writeFile2 } from "node:fs/promises";
import { isAbsolute, join as join2 } from "node:path";
import { createHash as createHash24 } from "node:crypto";

// packages/db/src/database.ts
import { sql as sql2 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/drizzle-orm/index.cjs";
import { drizzle } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/drizzle-orm/node-postgres/index.cjs";
import { Pool } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/pg/esm/index.mjs";

// packages/db/src/schema.ts
var schema_exports = {};
__export(schema_exports, {
  appMeta: () => appMeta,
  assets: () => assets,
  chartFillFxCaptureFailures: () => chartFillFxCaptureFailures,
  chartFillFxEvidence: () => chartFillFxEvidence,
  competitionAccounts: () => competitionAccounts,
  competitionTokenSlots: () => competitionTokenSlots,
  dailyCompetitions: () => dailyCompetitions,
  dailyResultHourlyResults: () => dailyResultHourlyResults,
  dailyResults: () => dailyResults,
  fills: () => fills,
  hourlyResults: () => hourlyResults,
  hourlyRounds: () => hourlyRounds,
  idempotencyRecords: () => idempotencyRecords,
  journalTransactions: () => journalTransactions,
  ledgerEntries: () => ledgerEntries,
  marketStateEvidence: () => marketStateEvidence,
  markets: () => markets,
  orderMarketStateEvidence: () => orderMarketStateEvidence,
  orders: () => orders,
  payoutAllocations: () => payoutAllocations,
  payoutApprovalAuthorizations: () => payoutApprovalAuthorizations,
  payoutApprovalSnapshots: () => payoutApprovalSnapshots,
  payoutAuthorityNonces: () => payoutAuthorityNonces,
  payoutBatchAllocations: () => payoutBatchAllocations,
  payoutBatches: () => payoutBatches,
  payoutBroadcastAttempts: () => payoutBroadcastAttempts,
  payoutExecutions: () => payoutExecutions,
  payoutOperationEvents: () => payoutOperationEvents,
  payoutPlanApprovals: () => payoutPlanApprovals,
  payoutPlans: () => payoutPlans,
  payoutRankBuckets: () => payoutRankBuckets,
  payoutSecurityEvents: () => payoutSecurityEvents,
  payoutSignedTransactions: () => payoutSignedTransactions,
  payoutStopState: () => payoutStopState,
  payoutTreasuryDays: () => payoutTreasuryDays,
  payoutTreasuryReceipts: () => payoutTreasuryReceipts,
  payoutTreasuryReservations: () => payoutTreasuryReservations,
  payoutTreasurySettlements: () => payoutTreasurySettlements,
  positions: () => positions,
  settlementWriteoffMetadataRepairs: () => settlementWriteoffMetadataRepairs,
  users: () => users
});
import { sql } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/drizzle-orm/index.cjs";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/drizzle-orm/pg-core/index.cjs";
var createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
var updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
var settlementWriteoffMetadataRepairs = pgTable(
  "settlement_writeoff_metadata_repairs",
  {
    journalTransactionId: text("journal_transaction_id").primaryKey().references(() => journalTransactions.id, { onDelete: "restrict", onUpdate: "restrict" }),
    tokenQuantity: numeric("token_quantity", { precision: 38, scale: 0 }).notNull(),
    costBasisLamports: bigint("cost_basis_lamports", { mode: "bigint" }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt
  },
  (table) => [
    check("settlement_writeoff_metadata_repairs_quantity", sql`${table.tokenQuantity} > 0`),
    check("settlement_writeoff_metadata_repairs_cost", sql`${table.costBasisLamports} >= 0`)
  ]
);
var appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt,
  updatedAt
});
var users = pgTable("users", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  createdAt
});
var hourlyRounds = pgTable(
  "hourly_rounds",
  {
    id: text("id").primaryKey(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().unique(),
    endsAtExclusive: timestamp("ends_at_exclusive", { withTimezone: true }).notNull().unique(),
    state: text("state").notNull().default("SCHEDULED"),
    startingPaperSolLamports: bigint("starting_paper_sol_lamports", { mode: "bigint" }).notNull(),
    maxUniqueTokens: integer("max_unique_tokens").notNull(),
    maxBuyRatioBps: integer("max_buy_ratio_bps").notNull(),
    rewardFinalizationGracePeriodSeconds: integer(
      "reward_finalization_grace_period_seconds"
    ).notNull(),
    rulesVersion: text("rules_version").notNull(),
    createdAt,
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    check(
      "hourly_rounds_exact_window",
      sql`${table.startsAt} = date_trunc('hour', ${table.startsAt}) and ${table.endsAtExclusive} = ${table.startsAt} + interval '1 hour'`
    ),
    check(
      "hourly_rounds_state_valid",
      sql`${table.state} in ('SCHEDULED', 'OPEN', 'CLOSING', 'SETTLING', 'FINALIZED', 'PAYING', 'PAID')`
    ),
    check("hourly_rounds_starting_balance_positive", sql`${table.startingPaperSolLamports} > 0`),
    check("hourly_rounds_token_limit_positive", sql`${table.maxUniqueTokens} > 0`),
    check(
      "hourly_rounds_buy_ratio_valid",
      sql`${table.maxBuyRatioBps} > 0 and ${table.maxBuyRatioBps} <= 10000`
    ),
    check(
      "hourly_rounds_grace_period_nonnegative",
      sql`${table.rewardFinalizationGracePeriodSeconds} >= 0`
    )
  ]
);
var dailyCompetitions = pgTable(
  "daily_competitions",
  {
    id: text("id").primaryKey(),
    utcDate: date("utc_date").notNull().unique(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().unique(),
    endsAtExclusive: timestamp("ends_at_exclusive", { withTimezone: true }).notNull().unique(),
    state: text("state").notNull().default("OPEN"),
    createdAt,
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    check(
      "daily_competitions_exact_utc_window",
      sql`${table.startsAt} = date_trunc('day', ${table.startsAt} at time zone 'UTC') at time zone 'UTC' and ${table.endsAtExclusive} = ${table.startsAt} + interval '1 day' and ${table.utcDate} = (${table.startsAt} at time zone 'UTC')::date`
    ),
    check(
      "daily_competitions_state_valid",
      sql`${table.state} in ('OPEN', 'CLOSING', 'FINALIZING', 'FINALIZED', 'PAYING', 'PAID')`
    )
  ]
);
var assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    mintAddress: text("mint_address").notNull().unique(),
    symbol: text("symbol"),
    name: text("name"),
    decimals: integer("decimals").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt
  },
  (table) => [check("assets_decimals_valid", sql`${table.decimals} between 0 and 255`)]
);
var markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(),
    baseAssetId: text("base_asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    quoteAssetId: text("quote_asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    venue: text("venue").notNull(),
    providerMarketId: text("provider_market_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt
  },
  (table) => [
    unique("markets_venue_provider_unique").on(table.venue, table.providerMarketId),
    check("markets_distinct_assets", sql`${table.baseAssetId} <> ${table.quoteAssetId}`)
  ]
);
var competitionAccounts = pgTable(
  "competition_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    hourlyRoundId: text("hourly_round_id").notNull().references(() => hourlyRounds.id, { onDelete: "restrict", onUpdate: "restrict" }),
    startingPaperSolLamports: bigint("starting_paper_sol_lamports", { mode: "bigint" }).notNull(),
    paperSolBalanceLamports: bigint("paper_sol_balance_lamports", { mode: "bigint" }).notNull(),
    realizedPnlLamports: bigint("realized_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    finalSettledBalanceLamports: bigint("final_settled_balance_lamports", { mode: "bigint" }),
    hourlyPnlLamports: bigint("hourly_pnl_lamports", { mode: "bigint" }),
    createdAt,
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    unique("competition_accounts_user_round_unique").on(table.userId, table.hourlyRoundId),
    index("competition_accounts_round_idx").on(table.hourlyRoundId),
    check(
      "competition_accounts_starting_balance_positive",
      sql`${table.startingPaperSolLamports} > 0`
    ),
    check("competition_accounts_balance_nonnegative", sql`${table.paperSolBalanceLamports} >= 0`),
    check(
      "competition_accounts_finalization_consistent",
      sql`(${table.finalSettledBalanceLamports} is null and ${table.hourlyPnlLamports} is null and ${table.finalizedAt} is null) or (${table.finalSettledBalanceLamports} is not null and ${table.hourlyPnlLamports} = ${table.finalSettledBalanceLamports} - ${table.startingPaperSolLamports} and ${table.finalizedAt} is not null)`
    )
  ]
);
var competitionTokenSlots = pgTable(
  "competition_token_slots",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    firstSuccessfulBuyAt: timestamp("first_successful_buy_at", { withTimezone: true }).notNull()
  },
  (table) => [
    unique("competition_token_slots_account_asset_unique").on(
      table.competitionAccountId,
      table.assetId
    ),
    index("competition_token_slots_account_idx").on(table.competitionAccountId)
  ]
);
var idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    operationClass: text("operation_class").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("PENDING"),
    competitionAccountId: text("competition_account_id").references(() => competitionAccounts.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    resultEntityType: text("result_entity_type"),
    resultEntityId: text("result_entity_id"),
    createdAt,
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("idempotency_operation_key_unique").on(table.operationClass, table.idempotencyKey),
    check("idempotency_status_valid", sql`${table.status} in ('PENDING', 'COMPLETED', 'FAILED')`),
    check(
      "idempotency_completion_consistent",
      sql`(${table.status} = 'PENDING' and ${table.completedAt} is null) or (${table.status} <> 'PENDING' and ${table.completedAt} is not null)`
    )
  ]
);
var orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    side: text("side").notNull(),
    requestedBaseUnits: bigint("requested_base_units", { mode: "bigint" }),
    requestedQuoteLamports: bigint("requested_quote_lamports", { mode: "bigint" }),
    executionContext: text("execution_context").notNull().default("NORMAL_USER"),
    status: text("status").notNull().default("PENDING"),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    updatedAt,
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason")
  },
  (table) => [
    index("orders_account_time_idx").on(table.competitionAccountId, table.requestedAt),
    check("orders_side_valid", sql`${table.side} in ('BUY', 'SELL')`),
    check(
      "orders_execution_context_valid",
      sql`${table.executionContext} in ('NORMAL_USER', 'FORCED_HOURLY_SETTLEMENT')`
    ),
    check(
      "orders_status_valid",
      sql`${table.status} in ('PENDING', 'PARTIALLY_FILLED', 'COMPLETED', 'REJECTED', 'CANCELLED')`
    ),
    check(
      "orders_request_valid",
      sql`(${table.side} = 'BUY' and ${table.requestedQuoteLamports} > 0 and ${table.requestedBaseUnits} is null) or (${table.side} = 'SELL' and ${table.requestedBaseUnits} > 0 and ${table.requestedQuoteLamports} is null)`
    )
  ]
);
var positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    remainingBaseUnits: bigint("remaining_base_units", { mode: "bigint" }).notNull().default(sql`0`),
    costBasisLamports: bigint("cost_basis_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    realizedPnlLamports: bigint("realized_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    status: text("status").notNull().default("OPEN"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    updatedAt,
    closedAt: timestamp("closed_at", { withTimezone: true })
  },
  (table) => [
    unique("positions_account_market_unique").on(table.competitionAccountId, table.marketId),
    check("positions_quantity_nonnegative", sql`${table.remainingBaseUnits} >= 0`),
    check("positions_cost_nonnegative", sql`${table.costBasisLamports} >= 0`),
    check("positions_status_valid", sql`${table.status} in ('OPEN', 'CLOSED')`),
    check(
      "positions_state_consistent",
      sql`(${table.status} = 'OPEN' and ${table.remainingBaseUnits} > 0 and ${table.costBasisLamports} > 0 and ${table.closedAt} is null) or (${table.status} = 'CLOSED' and ${table.remainingBaseUnits} = 0 and ${table.costBasisLamports} = 0 and ${table.closedAt} is not null)`
    )
  ]
);
var marketStateEvidence = pgTable(
  "market_state_evidence",
  {
    id: text("id").primaryKey(),
    protocolId: text("protocol_id").notNull(),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    chainSlot: bigint("chain_slot", { mode: "bigint" }),
    chainBlockId: text("chain_block_id"),
    adapterVersion: text("adapter_version").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    normalizedState: jsonb("normalized_state").notNull(),
    rawSource: jsonb("raw_source"),
    stateFingerprint: text("state_fingerprint").notNull().unique(),
    createdAt
  },
  (table) => [
    index("market_state_evidence_market_time_idx").on(table.marketId, table.observedAt),
    check("market_state_evidence_protocol_nonempty", sql`length(${table.protocolId}) > 0`),
    check("market_state_evidence_adapter_nonempty", sql`length(${table.adapterVersion}) > 0`),
    check(
      "market_state_evidence_normalization_nonempty",
      sql`length(${table.normalizationVersion}) > 0`
    )
  ]
);
var orderMarketStateEvidence = pgTable(
  "order_market_state_evidence",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "restrict" }),
    evidenceId: text("evidence_id").notNull().references(() => marketStateEvidence.id, { onDelete: "restrict", onUpdate: "restrict" }),
    purpose: text("purpose").notNull(),
    positionId: text("position_id").references(() => positions.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    executableValueLamports: bigint("executable_value_lamports", { mode: "bigint" }),
    createdAt
  },
  (table) => [
    unique("order_market_state_evidence_usage_unique").on(
      table.orderId,
      table.evidenceId,
      table.purpose,
      table.positionId
    ),
    index("order_market_state_evidence_order_idx").on(table.orderId),
    check(
      "order_market_state_evidence_purpose_valid",
      sql`${table.purpose} in ('BUY_EXECUTION', 'SELL_EXECUTION', 'POSITION_EXIT_VALUATION')`
    ),
    check(
      "order_market_state_evidence_value_nonnegative",
      sql`${table.executableValueLamports} is null or ${table.executableValueLamports} >= 0`
    )
  ]
);
var fills = pgTable(
  "fills",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "restrict" }),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    executionId: text("execution_id").notNull().unique(),
    side: text("side").notNull(),
    baseQuantity: bigint("base_quantity", { mode: "bigint" }).notNull(),
    quoteLamports: bigint("quote_lamports", { mode: "bigint" }).notNull(),
    executionPrice: numeric("execution_price", { precision: 38, scale: 18 }).notNull(),
    feeLamports: bigint("fee_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    actualInputLamports: bigint("actual_input_lamports", { mode: "bigint" }),
    actualOutputLamports: bigint("actual_output_lamports", { mode: "bigint" }),
    feeBreakdown: jsonb("fee_breakdown"),
    protocolId: text("protocol_id"),
    adapterVersion: text("adapter_version"),
    marketStateEvidenceId: text("market_state_evidence_id").references(
      () => marketStateEvidence.id,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
    costBasisLamportsRemoved: bigint("cost_basis_lamports_removed", { mode: "bigint" }).notNull().default(sql`0`),
    realizedPnlLamports: bigint("realized_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    createdAt
  },
  (table) => [
    index("fills_order_time_idx").on(table.orderId, table.executedAt),
    check("fills_side_valid", sql`${table.side} in ('BUY', 'SELL')`),
    check("fills_base_positive", sql`${table.baseQuantity} > 0`),
    check("fills_quote_positive", sql`${table.quoteLamports} > 0`),
    check("fills_price_positive", sql`${table.executionPrice} > 0`),
    check("fills_fee_nonnegative", sql`${table.feeLamports} >= 0`),
    check(
      "fills_actual_input_positive",
      sql`${table.actualInputLamports} is null or ${table.actualInputLamports} > 0`
    ),
    check(
      "fills_actual_output_positive",
      sql`${table.actualOutputLamports} is null or ${table.actualOutputLamports} > 0`
    ),
    check("fills_cost_removed_nonnegative", sql`${table.costBasisLamportsRemoved} >= 0`)
  ]
);
var hourlyResults = pgTable(
  "hourly_results",
  {
    id: text("id").primaryKey(),
    hourlyRoundId: text("hourly_round_id").notNull().references(() => hourlyRounds.id, { onDelete: "restrict", onUpdate: "restrict" }),
    competitionAccountId: text("competition_account_id").notNull().unique().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    finalSettledBalanceLamports: bigint("final_settled_balance_lamports", {
      mode: "bigint"
    }).notNull(),
    startingPaperSolLamports: bigint("starting_paper_sol_lamports", { mode: "bigint" }).notNull(),
    hourlyPnlLamports: bigint("hourly_pnl_lamports", { mode: "bigint" }).notNull(),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull()
  },
  (table) => [
    unique("hourly_results_round_account_unique").on(
      table.hourlyRoundId,
      table.competitionAccountId
    ),
    index("hourly_results_round_idx").on(table.hourlyRoundId),
    check(
      "hourly_results_pnl_exact",
      sql`${table.hourlyPnlLamports} = ${table.finalSettledBalanceLamports} - ${table.startingPaperSolLamports}`
    ),
    check(
      "hourly_results_final_balance_nonnegative",
      sql`${table.finalSettledBalanceLamports} >= 0`
    )
  ]
);
var dailyResults = pgTable(
  "daily_results",
  {
    id: text("id").primaryKey(),
    dailyCompetitionId: text("daily_competition_id").notNull().references(() => dailyCompetitions.id, { onDelete: "restrict", onUpdate: "restrict" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    cumulativePnlLamports: bigint("cumulative_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    completedHourlyRoundCount: integer("completed_hourly_round_count").notNull().default(0),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("daily_results_competition_user_unique").on(table.dailyCompetitionId, table.userId),
    check(
      "daily_results_completed_count_nonnegative",
      sql`${table.completedHourlyRoundCount} >= 0`
    )
  ]
);
var dailyResultHourlyResults = pgTable(
  "daily_result_hourly_results",
  {
    id: text("id").primaryKey(),
    dailyResultId: text("daily_result_id").notNull().references(() => dailyResults.id, { onDelete: "restrict", onUpdate: "restrict" }),
    hourlyResultId: text("hourly_result_id").notNull().unique().references(() => hourlyResults.id, { onDelete: "restrict", onUpdate: "restrict" }),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contributedAt: timestamp("contributed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("daily_result_hourly_results_pair_unique").on(table.dailyResultId, table.hourlyResultId)
  ]
);
var payoutPlans = pgTable(
  "payout_plans",
  {
    id: text("id").primaryKey(),
    competitionType: text("competition_type").notNull(),
    hourlyRoundId: text("hourly_round_id").references(() => hourlyRounds.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    dailyCompetitionId: text("daily_competition_id").references(() => dailyCompetitions.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    prizePoolLamports: bigint("prize_pool_lamports", { mode: "bigint" }).notNull(),
    curveVersion: text("curve_version").notNull(),
    tiePolicyVersion: text("tie_policy_version").notNull(),
    participantCount: integer("participant_count").notNull(),
    nominalWinnerCount: integer("nominal_winner_count").notNull(),
    actualWinnerCount: integer("actual_winner_count").notNull(),
    state: text("state").notNull().default("CALCULATED"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    configSnapshot: jsonb("config_snapshot").notNull(),
    sourceResultSnapshot: jsonb("source_result_snapshot").notNull(),
    totalAllocatedLamports: bigint("total_allocated_lamports", { mode: "bigint" }).notNull(),
    conservationHolds: boolean("conservation_holds").notNull(),
    createdAt
  },
  (table) => [
    unique("payout_plans_hour_curve_unique").on(table.hourlyRoundId, table.curveVersion),
    unique("payout_plans_daily_curve_unique").on(table.dailyCompetitionId, table.curveVersion),
    index("payout_plans_state_idx").on(table.state, table.calculatedAt),
    check("payout_plans_type_valid", sql`${table.competitionType} in ('HOURLY','DAILY')`),
    check(
      "payout_plans_source_exact",
      sql`(${table.competitionType} = 'HOURLY' and ${table.hourlyRoundId} is not null and ${table.dailyCompetitionId} is null) or (${table.competitionType} = 'DAILY' and ${table.hourlyRoundId} is null and ${table.dailyCompetitionId} is not null)`
    ),
    check(
      "payout_plans_state_valid",
      sql`${table.state} in ('CALCULATED','FROZEN','VALIDATED','APPROVED','SIGNED','BROADCAST','VERIFIED','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')`
    ),
    check(
      "payout_plans_counts_valid",
      sql`${table.participantCount} >= 0 and ${table.nominalWinnerCount} > 0 and ${table.actualWinnerCount} >= 0`
    ),
    check(
      "payout_plans_amounts_valid",
      sql`${table.prizePoolLamports} >= 0 and ${table.totalAllocatedLamports} >= 0`
    ),
    check(
      "payout_plans_conservation_exact",
      sql`${table.conservationHolds} and ${table.prizePoolLamports} = ${table.totalAllocatedLamports}`
    )
  ]
);
var payoutRankBuckets = pgTable(
  "payout_rank_buckets",
  {
    id: text("id").primaryKey(),
    payoutPlanId: text("payout_plan_id").notNull().references(() => payoutPlans.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    weightPpm: bigint("weight_ppm", { mode: "bigint" }).notNull(),
    floorAllocationLamports: bigint("floor_allocation_lamports", { mode: "bigint" }).notNull(),
    remainderBasis: bigint("remainder_basis", { mode: "bigint" }).notNull(),
    finalAllocationLamports: bigint("final_allocation_lamports", { mode: "bigint" }).notNull(),
    createdAt
  },
  (table) => [
    unique("payout_rank_buckets_plan_ordinal_unique").on(table.payoutPlanId, table.ordinal),
    check("payout_rank_buckets_ordinal_positive", sql`${table.ordinal} > 0`),
    check(
      "payout_rank_buckets_values_nonnegative",
      sql`${table.weightPpm} >= 0 and ${table.floorAllocationLamports} >= 0 and ${table.remainderBasis} >= 0 and ${table.finalAllocationLamports} >= 0`
    )
  ]
);
var payoutAllocations = pgTable(
  "payout_allocations",
  {
    id: text("id").primaryKey(),
    payoutPlanId: text("payout_plan_id").notNull().references(() => payoutPlans.id, { onDelete: "restrict", onUpdate: "restrict" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    competitiveRank: integer("competitive_rank").notNull(),
    tieGroupSize: integer("tie_group_size").notNull(),
    ordinalStart: integer("ordinal_start").notNull(),
    ordinalEnd: integer("ordinal_end").notNull(),
    fundedOrdinalCount: integer("funded_ordinal_count").notNull(),
    allocatedLamports: bigint("allocated_lamports", { mode: "bigint" }).notNull(),
    dustAdjustmentLamports: bigint("dust_adjustment_lamports", { mode: "bigint" }).notNull(),
    allocationExplanation: jsonb("allocation_explanation").notNull(),
    createdAt
  },
  (table) => [
    unique("payout_allocations_plan_user_unique").on(table.payoutPlanId, table.userId),
    index("payout_allocations_user_idx").on(table.userId, table.createdAt),
    check(
      "payout_allocations_rank_valid",
      sql`${table.competitiveRank} > 0 and ${table.tieGroupSize} > 0 and ${table.ordinalStart} > 0 and ${table.ordinalEnd} >= ${table.ordinalStart} and ${table.fundedOrdinalCount} > 0`
    ),
    check(
      "payout_allocations_amount_valid",
      sql`${table.allocatedLamports} >= 0 and ${table.dustAdjustmentLamports} >= 0 and ${table.dustAdjustmentLamports} <= 1`
    )
  ]
);
var payoutPlanApprovals = pgTable("payout_plan_approvals", {
  id: text("id").primaryKey(),
  payoutPlanId: text("payout_plan_id").notNull().unique().references(() => payoutPlans.id),
  approvalMethod: text("approval_method").notNull(),
  approverIdentifier: text("approver_identifier").notNull(),
  planSnapshotHash: text("plan_snapshot_hash").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  createdAt
});
var payoutExecutions = pgTable("payout_executions", {
  id: text("id").primaryKey(),
  payoutPlanId: text("payout_plan_id").notNull().unique().references(() => payoutPlans.id),
  network: text("network").notNull(),
  treasuryAddress: text("treasury_address").notNull(),
  signerType: text("signer_type").notNull(),
  safetyVersion: text("safety_version"),
  state: text("state").notNull(),
  totalPayoutLamports: bigint("total_payout_lamports", { mode: "bigint" }).notNull(),
  estimatedFeeLamports: bigint("estimated_fee_lamports", { mode: "bigint" }).notNull(),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
  lastBroadcastAt: timestamp("last_broadcast_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  failureDetail: text("failure_detail"),
  createdAt,
  updatedAt
});
var payoutBatches = pgTable(
  "payout_batches",
  {
    id: text("id").primaryKey(),
    payoutExecutionId: text("payout_execution_id").notNull().references(() => payoutExecutions.id),
    batchIndex: integer("batch_index").notNull(),
    intentVersion: text("intent_version").notNull(),
    intentHash: text("intent_hash").notNull().unique(),
    state: text("state").notNull(),
    recipientCount: integer("recipient_count").notNull(),
    totalLamports: bigint("total_lamports", { mode: "bigint" }).notNull(),
    feeLamports: bigint("fee_lamports", { mode: "bigint" }).notNull(),
    recentBlockhash: text("recent_blockhash").notNull(),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "bigint" }).notNull(),
    unsignedTransactionBase64: text("unsigned_transaction_base64").notNull(),
    signedTransactionBase64: text("signed_transaction_base64"),
    transactionSignature: text("transaction_signature").unique(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    lastBroadcastAt: timestamp("last_broadcast_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confirmationSlot: bigint("confirmation_slot", { mode: "bigint" }),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("payout_batches_execution_index_unique").on(table.payoutExecutionId, table.batchIndex)
  ]
);
var payoutBatchAllocations = pgTable(
  "payout_batch_allocations",
  {
    payoutBatchId: text("payout_batch_id").notNull().references(() => payoutBatches.id),
    payoutAllocationId: text("payout_allocation_id").notNull().unique().references(() => payoutAllocations.id),
    ordinal: integer("ordinal").notNull(),
    destinationAddress: text("destination_address").notNull(),
    lamports: bigint("lamports", { mode: "bigint" }).notNull(),
    createdAt
  },
  (table) => [
    unique("payout_batch_allocations_ordinal_unique").on(table.payoutBatchId, table.ordinal)
  ]
);
var payoutBroadcastAttempts = pgTable(
  "payout_broadcast_attempts",
  {
    id: text("id").primaryKey(),
    payoutBatchId: text("payout_batch_id").notNull().references(() => payoutBatches.id),
    attemptNumber: integer("attempt_number").notNull(),
    transactionSignature: text("transaction_signature").notNull(),
    outcome: text("outcome").notNull(),
    rpcDetail: text("rpc_detail"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt
  },
  (table) => [
    unique("payout_broadcast_attempts_batch_number_unique").on(
      table.payoutBatchId,
      table.attemptNumber
    )
  ]
);
var journalTransactions = pgTable(
  "journal_transactions",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    operationType: text("operation_type").notNull(),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: text("source_entity_id").notNull(),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt
  },
  (table) => [
    index("journal_transactions_account_time_idx").on(table.competitionAccountId, table.createdAt)
  ]
);
var ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    journalTransactionId: text("journal_transaction_id").notNull().references(() => journalTransactions.id, { onDelete: "restrict", onUpdate: "restrict" }),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    accountCode: text("account_code").notNull(),
    direction: text("direction").notNull(),
    amountLamports: bigint("amount_lamports", { mode: "bigint" }).notNull(),
    createdAt
  },
  (table) => [
    index("ledger_entries_account_time_idx").on(table.competitionAccountId, table.createdAt),
    index("ledger_entries_journal_idx").on(table.journalTransactionId),
    check(
      "ledger_entries_account_code_valid",
      sql`${table.accountCode} in ('CASH', 'POSITION_COST', 'HOURLY_STARTING_CAPITAL', 'TRADING_PNL', 'TRADING_FEES')`
    ),
    check("ledger_entries_direction_valid", sql`${table.direction} in ('DEBIT', 'CREDIT')`),
    check("ledger_entries_amount_positive", sql`${table.amountLamports} > 0`)
  ]
);
var chartFillFxEvidence = pgTable(
  "chart_fill_fx_evidence",
  {
    fillId: text("fill_id").notNull().references(() => fills.id, { onDelete: "restrict", onUpdate: "restrict" }),
    version: text("version").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    fxAt: timestamp("fx_at", { withTimezone: true }).notNull(),
    rate: numeric("rate", { precision: 38, scale: 18 }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({ columns: [table.fillId, table.version] }),
    check("chart_fill_fx_rate_positive", sql`${table.rate} > 0`)
  ]
);
var chartFillFxCaptureFailures = pgTable(
  "chart_fill_fx_capture_failures",
  {
    fillId: text("fill_id").notNull().references(() => fills.id, { onDelete: "restrict", onUpdate: "restrict" }),
    version: text("version").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({ columns: [table.fillId, table.version] }),
    check("chart_capture_status_unavailable", sql`${table.status} = 'UNAVAILABLE'`)
  ]
);
var payoutApprovalSnapshots = pgTable("payout_approval_snapshots", {
  approvalId: text("approval_id").primaryKey().references(() => payoutPlanApprovals.id, {
    onDelete: "restrict",
    onUpdate: "restrict"
  }),
  snapshotVersion: text("snapshot_version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt
});
var payoutSignedTransactions = pgTable("payout_signed_transactions", {
  payoutBatchId: text("payout_batch_id").primaryKey().references(() => payoutBatches.id, { onDelete: "restrict" }),
  transactionSignature: text("transaction_signature").notNull().unique(),
  intentHash: text("intent_hash").notNull(),
  unsignedTransactionBase64: text("unsigned_transaction_base64").notNull(),
  signedTransactionBase64: text("signed_transaction_base64").notNull(),
  recentBlockhash: text("recent_blockhash").notNull(),
  lastValidBlockHeight: bigint("last_valid_block_height", { mode: "bigint" }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutOperationEvents = pgTable("payout_operation_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  payoutExecutionId: text("payout_execution_id").notNull().references(() => payoutExecutions.id, { onDelete: "restrict" }),
  payoutBatchId: text("payout_batch_id").references(() => payoutBatches.id, { onDelete: "restrict" }),
  transactionSignature: text("transaction_signature"),
  event: text("event").notNull(),
  detail: jsonb("detail").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutStopState = pgTable("payout_stop_state", {
  singleton: boolean("singleton").primaryKey().default(true),
  stopped: boolean("stopped").notNull().default(true),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n),
  reason: text("reason").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutSecurityEvents = pgTable("payout_security_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  actor: text("actor"),
  action: text("action").notNull(),
  planId: text("plan_id"),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutAuthorityNonces = pgTable("payout_authority_nonces", {
  issuer: text("issuer").notNull(),
  nonce: text("nonce").notNull(),
  action: text("action").notNull(),
  planId: text("plan_id").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  signedRequest: jsonb("signed_request").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
}, (table) => [primaryKey({ columns: [table.issuer, table.nonce] })]);
var payoutApprovalAuthorizations = pgTable("payout_approval_authorizations", {
  approvalId: text("approval_id").primaryKey().references(() => payoutPlanApprovals.id, { onDelete: "restrict" }),
  subject: text("subject").notNull(),
  signedRequest: jsonb("signed_request").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutTreasuryReceipts = pgTable("payout_treasury_receipts", {
  identity: text("identity").primaryKey(),
  kind: text("kind").notNull(),
  // creator_fee_events is an existing SQL-defined table; the companion SQL enforces this FK.
  creatorFeeEventId: text("creator_fee_event_id"),
  allocations: jsonb("allocations").notNull(),
  network: text("network").notNull(),
  treasury: text("treasury").notNull(),
  lamports: bigint("lamports", { mode: "bigint" }).notNull(),
  finalizedSlot: bigint("finalized_slot", { mode: "bigint" }).notNull(),
  evidenceHash: text("evidence_hash").notNull()
});
var payoutTreasuryReservations = pgTable("payout_treasury_reservations", {
  planId: text("plan_id").primaryKey().references(() => payoutPlans.id, { onDelete: "restrict" }),
  sourceKey: text("source_key").notNull().unique(),
  approvalHash: text("approval_hash").notNull(),
  fundingHash: text("funding_hash").notNull(),
  principal: bigint("principal", { mode: "bigint" }).notNull(),
  feeBudget: bigint("fee_budget", { mode: "bigint" }).notNull(),
  recipients: jsonb("recipients").notNull(),
  network: text("network").notNull(),
  treasury: text("treasury").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull()
});
var payoutTreasuryDays = pgTable(
  "payout_treasury_days",
  {
    planId: text("plan_id").notNull().references(() => payoutTreasuryReservations.planId, { onDelete: "restrict" }),
    utcDay: date("utc_day").notNull(),
    exposure: bigint("exposure", { mode: "bigint" }).notNull()
  },
  (table) => [primaryKey({ columns: [table.planId, table.utcDay] })]
);
var payoutTreasurySettlements = pgTable("payout_treasury_settlements", {
  batchId: text("batch_id").primaryKey().references(() => payoutBatches.id, { onDelete: "restrict" }),
  planId: text("plan_id").notNull().references(() => payoutTreasuryReservations.planId, { onDelete: "restrict" }),
  signature: text("signature").notNull().unique(),
  principal: bigint("principal", { mode: "bigint" }).notNull(),
  fee: bigint("fee", { mode: "bigint" }).notNull(),
  finalizedSlot: bigint("finalized_slot", { mode: "bigint" }).notNull()
});

// packages/db/src/database.ts
function createDatabase(databaseUrl, admission = {}) {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", () => {
  });
  const client = drizzle(pool, { schema: schema_exports });
  return {
    authorizePaperBuy: admission.authorizePaperBuy ?? (async () => false),
    client,
    pool,
    async healthCheck() {
      try {
        await client.execute(sql2`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    }
  };
}

// packages/db/src/generic-capability.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var KEY = "generic_pumpswap_operator_control_v1";
var ID = /^user:[a-f0-9]{64}$/;
function deny(reason) {
  throw new ExecutionEngineError("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
function genericCapabilityOptions(config2) {
  const c = config2;
  return {
    armed: c["GENERIC_PUMPSWAP_ENABLED"] === true,
    entries: c["GENERIC_PUMPSWAP_BUYS_ENABLED"] === true,
    normalUserAccess: c["GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED"] === true,
    operatorIds: Array.isArray(c["GENERIC_PUMPSWAP_OPERATOR_USER_IDS"]) ? c["GENERIC_PUMPSWAP_OPERATOR_USER_IDS"] : [],
    entrySeconds: typeof c["GENERIC_PUMPSWAP_ENTRY_SECONDS"] === "number" ? c["GENERIC_PUMPSWAP_ENTRY_SECONDS"] : 900
  };
}
var GenericCapability = class {
  constructor(db, options, now = Date.now) {
    this.db = db;
    this.options = options;
    this.now = now;
    if (options.operatorIds.length > 1 || options.operatorIds.some((id) => !ID.test(id)))
      throw Error("GENERIC_OPERATOR_SCOPE_INVALID");
    if (options.entries && (!options.armed || options.operatorIds.length === 0))
      throw Error("GENERIC_ENTRY_REQUIRES_OPERATOR");
    this.controllers = new Set(options.operatorIds);
  }
  db;
  options;
  now;
  controllers;
  async mode() {
    if (!this.options.armed) return "HARD_STOP";
    const r = await this.db.pool.query({
      text: "select value from app_meta where key=$1",
      values: [KEY],
      query_timeout: 600
    });
    if (!r.rows[0]) return "EXIT_ONLY";
    try {
      const v = JSON.parse(r.rows[0].value);
      if (v.schema !== "GENERIC_OPERATOR_CONTROL_V1") return "HARD_STOP";
      if (v.mode === "HARD_STOP" || v.mode === "EXIT_ONLY") return v.mode;
      if (v.mode === "ENTRY" && typeof v.expiresAt === "number")
        return v.expiresAt > this.now() ? "ENTRY" : "EXIT_ONLY";
    } catch {
    }
    return "HARD_STOP";
  }
  async status(userId) {
    const mode = await this.mode();
    return {
      userId,
      armed: this.options.armed,
      // Compatibility field now describes uniform trading access, not a role.
      entitled: this.options.armed && this.options.normalUserAccess === true,
      canControl: this.controllers.has(userId),
      mode,
      entriesEnabled: this.options.armed && this.options.entries && this.options.normalUserAccess === true && mode === "ENTRY",
      exitPolicy: "OWNED_IMMUTABLE_GENERIC_FILL_AND_FRESH_ROUTE"
    };
  }
  async control(userId, mode) {
    if (!this.controllers.has(userId)) deny("GENERIC_OPERATOR_ENTITLEMENT_REQUIRED");
    if (!this.options.armed) deny("GENERIC_CAPABILITY_NOT_ARMED");
    if (mode === "ENTRY" && (!this.options.entries || this.options.normalUserAccess !== true))
      deny("GENERIC_ENTRY_NOT_ARMED");
    if (!["ENTRY", "EXIT_ONLY", "HARD_STOP"].includes(mode)) deny("GENERIC_CONTROL_INVALID");
    const record = {
      schema: "GENERIC_OPERATOR_CONTROL_V1",
      mode,
      actorUserId: userId,
      version: randomUUID2(),
      at: new Date(this.now()).toISOString(),
      expiresAt: mode === "ENTRY" ? this.now() + this.options.entrySeconds * 1e3 : null
    };
    await this.db.pool.query(
      "insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()",
      [KEY, JSON.stringify(record)]
    );
    return this.status(userId);
  }
  async exitPosition(mint, userId, system, accountId, forSettlement) {
    const r = await this.db.pool.query({
      text: `select f.protocol_id protocol,e.protocol_id evidence_protocol,e.adapter_version adapter,e.normalization_version normalization,e.normalized_state->'stage1Snapshot'->>'quoteMint' quote,
    e.normalized_state->'stage1Snapshot'->>'bridgePool' bridge,e.normalized_state->'stage1Snapshot'->>'targetPool' target,
    e.normalized_state->'stage1Snapshot'->>'mint' mint
    from positions p join competition_accounts ca on ca.id=p.competition_account_id join hourly_rounds h on h.id=ca.hourly_round_id join assets a on a.id=p.asset_id
    join lateral(select x.* from fills x join orders o on o.id=x.order_id join markets m on m.id=x.market_id
      where o.competition_account_id=ca.id and m.base_asset_id=p.asset_id and x.side='BUY' and x.base_quantity>0 and o.status='COMPLETED'
      order by x.executed_at desc,x.id desc limit 1) f on true
    join market_state_evidence e on e.id=f.market_state_evidence_id and e.market_id=f.market_id and e.protocol_id=f.protocol_id
    where a.mint_address=$1 and p.status='OPEN' and p.remaining_base_units>0
      and ($3::boolean or ca.user_id=$2::text) and ($4::text is null or ca.id=$4::text)
      and ca.final_settled_balance_lamports is null
      and (($6::boolean and h.state='SETTLING' and h.ends_at_exclusive<=$5)
        or (not $6::boolean and h.state='OPEN' and h.starts_at<=$5 and h.ends_at_exclusive>$5))
    order by f.executed_at desc,f.id desc limit 1`,
      values: [
        mint,
        userId ?? null,
        system,
        accountId ?? null,
        new Date(this.now()),
        forSettlement
      ],
      query_timeout: 600
    });
    const row = r.rows[0];
    if (!row) return void 0;
    if (row.protocol !== row.evidence_protocol || !row.adapter || !row.normalization)
      deny("GENERIC_EXIT_EVIDENCE_INVALID");
    if (row.protocol !== "GENERIC_PUMP_SWAP") return { binding: void 0 };
    if (row.evidence_protocol !== "GENERIC_PUMP_SWAP" || row.adapter !== "generic-pump-swap-orca-v1" || row.normalization !== "generic-pump-swap-accounts-v1" || row.mint !== mint || !row.quote || !row.bridge || !row.target)
      deny("GENERIC_EXIT_EVIDENCE_INVALID");
    return { binding: { quoteMint: row.quote, bridgePool: row.bridge, targetPool: row.target } };
  }
  async resolve(mint, quote, forSettlement) {
    if (!this.options.armed) return { discover: false, buy: false };
    const actor = genericActor(), system = this.options.systemSettlement === true && forSettlement || actor?.systemRead === true;
    if (!actor?.userId && !system) return { discover: false, buy: false };
    if (system && !actor?.accountId) deny("GENERIC_SYSTEM_ACCOUNT_SCOPE_REQUIRED");
    if (actor?.accountId && !system) {
      const own = await this.db.pool.query(
        "select id from competition_accounts where id=$1 and user_id=$2",
        [actor.accountId, actor.userId]
      );
      if (!own.rows[0]) deny("GENERIC_ACCOUNT_OWNER_MISMATCH");
    }
    const mode = await this.mode();
    if (mode === "HARD_STOP") deny("GENERIC_HARD_STOP");
    const eligible = !!actor?.userId && this.options.normalUserAccess === true, position = await this.exitPosition(
      mint,
      actor?.userId,
      system,
      actor?.accountId,
      forSettlement
    ), binding = position?.binding;
    if (binding && binding.quoteMint !== quote) deny("GENERIC_EXIT_QUOTE_CHANGED");
    const buy = !system && eligible && this.options.entries && mode === "ENTRY";
    const authorizeLive = async (kind) => {
      if (kind === "BUY" && actor?.intent !== "BUY") deny("GENERIC_READ_SCOPE_CANNOT_EXECUTE");
      if (kind === "SELL" && !forSettlement && actor?.intent !== "SELL")
        deny("GENERIC_READ_SCOPE_CANNOT_EXECUTE");
      const fresh = await this.mode();
      if (fresh === "HARD_STOP") deny("GENERIC_HARD_STOP");
      if (kind === "BUY" && (!buy || !this.options.entries || this.options.normalUserAccess !== true || fresh !== "ENTRY"))
        deny("GENERIC_OPERATOR_ENTRY_DISABLED");
      if (kind === "SELL") {
        const current2 = await this.exitPosition(
          mint,
          actor?.userId,
          system,
          actor?.accountId,
          forSettlement
        );
        if (!position || !current2) deny("GENERIC_OWNED_EXIT_EVIDENCE_REQUIRED");
        if (JSON.stringify(current2.binding) !== JSON.stringify(binding))
          deny("GENERIC_EXIT_EVIDENCE_CHANGED");
      }
    };
    if (binding) return { discover: false, buy, exitBinding: binding, authorizeLive };
    if (position || eligible && !system) return { discover: true, buy, authorizeLive };
    return { discover: false, buy: false };
  }
};

// packages/db/isolated/linked-pair/flow-progress.ts
import { gzipSync, gunzipSync as gunzipSync2 } from "node:zlib";
import { performance as performance4 } from "node:perf_hooks";

// packages/db/isolated/linked-pair/proof-recovery.ts
import { gunzipSync } from "node:zlib";

// packages/db/isolated/linked-pair/store.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { readFile as readFile3 } from "node:fs/promises";

// apps/api/src/competition.ts
import { createHash as createHash23 } from "node:crypto";
import { randomUUID as randomUUID4 } from "node:crypto";

// packages/db/src/creator-fee-ingestion.ts
import { createHash as createHash19 } from "node:crypto";
import bs585 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/bs58/src/cjs/index.cjs";
import { PublicKey as PublicKey14 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@solana/web3.js/lib/index.cjs.js";

// packages/db/src/reward-service.ts
import { createHash as createHash18 } from "node:crypto";
var FixtureCreatorFeeSource = class {
  constructor(events) {
    this.events = events;
  }
  events;
  id = "DETERMINISTIC_FIXTURE";
  async read() {
    return this.events;
  }
};
var defaultRewardAccountingConfig = {
  allocationMode: "NORMAL",
  baselineWindow: 12,
  lambdaBps: 6000n,
  configurationVersion: "phase-5a-v1"
};
var RewardAccountingError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
function eventId(event) {
  return `fee:${createHash18("sha256").update(`${event.transactionSignature}:${event.eventIndex.toString()}`).digest("hex")}`;
}
function assertEvent(event) {
  if (event.transactionSignature.length === 0 || !Number.isInteger(event.eventIndex) || event.eventIndex < 0 || event.slot < 0n || event.creatorFeeLamports <= 0n || event.sourceProgram.length === 0 || !Number.isFinite(event.eventTime.getTime()) || !Number.isFinite(event.observedAt.getTime())) {
    throw new RewardAccountingError("INVALID_CREATOR_FEE_EVENT", "Creator-fee event is malformed.");
  }
}
async function attributeEvent(client, event) {
  const round = (await client.query(
    `select id from hourly_rounds
       where starts_at <= $1 and ends_at_exclusive > $1
       order by starts_at desc limit 1`,
    [event.eventTime]
  )).rows[0];
  if (!round || event.verificationStatus !== "VERIFIED") {
    return { hourlyRoundId: round?.id ?? null, accountingStatus: "INELIGIBLE" };
  }
  const frozen = (await client.query(
    "select id from hourly_reward_pools where hourly_round_id = $1",
    [round.id]
  )).rows[0];
  return {
    hourlyRoundId: round.id,
    accountingStatus: frozen ? "LATE_AFTER_FREEZE" : "ATTRIBUTED"
  };
}
async function ingestCreatorFeeEvents(database2, source) {
  const events = await source.read();
  const client = await database2.pool.connect();
  let inserted = 0;
  let duplicates = 0;
  let lateAfterFreeze = 0;
  try {
    await client.query("begin");
    for (const event of events) {
      assertEvent(event);
      const attribution = await attributeEvent(client, event);
      const id = eventId(event);
      const result = await client.query(
        `insert into creator_fee_events
          (id, transaction_signature, event_index, slot, event_time, creator_fee_lamports,
           source_program, token_project_identity, observed_at, normalized_metadata,
           verification_status, accounting_status, hourly_round_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (transaction_signature, event_index) do nothing returning id`,
        [
          id,
          event.transactionSignature,
          event.eventIndex,
          event.slot.toString(),
          event.eventTime,
          event.creatorFeeLamports.toString(),
          event.sourceProgram,
          event.tokenProjectIdentity ?? null,
          event.observedAt,
          event.normalizedMetadata ?? {},
          event.verificationStatus,
          attribution.accountingStatus,
          attribution.hourlyRoundId
        ]
      );
      if (result.rowCount === 0) {
        const existing = (await client.query(
          `select slot,event_time,creator_fee_lamports,source_program,verification_status
             from creator_fee_events where transaction_signature=$1 and event_index=$2`,
          [event.transactionSignature, event.eventIndex]
        )).rows[0];
        if (BigInt(existing.slot) !== event.slot || existing.event_time.getTime() !== event.eventTime.getTime() || BigInt(existing.creator_fee_lamports) !== event.creatorFeeLamports || existing.source_program !== event.sourceProgram || existing.verification_status !== event.verificationStatus) {
          throw new RewardAccountingError(
            "CREATOR_FEE_IDENTITY_CONFLICT",
            "Creator-fee chain identity was reingested with different authoritative data."
          );
        }
        duplicates += 1;
        continue;
      }
      inserted += 1;
      if (attribution.accountingStatus === "LATE_AFTER_FREEZE") {
        lateAfterFreeze += 1;
        await client.query(
          `insert into late_fee_reconciliations
             (id, creator_fee_event_id, hourly_round_id, discovered_at)
           values ($1,$2,$3,$4) on conflict (creator_fee_event_id) do nothing`,
          [`reconciliation:${id}`, id, attribution.hourlyRoundId, event.observedAt]
        );
      }
    }
    await client.query("commit");
    return { inserted, duplicates, lateAfterFreeze };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
function runtimeCompetitionConfig(config2) {
  return validateCompetitionConfig({
    ...competitionConfig,
    version: config2.configurationVersion,
    rewardBuffer: {
      ...competitionConfig.rewardBuffer,
      baselineWindowCompletedHours: config2.baselineWindow,
      lambdaBps: config2.lambdaBps
    }
  });
}
function exactPool(row) {
  return {
    id: row.id,
    hourlyRoundId: row.hourly_round_id,
    creatorFeeLamports: BigInt(row.creator_fee_lamports),
    allocationMode: row.allocation_mode,
    naturalHourlyLamports: BigInt(row.natural_hourly_lamports),
    explicitBufferContributionLamports: BigInt(row.explicit_buffer_contribution_lamports),
    dailyAllocationLamports: BigInt(row.daily_allocation_lamports),
    platformAllocationLamports: BigInt(row.platform_allocation_lamports),
    baselineLamports: row.baseline_lamports === null ? null : BigInt(row.baseline_lamports),
    baselineInputRoundIds: row.baseline_input_round_ids,
    baselineWindow: row.baseline_window,
    lambdaBps: BigInt(row.lambda_bps),
    splitRatesBps: {
      hourly: BigInt(row.hourly_rate_bps),
      daily: BigInt(row.daily_rate_bps),
      buffer: BigInt(row.buffer_rate_bps),
      platform: BigInt(row.platform_rate_bps)
    },
    finalizationGraceSeconds: row.finalization_grace_seconds,
    dynamicTargetLamports: BigInt(row.dynamic_target_lamports),
    dynamicBufferDepositLamports: BigInt(row.dynamic_buffer_deposit_lamports),
    dynamicBufferSupportLamports: BigInt(row.dynamic_buffer_support_lamports),
    finalHourlyPrizeLamports: BigInt(row.final_hourly_prize_lamports),
    startingBufferLamports: BigInt(row.starting_buffer_lamports),
    endingBufferLamports: BigInt(row.ending_buffer_lamports),
    configurationVersion: row.configuration_version,
    status: row.status,
    finalizedAt: row.finalized_at,
    frozenAt: row.frozen_at,
    ...row.starts_at ? { startsAt: row.starts_at } : {},
    ...row.ends_at_exclusive ? { endsAtExclusive: row.ends_at_exclusive } : {}
  };
}
async function loadPool(client, roundId) {
  return (await client.query(
    `select p.*, r.starts_at, r.ends_at_exclusive
       from hourly_reward_pools p join hourly_rounds r on r.id = p.hourly_round_id
       where p.hourly_round_id = $1`,
    [roundId]
  )).rows[0];
}
async function finalizeHourlyRewardPool(database2, input) {
  const config2 = input.config ?? defaultRewardAccountingConfig;
  const client = await database2.pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [input.hourlyRoundId]);
    const existing = await loadPool(client, input.hourlyRoundId);
    if (existing) {
      await client.query("commit");
      return exactPool(existing);
    }
    const round = (await client.query(
      `select id, starts_at, ends_at_exclusive, reward_finalization_grace_period_seconds
         from hourly_rounds where id = $1 for update`,
      [input.hourlyRoundId]
    )).rows[0];
    if (!round)
      throw new RewardAccountingError("REWARD_ROUND_NOT_FOUND", "Hourly round not found.");
    const freezeAt = new Date(
      round.ends_at_exclusive.getTime() + round.reward_finalization_grace_period_seconds * 1e3
    );
    if (input.now < freezeAt) {
      throw new RewardAccountingError("REWARD_GRACE_ACTIVE", "Reward grace period has not ended.");
    }
    await client.query(
      `insert into reward_buffer_state (id, balance_lamports) values ('PRIMARY', 0)
       on conflict (id) do nothing`
    );
    const buffer = (await client.query(
      `select balance_lamports from reward_buffer_state where id = 'PRIMARY' for update`
    )).rows[0];
    const fees = (await client.query(
      `select coalesce(sum(creator_fee_lamports), 0)::text total
         from creator_fee_events
         where hourly_round_id = $1 and verification_status = 'VERIFIED'
           and accounting_status = 'ATTRIBUTED'`,
      [input.hourlyRoundId]
    )).rows[0];
    const historyRows = (await client.query(
      `select p.hourly_round_id, r.starts_at, r.ends_at_exclusive, p.natural_hourly_lamports
         from hourly_reward_pools p join hourly_rounds r on r.id = p.hourly_round_id
         where p.status in ('FROZEN','FINAL') and r.starts_at < $1
         order by r.starts_at desc limit $2`,
      [round.starts_at, config2.baselineWindow]
    )).rows;
    const history = historyRows.map((row) => ({
      hourlyRoundId: identifier(row.hourly_round_id, "HourlyRoundId"),
      startsAt: row.starts_at.toISOString(),
      endsAtExclusive: row.ends_at_exclusive.toISOString(),
      naturalHourlyLamports: BigInt(
        row.natural_hourly_lamports
      )
    }));
    const economics = processHourlyRewardEconomics({
      creatorFeeLamports: BigInt(fees.total),
      mode: config2.allocationMode,
      currentBufferLamports: BigInt(buffer.balance_lamports),
      previousCompletedNaturalHourlyRewards: history,
      config: runtimeCompetitionConfig(config2)
    });
    if (!economics.ok || !isHourlyRewardEconomicsConserved(economics.economics)) {
      throw new RewardAccountingError(
        "REWARD_ECONOMICS_INVALID",
        "Reward economics did not conserve."
      );
    }
    const value = economics.economics;
    const split = config2.allocationMode === "NORMAL" ? competitionConfig.creatorFees.normal : competitionConfig.creatorFees.bufferAccumulation;
    const poolId = `hourly-reward:${input.hourlyRoundId}`;
    const baselineIds = value.baseline.ok && value.baseline.status === "ACTIVE" ? value.baseline.includedHourlyRoundIds : [];
    await client.query(
      `insert into hourly_reward_pools
        (id,hourly_round_id,creator_fee_lamports,allocation_mode,natural_hourly_lamports,
         explicit_buffer_contribution_lamports,daily_allocation_lamports,platform_allocation_lamports,
         baseline_lamports,baseline_input_round_ids,baseline_window,lambda_bps,hourly_rate_bps,
         daily_rate_bps,buffer_rate_bps,platform_rate_bps,finalization_grace_seconds,
         dynamic_target_lamports,dynamic_buffer_deposit_lamports,dynamic_buffer_support_lamports,
         final_hourly_prize_lamports,starting_buffer_lamports,ending_buffer_lamports,
         configuration_version,status,finalized_at,frozen_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'FROZEN',$25,$25)`,
      [
        poolId,
        input.hourlyRoundId,
        value.creatorFeeTotalLamports.toString(),
        value.allocationMode,
        value.naturalHourlyLamports.toString(),
        value.explicitBufferLamports.toString(),
        value.dailyContributionLamports.toString(),
        value.platformContributionLamports.toString(),
        value.baseline.ok && value.baseline.status === "ACTIVE" ? value.baseline.baselineLamports.toString() : null,
        JSON.stringify(baselineIds),
        config2.baselineWindow,
        Number(config2.lambdaBps),
        Number(split.hourlyBps),
        Number(split.dailyBps),
        Number(split.bufferContributionBps),
        Number(split.platformBps),
        round.reward_finalization_grace_period_seconds,
        value.dynamicTargetLamports.toString(),
        value.dynamicDepositLamports.toString(),
        value.dynamicWithdrawalLamports.toString(),
        value.actualHourlyPrizeLamports.toString(),
        value.startingBufferLamports.toString(),
        value.endingBufferLamports.toString(),
        config2.configurationVersion,
        input.now
      ]
    );
    let movementBalance = value.startingBufferLamports;
    const movements = [
      { reason: "EXPLICIT_ACCUMULATION", amount: value.explicitBufferLamports },
      { reason: "DYNAMIC_EXCESS_DEPOSIT", amount: value.dynamicDepositLamports },
      { reason: "WEAK_HOUR_SUPPORT", amount: -value.dynamicWithdrawalLamports }
    ];
    for (const movement of movements) {
      if (movement.amount === 0n) continue;
      const ending = movementBalance + movement.amount;
      await client.query(
        `insert into reward_buffer_movements
          (id,hourly_reward_pool_id,reason,amount_lamports,starting_balance_lamports,ending_balance_lamports)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          `buffer:${input.hourlyRoundId}:${movement.reason}`,
          poolId,
          movement.reason,
          movement.amount.toString(),
          movementBalance.toString(),
          ending.toString()
        ]
      );
      movementBalance = ending;
    }
    await client.query(
      `update reward_buffer_state set balance_lamports = $1, updated_at = $2 where id = 'PRIMARY'`,
      [value.endingBufferLamports.toString(), input.now]
    );
    const daily = (await client.query(
      `select id from daily_competitions
         where starts_at <= $1 and ends_at_exclusive > $1 limit 1 for update`,
      [round.starts_at]
    )).rows[0];
    if (!daily)
      throw new RewardAccountingError("DAILY_POOL_NOT_FOUND", "Daily competition not found.");
    const dailyPoolId = `daily-reward:${daily.id}`;
    await client.query(
      `insert into daily_reward_pools (id,daily_competition_id) values ($1,$2)
       on conflict (daily_competition_id) do nothing`,
      [dailyPoolId, daily.id]
    );
    await client.query(
      `insert into daily_reward_contributions
        (id,daily_reward_pool_id,hourly_reward_pool_id,amount_lamports,contributed_at)
       values ($1,$2,$3,$4,$5)`,
      [
        `daily-contribution:${input.hourlyRoundId}`,
        dailyPoolId,
        poolId,
        value.dailyContributionLamports.toString(),
        input.now
      ]
    );
    await client.query(
      `update daily_reward_pools p set accumulated_lamports = q.total, updated_at = $2
       from (
         select daily_reward_pool_id, sum(amount_lamports) total
         from daily_reward_contributions where daily_reward_pool_id = $1
         group by daily_reward_pool_id
       ) q where p.id = q.daily_reward_pool_id`,
      [dailyPoolId, input.now]
    );
    await client.query(
      `update creator_fee_events set accounting_status = 'COUNTED'
       where hourly_round_id = $1 and verification_status = 'VERIFIED'
         and accounting_status = 'ATTRIBUTED'`,
      [input.hourlyRoundId]
    );
    await client.query("commit");
    return exactPool(await loadPool(client, input.hourlyRoundId));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
async function runRewardFinalizationTick(database2, now, config2 = defaultRewardAccountingConfig) {
  const eligible = await database2.pool.query(
    `select r.id from hourly_rounds r
     where r.ends_at_exclusive + make_interval(secs => r.reward_finalization_grace_period_seconds) <= $1
       and not exists (select 1 from hourly_reward_pools p where p.hourly_round_id = r.id)
     order by r.starts_at`,
    [now]
  );
  const finalized = [];
  for (const { id } of eligible.rows) {
    await finalizeHourlyRewardPool(database2, { hourlyRoundId: id, now, config: config2 });
    finalized.push(id);
  }
  return finalized;
}

// packages/db/src/creator-fee-ingestion.ts
var PUMP_TRADE_EVENT = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
var PUMP_BUY = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
var PUMP_BUY_EXACT_SOL_IN = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
var PUMP_SELL = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
var PUMP_BUY_V2 = Buffer.from([184, 23, 238, 97, 103, 197, 211, 61]);
var PUMP_BUY_EXACT_QUOTE_IN_V2 = Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]);
var PUMP_SELL_V2 = Buffer.from([93, 246, 130, 60, 231, 233, 64, 178]);
var PUMP_BUY_V3 = Buffer.from([7, 5, 29, 196, 245, 23, 101, 80]);
var PUMP_BUY_EXACT_QUOTE_IN_V3 = Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]);
var PUMP_SELL_V3 = Buffer.from([28, 146, 222, 119, 38, 196, 105, 213]);
var PUMP_AMM_BUY_EVENT = Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]);
var PUMP_AMM_SELL_EVENT = Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]);
var PUMP_AMM_BUY_EXACT_QUOTE_IN = Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]);
var NATIVE_SOL_QUOTE = "11111111111111111111111111111111";
var ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
function programAddress(seeds, programId) {
  return PublicKey14.findProgramAddressSync(
    seeds.map((seed) => typeof seed === "string" ? new PublicKey14(seed).toBuffer() : seed),
    new PublicKey14(programId)
  )[0].toBase58();
}
var CreatorFeeIngestionError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var Reader = class {
  constructor(value) {
    this.value = value;
  }
  value;
  #offset = 8;
  u8() {
    this.ensure(1);
    return this.value[this.#offset++];
  }
  u16() {
    this.ensure(2);
    const result = this.value.readUInt16LE(this.#offset);
    this.#offset += 2;
    return result;
  }
  u32() {
    this.ensure(4);
    const result = this.value.readUInt32LE(this.#offset);
    this.#offset += 4;
    return result;
  }
  u64() {
    this.ensure(8);
    const result = this.value.readBigUInt64LE(this.#offset);
    this.#offset += 8;
    return result;
  }
  i64() {
    this.ensure(8);
    const result = this.value.readBigInt64LE(this.#offset);
    this.#offset += 8;
    return result;
  }
  i128() {
    this.ensure(16);
    this.#offset += 16;
  }
  publicKey() {
    this.ensure(32);
    const result = bs585.encode(this.value.subarray(this.#offset, this.#offset + 32));
    this.#offset += 32;
    return result;
  }
  string() {
    const length = this.u32();
    this.ensure(length);
    const result = this.value.subarray(this.#offset, this.#offset + length).toString("utf8");
    this.#offset += length;
    return result;
  }
  ensure(length) {
    if (this.#offset + length > this.value.length) {
      throw new CreatorFeeIngestionError("MALFORMED_EVENT", "Creator-fee event is truncated.");
    }
  }
};
function decodePumpEvent(data) {
  const value = new Reader(data);
  const tokenMint = value.publicKey();
  value.u64();
  value.u64();
  value.u8();
  const user = value.publicKey();
  const timestamp2 = value.i64();
  value.u64();
  value.u64();
  value.u64();
  value.u64();
  value.publicKey();
  value.u64();
  value.u64();
  const creatorWallet = value.publicKey();
  value.u64();
  const creatorFeeLamports = value.u64();
  value.u8();
  value.u64();
  value.u64();
  value.u64();
  value.i64();
  const instructionName = value.string();
  value.u8();
  value.u64();
  const cashbackLamports = value.u64();
  value.u64();
  value.u64();
  const shareholders = value.u32();
  for (let index2 = 0; index2 < shareholders; index2 += 1) {
    value.publicKey();
    value.u16();
  }
  const quoteMint = value.publicKey();
  value.u64();
  value.u64();
  value.u64();
  const holderRewardsBps = value.u64();
  const holderRewardsLamports = value.u64();
  if (quoteMint !== WRAPPED_SOL_MINT && quoteMint !== NATIVE_SOL_QUOTE) {
    throw new CreatorFeeIngestionError("UNSUPPORTED_QUOTE_MINT", "Pump trade quote is not SOL.");
  }
  return {
    sourceProgram: PUMP_PROGRAM_ID,
    user,
    quoteMint,
    tokenMint,
    creatorWallet,
    creatorFeeLamports,
    protocolEventTimestamp: timestamp2,
    instructionName,
    holderRewardsBps,
    holderRewardsLamports,
    cashbackLamports
  };
}
function decodePumpSwapEvent(data, kind) {
  const value = new Reader(data);
  const timestamp2 = value.i64();
  for (let index2 = 0; index2 < 13; index2 += 1) value.u64();
  const pool = value.publicKey();
  value.publicKey();
  value.publicKey();
  value.publicKey();
  value.publicKey();
  value.publicKey();
  const creatorWallet = value.publicKey();
  value.u64();
  const creatorFeeLamports = value.u64();
  if (kind === "buy") {
    value.u8();
    value.u64();
    value.u64();
    value.u64();
    value.i64();
    value.u64();
    value.string();
  }
  value.u64();
  const cashbackLamports = value.u64();
  value.u64();
  value.u64();
  value.i128();
  value.u8();
  value.u64();
  const holderRewardsBps = value.u64();
  const holderRewardsLamports = value.u64();
  return {
    sourceProgram: PUMP_AMM_PROGRAM_ID,
    tokenMint: "",
    creatorWallet,
    creatorFeeLamports,
    protocolEventTimestamp: timestamp2,
    instructionName: kind,
    pool,
    holderRewardsBps,
    holderRewardsLamports,
    cashbackLamports
  };
}
function accountKeys(transaction) {
  const staticKeys = transaction.transaction.message.accountKeys.map(
    (key3) => typeof key3 === "string" ? key3 : key3.pubkey
  );
  const loaded = transaction.meta?.loadedAddresses;
  return [...staticKeys, ...loaded?.writable ?? [], ...loaded?.readonly ?? []];
}
function allInstructions(transaction) {
  return [
    ...transaction.transaction.message.instructions,
    ...transaction.meta?.innerInstructions?.flatMap((group) => group.instructions) ?? []
  ];
}
function discriminatorIs(data, expected) {
  try {
    return Buffer.from(bs585.decode(data)).subarray(0, 8).equals(expected);
  } catch {
    return false;
  }
}
function bindEventToInstruction(event, transaction) {
  const keys = accountKeys(transaction);
  for (const instruction of allInstructions(transaction)) {
    const program2 = keys[instruction.programIdIndex];
    if (program2 !== event.sourceProgram) continue;
    if (program2 === PUMP_PROGRAM_ID) {
      const isSell = discriminatorIs(instruction.data, PUMP_SELL);
      const isV2 = discriminatorIs(instruction.data, PUMP_BUY_V2) || discriminatorIs(instruction.data, PUMP_BUY_EXACT_QUOTE_IN_V2) || discriminatorIs(instruction.data, PUMP_SELL_V2);
      const isTrade = discriminatorIs(instruction.data, PUMP_BUY) || discriminatorIs(instruction.data, PUMP_BUY_EXACT_SOL_IN) || isSell || isV2;
      const isV3 = discriminatorIs(instruction.data, PUMP_BUY_V3) || discriminatorIs(instruction.data, PUMP_BUY_EXACT_QUOTE_IN_V3) || discriminatorIs(instruction.data, PUMP_SELL_V3);
      if (isV3) {
        const curve = programAddress([Buffer.from("bonding-curve"), event.tokenMint], PUMP_PROGRAM_ID);
        const quote = keys[instruction.accounts[2]];
        const quoteProgram = keys[instruction.accounts[4]];
        const associatedQuote = quote && quoteProgram ? programAddress([curve, quoteProgram, quote], ASSOCIATED_TOKEN_PROGRAM_ID) : "";
        if (keys[instruction.accounts[1]] === event.tokenMint && quote === WRAPPED_SOL_MINT && (event.quoteMint === WRAPPED_SOL_MINT || event.quoteMint === NATIVE_SOL_QUOTE) && keys[instruction.accounts[5]] === curve && keys[instruction.accounts[7]] === associatedQuote && keys[instruction.accounts[8]] === event.user) return event;
        continue;
      }
      const creatorVaultIndex = isSell ? 8 : 9;
      const expectedCreatorVault = programAddress(
        [Buffer.from("creator-vault"), event.creatorWallet],
        PUMP_PROGRAM_ID
      );
      if (isV2) {
        const quoteMint = keys[instruction.accounts[2]];
        const quoteTokenProgram = keys[instruction.accounts[4]];
        const expectedAssociatedCreatorVault = quoteMint && quoteTokenProgram ? programAddress(
          [expectedCreatorVault, quoteTokenProgram, quoteMint],
          ASSOCIATED_TOKEN_PROGRAM_ID
        ) : "";
        if (keys[instruction.accounts[1]] === event.tokenMint && quoteMint === WRAPPED_SOL_MINT && keys[instruction.accounts[16]] === expectedCreatorVault && keys[instruction.accounts[17]] === expectedAssociatedCreatorVault) {
          return event;
        }
        continue;
      }
      if (isTrade && keys[instruction.accounts[2]] === event.tokenMint && keys[instruction.accounts[creatorVaultIndex]] === expectedCreatorVault) {
        return event;
      }
    } else {
      const isTrade = discriminatorIs(instruction.data, PUMP_BUY) || discriminatorIs(instruction.data, PUMP_AMM_BUY_EXACT_QUOTE_IN) || discriminatorIs(instruction.data, PUMP_SELL);
      if (isTrade && keys[instruction.accounts[0]] === event.pool && keys[instruction.accounts[4]] === WRAPPED_SOL_MINT) {
        const quoteTokenProgram = keys[instruction.accounts[12]];
        const expectedAuthority = programAddress(
          [Buffer.from("creator_vault"), event.creatorWallet],
          PUMP_AMM_PROGRAM_ID
        );
        const expectedVault = quoteTokenProgram ? programAddress(
          [expectedAuthority, quoteTokenProgram, WRAPPED_SOL_MINT],
          ASSOCIATED_TOKEN_PROGRAM_ID
        ) : "";
        if (keys[instruction.accounts[17]] === expectedVault && keys[instruction.accounts[18]] === expectedAuthority) {
          return { ...event, tokenMint: keys[instruction.accounts[3]] ?? "" };
        }
      }
    }
  }
  return null;
}
function eventProgramAtLogs(logs) {
  const stack = [];
  return logs.map((log2) => {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(log2);
    if (invoke) stack.push(invoke[1]);
    const current2 = stack.at(-1) ?? null;
    if (/^Program \S+ (success|failed:)/.test(log2)) stack.pop();
    return current2;
  });
}
function parsePumpCreatorFeeEvents(transactionSignature, transaction, identity, observedAt = /* @__PURE__ */ new Date()) {
  if (transaction.meta?.err !== null || transaction.blockTime === null || !transaction.meta)
    return [];
  const logs = transaction.meta.logMessages ?? [];
  const activePrograms = eventProgramAtLogs(logs);
  const events = [];
  for (let eventIndex = 0; eventIndex < logs.length; eventIndex += 1) {
    const match = /^Program data: (\S+)$/.exec(logs[eventIndex]);
    if (!match) continue;
    let data;
    try {
      data = Buffer.from(match[1], "base64");
    } catch {
      continue;
    }
    let decoded = null;
    if (activePrograms[eventIndex] === PUMP_PROGRAM_ID && data.subarray(0, 8).equals(PUMP_TRADE_EVENT)) {
      decoded = decodePumpEvent(data);
    } else if (activePrograms[eventIndex] === PUMP_AMM_PROGRAM_ID && data.subarray(0, 8).equals(PUMP_AMM_BUY_EVENT)) {
      decoded = decodePumpSwapEvent(data, "buy");
    } else if (activePrograms[eventIndex] === PUMP_AMM_PROGRAM_ID && data.subarray(0, 8).equals(PUMP_AMM_SELL_EVENT)) {
      decoded = decodePumpSwapEvent(data, "sell");
    }
    if (decoded) decoded = bindEventToInstruction(decoded, transaction);
    if (!decoded || decoded.tokenMint !== identity.tokenMint || decoded.creatorWallet !== identity.creatorWallet || decoded.creatorFeeLamports <= 0n || decoded.holderRewardsBps !== 0n || decoded.holderRewardsLamports !== 0n || decoded.cashbackLamports !== 0n) {
      continue;
    }
    events.push({
      transactionSignature,
      eventIndex,
      slot: BigInt(transaction.slot),
      eventTime: new Date(transaction.blockTime * 1e3),
      creatorFeeLamports: decoded.creatorFeeLamports,
      sourceProgram: decoded.sourceProgram,
      tokenProjectIdentity: decoded.tokenMint,
      observedAt,
      normalizedMetadata: {
        creatorWallet: decoded.creatorWallet,
        protocolEventTimestamp: decoded.protocolEventTimestamp.toString(),
        instructionName: decoded.instructionName,
        ...decoded.pool ? { pool: decoded.pool } : {},
        evidence: "official-anchor-event-plus-matching-trade-instruction"
      },
      verificationStatus: "VERIFIED"
    });
  }
  return events;
}
var SolanaJsonRpcClient = class {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
  }
  url;
  options;
  #lastRequestAt = 0;
  #id = 0;
  async call(method, params) {
    const attempts = this.options.maxAttempts ?? 4;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const delay = Math.max(
        0,
        (this.options.minimumRequestIntervalMs ?? 75) - (Date.now() - this.#lastRequestAt)
      );
      if (delay > 0) await new Promise((resolve2) => setTimeout(resolve2, delay));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 1e4);
      try {
        this.#lastRequestAt = Date.now();
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.#id, method, params }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status.toString()}`);
        const payload = await response.json();
        if (payload.error)
          throw new Error(`RPC ${payload.error.code.toString()}: ${payload.error.message}`);
        if (payload.result === void 0) throw new Error("RPC response omitted result.");
        return payload.result;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          this.options.onRetry?.({
            method,
            attempt,
            maxAttempts: attempts,
            message: safeErrorMessage(error, [this.url], "Unknown RPC failure")
          });
          await new Promise((resolve2) => setTimeout(resolve2, Math.min(2e3, 125 * 2 ** attempt)));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new CreatorFeeIngestionError(
      "RPC_UNAVAILABLE",
      safeErrorMessage(lastError, [this.url], "Solana RPC request failed.")
    );
  }
  getSignaturesForAddress(address3, options) {
    return this.call("getSignaturesForAddress", [
      address3,
      { ...options, commitment: "confirmed" }
    ]);
  }
  getTransaction(signature) {
    return this.call("getTransaction", [
      signature,
      { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }
    ]);
  }
  async getSignatureStatuses(signatures) {
    const value = await this.call(
      "getSignatureStatuses",
      [signatures, { searchTransactionHistory: true }]
    );
    return value.value;
  }
  getSlot(commitment) {
    return this.call("getSlot", [{ commitment }]);
  }
};
var SolanaPumpCreatorFeeSource = class {
  constructor(rpc, identity, network, pageSize = 50) {
    this.rpc = rpc;
    this.identity = identity;
    this.network = network;
    this.pageSize = pageSize;
    if (!identity.tokenMint || !identity.creatorWallet) {
      throw new CreatorFeeIngestionError(
        "FUNDING_IDENTITY_REQUIRED",
        "PAPERFUND_TOKEN_MINT and PAPERFUND_CREATOR_WALLET are required."
      );
    }
    try {
      new PublicKey14(identity.tokenMint);
      new PublicKey14(identity.creatorWallet);
    } catch {
      throw new CreatorFeeIngestionError(
        "INVALID_FUNDING_IDENTITY",
        "Paperfund token mint and creator wallet must be valid Solana public keys."
      );
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new CreatorFeeIngestionError(
        "INVALID_PAGE_SIZE",
        "Page size must be between 1 and 100."
      );
    }
    this.id = `SOLANA_PUMP:${network}:${identity.tokenMint}`;
  }
  rpc;
  identity;
  network;
  pageSize;
  id;
  async discover(options = {}) {
    const signatures = await this.rpc.getSignaturesForAddress(this.identity.tokenMint, {
      ...options.before ? { before: options.before } : {},
      ...options.until ? { until: options.until } : {},
      limit: options.limit ?? this.pageSize
    });
    const discovered = [];
    for (const record of [...signatures].reverse()) {
      if (record.err !== null) continue;
      const transaction = await this.rpc.getTransaction(record.signature);
      if (!transaction) {
        throw new CreatorFeeIngestionError(
          "TRANSACTION_UNAVAILABLE",
          `Transaction ${record.signature} was discovered but is not readable.`
        );
      }
      const events = parsePumpCreatorFeeEvents(record.signature, transaction, this.identity);
      const status = record.confirmationStatus ?? "processed";
      for (const event of events) discovered.push({ event, confirmationStatus: status });
    }
    return { signatures, events: discovered };
  }
  async discoverSince(until, maxTransactions = 1e4) {
    if (!until) return this.discover();
    const signatures = [];
    let before;
    let reachedCheckpoint = false;
    while (signatures.length < maxTransactions) {
      const limit = Math.min(this.pageSize, maxTransactions - signatures.length);
      const page = await this.rpc.getSignaturesForAddress(this.identity.tokenMint, {
        ...before ? { before } : {},
        until,
        limit
      });
      signatures.push(...page);
      if (page.length < limit) {
        reachedCheckpoint = true;
        break;
      }
      before = page.at(-1).signature;
    }
    if (!reachedCheckpoint) {
      throw new CreatorFeeIngestionError(
        "DISCOVERY_WINDOW_EXCEEDED",
        "More than 10,000 signatures accumulated since the checkpoint; run a bounded backfill before following."
      );
    }
    const discovered = [];
    for (const record of [...signatures].reverse()) {
      if (record.err !== null) continue;
      const transaction = await this.rpc.getTransaction(record.signature);
      if (!transaction) {
        throw new CreatorFeeIngestionError(
          "TRANSACTION_UNAVAILABLE",
          `Transaction ${record.signature} was discovered but is not readable.`
        );
      }
      const events = parsePumpCreatorFeeEvents(record.signature, transaction, this.identity);
      const status = record.confirmationStatus ?? "processed";
      for (const event of events) discovered.push({ event, confirmationStatus: status });
    }
    return { signatures, events: discovered };
  }
  async read() {
    const result = await this.discover();
    return result.events.filter((item) => item.confirmationStatus === "finalized").map((item) => item.event);
  }
};
function observationId(signature, eventIndex) {
  return `fee-observation:${createHash19("sha256").update(`${signature}:${eventIndex.toString()}`).digest("hex")}`;
}
async function recordFinding(database2, observation, category, detail, now) {
  await database2.pool.query(
    `insert into creator_fee_reconciliation_findings
       (id,creator_fee_observation_id,category,detail,detected_at)
     values ($1,$2,$3,$4,$5)
     on conflict (creator_fee_observation_id,category) do update
       set detail=excluded.detail, detected_at=excluded.detected_at, status='OPEN'`,
    [`finding:${observation.id}:${category}`, observation.id, category, detail, now]
  );
}
async function promoteFinalized(database2, event, now) {
  const result = await ingestCreatorFeeEvents(database2, new FixtureCreatorFeeSource([event]));
  const canonical = await database2.pool.query(
    `select id from creator_fee_events where transaction_signature=$1 and event_index=$2`,
    [event.transactionSignature, event.eventIndex]
  );
  await database2.pool.query(
    `update creator_fee_observations
     set confirmation_status='FINALIZED', finalized_at=coalesce(finalized_at,$3),
         shadow_mode=false,missing_status_checks=0,last_checked_at=$3, updated_at=$3,
         canonical_creator_fee_event_id=$4
     where transaction_signature=$1 and event_index=$2`,
    [event.transactionSignature, event.eventIndex, now, canonical.rows[0].id]
  );
  return result;
}
async function finalizeObservation(database2, event, now, shadowMode) {
  if (!shadowMode) return promoteFinalized(database2, event, now);
  const round = (await database2.pool.query(
    `select r.id,exists(select 1 from hourly_reward_pools p where p.hourly_round_id=r.id) frozen
       from hourly_rounds r where r.starts_at <= $1 and r.ends_at_exclusive > $1
       order by r.starts_at desc limit 1`,
    [event.eventTime]
  )).rows[0];
  const shadowAttribution = {
    hourlyRoundId: round?.id ?? null,
    accountingStatus: !round ? "INELIGIBLE" : round.frozen ? "LATE_AFTER_FREEZE" : "ATTRIBUTED"
  };
  await database2.pool.query(
    `update creator_fee_observations
     set confirmation_status='FINALIZED',shadow_mode=true,finalized_at=coalesce(finalized_at,$3),
         missing_status_checks=0,last_checked_at=$3,updated_at=$3,
         evidence=evidence || jsonb_build_object('shadowAttribution',$4::jsonb)
     where transaction_signature=$1 and event_index=$2`,
    [event.transactionSignature, event.eventIndex, now, JSON.stringify(shadowAttribution)]
  );
  return { inserted: 0, duplicates: 0 };
}
async function reconcilePending(database2, source, now, shadowMode) {
  const pending = await database2.pool.query(
    `select id,transaction_signature,event_index,slot,creator_fee_lamports,source_program
     from creator_fee_observations
     where confirmation_status in ('OBSERVED','CONFIRMED')
       and token_mint=$1 and creator_wallet=$2
     order by slot limit 100`,
    [source.identity.tokenMint, source.identity.creatorWallet]
  );
  if (pending.rows.length === 0)
    return { finalized: 0, finalizedObserved: 0, duplicates: 0, rolledBack: 0 };
  const statuses = await source.rpc.getSignatureStatuses(
    pending.rows.map((row) => row.transaction_signature)
  );
  let finalized = 0;
  let duplicates = 0;
  let rolledBack = 0;
  let finalizedObserved = 0;
  for (let index2 = 0; index2 < pending.rows.length; index2 += 1) {
    const row = pending.rows[index2];
    const status = statuses[index2];
    if (!status) {
      const missing = await database2.pool.query(
        `update creator_fee_observations
         set missing_status_checks=missing_status_checks+1,last_checked_at=$2,updated_at=$2
         where id=$1 returning missing_status_checks`,
        [row.id, now]
      );
      if (missing.rows[0].missing_status_checks < 3) continue;
      await database2.pool.query(
        `update creator_fee_observations set confirmation_status='ROLLED_BACK',last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now]
      );
      rolledBack += 1;
      continue;
    }
    if (status.err !== null) {
      await database2.pool.query(
        `update creator_fee_observations set confirmation_status='ROLLED_BACK',missing_status_checks=0,last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now]
      );
      rolledBack += 1;
      continue;
    }
    if (status.confirmationStatus !== "finalized") {
      await database2.pool.query(
        `update creator_fee_observations set confirmation_status=$2,missing_status_checks=0,last_checked_at=$3,updated_at=$3 where id=$1`,
        [row.id, status.confirmationStatus === "confirmed" ? "CONFIRMED" : "OBSERVED", now]
      );
      continue;
    }
    const transaction = await source.rpc.getTransaction(row.transaction_signature);
    const event = transaction ? parsePumpCreatorFeeEvents(
      row.transaction_signature,
      transaction,
      source.identity,
      now
    ).find((item) => item.eventIndex === row.event_index) : void 0;
    if (!event || event.slot !== BigInt(row.slot) || event.creatorFeeLamports !== BigInt(row.creator_fee_lamports) || event.sourceProgram !== row.source_program) {
      await database2.pool.query(
        `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now]
      );
      await recordFinding(
        database2,
        row,
        transaction ? "FINALIZED_EVIDENCE_CHANGED" : "FINALIZED_TRANSACTION_MISSING",
        "Finalized transaction evidence did not match the previously observed creator-fee event.",
        now
      );
      continue;
    }
    const result = await finalizeObservation(database2, event, now, shadowMode);
    finalizedObserved += 1;
    finalized += result.inserted;
    duplicates += result.duplicates;
  }
  return { finalized, finalizedObserved, duplicates, rolledBack };
}
async function auditFinalized(database2, source, now) {
  const rows = await database2.pool.query(
    `select id,transaction_signature,event_index,slot,creator_fee_lamports,source_program,
            shadow_mode,canonical_creator_fee_event_id
     from creator_fee_observations where confirmation_status='FINALIZED'
       and token_mint=$1 and creator_wallet=$2
       and last_checked_at <= $3
     order by slot desc limit 100`,
    [source.identity.tokenMint, source.identity.creatorWallet, new Date(now.getTime() - 6e4)]
  );
  if (rows.rows.length === 0) return 0;
  const statuses = await source.rpc.getSignatureStatuses(
    rows.rows.map((row) => row.transaction_signature)
  );
  let findings = 0;
  for (let index2 = 0; index2 < rows.rows.length; index2 += 1) {
    const row = rows.rows[index2];
    const status = statuses[index2];
    let category = null;
    let detail = "";
    if (!status) {
      const missing = await database2.pool.query(
        `update creator_fee_observations
         set missing_status_checks=missing_status_checks+1,last_checked_at=$2,updated_at=$2
         where id=$1 returning missing_status_checks`,
        [row.id, now]
      );
      if (missing.rows[0].missing_status_checks < 3) continue;
      category = "FINALIZED_TRANSACTION_MISSING";
      detail = "A locally finalized creator-fee transaction is no longer finalized on the RPC.";
    } else if (status.err !== null || status.confirmationStatus !== "finalized") {
      category = "FINALIZED_TRANSACTION_MISSING";
      detail = "A locally finalized creator-fee transaction is no longer finalized on the RPC.";
    } else if (!row.shadow_mode && !row.canonical_creator_fee_event_id) {
      category = "CANONICAL_EVENT_MISSING";
      detail = "A finalized observation has no canonical creator-fee event link.";
    } else {
      if (!row.shadow_mode) {
        const canonical = await database2.pool.query(`select slot,creator_fee_lamports,source_program from creator_fee_events where id=$1`, [
          row.canonical_creator_fee_event_id
        ]);
        const value = canonical.rows[0];
        if (!value) {
          category = "CANONICAL_EVENT_MISSING";
          detail = "The canonical creator-fee event linked from the observation is missing.";
        } else if (value.slot !== row.slot || value.creator_fee_lamports !== row.creator_fee_lamports || value.source_program !== row.source_program) {
          category = "CANONICAL_EVENT_MISMATCH";
          detail = "Canonical creator-fee data differs from finalized observation evidence.";
        }
      }
      if (!category) {
        const transaction = await source.rpc.getTransaction(row.transaction_signature);
        const event = transaction ? parsePumpCreatorFeeEvents(
          row.transaction_signature,
          transaction,
          source.identity,
          now
        ).find((item) => item.eventIndex === row.event_index) : void 0;
        if (!event || event.slot !== BigInt(row.slot) || event.creatorFeeLamports !== BigInt(row.creator_fee_lamports) || event.sourceProgram !== row.source_program) {
          category = transaction ? "FINALIZED_EVIDENCE_CHANGED" : "FINALIZED_TRANSACTION_MISSING";
          detail = "Refetched finalized transaction evidence differs from the stored observation.";
        }
      }
    }
    if (category) {
      await database2.pool.query(
        `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now]
      );
      await recordFinding(database2, row, category, detail, now);
      findings += 1;
    } else {
      await database2.pool.query(
        "update creator_fee_observations set missing_status_checks=0,last_checked_at=$2,updated_at=$2 where id=$1",
        [row.id, now]
      );
    }
  }
  return findings;
}
async function runCreatorFeeIngestionTick(database2, source, now = /* @__PURE__ */ new Date(), options = {}) {
  const shadowMode = options.shadowMode ?? false;
  const checkpoint = await database2.pool.query(
    "select latest_signature,latest_slot::text from creator_fee_ingestion_checkpoints where source_id=$1",
    [source.id]
  );
  const resumedFromSignature = checkpoint.rows[0]?.latest_signature ?? null;
  const discovery = await source.discoverSince(resumedFromSignature ?? void 0);
  const candidates = discovery.signatures.length;
  const acceptedSignatures = new Set(
    discovery.events.map((item) => item.event.transactionSignature)
  ).size;
  const rejected = Math.max(0, candidates - acceptedSignatures);
  let finalized = 0;
  let finalizedObserved = 0;
  let duplicates = 0;
  for (const item of discovery.events) {
    const event = item.event;
    const status = item.confirmationStatus === "finalized" ? "FINALIZED" : item.confirmationStatus === "confirmed" ? "CONFIRMED" : "OBSERVED";
    const observation = await database2.pool.query(
      `insert into creator_fee_observations
        (id,transaction_signature,event_index,slot,block_time,source_program,token_mint,
         creator_wallet,creator_fee_lamports,confirmation_status,shadow_mode,evidence,
         first_observed_at,last_checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       on conflict (transaction_signature,event_index) do update set
         last_checked_at=excluded.last_checked_at, updated_at=excluded.last_checked_at,
         shadow_mode=creator_fee_observations.shadow_mode or excluded.shadow_mode,
         confirmation_status=case
           when creator_fee_observations.confirmation_status in ('FINALIZED','RECONCILIATION_REQUIRED')
             then creator_fee_observations.confirmation_status
           else excluded.confirmation_status end
       where creator_fee_observations.slot=excluded.slot
         and creator_fee_observations.block_time=excluded.block_time
         and creator_fee_observations.source_program=excluded.source_program
         and creator_fee_observations.token_mint=excluded.token_mint
         and creator_fee_observations.creator_wallet=excluded.creator_wallet
         and creator_fee_observations.creator_fee_lamports=excluded.creator_fee_lamports
       returning id,confirmation_status`,
      [
        observationId(event.transactionSignature, event.eventIndex),
        event.transactionSignature,
        event.eventIndex,
        event.slot.toString(),
        event.eventTime,
        event.sourceProgram,
        event.tokenProjectIdentity,
        source.identity.creatorWallet,
        event.creatorFeeLamports.toString(),
        status,
        shadowMode,
        event.normalizedMetadata ?? {},
        now
      ]
    );
    if (observation.rowCount === 0) {
      const conflict = await database2.pool.query(
        `select id from creator_fee_observations where transaction_signature=$1 and event_index=$2`,
        [event.transactionSignature, event.eventIndex]
      );
      const conflictRow = conflict.rows[0];
      await database2.pool.query(
        `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
        [conflictRow.id, now]
      );
      await recordFinding(
        database2,
        conflictRow,
        "FINALIZED_EVIDENCE_CHANGED",
        "A chain identity was rediscovered with different creator-fee evidence.",
        now
      );
      continue;
    }
    if (status === "FINALIZED" && observation.rows[0].confirmation_status !== "RECONCILIATION_REQUIRED") {
      const result = await finalizeObservation(database2, event, now, shadowMode);
      finalizedObserved += 1;
      finalized += result.inserted;
      duplicates += result.duplicates;
    }
  }
  const pending = await reconcilePending(database2, source, now, shadowMode);
  finalized += pending.finalized;
  finalizedObserved += pending.finalizedObserved;
  duplicates += pending.duplicates;
  await auditFinalized(database2, source, now);
  const finalizedChainSlot = BigInt(await source.rpc.getSlot("finalized"));
  const newest = discovery.signatures[0];
  const latestObservedSlot = newest ? BigInt(newest.slot) : checkpoint.rows[0]?.latest_slot ? BigInt(checkpoint.rows[0].latest_slot) : finalizedChainSlot;
  const observedLagSlots = finalizedChainSlot > latestObservedSlot ? finalizedChainSlot - latestObservedSlot : 0n;
  const latestSignature = newest?.signature ?? resumedFromSignature;
  const checkpointMoved = latestSignature !== resumedFromSignature;
  await database2.pool.query(
    `insert into creator_fee_ingestion_checkpoints
      (source_id,network,token_mint,creator_wallet,latest_signature,latest_slot,last_finalized_slot,
       last_success_at,shadow_mode,poll_count,candidate_count,verified_count,rejected_count,
       max_observed_lag_slots,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,$8)
     on conflict (source_id) do update set
       latest_signature=coalesce(excluded.latest_signature,creator_fee_ingestion_checkpoints.latest_signature),
       latest_slot=coalesce(excluded.latest_slot,creator_fee_ingestion_checkpoints.latest_slot),
       last_finalized_slot=excluded.last_finalized_slot,last_success_at=excluded.last_success_at,
       shadow_mode=excluded.shadow_mode,poll_count=creator_fee_ingestion_checkpoints.poll_count+1,
       candidate_count=creator_fee_ingestion_checkpoints.candidate_count+excluded.candidate_count,
       verified_count=creator_fee_ingestion_checkpoints.verified_count+excluded.verified_count,
       rejected_count=creator_fee_ingestion_checkpoints.rejected_count+excluded.rejected_count,
       max_observed_lag_slots=greatest(creator_fee_ingestion_checkpoints.max_observed_lag_slots,excluded.max_observed_lag_slots),
       last_error_category=null,last_error_detail=null,updated_at=excluded.updated_at`,
    [
      source.id,
      source.network,
      source.identity.tokenMint,
      source.identity.creatorWallet,
      newest?.signature ?? null,
      newest?.slot ?? null,
      finalizedChainSlot.toString(),
      now,
      shadowMode,
      candidates,
      discovery.events.length,
      rejected,
      observedLagSlots.toString()
    ]
  );
  const reconciliation = await database2.pool.query(
    `select count(*)::text count from creator_fee_observations
     where confirmation_status='RECONCILIATION_REQUIRED' and token_mint=$1 and creator_wallet=$2`,
    [source.identity.tokenMint, source.identity.creatorWallet]
  );
  return {
    shadowMode,
    candidates,
    discovered: discovery.events.length,
    rejected,
    finalizedObserved,
    finalized,
    duplicates,
    rolledBack: pending.rolledBack,
    reconciliationRequired: Number(reconciliation.rows[0].count),
    latestSignature,
    resumedFromSignature,
    checkpointMoved,
    observedLagSlots,
    finalizedChainSlot
  };
}
async function recordCreatorFeeIngestionFailure(database2, source, error, now = /* @__PURE__ */ new Date(), options = {}) {
  const category = error instanceof CreatorFeeIngestionError ? error.code : "CREATOR_FEE_INGESTION_FAILED";
  const detail = safeErrorMessage(
    error,
    [process.env["SOLANA_RPC_URL"]],
    "Unknown creator-fee ingestion failure"
  );
  await database2.pool.query(
    `insert into creator_fee_ingestion_checkpoints
      (source_id,network,token_mint,creator_wallet,last_error_category,last_error_detail,
       shadow_mode,retry_error_count,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (source_id) do update set
       last_error_category=excluded.last_error_category,last_error_detail=excluded.last_error_detail,
       shadow_mode=excluded.shadow_mode,
       retry_error_count=creator_fee_ingestion_checkpoints.retry_error_count+excluded.retry_error_count,
       updated_at=excluded.updated_at`,
    [
      source.id,
      source.network,
      source.identity.tokenMint,
      source.identity.creatorWallet,
      category,
      detail,
      options.shadowMode ?? false,
      options.retryErrors ?? 0,
      now
    ]
  );
}
async function recordCreatorFeeIngestionRetries(database2, source, retryErrors, now = /* @__PURE__ */ new Date()) {
  if (retryErrors <= 0) return;
  await database2.pool.query(
    `update creator_fee_ingestion_checkpoints
     set retry_error_count=retry_error_count+$2,updated_at=$3
     where source_id=$1`,
    [source.id, retryErrors, now]
  );
}

// packages/db/src/payout-treasury.ts
import { AsyncLocalStorage as AsyncLocalStorage4 } from "node:async_hooks";

// packages/db/src/payout-approval.ts
import { createHash as createHash20 } from "node:crypto";
import { PublicKey as PublicKey15 } from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@solana/web3.js/lib/index.cjs.js";

// packages/db/src/payout-treasury.ts
var scope = new AsyncLocalStorage4();

// packages/db/src/payout-security.ts
import { AsyncLocalStorage as AsyncLocalStorage5 } from "node:async_hooks";
import { createPublicKey, verify } from "node:crypto";
var current = new AsyncLocalStorage5();

// packages/db/src/payout-execution.ts
import {
  Connection,
  PublicKey as PublicKey16,
  SystemInstruction,
  SystemProgram,
  Transaction
} from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/@solana/web3.js/lib/index.cjs.js";
import bs586 from "../../operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/runtime/node_modules/bs58/src/cjs/index.cjs";

// apps/api/src/chart-fx-live.ts
import { createHash as createHash21 } from "node:crypto";

// apps/api/src/chart-fx.ts
import { createHash as createHash22 } from "node:crypto";
var SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
var CHART_FX_VERSION = "HISTORICAL_FX_AT_EXECUTION_V1";
var unavailable2 = (reason) => ({ status: "UNAVAILABLE", reason });
var PythHistoricalFxProvider = class {
  constructor(key3 = () => process.env["PYTH_API_KEY"], fetcher = fetch, now = Date.now) {
    this.key = key3;
    this.fetcher = fetcher;
    this.now = now;
  }
  key;
  fetcher;
  now;
  cache = /* @__PURE__ */ new Map();
  requests = [];
  lookup(time) {
    const seconds = Math.floor(time.getTime() / 1e3);
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      return Promise.resolve(unavailable2("INVALID_FILL_TIMESTAMP"));
    if (!this.key()) return Promise.resolve(unavailable2("HISTORICAL_FX_PROVIDER_NOT_CONFIGURED"));
    const cached = this.cache.get(seconds);
    if (cached && cached.expires > this.now()) return cached.value;
    const value = this.read(seconds);
    if (this.cache.size >= 1e3) this.cache.delete(this.cache.keys().next().value);
    const item = { expires: this.now() + 3e4, value };
    this.cache.set(seconds, item);
    void value.then((result) => {
      if (result.status === "AVAILABLE") item.expires = Infinity;
    });
    return value;
  }
  async read(seconds) {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.requests = this.requests.filter((t) => this.now() - t < 1e4);
      if (this.requests.length >= 10) return unavailable2("HISTORICAL_FX_RATE_LIMITED");
      this.requests.push(this.now());
      try {
        const response = await this.fetcher(
          `https://pyth.dourolabs.app/hermes/v2/updates/price/${seconds}?ids[]=${SOL_USD_FEED}`,
          {
            headers: { Authorization: `Bearer ${this.key()}` },
            signal: AbortSignal.timeout(700)
          }
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 403)
            return unavailable2("HISTORICAL_FX_PROVIDER_UNAUTHORIZED");
          if (response.status === 404) return unavailable2("HISTORICAL_FX_UNAVAILABLE");
          if (response.status !== 429 && response.status < 500)
            return unavailable2("HISTORICAL_FX_PROVIDER_REJECTED");
          if (attempt === 2) return unavailable2("HISTORICAL_FX_PROVIDER_UNAVAILABLE");
        } else {
          const raw = await response.json();
          const quote = raw.parsed?.find((p) => p.id === SOL_USD_FEED)?.price;
          if (!quote || !/^\d+$/.test(quote.price) || BigInt(quote.price) <= 0n || !/^\d+$/.test(quote.conf) || BigInt(quote.conf) >= BigInt(quote.price) || !Number.isInteger(quote.expo) || Math.abs(quote.expo) > 18 || !Number.isSafeInteger(quote.publish_time) || quote.publish_time < seconds || quote.publish_time - seconds > 5)
            return unavailable2("INVALID_HISTORICAL_FX");
          const digits = quote.price.padStart(-quote.expo + 1, "0");
          const rate = quote.expo >= 0 ? quote.price + "0".repeat(quote.expo) : `${digits.slice(0, quote.expo)}.${digits.slice(quote.expo)}`;
          return {
            status: "AVAILABLE",
            version: CHART_FX_VERSION,
            source: "PYTH_HERMES_TIMESTAMP",
            feedId: SOL_USD_FEED,
            requestedAt: new Date(seconds * 1e3).toISOString(),
            fxAt: new Date(quote.publish_time * 1e3).toISOString(),
            rate,
            rawPrice: quote.price,
            exponent: quote.expo,
            confidence: quote.conf,
            retrievedAt: new Date(this.now()).toISOString(),
            responseHash: createHash22("sha256").update(JSON.stringify(raw)).digest("hex")
          };
        }
      } catch {
        if (attempt === 2) return unavailable2("HISTORICAL_FX_PROVIDER_UNAVAILABLE");
      }
      await new Promise((resolve2) => setTimeout(resolve2, 50 * (attempt + 1)));
    }
    return unavailable2("HISTORICAL_FX_UNAVAILABLE");
  }
};
var provider = new PythHistoricalFxProvider();

// apps/api/isolated/verified-routes/operational/bootstrap.ts
var assert = (v, reason) => {
  if (!v) throw Error("MIXED_BOOTSTRAP_" + reason);
};
function installDrain(directory, role, drain) {
  let busy = false;
  const request = join2(directory, role + "-drain.request.json");
  const timer2 = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const raw = JSON.parse(await readFile4(request, "utf8"));
        assert(
          raw?.schema === "PAPERFUND_DRAIN_V1" && typeof raw.requestId === "string",
          "DRAIN_REQUEST"
        );
        clearInterval(timer2);
        await drain();
        await mkdir2(directory, { recursive: true });
        const target = join2(directory, role + "-drained.json"), temp = target + "." + process.pid + ".tmp";
        await writeFile2(
          temp,
          JSON.stringify({
            requestId: raw.requestId,
            pid: process.pid,
            drainedAt: (/* @__PURE__ */ new Date()).toISOString()
          }) + "\n"
        );
        await rename(temp, target);
      } catch (e) {
        if (e.code !== "ENOENT") console.error("DRAIN_REQUEST_REJECTED");
      } finally {
        busy = false;
      }
    })();
  }, 250);
  return () => clearInterval(timer2);
}

// apps/worker/isolated/reward-bootstrap.ts
async function connectRewardRuntime(database2, baseline, config2) {
  if (!config2.PRIVATE_BETA_NON_PAYING || config2.PAYOUT_EXECUTION_ENABLED || config2.PAYOUT_SIGNER_TYPE !== "DISABLED")
    throw Error("REWARD_WORKER_NONPAYING_REQUIRED");
  const [file, pin] = process.argv.slice(2);
  if (!file || !path.isAbsolute(file) || !pin) throw Error("REWARD_WORKER_PINNED_PROFILE_REQUIRED");
  const raw = fs.readFileSync(file);
  if (createHash25("sha256").update(raw).digest("hex") !== pin)
    throw Error("REWARD_WORKER_PROFILE_PIN");
  const profile = JSON.parse(raw.toString("utf8")), scope2 = profile.rewardSettlement;
  if (profile.schema !== "PAPERFUND_PUBLIC_CURRENT_QUOTES_V1" || profile.nonPaying !== true || scope2?.model !== "DURABLE_QUOTE_V2" || typeof scope2.policyId !== "string" || !path.isAbsolute(profile.archiveDirectory) || !path.isAbsolute(profile.controlDirectory))
    throw Error("REWARD_WORKER_REVIEWED_SCOPE_REQUIRED");
  const policy = (await database2.pool.query(
    "select to_jsonb(p) policy from current_quote_settlement_policies p where id=$1",
    [scope2.policyId]
  )).rows[0]?.policy;
  if (config2.CREATOR_FEE_INGESTION_ENABLED && scope2.creatorFeeIngestion !== "APPROVED_EXISTING_PIPELINE_V1")
    throw Error("REWARD_INGESTION_SEPARATE_REVIEW_REQUIRED");
  const rpc = new FinalizedRpc(config2.SOLANA_RPC_URL, config2.SOLANA_RPC_TIMEOUT_MS);
  if (policy?.selection_version !== "DURABLE_QUOTE_V2" || policy.provider_id !== rpc.providerIdentity)
    throw Error("REWARD_WORKER_FUTURE_POLICY_REQUIRED");
  if ((await database2.pool.query("select stopped from payout_stop_state where singleton=true")).rows[0]?.stopped !== true)
    throw Error("REWARD_WORKER_FINANCIAL_STOP_REQUIRED");
  const archive = new FinalizedBankArchive(profile.archiveDirectory, true);
  const snapshots = currentSnapshots(
    { currentQuoteRouter, captureCurrentPumpRoute },
    src_exports,
    rpc,
    archive,
    baseline
  );
  const assembled = composePublicCurrentCutoffWorker(
    database2,
    baseline,
    scope2.policyId,
    rpc,
    snapshots
  );
  let stopping2 = false;
  let timer2;
  let active = Promise.resolve();
  const captureStatus = {
    model: "DURABLE_QUOTE_V2",
    lastSampleAt: null,
    positions: 0,
    failures: 0,
    serviceFailure: false
  };
  const tick2 = () => {
    active = assembled.capture(/* @__PURE__ */ new Date()).then((result) => {
      Object.assign(captureStatus, {
        lastSampleAt: (/* @__PURE__ */ new Date()).toISOString(),
        positions: result.positions,
        failures: result.failures.length,
        serviceFailure: false
      });
    }).catch(() => {
      captureStatus.serviceFailure = true;
    }).finally(() => {
      if (!stopping2) timer2 = setTimeout(tick2, 250);
    });
  };
  tick2();
  return {
    database: assembled.database,
    router: assembled.router,
    captureStatus,
    attachDrain: (drain) => installDrain(profile.controlDirectory, "worker", drain),
    async stop() {
      stopping2 = true;
      if (timer2) clearTimeout(timer2);
      await active;
    }
  };
}

// apps/worker/src/safe-diagnostics.ts
var sources = () => [process.env["SOLANA_RPC_URL"], process.env["SOLANA_WS_URL"]];
var safeWorkerErrorMessage = (error, fallback = "Unknown worker failure") => safeErrorMessage(error, sources(), fallback);
var workerDiagnosticJson = (value) => JSON.stringify(redactDiagnostic(value, sources()));

// apps/worker/src/index.ts
import { mkdir as mkdir3, rename as rename2, writeFile as writeFile3 } from "node:fs/promises";
import { dirname, isAbsolute as isAbsolute2, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var config = parseApplicationEnvironment(process.env);
var database = createDatabase(config.DATABASE_URL);
var genericCapability = new GenericCapability(database, {
  ...genericCapabilityOptions(config),
  systemSettlement: true
});
var router = createProductionExecutionRouter({
  genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
  genericPumpSwapBuysEnabled: false,
  genericAccessResolver: (mint, quote, settlement) => genericCapability.resolve(mint, quote, settlement),
  nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
  nonSolPumpSwapRoutes: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES,
  rpcUrl: config.SOLANA_RPC_URL,
  rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  commitment: config.SOLANA_COMMITMENT
});
var rewardRuntime = await connectRewardRuntime(database, router, config);
database = rewardRuntime.database;
router = rewardRuntime.router;
var creatorFeeSource = config.CREATOR_FEE_INGESTION_ENABLED ? new SolanaPumpCreatorFeeSource(
  new SolanaJsonRpcClient(config.SOLANA_RPC_URL, {
    timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
    maxAttempts: config.CREATOR_FEE_RPC_MAX_ATTEMPTS,
    minimumRequestIntervalMs: config.CREATOR_FEE_RPC_MIN_INTERVAL_MS,
    onRetry: ({ method, attempt, maxAttempts, message }) => {
      creatorFeeRetryErrors += 1;
      log("error", "creator_fee_rpc_retry", { method, attempt, maxAttempts, message });
    }
  }),
  {
    tokenMint: config.PAPERFUND_TOKEN_MINT,
    creatorWallet: config.PAPERFUND_CREATOR_WALLET
  },
  config.CREATOR_FEE_NETWORK,
  config.CREATOR_FEE_PAGE_SIZE
) : null;
var stopping = false;
var timer;
var creatorFeeRetryErrors = 0;
var repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
var heartbeatPath = isAbsolute2(config.WORKER_HEARTBEAT_FILE) ? config.WORKER_HEARTBEAT_FILE : resolve(repositoryRoot, config.WORKER_HEARTBEAT_FILE);
var heartbeat = {
  genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
  genericPumpSwapEntriesArmed: config.GENERIC_PUMPSWAP_BUYS_ENABLED,
  genericOperatorCount: config.GENERIC_PUMPSWAP_OPERATOR_USER_IDS.length,
  nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
  nonSolPumpSwapAllowedMints: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES.map((r) => r.mint),
  processId: process.pid,
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  lastTickStartedAt: null,
  lastLifecycleSuccessAt: null,
  lastFeePollAt: null,
  lastError: null
};
async function writeHeartbeat() {
  Object.assign(heartbeat, { rewardCapture: rewardRuntime.captureStatus });
  const temporary = `${heartbeatPath}.${process.pid.toString()}.tmp`;
  await mkdir3(dirname(heartbeatPath), { recursive: true });
  await writeFile3(temporary, `${workerDiagnosticJson(heartbeat)}
`, {
    encoding: "utf8",
    mode: 384
  });
  await rename2(temporary, heartbeatPath);
}
function log(level, event, metadata) {
  const entry = workerDiagnosticJson({
    level,
    event,
    ...metadata,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (level === "error") console.error(entry);
  else console.log(entry);
}
async function tick() {
  heartbeat.lastTickStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (creatorFeeSource) {
    const retriesBeforeTick = creatorFeeRetryErrors;
    try {
      const result = await runCreatorFeeIngestionTick(database, creatorFeeSource, /* @__PURE__ */ new Date(), {
        shadowMode: config.CREATOR_FEE_SHADOW_MODE
      });
      const retryErrors = creatorFeeRetryErrors - retriesBeforeTick;
      await recordCreatorFeeIngestionRetries(database, creatorFeeSource, retryErrors);
      heartbeat.lastFeePollAt = (/* @__PURE__ */ new Date()).toISOString();
      heartbeat.lastError = null;
      log("info", "creator_fee_ingestion_tick", {
        ...result,
        observedLagSlots: result.observedLagSlots.toString(),
        finalizedChainSlot: result.finalizedChainSlot.toString(),
        retryErrors
      });
      if (result.rejected > 0)
        log("info", "creator_fee_candidates_rejected", {
          count: result.rejected,
          category: "NO_VERIFIED_CREATOR_FEE_EVENT"
        });
      if (result.reconciliationRequired > 0)
        log("error", "creator_fee_reconciliation_required", {
          count: result.reconciliationRequired
        });
    } catch (error) {
      try {
        await recordCreatorFeeIngestionFailure(database, creatorFeeSource, error, /* @__PURE__ */ new Date(), {
          shadowMode: config.CREATOR_FEE_SHADOW_MODE,
          retryErrors: creatorFeeRetryErrors - retriesBeforeTick
        });
      } catch (healthError) {
        log("error", "creator_fee_ingestion_health_write_failed", {
          message: safeWorkerErrorMessage(healthError, "Unknown health write failure")
        });
      }
      log("error", "creator_fee_ingestion_tick_failed", {
        errorCode: error instanceof Error && "code" in error ? String(error.code) : "INTERNAL_ERROR",
        message: safeWorkerErrorMessage(error, "Unknown creator-fee ingestion failure")
      });
      heartbeat.lastError = {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        scope: "creator_fee_ingestion",
        message: safeWorkerErrorMessage(error, "Unknown creator-fee ingestion failure")
      };
    }
  }
  try {
    const now = /* @__PURE__ */ new Date();
    const events = await runHourlyLifecycleTick(
      database,
      router,
      now,
      config.REWARD_FINALIZATION_GRACE_SECONDS
    );
    const rewardRounds = await runRewardFinalizationTick(database, now, {
      allocationMode: config.REWARD_ALLOCATION_MODE,
      baselineWindow: config.REWARD_BASELINE_WINDOW,
      lambdaBps: BigInt(config.REWARD_LAMBDA_BPS),
      configurationVersion: "phase-5a-v1"
    });
    const rewardDays = await runDailyRewardFinalizationTick(database, now);
    const payoutPlans2 = config.PRIVATE_BETA_NON_PAYING ? [] : await runPayoutPlanGenerationTick(database, now);
    for (const roundId of rewardRounds) log("info", "reward_pool_frozen", { roundId });
    for (const dailyCompetitionId of rewardDays)
      log("info", "daily_reward_pool_frozen", { dailyCompetitionId });
    for (const payoutPlanId of payoutPlans2)
      log("info", "shadow_payout_plan_validated", { payoutPlanId });
    for (const event of events) {
      log(
        event.type === "SETTLEMENT_OPERATIONAL_ERROR" ? "error" : "info",
        event.type.toLowerCase(),
        {
          roundId: event.roundId,
          failures: event.failures,
          failureDetails: event.failureDetails
        }
      );
    }
    const operationalError = events.find((event) => event.type === "SETTLEMENT_OPERATIONAL_ERROR");
    if (operationalError) {
      heartbeat.lastError = {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        scope: "settlement",
        message: `${operationalError.roundId}: ${operationalError.failureDetails?.[0]?.message ?? "Settlement requires operator intervention."}`
      };
    } else {
      heartbeat.lastLifecycleSuccessAt = (/* @__PURE__ */ new Date()).toISOString();
      if (!creatorFeeSource) heartbeat.lastError = null;
    }
  } catch (error) {
    log("error", "round_lifecycle_tick_failed", {
      errorCode: error instanceof Error && "code" in error ? String(error.code) : "INTERNAL_ERROR",
      message: safeWorkerErrorMessage(error, "Unknown worker failure")
    });
    heartbeat.lastError = {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      scope: "round_lifecycle",
      message: safeWorkerErrorMessage(error, "Unknown worker failure")
    };
  } finally {
    try {
      await writeHeartbeat();
    } catch (error) {
      log("error", "worker_heartbeat_write_failed", {
        message: safeWorkerErrorMessage(error, "Unknown heartbeat write failure")
      });
    }
    if (!stopping) timer = setTimeout(() => void tick(), config.WORKER_TICK_INTERVAL_MS);
  }
}
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  log("info", "worker_shutdown", { signal });
  detachRewardDrain();
  await rewardRuntime.stop();
  await database.close();
}
var detachRewardDrain = rewardRuntime.attachDrain(() => shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
log("info", "worker_started", {
  creatorFeeIngestionEnabled: config.CREATOR_FEE_INGESTION_ENABLED,
  creatorFeeShadowMode: config.CREATOR_FEE_SHADOW_MODE,
  creatorFeeNetwork: config.CREATOR_FEE_NETWORK,
  payoutNetwork: config.PAYOUT_NETWORK,
  payoutExecutionEnabled: config.PAYOUT_EXECUTION_ENABLED
});
await tick();
