/** Isolated linked engine: existing Orca behavior plus native canonical SOL PumpSwap bridge. */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { unpackAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ExecutionEngineError, type JsonObject } from '@paperfund/execution';
import {
  Stage1NonSolPumpSwap,
  stage1PoolSwap,
  validatePumpSwapMint,
  type Stage1Snapshot,
  type PoolMath,
  type ReplayPolicy,
} from '../../src/experimental/non-sol-pump-swap.js';
import {
  decodePumpBondingCurve,
  pumpBondingCurveAddress,
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from '../../src/pump-fun.js';
import {
  decodePumpSwapPool,
  decodePumpSwapGlobalConfig,
  decodePumpSwapFeeConfig,
  canonicalPumpSwapPoolAddress,
  pumpPoolAuthorityAddress,
  pumpSwapGlobalConfigAddress,
  pumpSwapFeeConfigAddress,
  PUMP_AMM_PROGRAM_ID,
} from '../../src/pump-swap.js';
import { ORCA_WHIRLPOOL_PROGRAM, quoteSupplementalHop } from '../../src/composed-pump-orca.js';
import type { CapturedAccount, PoolLink } from '../../src/solana-routes.js';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111',
  U64 = (1n << 64n) - 1n;
function fail(reason: string): never {
  throw new ExecutionEngineError('INVALID_MARKET_STATE', reason);
}
function u64(n: bigint) {
  if (typeof n !== 'bigint' || n < 0n || n > U64) fail('STAGE1_INVALID_U64');
  return n;
}
function dust(): never {
  throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'STAGE1_DUST');
}
const info = (a: CapturedAccount) => ({
  data: Buffer.from(a.base64, 'base64'),
  owner: new PublicKey(a.owner),
  executable: false,
  lamports: 0,
  rentEpoch: 0,
});
function need(s: Stage1Snapshot, address: string) {
  const a = s.accounts[address];
  if (!a) fail('STAGE1_REQUIRED_ACCOUNT_MISSING: ' + address);
  return a;
}
function vault(s: Stage1Snapshot, address: string, expectedMint: string, authority: string) {
  const a = need(s, address),
    program = need(s, expectedMint).owner;
  if (a.owner !== program) fail('STAGE1_VAULT_PROGRAM');
  const v = unpackAccount(new PublicKey(address), info(a), new PublicKey(program));
  if (
    !v.isInitialized ||
    v.isFrozen ||
    v.mint.toBase58() !== expectedMint ||
    v.owner.toBase58() !== authority
  )
    fail('STAGE1_VAULT_IDENTITY');
  return v;
}

