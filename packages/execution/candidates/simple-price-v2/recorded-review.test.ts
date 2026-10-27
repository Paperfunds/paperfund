import { describe, it, expect } from 'vitest';
import { evaluateRecorded } from './recorded-review.js';
describe('preserved independent Jupiter fixture analytics; no authority promotion', () => {
  const results = evaluateRecorded();
  for (const market of results)
    it(market.market + ' matches bounded held-out math while execution remains rejected', () => {
      expect(market.executionRejected).toBe('UNVERIFIED_PRICE_CONVENTION');
      expect(market.roundTrip.net).toBeLessThan(1_000_000_000n);
      for (const row of market.results)
        for (const [modeled, reference] of [
          [row.buy, row.referenceBuy],
          [row.sell, row.referenceSell],
        ]) {
          const delta = modeled! > reference! ? modeled! - reference! : reference! - modeled!;
          // Below 1 SOL, one SELL lamport of floor/ceiling dust can exceed 4 ppb.
          expect(delta * 1_000_000_000n).toBeLessThanOrEqual(
            reference! * 4n + (row.budget < 1_000_000_000n ? 1_000_000_000n : 0n),
          );
        }
      const r = market.roundTrip;
      expect(
        r.buyFees.reduce((s, f) => s + f.amount, 0n) +
          r.sellFees.reduce((s, f) => s + f.amount, 0n) +
          r.buyImpactAndDust +
          r.sellImpactAndDust,
      ).toBe(r.loss);
      expect(market.curve.maxBuy).toBeLessThan(2_000_000_000n);
    });
});
