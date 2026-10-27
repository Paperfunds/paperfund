import { describe, expect, it } from 'vitest';
import { fingerprint, quote, validateEvidence } from './model.js';
import type { Evidence, Observation } from './model.js';
import { evidence, POLICY, START, TOKEN } from '../../acceptance/simple-price-v1/fixtures.js';
import { DisposableSandbox } from './sandbox.js';
import { account, CUTOFF, SOL } from '../../acceptance/simple-price-v1/fixtures.js';

function nonSol(): Evidence {
  const i = { ...TOKEN, quote: 'QUOTE' },
    e = evidence(i);
  const fx = evidence({ mint: 'QUOTE', market: 'conversion:QUOTE', quote: 'SOL' });
  fx.observations.forEach((o) => Object.assign(o, { price: { n: 10n, d: 1n } }));
  return { ...e, conversion: { price: { n: 10n, d: 1n }, observations: fx.observations } };
}
function newer(e: Evidence, step: number): Evidence {
  const result = structuredClone(e);
  for (const o of [...result.observations, ...(result.conversion?.observations ?? [])])
    Object.assign(o, { observedAtMs: START + step, slot: BigInt(START + step) });
  Object.assign(result, { feeObservedAtMs: START + step });
  Object.assign(result.quality, { observedAtMs: START + step });
  return result;
}
function stream(e: Evidence, kind: 'native' | 'fx'): readonly Observation[] {
  return kind === 'native' ? e.observations : e.conversion!.observations;
}
describe('candidate-only token and conversion cursor correction', () => {
  for (const kind of ['native', 'fx'] as const) {
    it(`${kind}: rejects a timestamp regression independent of slot progression`, () => {
      const prior = newer(nonSol(), 10),
        next = newer(prior, 11);
      Object.assign(stream(next, kind)[0]!, { observedAtMs: START + 9 });
      expect(() => validateEvidence(next, next.identity, START + 11, POLICY, prior)).toThrow(
        'REGRESSING_EVIDENCE',
      );
    });
    it(`${kind}: rejects a slot regression independent of timestamp progression`, () => {
      const prior = newer(nonSol(), 10),
        next = newer(prior, 11);
      Object.assign(stream(next, kind)[0]!, { slot: BigInt(START + 9) });
      expect(() => validateEvidence(next, next.identity, START + 11, POLICY, prior)).toThrow(
        'REGRESSING_EVIDENCE',
      );
    });
    it(`${kind}: cannot erase a known slot by replacing it with null`, () => {
      const prior = nonSol(),
        next = newer(prior, 1);
      Object.assign(stream(next, kind)[0]!, { slot: null });
      expect(() => validateEvidence(next, next.identity, START + 1, POLICY, prior)).toThrow(
        'REGRESSING_EVIDENCE',
      );
    });
    it(`${kind}: identical cursor with a changed price fails even within the price-discrepancy band`, () => {
      const prior = nonSol(),
        next = structuredClone(prior);
      const o = stream(next, kind)[0]!;
      Object.assign(o, { price: { n: o.price.n * 1001n, d: o.price.d * 1000n } });
      if (kind === 'fx') Object.assign(next.conversion!, { price: o.price });
      expect(() => validateEvidence(next, next.identity, START, POLICY, prior)).toThrow(
        'CONFLICTING_SOURCE_EVIDENCE',
      );
    });
    it(`${kind}: duplicate observations cannot masquerade as independent source evidence`, () => {
      const e = nonSol(),
        observations = [...stream(e, kind), structuredClone(stream(e, kind)[0]!)];
      if (kind === 'native') Object.assign(e, { observations });
      else Object.assign(e.conversion!, { observations });
      expect(() => validateEvidence(e, e.identity, START, POLICY)).toThrow(
        'CONFLICTING_SOURCE_EVIDENCE',
      );
    });
    it(`${kind}: a changed upstream under the same source ID fails explicitly`, () => {
      const prior = nonSol(),
        next = newer(prior, 1);
      Object.assign(stream(next, kind)[0]!, { upstream: 'replacement' });
      // Registry changes do not silently reinterpret an archived cursor's provenance.
      const changedPolicy = {
        ...POLICY,
        trustedSources: { ...POLICY.trustedSources, chain: 'replacement' },
      };
      next.observations.forEach((o) => {
        if (o.source === 'chain') Object.assign(o, { upstream: 'replacement' });
      });
      next.conversion!.observations.forEach((o) => {
        if (o.source === 'chain') Object.assign(o, { upstream: 'replacement' });
      });
      expect(() => validateEvidence(next, next.identity, START + 1, changedPolicy, prior)).toThrow(
        'CONFLICTING_SOURCE_EVIDENCE',
      );
    });
  }
  it('accepts an exact duplicate and preserves evidence and provenance without mutation', () => {
    const prior = nonSol(),
      hash = fingerprint(prior);
    expect(validateEvidence(prior, prior.identity, START, POLICY, prior)).toEqual({
      n: 10n,
      d: 1000n,
    });
    const a = quote('BUY', SOL, prior, prior.identity, START, POLICY, prior);
    expect(a).toEqual(quote('BUY', SOL, prior, prior.identity, START, POLICY, prior));
    expect(fingerprint(prior)).toBe(hash);
    expect(a.previousEvidence).toEqual(prior);
    expect(a.evidence.conversion!.observations.map((o) => o.reference)).toEqual(
      prior.conversion!.observations.map((o) => o.reference),
    );
  });
  it('accepts mathematically equivalent rational duplicates', () => {
    const prior = nonSol(),
      next = structuredClone(prior);
    for (const o of [...next.observations, ...next.conversion!.observations])
      Object.assign(o, { price: { n: o.price.n * 2n, d: o.price.d * 2n } });
    Object.assign(next.conversion!, { price: next.conversion!.observations[0]!.price });
    expect(() => validateEvidence(next, next.identity, START, POLICY, prior)).not.toThrow();
  });
  it('rejects primary-provider reordering rather than changing execution authority', () => {
    const prior = nonSol(),
      next = structuredClone(prior);
    Object.assign(next, { observations: [...next.observations].reverse() });
    expect(() => validateEvidence(next, next.identity, START, POLICY, prior)).toThrow(
      'SOURCE_PROVENANCE_CHANGED',
    );
    const conversionReordered = structuredClone(prior);
    Object.assign(conversionReordered.conversion!, {
      observations: [...conversionReordered.conversion!.observations].reverse(),
    });
    expect(() =>
      validateEvidence(conversionReordered, prior.identity, START, POLICY, prior),
    ).toThrow('SOURCE_PROVENANCE_CHANGED');
  });
  it('does not silently replace a provider with a source that has no cursor baseline', () => {
    const prior = nonSol(),
      next = structuredClone(prior);
    Object.assign(next.conversion!.observations[1]!, {
      source: 'new-source',
      upstream: 'new-upstream',
    });
    const policy = {
      ...POLICY,
      trustedSources: { ...POLICY.trustedSources, 'new-source': 'new-upstream' },
    };
    expect(() => validateEvidence(next, next.identity, START, policy, prior)).toThrow(
      'SOURCE_PROVENANCE_CHANGED',
    );
  });
  it('handles timestamp-only progress when slots are unavailable for both observations', () => {
    const prior = nonSol();
    prior.conversion!.observations.forEach((o) => Object.assign(o, { slot: null }));
    const next = newer(prior, 1);
    next.conversion!.observations.forEach((o) =>
      Object.assign(o, { slot: null, price: { n: 11n, d: 1n } }),
    );
    Object.assign(next.conversion!, { price: { n: 11n, d: 1n } });
    expect(validateEvidence(next, next.identity, START + 1, POLICY, prior)).toEqual({
      n: 11n,
      d: 1000n,
    });
  });
  it('accepts fresh updates and rejects an older out-of-order update deterministically', () => {
    const first = nonSol(),
      middle = newer(first, 1),
      last = newer(first, 2);
    expect(() => validateEvidence(middle, middle.identity, START + 2, POLICY, first)).not.toThrow();
    expect(() => validateEvidence(last, last.identity, START + 2, POLICY, middle)).not.toThrow();
    for (let i = 0; i < 3; i++)
      expect(() => validateEvidence(middle, middle.identity, START + 2, POLICY, last)).toThrow(
        'REGRESSING_EVIDENCE',
      );
  });
  it('rejects malformed or absent previous conversion evidence rather than inventing a baseline', () => {
    const next = nonSol(),
      prior = { ...next, conversion: null };
    expect(() => validateEvidence(next, next.identity, START, POLICY, prior)).toThrow(
      'INVALID_PREVIOUS_EVIDENCE',
    );
  });
  it('still accepts SOL with no FX and rejects unexpected FX provenance', () => {
    const prior = evidence(),
      next = newer(prior, 1);
    expect(() => validateEvidence(next, TOKEN, START + 1, POLICY, prior)).not.toThrow();
    Object.assign(next, { conversion: nonSol().conversion });
    expect(() => validateEvidence(next, TOKEN, START + 1, POLICY, prior)).toThrow(
      'UNEXPECTED_CONVERSION',
    );
  });
  it('fails conflicting source prices explicitly and still rejects expired observations', () => {
    const e = nonSol();
    Object.assign(e.conversion!.observations[1]!, { price: { n: 100n, d: 1n } });
    expect(() => validateEvidence(e, e.identity, START, POLICY)).toThrow('CONTRADICTORY_PRICE');
    const stale = nonSol();
    expect(() => validateEvidence(stale, stale.identity, START + 5001, POLICY)).toThrow(
      'STALE_OR_INVALID_EVIDENCE',
    );
  });
  it('rejects an FX regression atomically in BUY, SELL, valuation and settlement', async () => {
    let now = START,
      current = nonSol();
    const sandbox = new DisposableSandbox(
      POLICY,
      async (ids) => new Map(ids.map((i) => [fingerprint(i), current])),
      () => now,
    );
    sandbox.add(account());
    const request = {
      owner: 'owner-a',
      account: 'acceptance-a',
      round: 'round-a',
      key: 'buy',
      identity: current.identity,
      side: 'BUY' as const,
      amount: SOL,
    };
    await sandbox.execute(request);
    const before = sandbox.read('acceptance-a');
    current = newer(current, 1);
    current.conversion!.observations.forEach((o) => Object.assign(o, { slot: 0n }));
    now += 1;
    await expect(
      sandbox.execute({ ...request, key: 'sell', side: 'SELL', amount: 'ALL' }),
    ).rejects.toThrow('REGRESSING_EVIDENCE');
    await expect(sandbox.execute({ ...request, key: 'second-buy' })).rejects.toThrow(
      'REGRESSING_EVIDENCE',
    );
    await expect(sandbox.equity('acceptance-a')).rejects.toThrow('REGRESSING_EVIDENCE');
    expect(sandbox.read('acceptance-a')).toEqual(before);
    now = CUTOFF;
    current = newer(current, CUTOFF - START);
    current.conversion!.observations.forEach((o) => Object.assign(o, { slot: 0n }));
    expect((await sandbox.settle('acceptance-a', 1, 3)).failures).toContain('REGRESSING_EVIDENCE');
    expect(sandbox.read('acceptance-a')).toEqual({ ...before, state: 'SETTLING' });
    current = newer(nonSol(), CUTOFF - START);
    expect((await sandbox.settle('acceptance-a', 2, 3)).state).toBe('FINALIZED');
    expect(sandbox.read('acceptance-a').cash).toBeLessThan(10n * SOL);
  });
});
