/** Review-only algebra for unapproved policies. Never imported by candidate execution or production. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { quote } from '../../candidates/simple-price-v1/model.js';
import type { Rational, Fee } from '../../candidates/simple-price-v1/model.js';
import { evidence, POLICY, SOL, START, TOKEN } from './fixtures.js';

const B = 10_000n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
function fraction(n: bigint, d: bigint): Rational {
  if (n < 0n || d <= 0n) throw new Error('INVALID_REVIEW_RATIO');
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a: Rational, b: Rational) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export interface Anchor {
  notional: bigint;
  surcharge: Rational;
  reference: string;
}
export interface ProposedCurve {
  fixed: Rational;
  slope: Rational;
  references: readonly string[];
}
export function feeTotal(amount: bigint, fees: readonly Fee[]): bigint {
  if (
    fees.length === 0 ||
    fees.some((f) => f.bps < 0n) ||
    fees.reduce((s, f) => s + f.bps, 0n) >= B
  )
    throw new Error('UNVERIFIED_REVIEW_FEES');
  return fees.reduce((s, f) => s + ceil(amount * f.bps, B), 0n);
}
export function buyNotional(budget: bigint, fees: readonly Fee[]): bigint {
  if (budget <= 0n) throw new Error('INVALID_AMOUNT');
  let lo = 0n,
    hi = budget;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + feeTotal(mid, fees) <= budget) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
export function quoteAnchor(
  notional: bigint,
  tokens: bigint,
  price: Rational,
  reference: string,
): Anchor {
  if (notional <= 0n || tokens <= 0n || price.n <= 0n || price.d <= 0n || !reference)
    throw new Error('QUOTE_QUALITY_UNAVAILABLE');
  const delta = notional * price.d - tokens * price.n;
  if (delta <= 0n) throw new Error('UNMEASURED_SIZE_RESPONSE');
  return { notional, surcharge: fraction(delta, tokens * price.n), reference };
}
/** A: u(N) = k*N, k = u(reference)/referenceNotional. */
export function singleQuoteCurve(anchor: Anchor | null): ProposedCurve {
  if (!anchor || anchor.surcharge.n <= 0n || anchor.notional <= 0n)
    throw new Error('QUOTE_QUALITY_UNAVAILABLE');
  return {
    fixed: { n: 0n, d: 1n },
    slope: fraction(anchor.surcharge.n, anchor.surcharge.d * anchor.notional),
    references: [anchor.reference],
  };
}
/** B: u(N) = a+b*N, b=(u2-u1)/(N2-N1), a=max(0,u1-b*N1). */
export function twoQuoteCurve(first: Anchor | null, second: Anchor | null): ProposedCurve {
  if (!first || !second || first.notional <= 0n || second.notional <= first.notional)
    throw new Error('TWO_REFERENCE_QUOTES_REQUIRED');
  const slopeN = second.surcharge.n * first.surcharge.d - first.surcharge.n * second.surcharge.d;
  if (slopeN <= 0n) throw new Error('UNMEASURED_SIZE_RESPONSE');
  const slope = fraction(
    slopeN,
    second.surcharge.d * first.surcharge.d * (second.notional - first.notional),
  );
  const fixedN = first.surcharge.n * slope.d - slope.n * first.notional * first.surcharge.d;
  return {
    slope,
    fixed: fraction(fixedN > 0n ? fixedN : 0n, first.surcharge.d * slope.d),
    references: [first.reference, second.reference],
  };
}
export function proposedQuote(
  side: 'BUY' | 'SELL',
  amount: bigint,
  price: Rational,
  fees: readonly Fee[],
  curve: ProposedCurve,
  extraSpreadBps = 0n,
) {
  if (amount <= 0n || price.n <= 0n || price.d <= 0n || extraSpreadBps < 0n || extraSpreadBps >= B)
    throw new Error('INVALID_REVIEW_INPUT');
  const notional = side === 'BUY' ? buyNotional(amount, fees) : (amount * price.n) / price.d;
  const surcharge = add(curve.fixed, fraction(curve.slope.n * notional, curve.slope.d));
  const denominator = surcharge.d + surcharge.n;
  const gross =
    side === 'BUY' ? notional : (notional * surcharge.d * (B - extraSpreadBps)) / (denominator * B);
  const cost = feeTotal(gross, fees);
  const output =
    side === 'BUY'
      ? (notional * price.d * surcharge.d * B) / (price.n * denominator * (B + extraSpreadBps))
      : gross - cost;
  if (output <= 0n) throw new Error('ZERO_OUTPUT');
  return {
    input: side === 'BUY' ? notional + cost : amount,
    output,
    gross,
    fee: cost,
    notional,
    surcharge,
  };
}
export function proportionalNetExit(
  fullPeakNet: bigint,
  quantity: bigint,
  peakQuantity: bigint,
): bigint {
  if (fullPeakNet <= 0n || quantity <= 0n || peakQuantity < quantity)
    throw new Error('INVALID_PEAK_QUOTE');
  // FullPeakNet already includes fees and spread; never charge them a second time.
  return (fullPeakNet * quantity) / peakQuantity;
}
interface RecordedRow {
  input: string;
  currentBuy: { input: string };
  buyQuote: { quote: { outAmount: string; contextSlot: number } };
  sellQuote: { quote: { outAmount: string } };
}
interface MarketRecord {
  pool: { name: string; pool: string };
  calibration: {
    fees: { category: string; bps: string }[];
    observations: { price: { n: string; d: string } }[];
  };
  rows: RecordedRow[];
}
export function evaluatePolicies() {
  const fixturePath =
    'packages/execution/candidates/simple-price-v1/fixtures/2026-10-13-pumpswap-quotes.json';
  const data = JSON.parse(readFileSync(fixturePath, 'utf8')) as { records: MarketRecord[] };
  const markets = data.records.map((record) => {
    const p = record.calibration.observations[0]!.price,
      price = { n: BigInt(p.n), d: BigInt(p.d) };
    const fees = record.calibration.fees.map((f) => ({ category: f.category, bps: BigInt(f.bps) }));
    const anchors = record.rows
      .slice(0, 2)
      .map((row) =>
        quoteAnchor(
          buyNotional(BigInt(row.currentBuy.input), fees),
          BigInt(row.buyQuote.quote.outAmount),
          price,
          `${fixturePath}:${record.pool.pool}:${row.input}:${row.buyQuote.quote.contextSlot}`,
        ),
      );
    const curves = { A: singleQuoteCurve(anchors[0]!), B: twoQuoteCurve(anchors[0]!, anchors[1]!) };
    const samples = record.rows.map((row) => {
      const amount = BigInt(row.input),
        tokens = BigInt(row.buyQuote.quote.outAmount),
        referenceSell = BigInt(row.sellQuote.quote.outAmount);
      const outputs = Object.entries(curves).map(([policy, curve]) => {
        const buy = proposedQuote('BUY', amount, price, fees, curve),
          sell = proposedQuote('SELL', tokens, price, fees, curve);
        const buyDelta = buy.output - tokens,
          sellDelta = sell.output - referenceSell;
        return {
          policy,
          buy,
          sell,
          buyDiscrepancy: { numerator: buyDelta, denominator: tokens },
          sellDiscrepancy: { numerator: sellDelta, denominator: referenceSell },
          buyRelativePpm: (buyDelta * 1_000_000n) / tokens,
          sellRelativePpm: (sellDelta * 1_000_000n) / referenceSell,
        };
      });
      return { amount, referenceBuy: tokens, referenceSell, outputs };
    });
    const heldOut = samples.filter((row) => row.amount >= SOL);
    let maxResidualBps = 0n;
    for (const row of heldOut) {
      const result = row.outputs.find((o) => o.policy === 'A')!;
      for (const [modeled, reference] of [
        [result.buy.output, row.referenceBuy],
        [result.sell.output, row.referenceSell],
      ]) {
        const delta = modeled! >= reference! ? modeled! - reference! : reference! - modeled!;
        const bound = ceil(delta * B, reference!);
        if (bound > maxResidualBps) maxResidualBps = bound;
      }
    }
    const defaultBuy = proposedQuote('BUY', SOL, price, fees, curves.A),
      defaultSell = proposedQuote('SELL', defaultBuy.output, price, fees, curves.A);
    const cautiousBuy = proposedQuote('BUY', SOL, price, fees, curves.A, maxResidualBps),
      cautiousSell = proposedQuote(
        'SELL',
        cautiousBuy.output,
        price,
        fees,
        curves.A,
        maxResidualBps,
      );
    return {
      market: record.pool.name,
      identity: record.pool.pool,
      price,
      fees,
      anchors,
      curves,
      samples,
      maxObservedHeldOutResidualBps: maxResidualBps,
      feeRecommendations: {
        default: { buy: defaultBuy, sell: defaultSell, roundTripLoss: SOL - defaultSell.output },
        conservative: {
          measuredBufferBps: maxResidualBps,
          buy: cautiousBuy,
          sell: cautiousSell,
          roundTripLoss: SOL - cautiousSell.output,
        },
      },
    };
  });
  const fragmentation: unknown[] = [];
  const e = evidence(),
    buy = quote('BUY', SOL, e, TOKEN, START, POLICY);
  const full = quote('SELL', buy.output, e, TOKEN, START, POLICY).output;
  for (const count of [1, 2, 4, 10, 100, 1000]) {
    const n = BigInt(count),
      base = buy.output / n,
      remainder = buy.output % n;
    let ordinary = 0n,
      anchored = 0n;
    for (let i = 0n; i < n; i++) {
      const q = base + (i < remainder ? 1n : 0n);
      ordinary += quote('SELL', q, e, TOKEN, START, POLICY).output;
      anchored += proportionalNetExit(full, q, buy.output);
    }
    fragmentation.push({
      count,
      ordinary,
      advantageOverFull: ordinary - full,
      proposedAnchored: anchored,
      anchoredRoundingLoss: full - anchored,
    });
  }
  const unchangedPriceFragmentLimit = (buy.output * 9900n * 9990n) / (1000n * B * B);
  return {
    label: 'OFFLINE_UNAPPROVED_PROPOSALS_NO_RESERVES_OR_RUNTIME_REGISTRATION',
    markets,
    existingPreset: { buy, fullExit: full, unchangedPriceFragmentLimit, fragmentation },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluatePolicies();
  writeFileSync(
    'artifacts/simple-price-v1-blockers/policy-evaluation.json',
    JSON.stringify(result, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
  for (const m of result.markets)
    console.log(
      JSON.stringify(
        {
          market: m.market,
          curves: m.curves,
          rows: m.samples.map((s) => ({
            input: s.amount,
            outputs: s.outputs.map((o) => ({
              policy: o.policy,
              buy: o.buy.output,
              sell: o.sell.output,
              buyPpm: o.buyRelativePpm,
              sellPpm: o.sellRelativePpm,
            })),
          })),
          feeRecommendations: m.feeRecommendations,
        },
        (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    );
  console.log(
    JSON.stringify(
      {
        fragmentation: result.existingPreset.fragmentation,
        unchangedPriceFragmentLimit: result.existingPreset.unchangedPriceFragmentLimit,
      },
      (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    ),
  );
}
