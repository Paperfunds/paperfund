import {
  LinkedEngine as Stage1NonSolPumpSwap,
  validatePumpPool,
  type LinkedBridgeQuote,
} from './engine.js';
import { PUMP_AMM_PROGRAM_ID } from '../../src/pump-swap.js';
/** Acceptance candidate only: no production exports, state store or entry authority. */
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { convertIdlToCamelCase } from '@coral-xyz/anchor/dist/cjs/idl.js';
import { WHIRLPOOL_IDL, PriceMath, SwapUtils, PoolUtil, PDAUtil } from '@orca-so/whirlpools-sdk';
import { TickArraySequence } from '@orca-so/whirlpools-sdk/dist/quotes/swap/tick-array-sequence.js';
import { FeeRateManager } from '@orca-so/whirlpools-sdk/dist/quotes/swap/fee-rate-manager.js';
import { computeSwapStep } from '@orca-so/whirlpools-sdk/dist/utils/math/swap-math.js';
import { createHash } from 'node:crypto';
import { readOrcaSnapshot, ORCA_WHIRLPOOL_PROGRAM } from '../../src/composed-pump-orca.js';
import { decodePumpSwapPool } from '../../src/pump-swap.js';
import { WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
import {
  type Stage1Snapshot,
  type ReplayPolicy,
  stage1PoolSwap,
} from '../../src/experimental/non-sol-pump-swap.js';

const U64 = (1n << 64n) - 1n,
  U128 = (1n << 128n) - 1n;
const codec = new BorshAccountsCoder(convertIdlToCamelCase(WHIRLPOOL_IDL));
const integer = (n: BN) => BigInt(n.toString());
const bn = (n: bigint) => new BN(n.toString());
export class LinkedTransitionError extends Error {
  readonly code = 'LINKED_STATE_TRANSITION_UNAVAILABLE';
}
const fail = (reason: string): never => {
  throw new LinkedTransitionError(reason);
};
const hash = (s: Stage1Snapshot) => createHash('sha256').update(JSON.stringify(s)).digest('hex');
function u64(n: bigint) {
  if (n < 0n || n > U64) fail('U64_RANGE');
  return n;
}
function engine(s: Stage1Snapshot) {
  return new Stage1NonSolPumpSwap({
    purpose: 'READ_ONLY_STAGE1_VALIDATION',
    bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool },
  });
}
function put(s: Stage1Snapshot, address: string, raw: Buffer) {
  const a = s.accounts[address];
  if (!a) return fail('ACCOUNT_MISSING');
  s.accounts[address] = { ...a, base64: raw.toString('base64') };
}
function setVault(s: Stage1Snapshot, address: string, amount: bigint) {
  const raw = Buffer.from(s.accounts[address]!.base64, 'base64');
  raw.writeBigUInt64LE(u64(amount), 64);
  put(s, address, raw);
}
async function encode(s: Stage1Snapshot, address: string, name: string, data: unknown) {
  const original = Buffer.from(s.accounts[address]!.base64, 'base64');
  const bytes = await codec.encode(name, data);
  if (bytes.length > original.length) fail('ACCOUNT_CODEC_CHANGED');
  bytes.copy(original);
  put(s, address, original);
}
/** Current chain changes cannot silently replace a paper branch or refill its liquidity. */
export function assertUnchangedExternalAnchor(anchor: Stage1Snapshot, fresh: Stage1Snapshot) {
  if (fresh.slot < anchor.slot || Date.parse(fresh.observedAt) < Date.parse(anchor.observedAt))
    fail('REGRESSING_ANCHOR');
  if (
    anchor.mint !== fresh.mint ||
    anchor.quoteMint !== fresh.quoteMint ||
    anchor.targetPool !== fresh.targetPool ||
    anchor.bridgePool !== fresh.bridgePool
  )
    fail('ROUTE_CHANGED');
  const addresses = Object.keys(anchor.accounts).filter(
    (a) => a !== 'SysvarC1ock11111111111111111111111111111111',
  );
  if (
    addresses.some(
      (a) => JSON.stringify(anchor.accounts[a]) !== JSON.stringify(fresh.accounts[a]),
    ) ||
    JSON.stringify(anchor.absentAccounts) !== JSON.stringify(fresh.absentAccounts)
  )
    fail('EXTERNAL_RECONCILIATION_REQUIRED');
  // Identical endpoint bytes cannot prove absence/order of intervening swaps.
  if (
    fresh.slot !== anchor.slot ||
    fresh.observedAt !== anchor.observedAt ||
    hash(fresh) !== hash(anchor)
  )
    fail('EXTERNAL_FRONTIER_UNPROVEN');
}
/** Pure successor calculation. Caller must atomically persist successor with the financial fill. */
export async function transitionLinkedSnapshot(
  snapshot: Stage1Snapshot,
  input: bigint,
  buy: boolean,
  policy: ReplayPolicy,
) {
  const s = structuredClone(snapshot),
    native = engine(s),
    valid = await native.validate(s, policy);
  const quote = await native.quote(s, input, buy, policy);
  const bridgeInput = buy ? input : quote.target.output;
  const bridgeReceipt =
    s.targetPool === s.bridgePool
      ? { totalFee: 0n, protocolFee: 0n }
      : await advanceBridge(s, valid, bridgeInput, buy, quote.bridge);
  applyTarget(s, quote.target);
  await native.validate(s, policy);
  return {
    next: s,
    quote,
    receipt: {
      model: 'LINKED_NATIVE_TRANSITION_CANDIDATE_V1',
      beforeHash: hash(snapshot),
      afterHash: hash(s),
      input: input.toString(),
      output: quote.output.toString(),
      side: buy ? 'BUY' : 'SELL',
      ...(valid.bridge.program === PUMP_AMM_PROGRAM_ID
        ? {
            bridgeKind: 'PUMP_SWAP',
            bridgeLpFee: quote.bridge.lp.toString(),
            bridgeProtocolFee: quote.bridge.protocol.toString(),
            bridgeCreatorOrHolderFee: quote.bridge.creator.toString(),
            bridgeFeeMint: quote.bridge.feeMint,
          }
        : {
            orcaFee: bridgeReceipt.totalFee.toString(),
            orcaProtocolFee: bridgeReceipt.protocolFee.toString(),
            orcaLpFee: (bridgeReceipt.totalFee - bridgeReceipt.protocolFee).toString(),
          }),
      sourceSlot: snapshot.slot,
    },
  };
}

