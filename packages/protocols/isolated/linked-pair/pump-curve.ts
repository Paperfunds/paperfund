/** Native V2 payout / V3 retained-fee curve leg, including V3 synthetic completion. */
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, unpackAccount } from '@solana/spl-token';
import { ExecutionEngineError } from '@paperfund/execution';
import {
  validatePumpSwapMint,
  type Stage1Snapshot,
  type ReplayPolicy,
} from '../../src/experimental/non-sol-pump-swap.js';
import {
  decodePumpBondingCurve,
  decodePumpGlobal,
  pumpBondingCurveAddress,
  pumpGlobalAddress,
  pumpFeeConfigAddress,
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from '../../src/pump-fun.js';
import { decodePumpSwapFeeConfig } from '../../src/pump-swap.js';
import type { PumpExternalSpec } from './pump-external.js';
const U64 = (1n << 64n) - 1n,
  ZERO = PublicKey.default.toBase58();
const fail = (s: string): never => {
  throw new ExecutionEngineError('INVALID_MARKET_STATE', s);
};
const fee = (n: bigint, b: bigint) => (n * b + 9999n) / 10000n;
export type CurveNativeAccount = Stage1Snapshot['accounts'][string] & { lamports?: string };
export type CurveTransfer = {
  from: string;
  to: string;
  amount: bigint;
  kind?: 'NATIVE_SYSTEM' | 'NATIVE_DIRECT';
};
function need(s: Stage1Snapshot, a: string) {
  const v = s.accounts[a];
  if (!v) fail('CURVE_DEPENDENCY_MISSING:' + a);
  return v!;
}
function token(s: Stage1Snapshot, a: string, m: string, owner: string) {
  const v = need(s, a),
    program = need(s, m).owner;
  if (v.owner !== program) fail('CURVE_TOKEN_PROGRAM');
  const t = unpackAccount(
    new PublicKey(a),
    {
      data: Buffer.from(v.base64, 'base64'),
      owner: new PublicKey(v.owner),
      lamports: 0,
      executable: false,
      rentEpoch: 0,
    },
    new PublicKey(program),
  );
  if (!t.isInitialized || t.isFrozen || t.mint.toBase58() !== m || t.owner.toBase58() !== owner)
    fail('CURVE_VAULT_IDENTITY');
  return t;
}
export async function validatePumpCurve(
  s: Stage1Snapshot,
  address: string,
  baseMint: string,
  quoteMint: string,
  allowComplete = false,
) {
  const captured = need(s, 'SysvarC1ock11111111111111111111111111111111'),
    clock = Buffer.from(captured.base64, 'base64');
  if (
    captured.owner !== 'Sysvar1111111111111111111111111111111111111' ||
    clock.length !== 40 ||
    !Number.isSafeInteger(s.slot) ||
    clock.readBigUInt64LE(0) !== BigInt(s.slot)
  )
    fail('CURVE_CLOCK_INCONSISTENT');
  const account = need(s, address),
    raw = Buffer.from(account.base64, 'base64');
  if (
    account.owner !== PUMP_PROGRAM_ID ||
    raw.length !== 166 ||
    address !== (await pumpBondingCurveAddress(baseMint))
  )
    fail('CURVE_IDENTITY_OR_LAYOUT');
  const c = decodePumpBondingCurve(raw);
  if (
    [48, 81, 82, 123, 124].some((i) => raw[i]! > 1) ||
    (!allowComplete && c.complete) ||
    c.isMayhemMode ||
    c.isCashbackCoin ||
    raw[123] !== 0 ||
    (!allowComplete && (raw.readBigUInt64LE(150) !== 0n || raw.readBigUInt64LE(158) !== 0n))
  )
    fail('CURVE_FLAGS_OR_COMPLETION_UNSUPPORTED');
  if ((c.quoteMint === ZERO ? WRAPPED_SOL_MINT : c.quoteMint) !== quoteMint)
    fail('CURVE_QUOTE_IDENTITY');
  const native = quoteMint === WRAPPED_SOL_MINT;
  const base = validatePumpSwapMint(s, baseMint),
    quote = validatePumpSwapMint(s, quoteMint);
  const ata = (mint: string) =>
    getAssociatedTokenAddressSync(
      new PublicKey(mint),
      new PublicKey(address),
      true,
      new PublicKey(need(s, mint).owner),
    ).toBase58();
  const baseVault = ata(baseMint),
    quoteVault = ata(quoteMint),
    bv = token(s, baseVault, baseMint, address),
    qv = native ? null : token(s, quoteVault, quoteMint, address);
  const ga = need(s, await pumpGlobalAddress()),
    fa = need(s, await pumpFeeConfigAddress()),
    g = Buffer.from(ga.base64, 'base64'),
    f = Buffer.from(fa.base64, 'base64');
  if (
    ga.owner !== PUMP_PROGRAM_ID ||
    fa.owner !== PUMP_FEE_PROGRAM_ID ||
    g.length !== 1088 ||
    f.length !== 4097
  )
    fail('CURVE_CONFIG_LAYOUT');
  decodePumpGlobal(g);
  const decoded = decodePumpSwapFeeConfig(f);
  let end = 69 + f.readUInt32LE(65) * 40;
  if (end + 4 > f.length) fail('CURVE_FEE_LAYOUT');
  const count = f.readUInt32LE(end);
  end += 4;
  if (end + count * 40 + 24 > f.length || f.subarray(end + count * 40 + 24).some((b) => b !== 0))
    fail('CURVE_FEE_LAYOUT');
  let rates = decoded.flatFees;
  if (native) {
    const cap = (1000000000000000n * c.virtualSolReserves) / c.virtualTokenReserves;
    if (!decoded.feeTiers.length) fail('CURVE_SOL_FEES_MISSING');
    rates = decoded.feeTiers[0]!.fees;
    for (const t of decoded.feeTiers) if (cap >= t.marketCapLamportsThreshold) rates = t.fees;
  } else if (quoteMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
    if (!count) fail('CURVE_STABLE_FEES_MISSING');
    const cap = (1000000000000000n * c.virtualSolReserves) / c.virtualTokenReserves;
    for (let i = 0; i < count; i++) {
      const p = end + i * 40,
        threshold = f.readBigUInt64LE(p) + (f.readBigUInt64LE(p + 8) << 64n);
      if (i === 0 || cap >= threshold)
        rates = {
          lpFeeBps: f.readBigUInt64LE(p + 16),
          protocolFeeBps: f.readBigUInt64LE(p + 24),
          creatorFeeBps: f.readBigUInt64LE(p + 32),
        };
    }
  } else {
    end += count * 40;
    const exotic = {
      lpFeeBps: f.readBigUInt64LE(end),
      protocolFeeBps: f.readBigUInt64LE(end + 8),
      creatorFeeBps: f.readBigUInt64LE(end + 16),
    };
    if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) rates = exotic;
  }
  if (g[1045]! > 1 || g[1086]! > 1 || (c.isHolderReward && g[1086] !== 1))
    fail('CURVE_GLOBAL_FLAGS');
  const creatorBps =
    c.creator === ZERO
      ? 0n
      : g[1045] === 1 && c.creatorFeeBps > 0n
        ? c.creatorFeeBps
        : rates.creatorFeeBps;
  const protocolBps = rates.protocolFeeBps,
    buybackBps = g.readBigUInt64LE(997),
    creatorBucket = raw.readBigUInt64LE(125),
    protocolBucket = raw.readBigUInt64LE(133);
  if (
    [creatorBps, protocolBps, buybackBps].some((x) => x > 10000n) ||
    creatorBps + protocolBps >= 10000n ||
    (g[1045] === 1 && creatorBps > g.readBigUInt64LE(1046))
  )
    fail('CURVE_FEE_RANGE');
  let rent = 0n,
    nativeBalance: bigint | undefined;
  if (native) {
    const l = (account as CurveNativeAccount).lamports,
      r = need(s, 'SysvarRent111111111111111111111111111111111'),
      b = Buffer.from(r.base64, 'base64');
    if (
      !l ||
      !/^\d+$/.test(l) ||
      r.owner !== 'Sysvar1111111111111111111111111111111111111' ||
      b.length !== 17 ||
      ![1, 2].includes(b.readDoubleLE(8))
    )
      fail('CURVE_NATIVE_LAMPORT_STATE_REQUIRED');
    nativeBalance = BigInt(l!);
    rent = BigInt(raw.length + 128) * b.readBigUInt64LE(0) * BigInt(b.readDoubleLE(8));
  }
  const quoteBalance = native ? nativeBalance! - rent : qv!.amount;
  if (
    c.virtualTokenReserves === 0n ||
    c.virtualSolReserves === 0n ||
    (!allowComplete && c.realTokenReserves === 0n) ||
    bv.amount < c.realTokenReserves ||
    quoteBalance < c.realSolReserves + creatorBucket + protocolBucket + raw.readBigUInt64LE(158) ||
    c.virtualSolReserves !== c.realSolReserves + raw.readBigUInt64LE(142)
  )
    fail('CURVE_RESERVES_INCOHERENT');
  return {
    curve: c,
    raw,
    baseVault,
    quoteVault,
    baseBalance: bv.amount,
    quoteBalance,
    native,
    rent,
    nativeBalance,
    migrationFee: g.readBigUInt64LE(146),
    baseDecimals: base.decimals,
    quoteDecimals: quote.decimals,
    creatorBps,
    protocolBps,
    buybackBps,
    creatorBucket,
    protocolBucket,
  };
}
/** Fees accrue separately from executable reserves; no LP fee exists on an active curve. */
export interface CurveExternalSpec extends PumpExternalSpec {
  baseMint: string;
  quoteMint: string;
  baseVault?: string;
  quoteVault?: string;
  nativeUser?: string;
  completionMode?: 'STANDALONE' | 'MULTI_HOP';
  payouts?: {
    protocolWallet: string;
    creatorVault: string;
    buybackWallet: string;
    sharingConfig: string;
  };
}
export async function transitionExternalCurve(
  snapshot: Stage1Snapshot,
  spec: CurveExternalSpec,
  policy: ReplayPolicy,
) {
  const s = structuredClone(snapshot),
    raw = Buffer.from(need(s, spec.pool).base64, 'base64'),
    c = decodePumpBondingCurve(raw);
  const baseMint = spec.baseMint;
  const v = await validatePumpCurve(s, spec.pool, baseMint, spec.quoteMint);
  if (
    (spec.baseVault && spec.baseVault !== v.baseVault) ||
    (spec.quoteVault && spec.quoteVault !== v.quoteVault)
  )
    fail('CURVE_INSTRUCTION_VAULT_BINDING');
  if (spec.legacy) {
    const a = spec.payouts,
      g = Buffer.from(need(s, await pumpGlobalAddress()).base64, 'base64');
    if (!a) fail('CURVE_V2_PAYOUT_BINDINGS_REQUIRED');
    const key = (at: number) => new PublicKey(g.subarray(at, at + 32)).toBase58();
    const protocolWallets = [key(41), ...Array.from({ length: 7 }, (_, i) => key(162 + i * 32))],
      buybackWallets = Array.from({ length: 8 }, (_, i) => key(741 + i * 32));
    const creatorVault = PublicKey.findProgramAddressSync(
        [Buffer.from('creator-vault'), new PublicKey(c.creator).toBuffer()],
        new PublicKey(PUMP_PROGRAM_ID),
      )[0].toBase58(),
      sharingConfig = PublicKey.findProgramAddressSync(
        [Buffer.from('sharing-config'), new PublicKey(baseMint).toBuffer()],
        new PublicKey(PUMP_FEE_PROGRAM_ID),
      )[0].toBase58();
    const destination = (owner: string) =>
      v.native
        ? owner
        : getAssociatedTokenAddressSync(
            new PublicKey(spec.quoteMint),
            new PublicKey(owner),
            true,
            new PublicKey(need(s, spec.quoteMint).owner),
          ).toBase58();
    if (
      !protocolWallets.includes(a!.protocolWallet) ||
      !buybackWallets.includes(a!.buybackWallet) ||
      a!.creatorVault !== creatorVault ||
      a!.sharingConfig !== sharingConfig ||
      spec.protocolRecipient !== destination(a!.protocolWallet) ||
      spec.creatorRecipient !== destination(creatorVault) ||
      spec.buybackRecipient !== destination(a!.buybackWallet)
    )
      fail('CURVE_V2_FEE_DESTINATION_BINDING');
  }
  const at = Date.parse(s.observedAt);
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(policy.nowMs) ||
    !Number.isFinite(policy.maxAgeMs) ||
    policy.maxAgeMs <= 0 ||
    policy.nowMs < at ||
    policy.nowMs - at > policy.maxAgeMs
  )
    fail('STALE_CURVE_EXTERNAL_STATE');
  if (spec.bound < 0n || spec.bound > U64) fail('CURVE_BOUND_RANGE');
  if (spec.amount <= 0n || spec.amount > U64) fail('CURVE_AMOUNT_RANGE');
  const tokenEnd = !spec.feeRole || ['TOKEN_END', 'BOTH'].includes(spec.feeRole),
    currencyEnd = !spec.feeRole || ['CURRENCY_END', 'BOTH'].includes(spec.feeRole);
  const cb = tokenEnd ? v.creatorBps : 0n,
    pb = currencyEnd ? v.protocolBps : 0n;
  let output: bigint,
    input = spec.amount,
    gross: bigint,
    protocol = 0n,
    creator = 0n,
    buyback = 0n,
    curveGross: bigint,
    postBase = 0n,
    postQuote = 0n;
  const net = (budget: bigint) => {
    let n = (budget * 10000n) / (10000n + pb + cb);
    const cost = n + fee(n, pb) + fee(n, cb);
    if (cost > budget) n -= cost - budget;
    return n;
  };
  const charge = (g: bigint) => {
    const p = fee(g, pb),
      cfee = fee(g, cb);
    protocol += p;
    creator += cfee;
    buyback += (p * v.buybackBps) / 10000n;
    return p + cfee;
  };
  if (spec.buy) {
    const n = spec.exactOutput ? 0n : net(input);
    if (!spec.exactOutput && n <= 1n)
      throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'CURVE_DUST');
    output = spec.exactOutput
      ? spec.amount
      : ((n - 1n) * c.virtualTokenReserves) / (c.virtualSolReserves + n - 1n);
    if (spec.legacy && output > c.realTokenReserves) fail('CURVE_V2_COMPLETION_OVERFLOW');
    const completing = output >= c.realTokenReserves;
    if (completing) {
      const remaining = c.realTokenReserves;
      curveGross = (remaining * c.virtualSolReserves) / (c.virtualTokenReserves - remaining) + 1n;
      const curveCost = curveGross + charge(curveGross),
        poolBase = v.baseBalance - remaining,
        poolQuote = c.realSolReserves + curveGross - (v.native ? v.migrationFee : 0n);
      if (poolBase <= 0n || poolQuote <= 0n) fail('CURVE_EMPTY_MIGRATION_POOL');
      if (spec.exactOutput) {
        postBase = output - remaining;
        if (postBase >= poolBase) fail('CURVE_POST_COMPLETE_LIQUIDITY');
        postQuote =
          postBase === 0n
            ? 0n
            : (poolQuote * postBase + poolBase - postBase - 1n) / (poolBase - postBase);
        input = curveCost + postQuote + charge(postQuote);
      } else {
        const left = input - curveCost;
        if (left < 0n) fail('CURVE_COMPLETION_BUDGET');
        const leg = net(left);
        postBase = leg > 1n ? ((leg - 1n) * poolBase) / (poolQuote + leg - 1n) : 0n;
        if (postBase === 0n && spec.completionMode !== 'MULTI_HOP') {
          // Published V3 standalone semantics: an unspendable remainder stays with the payer.
          input = curveCost;
          postQuote = 0n;
        } else {
          const legFees = charge(leg);
          postQuote = left - legFees;
        }
        output = remaining + postBase;
      }
      gross = curveGross + postQuote;
    } else if (spec.exactOutput) {
      curveGross = (output * c.virtualSolReserves) / (c.virtualTokenReserves - output) + 1n;
      gross = curveGross;
      input = gross + charge(gross);
    } else {
      charge(n);
      gross = input - protocol - creator;
      curveGross = gross;
    }
  } else {
    if (spec.exactOutput) fail('CURVE_SELL_EXACT_OUTPUT_UNSUPPORTED');
    gross = (input * c.virtualSolReserves) / (c.virtualTokenReserves + input);
    curveGross = gross;
    output = gross - charge(gross);
    if (gross > c.realSolReserves)
      throw new ExecutionEngineError(
        'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
        'CURVE_REAL_QUOTE_RESERVES',
      );
  }
  if (output <= 0n || gross <= 0n)
    throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'CURVE_DUST');
  if (spec.exactOutput ? input > spec.bound : output < spec.bound)
    fail('EXTERNAL_SIGNED_MINIMUM_VIOLATED');
  const curveTokens = spec.buy
    ? output < c.realTokenReserves
      ? output
      : c.realTokenReserves
    : input;
  const vb = spec.buy ? c.virtualTokenReserves - curveTokens : c.virtualTokenReserves + input,
    vq = spec.buy ? c.virtualSolReserves + curveGross : c.virtualSolReserves - gross;
  const rb = spec.buy ? c.realTokenReserves - curveTokens : c.realTokenReserves + input,
    rq = spec.buy ? c.realSolReserves + curveGross : c.realSolReserves - gross;
  const bb = spec.buy ? v.baseBalance - output : v.baseBalance + input,
    qb = spec.legacy
      ? spec.buy
        ? v.quoteBalance + gross
        : v.quoteBalance - gross
      : spec.buy
        ? v.quoteBalance + input - buyback
        : v.quoteBalance - output - buyback;
  const cbucket = v.creatorBucket + (spec.legacy ? 0n : creator),
    pbucket = v.protocolBucket + (spec.legacy ? 0n : protocol - buyback);
  for (const n of [input, output, vb, vq, rb, rq, bb, qb, cbucket, pbucket, postBase, postQuote])
    if (n < 0n || n > U64) fail('CURVE_SUCCESSOR_RANGE');
  for (const [offset, value] of [
    [8, vb],
    [16, vq],
    [24, rb],
    [32, rq],
    [125, cbucket],
    [133, pbucket],
    [150, postBase],
    [158, postQuote],
  ] as const)
    raw.writeBigUInt64LE(value, offset);
  raw[48] = rb === 0n ? 1 : 0;
  s.accounts[spec.pool] = {
    ...s.accounts[spec.pool]!,
    base64: raw.toString('base64'),
    ...(v.native ? { lamports: (qb + v.rent).toString() } : {}),
  };
  for (const [address, value] of (v.native
    ? [[v.baseVault, bb]]
    : [
        [v.baseVault, bb],
        [v.quoteVault, qb],
      ]) as [string, bigint][]) {
    const b = Buffer.from(s.accounts[address]!.base64, 'base64');
    b.writeBigUInt64LE(value, 64);
    s.accounts[address] = { ...s.accounts[address]!, base64: b.toString('base64') };
  }
  await validatePumpCurve(s, spec.pool, baseMint, spec.quoteMint, true);
  const transfers: CurveTransfer[] = [
    {
      from: spec.buy ? v.baseVault : spec.userBase,
      to: spec.buy ? spec.userBase : v.baseVault,
      amount: spec.buy ? output : input,
    },
  ];
  if (v.native && !spec.nativeUser) fail('CURVE_NATIVE_USER_MISSING');
  const transfer = (
    from: string,
    to: string,
    amount: bigint,
    nativeKind: 'NATIVE_SYSTEM' | 'NATIVE_DIRECT',
  ) => {
    if (amount > 0n) {
      if (!from || !to) fail('CURVE_FEE_DESTINATION_MISSING');
      transfers.push({ from, to, amount, ...(v.native ? { kind: nativeKind } : {}) });
    }
  };
  const user = v.native ? spec.nativeUser! : spec.userQuote,
    venue = v.native ? spec.pool : v.quoteVault,
    kind = spec.buy ? 'NATIVE_SYSTEM' : 'NATIVE_DIRECT';
  transfer(
    spec.buy ? user : venue,
    spec.buy ? venue : user,
    spec.buy ? (spec.legacy ? gross : input) : output,
    kind,
  );
  if (spec.legacy) {
    transfer(spec.buy ? user : venue, spec.protocolRecipient, protocol - buyback, kind);
    transfer(spec.buy ? user : venue, spec.creatorRecipient, creator, kind);
  }
  transfer(
    spec.legacy && spec.buy ? user : venue,
    spec.buybackRecipient,
    buyback,
    spec.legacy ? kind : 'NATIVE_DIRECT',
  );
  return {
    next: s,
    output,
    input,
    transfers: transfers.filter((t) => t.amount > 0n),
    quote: {
      input,
      output,
      grossQuote: gross,
      fees: { lp: 0n, protocol, creator, buyback },
      post: {
        base: bb,
        quote: qb,
        virtual: vq - rq,
        protocolBucket: pbucket,
        creatorBucket: cbucket,
        lpBps: 0n,
        protocolBps: pb,
        creatorBps: cb,
        buybackBps: v.buybackBps,
      },
    },
  };
}
