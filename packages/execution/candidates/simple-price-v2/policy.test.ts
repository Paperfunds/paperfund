import { describe, it, expect } from 'vitest';
import { quote, replayFill, fingerprint, validateEvidence, calibrate } from './model.js';
import { asExecution } from './contract.js';
import { identifier } from '@paperfund/core';
import { synthetic, rebind, POLICY, START, TOKEN, SOL } from './test-support.js';
describe('bounded candidate A and fixed-cost separation', () => {
  it('does not fit a finite impact coefficient from token-floor dust alone', () => {
    const noImpact = synthetic(TOKEN, START, { n: 7n, d: 1000n }, undefined, { n: 0n, d: 1n });
    expect(() => quote('BUY', SOL, noImpact, TOKEN, START, POLICY)).toThrow(
      'UNMEASURED_SIZE_RESPONSE',
    );
  });
  it('requires fresh native and quote evidence; conflicting sources and unknown providers reject', () => {
    const e = synthetic();
    expect(() => quote('BUY', SOL, e, TOKEN, START + 5001, POLICY)).toThrow(
      'STALE_OR_INVALID_EVIDENCE',
    );
    const source = structuredClone(e);
    Object.assign(source.observations[1]!, { price: { n: 2n, d: 1000n } });
    expect(() => quote('BUY', SOL, rebind(source), TOKEN, START, POLICY)).toThrow(
      'CONTRADICTORY_PRICE',
    );
    const quoteSource = structuredClone(e);
    Object.assign(quoteSource.calibration.quotes[0]!, { source: 'chart' });
    expect(() => quote('BUY', SOL, quoteSource, TOKEN, START, POLICY)).toThrow('UNVERIFIED_QUOTE');
    expect(() => quote('BUY', SOL, { ...e, fees: [] }, TOKEN, START, POLICY)).toThrow(
      'INVALID_FEES',
    );
  });
  it('does not claim correlated-source agreement proves a real market move', () => {
    const prev = synthetic(),
      correlated = synthetic(TOKEN, START + 1, { n: 2n, d: 1000n });
    // This known limitation remains explicit: two underlying correlated sources can agree.
    expect(validateEvidence(correlated, TOKEN, START + 1, POLICY, prev)).toEqual({
      n: 2n,
      d: 1000n,
    });
    const extreme = synthetic(TOKEN, START + 2, { n: 4n, d: 1000n });
    expect(() => validateEvidence(extreme, TOKEN, START + 2, POLICY, prev)).toThrow(
      'CONTRADICTORY_PRICE',
    );
  });
  for (const bps of [0n, 37n, 125n, 1000n])
    it('fits size response after removing ' + bps + ' bps fixed fees', () => {
      const e = synthetic(TOKEN, START, undefined, [{ category: 'VERIFIED_MARKET', bps }]);
      const fill = quote('BUY', SOL, e, TOKEN, START, POLICY);
      const k = fill.curve.k;
      // Synthetic truth is 1/(100 SOL); only integer quote output dust may perturb the fit.
      const delta = k.n * 100n * SOL - k.d;
      expect(delta >= 0n).toBe(true);
      const reference = e.calibration.quotes[0]!,
        n = fill.curve.minBuy;
      // Exact upper bound from floor-to-one-token dust in the fit quote.
      expect(delta * reference.output * n < k.d * (100n * SOL + n)).toBe(true);
      expect(fill.costs.fixedFeeLamports).toBe((fill.gross * bps + 9999n) / 10000n);
      expect(fill.input).toBe(fill.gross + fill.costs.fixedFeeLamports);
      expect(fill.costs.platformFeeLamports).toBe(0n);
      expect(fill.costs.uncertaintyBufferBps).toBe(0n);
      const sell = quote('SELL', fill.output, e, TOKEN, START, POLICY);
      expect(sell.output + sell.costs.fixedFeeLamports).toBe(sell.gross);
      expect(sell.costs.sizeImpactAndDustLamports).toBe(fill.output / 1000n - sell.gross);
      expect(sell.output).toBeLessThan(fill.input);
      expect(replayFill(fill)).toEqual(fill);
      expect(replayFill(sell)).toEqual(sell);
    });
  for (const amount of [1n, SOL / 1000n, 5n * SOL, 10n ** 30n])
    it('rejects unquoted BUY size ' + amount, () => {
      const e = synthetic();
      expect(() => quote('BUY', amount, e, TOKEN, START, POLICY)).toThrow('UNSUPPORTED_SIZE_RANGE');
    });
  it('requires new larger SELL quotes after genuine price movement exceeds the quoted range', () => {
    const e = synthetic(),
      buy = quote('BUY', 2n * SOL, e, TOKEN, START, POLICY),
      moved = synthetic(TOKEN, START + 1, { n: 3n, d: 1000n });
    expect(() => quote('SELL', buy.output, moved, TOKEN, START + 1, POLICY, e)).toThrow(
      'UNSUPPORTED_SIZE_RANGE',
    );
  });
  it('rejects an all-in average price convention and changed snapshot', () => {
    const e = synthetic();
    expect(() =>
      validateEvidence(
        { ...e, calibration: { ...e.calibration, spotConvention: 'ALL_IN' as never } },
        TOKEN,
        START,
        POLICY,
      ),
    ).toThrow('UNVERIFIED_PRICE_CONVENTION');
    const changed = structuredClone(e);
    Object.assign(changed.observations[0]!, { price: { n: 1001n, d: 1_000_000n } });
    expect(() => validateEvidence(changed, TOKEN, START, POLICY)).toThrow(
      'UNVERIFIED_PRICE_CONVENTION',
    );
  });
  it('requires verified directional quotes, matching fees, measurable response and coherent slots', () => {
    const e = synthetic(),
      price = e.observations[0]!.price;
    const bad = structuredClone(e);
    Object.assign(bad.calibration.quotes[0]!, { feesHash: 'wrong' });
    expect(() => calibrate(bad, price, START, POLICY)).toThrow('UNVERIFIED_QUOTE');
    expect(() =>
      calibrate(
        {
          ...e,
          calibration: {
            ...e.calibration,
            quotes: e.calibration.quotes.filter((q) => q.side === 'BUY'),
          },
        },
        price,
        START,
        POLICY,
      ),
    ).toThrow('DIRECTIONAL_QUOTES_REQUIRED');
    Object.assign(bad.calibration.quotes[0]!, {
      feesHash: fingerprint(e.fees),
      slot: BigInt(START) - 1n,
    });
    expect(() => calibrate(bad, price, START, POLICY)).toThrow('QUOTE_STATE_SLOT_SKEW');
    const zero = structuredClone(e);
    const a = zero.calibration.quotes[0]!;
    Object.assign(a, { output: a.input * 1000n });
    expect(() => calibrate(zero, price, START, POLICY)).toThrow('UNMEASURED_SIZE_RESPONSE');
  });
  it('rejects costs hidden in larger calibration outputs', () => {
    const bad = structuredClone(synthetic());
    Object.assign(bad.calibration.quotes[2]!, { output: 1n });
    expect(() => quote('BUY', SOL, bad, TOKEN, START, POLICY)).toThrow('CALIBRATION_MISMATCH');
  });
  it('keeps tiny legitimate partial exits inside a validated peak and rejects zero precision', () => {
    const e = synthetic(),
      b = quote('BUY', SOL, e, TOKEN, START, POLICY);
    expect(
      quote('SELL', 1_000_000n, e, TOKEN, START, POLICY, undefined, b.output).output,
    ).toBeGreaterThan(0n);
    expect(() => quote('SELL', 1n, e, TOKEN, START, POLICY, undefined, b.output)).toThrow(
      'ZERO_OUTPUT',
    );
  });
  it('preserves native and conversion chronology, rational duplicates and explicit conflicts', () => {
    const i = { ...TOKEN, quote: 'QUOTE' },
      prev = synthetic(i, START, undefined, undefined, undefined, { n: 2n, d: 1n }),
      next = synthetic(i, START + 1, undefined, undefined, undefined, { n: 2n, d: 1n });
    for (const fx of [false, true]) {
      const reg = structuredClone(next),
        o = fx ? reg.conversion!.observations[0]! : reg.observations[0]!;
      Object.assign(o, { slot: BigInt(START) - 1n });
      expect(() => validateEvidence(rebind(reg), i, START + 1, POLICY, prev)).toThrow(
        'REGRESSING_EVIDENCE',
      );
      const conflict = structuredClone(prev),
        c = fx ? conflict.conversion!.observations[0]! : conflict.observations[0]!;
      Object.assign(c, { price: { n: c.price.n * 1001n, d: c.price.d * 1000n } });
      if (fx) Object.assign(conflict.conversion!, { price: c.price });
      expect(() => validateEvidence(rebind(conflict), i, START, POLICY, prev)).toThrow(
        'CONFLICTING_SOURCE_EVIDENCE',
      );
    }
    expect(validateEvidence(prev, i, START, POLICY, prev)).toEqual({ n: 2n, d: 1000n });
  });
  it('normalized audit fees are already included and versioned', () => {
    const fill = quote('BUY', SOL, synthetic(), TOKEN, START, POLICY);
    const normalized = asExecution(
      fill,
      identifier('order', 'OrderId'),
      identifier('fill', 'ExecutionId'),
      identifier('private', 'ProtocolId'),
    );
    expect(normalized.actualInput.amount).toBe(fill.input);
    expect(normalized.actualOutput.amount).toBe(fill.output);
    expect(normalized.quote.adapterVersion).toBe(fill.modelVersion);
  });
});