/** Same canonical native validation as Stage1; SOL bridge uses the SOL market-cap fee vector. */
export async function validatePumpPool(
  s: Stage1Snapshot,
  poolAddress: string,
  baseMint: string,
  quoteMint: string,
) {
  if (quoteMint !== WRAPPED_SOL_MINT) {
    const curveAddress = await pumpBondingCurveAddress(baseMint),
      curveAccount = need(s, curveAddress);
    if (curveAccount.owner !== PUMP_PROGRAM_ID) fail('STAGE1_CURVE_OWNER');
    const curve = decodePumpBondingCurve(Buffer.from(curveAccount.base64, 'base64'));
    if (!curve.complete || curve.quoteMint !== quoteMint) fail('STAGE1_MIGRATION_IDENTITY');
  }
  const poolAccount = need(s, poolAddress),
    poolBytes = Buffer.from(poolAccount.base64, 'base64');
  if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || ![287, 300, 301].includes(poolBytes.length))
    fail('STAGE1_POOL_LAYOUT_UNSUPPORTED');
  const p = decodePumpSwapPool(poolBytes);
  if (
    poolAddress !== (await canonicalPumpSwapPoolAddress(baseMint, quoteMint)) ||
    p.index !== 0 ||
    p.creator !== (await pumpPoolAuthorityAddress(baseMint)) ||
    p.baseMint !== baseMint ||
    p.quoteMint !== quoteMint
  )
    fail('STAGE1_CANONICAL_IDENTITY');
  if (
    [243, 244, 269, 270].some((i) => poolBytes[i]! > 1) ||
    poolBytes.subarray(287).some((b) => b !== 0)
  )
    fail('STAGE1_POOL_FLAGS_OR_TAIL');
  if (p.isMayhemMode || p.isCashbackCoin || p.canEditCreatorFee || poolBytes[270]! > 1)
    fail('STAGE1_FLAGS_UNSUPPORTED');
  for (const address of [baseMint, quoteMint, WRAPPED_SOL_MINT]) validatePumpSwapMint(s, address);
  for (const [address, m] of [
    [p.baseVault, baseMint],
    [p.quoteVault, quoteMint],
  ])
    if (
      getAssociatedTokenAddressSync(
        new PublicKey(m!),
        new PublicKey(poolAddress),
        true,
        new PublicKey(need(s, m!).owner),
      ).toBase58() !== address
    )
      fail('STAGE1_TARGET_ATA');
  const base = vault(s, p.baseVault, baseMint, poolAddress),
    quote = vault(s, p.quoteVault, quoteMint, poolAddress);
  const globalAddress = await pumpSwapGlobalConfigAddress(),
    feeAddress = await pumpSwapFeeConfigAddress();
  if (
    need(s, globalAddress).owner !== PUMP_AMM_PROGRAM_ID ||
    need(s, feeAddress).owner !== PUMP_FEE_PROGRAM_ID
  )
    fail('STAGE1_CONFIG_OWNER');
  const globalBytes = Buffer.from(need(s, globalAddress).base64, 'base64'),
    g = decodePumpSwapGlobalConfig(globalBytes);
  if (
    globalBytes.length !== 949 ||
    g.disableFlags !== 0 ||
    [417, 642, 939, 940].some((i) => globalBytes[i]! > 1)
  )
    fail('STAGE1_GLOBAL_STATE_UNSUPPORTED');
  const fBytes = Buffer.from(need(s, feeAddress).base64, 'base64'),
    legacy = decodePumpSwapFeeConfig(fBytes);
  // Versioned vectors are packed consecutively. New fields are gated by total account size.
  let end = 69 + fBytes.readUInt32LE(65) * 40;
  if (fBytes.length >= 4073) {
    if (end + 4 > fBytes.length) fail('STAGE1_FEE_LAYOUT');
    end += 4 + fBytes.readUInt32LE(end) * 40;
  }
  let fees = legacy.flatFees;
  if (fBytes.length >= 4097) {
    if (end + 24 > fBytes.length) fail('STAGE1_FEE_LAYOUT');
    const exotic = {
      lpFeeBps: fBytes.readBigUInt64LE(end),
      protocolFeeBps: fBytes.readBigUInt64LE(end + 8),
      creatorFeeBps: fBytes.readBigUInt64LE(end + 16),
    };
    if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) fees = exotic;
  }
  if (![2512, 4073, 4097].includes(fBytes.length)) fail('STAGE1_FEE_LAYOUT_UNSUPPORTED');
  if (quoteMint === WRAPPED_SOL_MINT) {
    const cap =
      ((quote.amount + p.virtualQuoteReserves) * validatePumpSwapMint(s, baseMint).supply) /
      base.amount;
    fees = legacy.feeTiers[0]!.fees;
    for (const tier of legacy.feeTiers)
      if (cap >= tier.marketCapLamportsThreshold) fees = tier.fees;
  }
  const creator =
    g.creatorFeeConfigurable && p.creatorFeeBps > 0n ? p.creatorFeeBps : fees.creatorFeeBps;
  if (g.creatorFeeConfigurable && creator > g.maxConfigurableCreatorFeeBps)
    fail('STAGE1_CREATOR_FEE_LIMIT');
  const math: PoolMath = {
    base: base.amount,
    quote: quote.amount,
    virtual: p.virtualQuoteReserves,
    protocolBucket: poolBytes.readBigUInt64LE(271),
    creatorBucket: poolBytes.readBigUInt64LE(279),
    lpBps: fees.lpFeeBps,
    protocolBps: fees.protocolFeeBps,
    creatorBps: p.coinCreator === PublicKey.default.toBase58() ? 0n : creator,
    buybackBps: globalBytes.readBigUInt64LE(899),
  };

  // Reuse native range validation without inventing reserves or executing a swap.
  for (const value of [math.base, math.quote, math.protocolBucket, math.creatorBucket]) u64(value);
  if (
    math.base === 0n ||
    math.quote + math.virtual <= 0n ||
    math.quote + math.virtual > U64 ||
    math.protocolBucket + math.creatorBucket > math.quote ||
    math.virtual < -(1n << 127n) ||
    math.virtual >= 1n << 127n
  )
    fail('STAGE1_INVALID_RESERVES');
  if (
    [math.lpBps, math.protocolBps, math.creatorBps, math.buybackBps].some(
      (n) => n < 0n || n > 10000n,
    ) ||
    math.lpBps + math.protocolBps + math.creatorBps >= 10000n
  )
    fail('STAGE1_INVALID_FEES');
  return {
    math,
    pool: p,
    holderReward: poolBytes[270] === 1,
    baseDecimals: validatePumpSwapMint(s, baseMint).decimals,
    quoteDecimals: validatePumpSwapMint(s, quoteMint).decimals,
  };
}
export interface LinkedBridgeQuote {
  output: bigint;
  feeMint: string;
  lp: bigint;
  protocol: bigint;
  creator: bigint;
  detail: JsonObject;
  feeCategory?: string;
}
export type LinkedQuote = Omit<Awaited<ReturnType<Stage1NonSolPumpSwap['quote']>>, 'bridge'> & {
  bridge: LinkedBridgeQuote;
};
export class LinkedEngine {
  private readonly legacy: Stage1NonSolPumpSwap;
  private readonly binding: { quoteMint: string; pool: string } | undefined;
  constructor(options: ConstructorParameters<typeof Stage1NonSolPumpSwap>[0]) {
    this.legacy = new Stage1NonSolPumpSwap(options);
    this.binding = options?.bridgeBinding ? { ...options.bridgeBinding } : undefined;
  }
  async validate(s: Stage1Snapshot, policy: ReplayPolicy) {
    const capturedClock = Buffer.from(s.accounts[CLOCK]?.base64 ?? '', 'base64');
    if (capturedClock.length !== 40 || capturedClock.readBigUInt64LE(0) !== BigInt(s.slot))
      fail('STAGE1_CLOCK_INCONSISTENT');
    const direct = s.quoteMint === WRAPPED_SOL_MINT && s.targetPool === s.bridgePool;
    const owner = s.accounts[s.bridgePool]?.owner;
    if (owner === ORCA_WHIRLPOOL_PROGRAM) return this.legacy.validate(s, policy);
    if (owner !== PUMP_AMM_PROGRAM_ID) fail('LINKED_BRIDGE_PROGRAM_UNSUPPORTED');
    if (
      !this.binding ||
      this.binding.quoteMint !== s.quoteMint ||
      this.binding.pool !== s.bridgePool
    )
      fail('LINKED_BRIDGE_BINDING_REQUIRED');
    if (
      s.version !== 'NON_SOL_PUMPSWAP_STAGE1_V1' ||
      !Number.isSafeInteger(s.slot) ||
      s.slot < 0 ||
      s.mint === s.quoteMint ||
      (!direct && (s.quoteMint === WRAPPED_SOL_MINT || s.targetPool === s.bridgePool))
    )
      fail('LINKED_PUMP_ROUTE_IDENTITY');
    const at = Date.parse(s.observedAt);
    if (
      !Number.isFinite(at) ||
      !Number.isFinite(policy.nowMs) ||
      !Number.isFinite(policy.maxAgeMs) ||
      policy.maxAgeMs <= 0 ||
      at > policy.nowMs ||
      policy.nowMs - at > policy.maxAgeMs
    )
      fail('STAGE1_STALE_CAPTURE');
    const clock = Buffer.from(need(s, CLOCK).base64, 'base64');
    if (
      need(s, CLOCK).owner !== 'Sysvar1111111111111111111111111111111111111' ||
      clock.length !== 40 ||
      clock.readBigUInt64LE(0) > BigInt(s.slot)
    )
      fail('STAGE1_CLOCK_INCONSISTENT');
    const time = clock.readBigInt64LE(32),
      epoch = clock.readBigUInt64LE(16);
    if (
      BigInt(Math.floor(policy.nowMs)) < time * 1000n ||
      BigInt(Math.floor(policy.nowMs)) - time * 1000n > BigInt(Math.ceil(policy.maxAgeMs))
    )
      fail('STAGE1_STALE_BANK');
    if (s.absentAccounts.some((a) => s.accounts[a])) fail('STAGE1_ABSENT_ACCOUNT_CONFLICT');
    const target = await validatePumpPool(s, s.targetPool, s.mint, s.quoteMint),
      bridgePool = direct
        ? target
        : await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT);
    const bridge: PoolLink = {
      pool: s.bridgePool,
      program: PUMP_AMM_PROGRAM_ID,
      mintA: direct ? s.mint : s.quoteMint,
      mintB: WRAPPED_SOL_MINT,
      vaultA: bridgePool.pool.baseVault,
      vaultB: bridgePool.pool.quoteVault,
      config: await pumpSwapGlobalConfigAddress(),
    };
    return {
      math: target.math,
      bridge,
      time,
      epoch,
      holderReward: target.holderReward,
      baseDecimals: target.baseDecimals,
      quoteDecimals: target.quoteDecimals,
    };
  }
  async bridgeQuote(
    s: Stage1Snapshot,
    input: bigint,
    buy: boolean,
    policy: ReplayPolicy,
  ): Promise<LinkedBridgeQuote> {
    const v = await this.validate(s, policy);
    if (v.bridge.program !== PUMP_AMM_PROGRAM_ID)
      return quoteSupplementalHop(
        v.bridge,
        s.accounts,
        input,
        v.bridge.mintA === (buy ? WRAPPED_SOL_MINT : s.quoteMint),
        v.time,
        validatePumpSwapMint(s, s.quoteMint).supply,
        s.absentAccounts,
      );
    const bridge = await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT),
      q = stage1PoolSwap(bridge.math, input, buy);
    return {
      output: q.output,
      feeMint: WRAPPED_SOL_MINT,
      lp: q.fees.lp,
      protocol: q.fees.protocol,
      creator: q.fees.creator,
      detail: {
        bridgeKind: 'PUMP_SWAP',
        nativeInstruction: buy ? 'buy_exact_quote_in_v2' : 'sell_v2',
        bridgeCreatorFeeDestination: bridge.holderReward ? 'HOLDER_REWARD' : 'CREATOR',
        input: input.toString(),
        output: q.output.toString(),
        fees: Object.fromEntries(Object.entries(q.fees).map(([k, v]) => [k, v.toString()])),
        postTrade: Object.fromEntries(Object.entries(q.post).map(([k, v]) => [k, v.toString()])),
      },
    };
  }
  async quote(
    s: Stage1Snapshot,
    input: bigint,
    buy: boolean,
    policy: ReplayPolicy,
  ): Promise<LinkedQuote> {
    if (s.accounts[s.bridgePool]?.owner === ORCA_WHIRLPOOL_PROGRAM)
      return this.legacy.quote(s, input, buy, policy);
    const v = await this.validate(s, policy);
    u64(input);
    if (input === 0n) dust();
    if (s.quoteMint === WRAPPED_SOL_MINT && s.targetPool === s.bridgePool) {
      const target = stage1PoolSwap(v.math, input, buy);
      return {
        version: s.version,
        slot: s.slot,
        mint: s.mint,
        quoteMint: s.quoteMint,
        creatorFeeDestination: v.holderReward ? 'HOLDER_REWARD' : 'CREATOR',
        input,
        output: target.output,
        buy,
        target,
        bridge: {
          output: buy ? input : target.output,
          feeMint: WRAPPED_SOL_MINT,
          lp: 0n,
          protocol: 0n,
          creator: 0n,
          detail: { bridgeKind: 'DIRECT' },
        },
        baseDecimals: v.baseDecimals,
        quoteDecimals: v.quoteDecimals,
        fingerprint: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
      };
    }
    const bridge = buy ? await this.bridgeQuote(s, input, true, policy) : null,
      target = stage1PoolSwap(v.math, bridge?.output ?? input, buy),
      reverse = buy ? null : await this.bridgeQuote(s, target.output, false, policy);
    return {
      version: s.version,
      slot: s.slot,
      mint: s.mint,
      quoteMint: s.quoteMint,
      creatorFeeDestination: v.holderReward ? 'HOLDER_REWARD' : 'CREATOR',
      input,
      output: reverse?.output ?? target.output,
      buy,
      target,
      bridge: bridge ?? reverse!,
      baseDecimals: v.baseDecimals,
      quoteDecimals: v.quoteDecimals,
      fingerprint: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
    };
  }
  async exits(snapshot: Stage1Snapshot, quantity: bigint, policy: ReplayPolicy) {
    const s = structuredClone(snapshot);
    u64(quantity);
    if (quantity === 0n) dust();
    const read = async (q: bigint) => {
      try {
        return { quantity: q, quote: await this.quote(s, q, false, policy), reason: null };
      } catch (e) {
        if (
          !(e instanceof ExecutionEngineError) ||
          !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code)
        )
          throw e;
        return { quantity: q, quote: null, reason: e.code };
      }
    };
    const full = await read(quantity);
    let max = quantity;
    if (!full.quote) {
      let low = 0n,
        high = quantity;
      while (low < high) {
        const mid = (low + high + 1n) / 2n,
          r = await read(mid);
        if (r.reason === 'INSUFFICIENT_EXECUTABLE_LIQUIDITY') high = mid - 1n;
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
      percentages: await Promise.all([25n, 50n, 75n].map((p) => read((quantity * p) / 100n))),
    };
  }
}
