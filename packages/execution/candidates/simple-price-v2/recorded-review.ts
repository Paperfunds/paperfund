/** Historical mathematical comparison only. Original captures cannot establish fresh spot authority. */
import { readFileSync } from 'node:fs';
import { fingerprint, calibrate, buyNotional, feeAmounts, quote } from './model.js';
import type { Evidence, Policy, ReferenceQuote, Identity, Rational, Fee } from './model.js';
interface RawQuote {
  inAmount: string;
  outAmount: string;
  contextSlot: number;
  swapMode: string;
  platformFee: unknown;
  inputMint: string;
  outputMint: string;
  routePlan: {
    percent: number;
    swapInfo: { ammKey: string; inputMint: string; outputMint: string };
  }[];
}
interface Row {
  input: string;
  currentBuy: { input: string };
  buyQuote: { quote: RawQuote; receivedAt: string };
  sellQuote: { quote: RawQuote; receivedAt: string };
}
interface Market {
  pool: { name: string };
  calibration: {
    identity: Identity;
    fees: { category: string; bps: string }[];
    feeReference: string;
    feeObservedAtMs: number;
    observations: {
      price: { n: string; d: string };
      slot: string;
      source: string;
      upstream: string;
      reference: string;
      observedAtMs: number;
      identity: Identity;
      tradeable: boolean;
    }[];
  };
  rows: Row[];
}
const path = new URL(
  '../simple-price-v1/fixtures/2026-10-13-pumpswap-quotes.json',
  import.meta.url,
);
export function evaluateRecorded() {
  const records = (JSON.parse(readFileSync(path, 'utf8')) as { records: Market[] }).records;
  return records.map((raw) => {
    const native = raw.calibration,
      fees: Fee[] = native.fees.map((f) => ({ ...f, bps: BigInt(f.bps) })),
      price: Rational = {
        n: BigInt(native.observations[0]!.price.n),
        d: BigInt(native.observations[0]!.price.d),
      };
    const quotes: ReferenceQuote[] = [];
    for (const row of raw.rows)
      for (const side of ['BUY', 'SELL'] as const) {
        const response = side === 'BUY' ? row.buyQuote : row.sellQuote,
          q = response.quote;
        const plan = q.routePlan;
        if (
          q.swapMode !== 'ExactIn' ||
          q.platformFee !== null ||
          plan.length !== 1 ||
          plan[0]!.percent !== 100 ||
          plan[0]!.swapInfo.ammKey !== native.identity.market ||
          q.inputMint !== (side === 'BUY' ? native.identity.quote : native.identity.mint) ||
          q.outputMint !== (side === 'BUY' ? native.identity.mint : native.identity.quote)
        )
          throw new Error('UNSUPPORTED_RECORDED_ROUTE');
        quotes.push({
          source: 'jupiter',
          upstream: 'jupiter',
          reference: fingerprint(response),
          identity: native.identity,
          side,
          input: BigInt(side === 'BUY' ? row.currentBuy.input : q.inAmount),
          output: BigInt(q.outAmount),
          observedAtMs: Date.parse(response.receivedAt),
          slot: BigInt(q.contextSlot),
          feesHash: fingerprint(fees),
          convention: 'EXACT_INPUT_ALL_IN_VERIFIED',
        });
      }
    const e: Evidence = {
      identity: native.identity,
      observations: native.observations.map((o) => ({
        ...o,
        price: { n: BigInt(o.price.n), d: BigInt(o.price.d) },
        slot: BigInt(o.slot),
      })),
      conversion: null,
      fees,
      feeReference: native.feeReference,
      feeObservedAtMs: native.feeObservedAtMs,
      calibration: {
        snapshotHash: 'HISTORICAL_ANALYSIS_ONLY_NOT_EXECUTION_AUTHORITY',
        spotConvention: 'FEE_EXCLUSIVE_SPOT',
        feeConvention: 'LAMPORT_BUY_INPUT_SELL_GROSS_CEIL',
        widthConvention: 'NO_FIXED_WIDTH_VERIFIED',
        quotes,
      },
    };
    const p: Policy = {
      version: 'HISTORICAL_MATH_REVIEW_NOT_AUTHORITY',
      maxAgeMs: 30000,
      maxFutureMs: 1000,
      maxSkewMs: 30000,
      maxDiscrepancyBps: 300n,
      maxMovementBps: 20000n,
      solQuote: native.identity.quote,
      trustedSources: Object.fromEntries(native.observations.map((o) => [o.source, o.upstream])),
      trustedQuoteSources: { jupiter: 'jupiter' },
      maxQuoteSlotSkew: 1000n,
      maxCalibrationErrorBps: 1n,
    };
    const now = Math.max(...quotes.map((q) => q.observedAtMs)),
      curve = calibrate(e, price, now, p);
    let executionRejected: string;
    try {
      quote('BUY', 1_000_000_000n, e, e.identity, now, p);
      executionRejected = 'UNEXPECTED_ACCEPTANCE';
    } catch (error) {
      executionRejected = (error as Error).message;
    }
    const results = raw.rows.map((row) => {
      const budget = BigInt(row.input),
        actualReferenceSpend = BigInt(row.currentBuy.input),
        n = buyNotional(actualReferenceSpend, fees),
        buy = (n * price.d * curve.k.d) / (price.n * (curve.k.d + curve.k.n * n)),
        quantity = BigInt(row.buyQuote.quote.outAmount),
        m = (quantity * price.n) / price.d,
        gross = (m * curve.k.d) / (curve.k.d + curve.k.n * m),
        sell = gross - feeAmounts(gross, fees).reduce((s, f) => s + f.amount, 0n);
      return {
        budget,
        actualReferenceSpend,
        buy,
        sell,
        referenceBuy: quantity,
        referenceSell: BigInt(row.sellQuote.quote.outAmount),
      };
    });
    const n = buyNotional(1_000_000_000n, fees),
      buy = (n * price.d * curve.k.d) / (price.n * (curve.k.d + curve.k.n * n)),
      m = (buy * price.n) / price.d,
      gross = (m * curve.k.d) / (curve.k.d + curve.k.n * m),
      buyFees = feeAmounts(n, fees),
      sellFees = feeAmounts(gross, fees),
      net = gross - sellFees.reduce((s, f) => s + f.amount, 0n);
    return {
      market: raw.pool.name,
      identity: native.identity,
      curve,
      executionRejected,
      results,
      roundTrip: {
        buy,
        notional: n,
        buyFees,
        buyImpactAndDust: n - m,
        sellMark: m,
        sellGross: gross,
        sellFees,
        sellImpactAndDust: m - gross,
        net,
        loss: 1_000_000_000n - net,
      },
    };
  });
}
