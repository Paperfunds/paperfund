/** Native single-pool Pump instructions. Unknown multi-hop/boost mutations stay rejected. */
import { PublicKey } from '@solana/web3.js';
import {
  stage1PoolSwap,
  type Stage1Snapshot,
  type ReplayPolicy,
} from '../../src/experimental/non-sol-pump-swap.js';
import { validatePumpPool } from './engine.js';
import { decodePumpSwapPool } from '../../src/pump-swap.js';
export interface PumpExternalSpec {
  pool: string;
  feeRole?: 'CURRENCY_END' | 'TOKEN_END' | 'INTERMEDIATE' | 'BOTH';
  legacy: boolean;
  exactOutput: boolean;
  buy: boolean;
  amount: bigint;
  bound: bigint;
  userBase: string;
  userQuote: string;
  protocolRecipient: string;
  creatorRecipient: string;
  buybackRecipient: string;
}
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export async function transitionExternalPump(
  snapshot: Stage1Snapshot,
  spec: PumpExternalSpec,
  policy: ReplayPolicy,
) {
  const s = structuredClone(snapshot),
    p = decodePumpSwapPool(Buffer.from(s.accounts[spec.pool]!.base64, 'base64'));
  const v = await validatePumpPool(s, spec.pool, p.baseMint, p.quoteMint),
    m = { ...v.math };
  if (spec.feeRole) {
    const token = spec.feeRole === 'TOKEN_END' || spec.feeRole === 'BOTH',
      currency = spec.feeRole === 'CURRENCY_END' || spec.feeRole === 'BOTH';
    if (!token) {
      m.lpBps = 0n;
      m.creatorBps = 0n;
    }
    if (!currency) m.protocolBps = 0n;
  }
  // Validate chronology through the caller's engine; this routine only mutates this native leg.
  if (
    !Number.isFinite(policy.nowMs) ||
    !Number.isFinite(policy.maxAgeMs) ||
    policy.maxAgeMs <= 0 ||
    !Number.isFinite(Date.parse(s.observedAt)) ||
    policy.nowMs < Date.parse(s.observedAt) ||
    policy.nowMs - Date.parse(s.observedAt) > policy.maxAgeMs
  )
    throw Error('STALE_PUMP_EXTERNAL_STATE');
  let q: ReturnType<typeof stage1PoolSwap>;
  if (spec.exactOutput) {
    if (!spec.buy || spec.amount >= m.base || spec.amount <= 0n)
      throw Error('INVALID_PUMP_EXACT_OUTPUT');
    const curve = ((m.quote + m.virtual) * spec.amount) / (m.base - spec.amount) + 1n;
    const lp = ceil(curve * m.lpBps, 10000n),
      protocol = ceil(curve * m.protocolBps, 10000n),
      creator = ceil(curve * m.creatorBps, 10000n),
      buyback = (protocol * m.buybackBps) / 10000n,
      input = curve + lp + protocol + creator,
      retained = protocol - buyback + creator;
    q = {
      input,
      output: spec.amount,
      grossQuote: curve,
      fees: { lp, protocol, creator, buyback },
      post: {
        ...m,
        base: m.base - spec.amount,
        quote: m.quote + input - buyback,
        virtual: m.virtual - retained,
        protocolBucket: m.protocolBucket + protocol - buyback,
        creatorBucket: m.creatorBucket + creator,
      },
    };
  } else q = stage1PoolSwap(m, spec.amount, spec.buy);
  if (q.input < 1n || q.input > (1n << 64n) - 1n) throw Error('PUMP_EXTERNAL_INPUT_RANGE');
  if (spec.exactOutput ? q.input > spec.bound : q.output < spec.bound)
    throw Error('EXTERNAL_SIGNED_MINIMUM_VIOLATED');
  const f = q.fees;
  if (spec.legacy)
    q = {
      ...q,
      post: {
        ...q.post,
        quote: spec.buy
          ? m.quote + q.input - f.protocol - f.creator
          : m.quote - q.output - f.protocol - f.creator,
        virtual: m.virtual,
        protocolBucket: m.protocolBucket,
        creatorBucket: m.creatorBucket,
      },
    };
  const transfers: { from: string; to: string; amount: bigint }[] = [];
  const transfer = (from: string, to: string, amount: bigint) => {
    if (amount > 0n) {
      if (
        !from ||
        !to ||
        from === PublicKey.default.toBase58() ||
        to === PublicKey.default.toBase58()
      )
        throw Error('PUMP_FEE_RECIPIENT_MISSING');
      transfers.push({ from, to, amount });
    }
  };
  transfer(
    spec.buy ? p.baseVault : spec.userBase,
    spec.buy ? spec.userBase : p.baseVault,
    spec.buy ? q.output : q.input,
  );
  transfer(
    spec.buy ? spec.userQuote : p.quoteVault,
    spec.buy ? p.quoteVault : spec.userQuote,
    spec.buy ? q.input - (spec.legacy ? f.protocol + f.creator : f.buyback) : q.output,
  );
  if (spec.legacy) {
    transfer(
      spec.buy ? spec.userQuote : p.quoteVault,
      spec.protocolRecipient,
      f.protocol - f.buyback,
    );
    transfer(spec.buy ? spec.userQuote : p.quoteVault, spec.creatorRecipient, f.creator);
  }
  transfer(spec.buy ? spec.userQuote : p.quoteVault, spec.buybackRecipient, f.buyback);
  const raw = Buffer.from(s.accounts[spec.pool]!.base64, 'base64'),
    post = q.post,
    U64 = (1n << 64n) - 1n;
  for (const n of [post.base, post.quote, post.protocolBucket, post.creatorBucket])
    if (n < 0n || n > U64) throw Error('PUMP_EXTERNAL_RANGE');
  if (post.quote < post.protocolBucket + post.creatorBucket)
    throw Error('PUMP_EXTERNAL_RESERVED_LIQUIDITY');
  for (const [vault, n] of [
    [p.baseVault, post.base],
    [p.quoteVault, post.quote],
  ] as const) {
    const b = Buffer.from(s.accounts[vault]!.base64, 'base64');
    b.writeBigUInt64LE(n, 64);
    s.accounts[vault] = { ...s.accounts[vault]!, base64: b.toString('base64') };
  }
  if (post.virtual < -(1n << 127n) || post.virtual >= 1n << 127n)
    throw Error('PUMP_EXTERNAL_VIRTUAL_RANGE');
  const virtual = BigInt.asUintN(128, post.virtual);
  raw.writeBigUInt64LE(virtual & U64, 245);
  raw.writeBigUInt64LE(virtual >> 64n, 253);
  raw.writeBigUInt64LE(post.protocolBucket, 271);
  raw.writeBigUInt64LE(post.creatorBucket, 279);
  s.accounts[spec.pool] = { ...s.accounts[spec.pool]!, base64: raw.toString('base64') };
  await validatePumpPool(s, spec.pool, p.baseMint, p.quoteMint);
  return { next: s, output: q.output, input: q.input, transfers, quote: q };
}