async function advanceBridge(
  s: Stage1Snapshot,
  valid: Awaited<ReturnType<Stage1NonSolPumpSwap['validate']>>,
  bridgeInput: bigint,
  buy: boolean,
  expected: LinkedBridgeQuote,
) {
  if (valid.bridge.program === PUMP_AMM_PROGRAM_ID) {
    const v = await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT),
      q = stage1PoolSwap(v.math, bridgeInput, buy);
    if (
      q.output !== expected.output ||
      q.fees.lp !== expected.lp ||
      q.fees.protocol !== expected.protocol ||
      q.fees.creator !== expected.creator
    )
      fail('NATIVE_PUMP_BRIDGE_DISAGREEMENT');
    applyPool(s, s.bridgePool, q);
    return {
      totalFee: q.fees.lp + q.fees.protocol + q.fees.creator,
      protocolFee: q.fees.protocol,
      creatorFee: q.fees.creator,
    };
  }
  const fromSol = buy,
    aToB = valid.bridge.mintA === (fromSol ? WRAPPED_SOL_MINT : s.quoteMint);
  const { data, ticks, oracle } = readOrcaSnapshot(
    valid.bridge,
    s.accounts,
    aToB,
    s.absentAccounts,
  );
  const previousTime = integer(data.rewardLastUpdatedTimestamp);
  if (valid.time < previousTime) fail('REWARD_TIME_REGRESSION');
  if (!data.liquidity.isZero() && valid.time !== previousTime) {
    for (const reward of data.rewardInfos) {
      if (reward.mint.equals(PublicKey.default)) continue;
      // Orca checked_mul_div checks the u128 PRODUCT before division.
      const product = (valid.time - previousTime) * integer(reward.emissionsPerSecondX64);
      const delta = product > U128 ? 0n : product / integer(data.liquidity);
      reward.growthGlobalX64 = bn((integer(reward.growthGlobalX64) + delta) & U128);
    }
  }
  const sequence = new TickArraySequence(
    SwapUtils.interpolateUninitializedTickArrays(new PublicKey(s.bridgePool), ticks),
    data.tickSpacing,
    aToB,
  );
  if (!sequence.isValidTickArray0(data.tickCurrentIndex)) fail('TICK_RANGE_UNAVAILABLE');
  const manager = FeeRateManager.new(
    aToB,
    data.tickCurrentIndex,
    bn(valid.time),
    data.feeRate,
    PoolUtil.isInitializedWithAdaptiveFee(data) && oracle
      ? {
          adaptiveFeeConstants: oracle.adaptiveFeeConstants,
          adaptiveFeeVariables: oracle.adaptiveFeeVariables,
        }
      : null,
  );
  let remaining = bn(bridgeInput),
    output = 0n,
    totalFee = 0n,
    protocolFee = 0n;
  let liquidity = data.liquidity.clone();
  let sqrt = data.sqrtPrice.clone(),
    tick = data.tickCurrentIndex;
  let growth = integer(aToB ? data.feeGrowthGlobalA : data.feeGrowthGlobalB);
  const limit = SwapUtils.getDefaultSqrtPriceLimit(aToB);
  let steps = 0;
  while (!remaining.isZero() && !sqrt.eq(limit)) {
    if (++steps > 10000) fail('SWAP_STEP_BOUND');
    const { nextIndex } = sequence.findNextInitializedTickIndex(tick);
    const nextTickPrice = PriceMath.tickIndexToSqrtPriceX64(nextIndex);
    const target = aToB ? BN.max(limit, nextTickPrice) : BN.min(limit, nextTickPrice);
    do {
      manager.updateVolatilityAccumulator();
      const bounded = manager.getBoundedSqrtPriceTarget(target, liquidity);
      const step = computeSwapStep(
        remaining,
        manager.getTotalFeeRate(),
        liquidity,
        sqrt,
        bounded.boundedSqrtPriceTarget,
        true,
        aToB,
      );
      remaining = remaining.sub(step.amountIn).sub(step.feeAmount);
      if (remaining.isNeg()) fail('NEGATIVE_INPUT');
      output = u64(output + integer(step.amountOut));
      const fee = integer(step.feeAmount),
        protocol = (fee * BigInt(data.protocolFeeRate)) / 10000n;
      totalFee = u64(totalFee + fee);
      protocolFee = u64(protocolFee + protocol);
      if (!liquidity.isZero())
        growth = (growth + ((fee - protocol) << 64n) / integer(liquidity)) & U128;
      if (step.nextPrice.eq(nextTickPrice)) {
        const crossed = sequence.getTick(nextIndex);
        if (crossed.initialized) {
          crossed.feeGrowthOutsideA = bn(
            ((aToB ? growth : integer(data.feeGrowthGlobalA)) -
              integer(crossed.feeGrowthOutsideA)) &
              U128,
          );
          crossed.feeGrowthOutsideB = bn(
            ((aToB ? integer(data.feeGrowthGlobalB) : growth) -
              integer(crossed.feeGrowthOutsideB)) &
              U128,
          );
          crossed.rewardGrowthsOutside = crossed.rewardGrowthsOutside.map((outside, i) =>
            data.rewardInfos[i]!.mint.equals(PublicKey.default)
              ? outside
              : bn((integer(data.rewardInfos[i]!.growthGlobalX64) - integer(outside)) & U128),
          );
          const nextLiquidity =
            integer(liquidity) +
            (aToB ? -integer(crossed.liquidityNet) : integer(crossed.liquidityNet));
          if (nextLiquidity < 0n || nextLiquidity > U128) fail('LIQUIDITY_CROSS_RANGE');
          liquidity = bn(nextLiquidity);
          const array = ticks.find(
            (a) =>
              a.data &&
              nextIndex >= a.data.startTickIndex &&
              nextIndex < a.data.startTickIndex + 88 * data.tickSpacing,
          );
          if (!array?.data) fail('CROSSED_TICK_ACCOUNT_MISSING');
          patchCrossedTick(
            s,
            array!.address.toBase58(),
            Math.floor((nextIndex - array!.data!.startTickIndex) / data.tickSpacing),
            crossed,
          );
        }
        tick = aToB ? nextIndex - 1 : nextIndex;
      } else if (!step.nextPrice.eq(sqrt)) tick = PriceMath.sqrtPriceX64ToTickIndex(step.nextPrice);
      const progressed =
        !step.nextPrice.eq(sqrt) || !step.amountIn.isZero() || !step.feeAmount.isZero();
      sqrt = step.nextPrice;
      if (!bounded.adaptiveFeeUpdateSkipped) manager.advanceTickGroup();
      else manager.advanceTickGroupAfterSkip(sqrt, nextTickPrice, nextIndex);
      if (!progressed && !sqrt.eq(target)) fail('SWAP_NO_PROGRESS');
      if (++steps > 10000) fail('SWAP_STEP_BOUND');
    } while (!remaining.isZero() && !sqrt.eq(target));
  }
  if (!remaining.isZero()) fail('PARTIAL_ORCA_INPUT');
  if (
    output !== expected.output ||
    totalFee !== expected.lp ||
    sqrt.toString() !== String(expected.detail.endSqrtPrice) ||
    tick !== expected.detail.endTick
  )
    fail('NATIVE_QUOTE_DISAGREEMENT');
  data.sqrtPrice = sqrt;
  data.tickCurrentIndex = tick;
  data.liquidity = liquidity;
  data.rewardLastUpdatedTimestamp = bn(valid.time);
  if (aToB) {
    data.feeGrowthGlobalA = bn(growth);
    data.protocolFeeOwedA = bn(u64(integer(data.protocolFeeOwedA) + protocolFee));
  } else {
    data.feeGrowthGlobalB = bn(growth);
    data.protocolFeeOwedB = bn(u64(integer(data.protocolFeeOwedB) + protocolFee));
  }
  await encode(s, s.bridgePool, 'whirlpool', data);
  const nextAdaptive = manager.getNextAdaptiveFeeInfo();
  if (nextAdaptive && oracle) {
    oracle.adaptiveFeeVariables = nextAdaptive.adaptiveFeeVariables;
    const address = PDAUtil.getOracle(
      new PublicKey(ORCA_WHIRLPOOL_PROGRAM),
      new PublicKey(s.bridgePool),
    ).publicKey.toBase58();
    await encode(s, address, 'oracle', oracle);
  }
  const inputVault = aToB ? valid.bridge.vaultA : valid.bridge.vaultB,
    outputVault = aToB ? valid.bridge.vaultB : valid.bridge.vaultA;
  const amount = (address: string) =>
    Buffer.from(s.accounts[address]!.base64, 'base64').readBigUInt64LE(64);
  setVault(s, inputVault, amount(inputVault) + bridgeInput);
  setVault(s, outputVault, amount(outputVault) - output);
  return { totalFee, protocolFee };
}
function applyTarget(s: Stage1Snapshot, quote: ReturnType<typeof stage1PoolSwap>) {
  applyPool(s, s.targetPool, quote);
}
function applyPool(
  s: Stage1Snapshot,
  poolAddress: string,
  quote: ReturnType<typeof stage1PoolSwap>,
) {
  const pool = decodePumpSwapPool(Buffer.from(s.accounts[poolAddress]!.base64, 'base64'));
  const post = quote.post,
    raw = Buffer.from(s.accounts[poolAddress]!.base64, 'base64');
  setVault(s, pool.baseVault, post.base);
  setVault(s, pool.quoteVault, post.quote);
  const virtual = BigInt.asUintN(128, post.virtual);
  raw.writeBigUInt64LE(virtual & U64, 245);
  raw.writeBigUInt64LE(virtual >> 64n, 253);
  raw.writeBigUInt64LE(u64(post.protocolBucket), 271);
  raw.writeBigUInt64LE(u64(post.creatorBucket), 279);
  put(s, poolAddress, raw);
}

