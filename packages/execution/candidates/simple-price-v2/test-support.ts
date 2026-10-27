/** Disposable synthetic evidence. Never establishes real non-SOL or provider coverage. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, snapshotHash, buyNotional, feeAmounts, MODEL_VERSION } from './model.js';
import type { Evidence, Identity, Policy, Rational, Fee, ReferenceQuote } from './model.js';
import { IsolatedHighWater } from './high-water.js';
import { DisposableSandbox } from './sandbox.js';
import type { SandboxAccount } from './sandbox.js';

export const SOL = 1_000_000_000n;
export const START = Date.parse('2026-10-14T12:00:00Z'),
  CUTOFF = START + 3_600_000;
export const TOKEN: Identity = { mint: 'synthetic-a', market: 'synthetic-market-a', quote: 'SOL' };
export const POLICY: Policy = {
  version: 'PRIVATE_FIXTURE_ONLY_NOT_APPROVED',
  maxAgeMs: 5000,
  maxFutureMs: 1000,
  maxSkewMs: 2000,
  maxDiscrepancyBps: 100n,
  maxMovementBps: 20_000n,
  solQuote: 'SOL',
  trustedSources: { native: 'fixture-chain', independent: 'fixture-oracle' },
  trustedQuoteSources: { executable: 'fixture-quote' },
  maxQuoteSlotSkew: 0n,
  maxCalibrationErrorBps: 1n,
};
const sum = (fees: readonly { amount: bigint }[]) => fees.reduce((s, f) => s + f.amount, 0n);
export function synthetic(
  identity = TOKEN,
  now = START,
  price: Rational = { n: 1n, d: 1000n },
  fees: readonly Fee[] = [{ category: 'VERIFIED_FIXTURE_MARKET', bps: 37n }],
  slope: Rational = { n: 1n, d: 100n * SOL },
  fx: Rational | null = null,
): Evidence {
  const observation = (i: Identity, p: Rational) =>
    Object.entries(POLICY.trustedSources).map(([source, upstream]) => ({
      source,
      upstream,
      reference: 'SYNTHETIC_ONLY:' + now,
      identity: i,
      price: p,
      observedAtMs: now,
      slot: BigInt(now),
      tradeable: true,
    }));
  const base = {
    identity,
    observations: observation(identity, price),
    conversion: fx
      ? {
          price: fx,
          observations: observation(
            { mint: identity.quote, quote: 'SOL', market: 'conversion:' + identity.quote },
            fx,
          ),
        }
      : null,
    fees,
    feeReference: 'SYNTHETIC_VERIFIED_FEES',
    feeObservedAtMs: now,
  };
  const p = fx ? { n: price.n * fx.n, d: price.d * fx.d } : price;
  const quotes: ReferenceQuote[] = [];
  for (const budget of [SOL / 100n, SOL / 10n, SOL, 2n * SOL, 4n * SOL]) {
    const n = buyNotional(budget, fees);
    const output = (n * p.d * slope.d) / (p.n * (slope.d + slope.n * n));
    quotes.push({
      source: 'executable',
      upstream: 'fixture-quote',
      reference: 'SYNTHETIC_BUY:' + budget + ':' + now,
      identity,
      side: 'BUY',
      input: n + sum(feeAmounts(n, fees)),
      output,
      observedAtMs: now,
      slot: BigInt(now),
      feesHash: fingerprint(fees),
      convention: 'EXACT_INPUT_ALL_IN_VERIFIED',
    });
  }
  for (const m of [SOL / 100n, SOL / 10n, SOL, 2n * SOL, 4n * SOL]) {
    const q = (m * p.d) / p.n,
      mark = (q * p.n) / p.d,
      gross = (mark * slope.d) / (slope.d + slope.n * mark);
    quotes.push({
      source: 'executable',
      upstream: 'fixture-quote',
      reference: 'SYNTHETIC_SELL:' + m + ':' + now,
      identity,
      side: 'SELL',
      input: q,
      output: gross - sum(feeAmounts(gross, fees)),
      observedAtMs: now,
      slot: BigInt(now),
      feesHash: fingerprint(fees),
      convention: 'EXACT_INPUT_ALL_IN_VERIFIED',
    });
  }
  return {
    ...base,
    calibration: {
      snapshotHash: snapshotHash(base),
      spotConvention: 'FEE_EXCLUSIVE_SPOT',
      feeConvention: 'LAMPORT_BUY_INPUT_SELL_GROSS_CEIL',
      widthConvention: 'NO_FIXED_WIDTH_VERIFIED',
      quotes,
    },
  };
}
export function rebind(e: Evidence): Evidence {
  return { ...e, calibration: { ...e.calibration, snapshotHash: snapshotHash(e) } };
}
export function account(id = 'a', round = 'round-a'): SandboxAccount {
  return {
    id,
    owner: 'owner',
    round,
    modelVersion: MODEL_VERSION,
    state: 'OPEN',
    startsAtMs: START,
    endsAtMs: CUTOFF,
    cash: 10n * SOL,
    startingCash: 10n * SOL,
    realizedPnl: 0n,
    positions: [],
    slots: [],
    fills: [],
    journals: [],
  };
}
export async function harness() {
  let now = START,
    order = 0;
  const updates = new Map<string, Evidence>(),
    missing = new Set<string>();
  const directory = await mkdtemp(join(tmpdir(), 'paperfund-simple-v2-'));
  const loader = async (identities: readonly Identity[]) =>
    new Map(
      identities
        .filter((i) => !missing.has(i.mint))
        .map((i) => [fingerprint(i), updates.get(i.mint) ?? synthetic(i, now)]),
    );
  const highWater = new IsolatedHighWater(directory, POLICY);
  const sandbox = new DisposableSandbox(POLICY, loader, () => now, highWater);
  sandbox.add(account());
  return {
    sandbox,
    highWater,
    directory,
    updates,
    missing,
    get now() {
      return now;
    },
    time: (t: number) => {
      now = t;
    },
    move: (identity: Identity, price: Rational, fx: Rational | null = null) => {
      now++;
      updates.set(identity.mint, synthetic(identity, now, price, undefined, undefined, fx));
    },
    trade: (
      side: 'BUY' | 'SELL',
      amount: bigint | 'ALL',
      identity = TOKEN,
      key = 'order-' + ++order,
    ) =>
      sandbox.execute({
        owner: 'owner',
        account: 'a',
        round: 'round-a',
        key,
        identity,
        side,
        amount,
      }),
  };
}
