import { describe, expect, it } from 'vitest';
import {
  buyNotional,
  evaluatePolicies,
  proportionalNetExit,
  proposedQuote,
  quoteAnchor,
  singleQuoteCurve,
  twoQuoteCurve,
} from './blocker-policy-review.js';
import type { Anchor } from './blocker-policy-review.js';

const feeFree = [{ category: 'verified-zero-fee-control', bps: 0n }];
const price = { n: 1n, d: 1n };
describe('unapproved quote-derived policy review only', () => {
  it('A has an independently calculable size response with no universal depth input', () => {
    const anchor = quoteAnchor(100n, 80n, price, 'verified-quote-control');
    const curve = singleQuoteCurve(anchor);
    expect(curve.slope).toEqual({ n: 1n, d: 400n });
    expect(proposedQuote('BUY', 100n, price, feeFree, curve).output).toBe(80n);
    expect(proposedQuote('SELL', 100n, price, feeFree, curve).output).toBe(80n);
    expect(proposedQuote('BUY', 400n, price, feeFree, curve).output).toBe(200n);
  });
  it('B derives its intercept and slope deterministically from two sizes', () => {
    const first: Anchor = { notional: 100n, surcharge: { n: 1n, d: 5n }, reference: 'quote-small' };
    const second: Anchor = {
      notional: 200n,
      surcharge: { n: 3n, d: 10n },
      reference: 'quote-medium',
    };
    const curve = twoQuoteCurve(first, second);
    expect(curve.fixed).toEqual({ n: 1n, d: 10n });
    expect(curve.slope).toEqual({ n: 1n, d: 1000n });
    expect(proposedQuote('BUY', 100n, price, feeFree, curve).output).toBe(83n);
    expect(proposedQuote('SELL', 200n, price, feeFree, curve).output).toBe(153n);
  });
  it('missing or unmeasurable quality fails instead of substituting a depth', () => {
    expect(() => singleQuoteCurve(null)).toThrow('QUOTE_QUALITY_UNAVAILABLE');
    expect(() => twoQuoteCurve(null, null)).toThrow('TWO_REFERENCE_QUOTES_REQUIRED');
    expect(() => quoteAnchor(100n, 100n, price, 'ref')).toThrow('UNMEASURED_SIZE_RESPONSE');
  });
  it('applies fees once per side and uses the all-in requested BUY amount', () => {
    const fees = [{ category: 'protocol', bps: 1000n }];
    const curve = singleQuoteCurve(quoteAnchor(100n, 80n, price, 'ref'));
    const buy = proposedQuote('BUY', 110n, price, fees, curve);
    expect(buyNotional(110n, fees)).toBe(100n);
    expect(buy.output).toBe(80n);
    expect(buy.input).toBe(110n);
    expect(buy.fee).toBe(10n);
    const sell = proposedQuote('SELL', buy.output, price, fees, curve);
    expect(sell.gross).toBe(66n);
    expect(sell.fee).toBe(7n);
    expect(sell.output).toBe(59n);
  });
  it('preserves all old Jupiter fixtures and retains held-out discrepancies without tuning', () => {
    const result = evaluatePolicies();
    expect(result.markets).toHaveLength(3);
    for (const market of result.markets) {
      expect(market.curves.A.references).toHaveLength(1);
      expect(market.curves.B.references).toHaveLength(2);
      for (const sample of market.samples.filter((s) => s.amount >= 1_000_000_000n))
        for (const output of sample.outputs) {
          const abs = (v: bigint) => (v < 0n ? -v : v);
          // Evidence limit for these recorded samples, not a production tolerance.
          expect(abs(output.buy.output - sample.referenceBuy) * 1_000_000_000n).toBeLessThanOrEqual(
            sample.referenceBuy * 5n,
          );
          expect(
            abs(output.sell.output - sample.referenceSell) * 1_000_000_000n,
          ).toBeLessThanOrEqual(sample.referenceSell * 5n);
        }
    }
  });
  it('handles small and very large integers monotonically without a capacity cut-off', () => {
    const result = evaluatePolicies();
    for (const market of result.markets)
      for (const curve of Object.values(market.curves)) {
        let previous = 0n;
        for (const size of [1000n, 1_000_000n, 1_000_000_000n, 10n ** 18n, 10n ** 30n]) {
          const b = proposedQuote('BUY', size, market.price, market.fees, curve);
          expect(b.output).toBeGreaterThanOrEqual(previous);
          previous = b.output;
          expect(
            proposedQuote('SELL', b.output, market.price, market.fees, curve).output,
          ).toBeLessThan(size);
        }
      }
  });
  it('the proposed net-per-peak-unit rule removes same-snapshot fragmentation gains', () => {
    const result = evaluatePolicies();
    const rows = result.existingPreset.fragmentation as {
      proposedAnchored: bigint;
      ordinary: bigint;
      count: number;
      anchoredRoundingLoss: bigint;
    }[];
    expect(rows.find((r) => r.count === 2)!.ordinary - result.existingPreset.fullExit).toBe(
      4_674_633n,
    );
    expect(rows.find((r) => r.count === 1000)!.ordinary - result.existingPreset.fullExit).toBe(
      9_384_059n,
    );
    for (const row of rows) {
      expect(row.proposedAnchored).toBeLessThanOrEqual(result.existingPreset.fullExit);
      expect(row.anchoredRoundingLoss).toBeLessThan(BigInt(row.count));
    }
    expect(proportionalNetExit(101n, 50n, 100n) + proportionalNetExit(101n, 50n, 100n)).toBe(100n);
  });
});