/** One genuine external swap affects one leg, not a fabricated two-leg round trip. */
export async function transitionLinkedLeg(
  snapshot: Stage1Snapshot,
  input: bigint,
  buy: boolean,
  policy: ReplayPolicy,
  leg: 'TARGET' | 'BRIDGE',
) {
  const s = structuredClone(snapshot),
    native = engine(s),
    valid = await native.validate(s, policy);
  let output: bigint;
  if (leg === 'TARGET') {
    const q = stage1PoolSwap(valid.math, input, buy);
    applyTarget(s, q);
    output = q.output;
  } else {
    const q = await native.bridgeQuote(s, input, buy, policy);
    await advanceBridge(s, valid, input, buy, q);
    output = q.output;
  }
  await native.validate(s, policy);
  return { next: s, output, beforeHash: hash(snapshot), afterHash: hash(s) };
}

function patchCrossedTick(
  s: Stage1Snapshot,
  address: string,
  index: number,
  tick: { feeGrowthOutsideA: BN; feeGrowthOutsideB: BN; rewardGrowthsOutside: BN[] },
) {
  const raw = Buffer.from(s.accounts[address]!.base64, 'base64'),
    disc = (name: string) =>
      createHash('sha256')
        .update('account:' + name)
        .digest()
        .subarray(0, 8);
  if (index < 0 || index >= 88) fail('CROSSED_TICK_INDEX');
  let offset: number;
  if (raw.subarray(0, 8).equals(disc('TickArray'))) offset = 12 + index * 113;
  else if (raw.subarray(0, 8).equals(disc('DynamicTickArray'))) {
    offset = 60;
    const bitmap = raw.readBigUInt64LE(44) + (raw.readBigUInt64LE(52) << 64n);
    for (let i = 0; i <= index; i++) {
      const tag = raw[offset];
      if (tag !== 0 && tag !== 1) fail('DYNAMIC_TICK_TAG');
      if (Boolean((bitmap >> BigInt(i)) & 1n) !== Boolean(tag)) fail('DYNAMIC_TICK_BITMAP');
      if (i < index) offset += tag === 1 ? 113 : 1;
    }
  } else return fail('CROSSED_TICK_CODEC_UNSUPPORTED');
  if (raw[offset] !== 1 || offset + 113 > raw.length) fail('CROSSED_TICK_NOT_INITIALIZED');
  const write = (at: number, value: BN) => {
    const n = integer(value) & U128;
    raw.writeBigUInt64LE(n & U64, at);
    raw.writeBigUInt64LE(n >> 64n, at + 8);
  };
  write(offset + 33, tick.feeGrowthOutsideA);
  write(offset + 49, tick.feeGrowthOutsideB);
  tick.rewardGrowthsOutside.forEach((v, i) => write(offset + 65 + i * 16, v));
  put(s, address, raw);
}
