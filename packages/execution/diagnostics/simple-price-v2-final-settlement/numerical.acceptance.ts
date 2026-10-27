/** Archived replay at its ORIGINAL validated time. Never refreshes timestamps or grants fill authority. */
import { readFileSync, writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { quote } from '../../candidates/simple-price-v2-directional/model.js';
import type { Evidence } from '../../candidates/simple-price-v2-directional/model.js';
import { REAL_POLICY } from '../../providers/simple-price-v2/provider.js';
import { quote as oldQuote } from '../../candidates/simple-price-v2/model.js';
import type { Evidence as OldEvidence } from '../../candidates/simple-price-v2/model.js';
import { MODEL_VERSION } from '../../candidates/simple-price-v2-directional/model.js';
const keys = new Set(['n', 'd', 'bps', 'slot', 'input', 'output', 'minInput', 'maxInput']);
function evidence(raw: unknown): Evidence {
  return JSON.parse(JSON.stringify(raw), (key, v: unknown) =>
    keys.has(key) && typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : v,
  ) as Evidence;
}
it('replays original-time TUSD comparisons, without promoting diagnostic captures', () => {
  const rows = JSON.parse(
    readFileSync('artifacts/simple-price-v2-directional-review/live-markets.json', 'utf8'),
  ) as {
    label: string;
    rejection: string;
    review: { normalized: { evidence: unknown }; previewAtMs: number };
    independent: unknown;
  }[];
  const summary = [];
  for (const row of rows.filter((r) => r.label.includes('TUSD'))) {
    expect(row.rejection).toContain('NON_ATOMIC_NATIVE_CAPTURE');
    const e = evidence(row.review.normalized.evidence),
      at = row.review.previewAtMs;
    const comparisons = e.calibration.quotes.map((q) => {
      const modeled = quote(q.side, q.input, e, e.identity, at, REAL_POLICY),
        delta = modeled.output - q.output;
      expect((delta < 0n ? -delta : delta) * 10000n).toBeLessThanOrEqual(q.output);
      return {
        side: q.side,
        input: q.input,
        native: q.output,
        modeled: modeled.output,
        delta,
        errorMicroBps: (delta * 10000000000n) / q.output,
      };
    });
    const examples = [100000000n, 1000000000n].map((size) => {
      const buy = quote('BUY', size, e, e.identity, at, REAL_POLICY),
        sell = quote('SELL', buy.output, e, e.identity, at, REAL_POLICY),
        half = quote(
          'SELL',
          buy.output / 2n,
          e,
          e.identity,
          at,
          REAL_POLICY,
          undefined,
          buy.output,
        );
      return {
        size,
        buyTokens: buy.output,
        buyFixed: buy.costs.fixedFeeLamports,
        buyImpactDust: buy.costs.sizeImpactAndDustLamports,
        buyDust: buy.costs.normalizationDustLamports,
        sellNet: sell.output,
        sellFixed: sell.costs.fixedFeeLamports,
        sellImpactDust: sell.costs.sizeImpactAndDustLamports,
        halfNet: half.output,
      };
    });
    summary.push({
      label: row.label,
      identity: e.identity,
      observedAt: at,
      BUY: e.directionalCosts!.BUY.bridgeInputRate,
      SELL: e.directionalCosts!.SELL.bridgeInputRate,
      comparisons,
      examples,
      independent: row.independent,
      status: 'ARCHIVED_DIAGNOSTIC_ONLY_NO_FILL_AUTHORITY',
    });
  }
  writeFileSync(
    'artifacts/simple-price-v2-final-settlement-review/recorded-comparisons-' +
      Date.now() +
      '.json',
    JSON.stringify(summary, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
  expect(summary.length).toBe(1);
});
it('replays all three preserved SOL market envelopes with exactly unchanged numerical fills', () => {
  const rows = JSON.parse(
    readFileSync('artifacts/simple-price-v2-provider-review/live-markets.json', 'utf8'),
  ) as { label: string; capture: { evidence: unknown; receivedAtMs: number } }[];
  const summary = [];
  for (const row of rows.slice(0, 3)) {
    const e = evidence(row.capture.evidence) as OldEvidence,
      at = row.capture.receivedAtMs;
    const old = oldQuote('BUY', 1000000000n, e, e.identity, at, REAL_POLICY),
      next = quote('BUY', 1000000000n, e, e.identity, at, REAL_POLICY);
    expect(next).toEqual({ ...old, modelVersion: MODEL_VERSION });
    for (const q of [old.output, old.output / 2n]) {
      const oldSell = oldQuote('SELL', q, e, e.identity, at, REAL_POLICY, undefined, old.output),
        nextSell = quote('SELL', q, e, e.identity, at, REAL_POLICY, undefined, old.output);
      expect(nextSell).toEqual({ ...oldSell, modelVersion: MODEL_VERSION });
      summary.push({
        label: row.label,
        buy: next.output,
        buyFees: next.costs.fixedFeeLamports,
        sellQuantity: q,
        sell: nextSell.output,
        sellFees: nextSell.costs.fixedFeeLamports,
      });
    }
  }
  writeFileSync(
    'artifacts/simple-price-v2-final-settlement-review/sol-three-market-equality-' +
      Date.now() +
      '.json',
    JSON.stringify(summary, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
  expect(summary.length).toBe(6);
});
