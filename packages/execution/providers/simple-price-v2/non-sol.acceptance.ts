import { it, describe, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  NonSolProvider,
  NON_SOL_SAMPLES,
  orientedPrice,
  fixedCostProof,
  verifyNonSolQuorum,
  mergeSameBank,
} from './non-sol.js';
import type { NonSolObservation } from './non-sol.js';
import { ENDPOINTS } from './provider.js';
import { WRAPPED_SOL_MINT } from '@paperfund/protocols';
const dir = 'artifacts/simple-price-v2-non-sol-review/';
const save = (name: string, value: unknown) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    dir + name,
    JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
};
function synthetic(index: 0 | 1): NonSolObservation {
  const native = {
    source: index === 0 ? 'solana' : 'publicnode',
    upstream: ENDPOINTS[index],
    reference: 'SYNTHETIC_ONLY',
    identity: { mint: 'TEST_BASE', market: 'TEST_POOL', quote: 'TEST_QUOTE' },
    observedAtMs: Date.now(),
    slot: 100n,
    price: { n: 2n, d: 3n },
    tradeable: true,
  };
  return {
    native,
    conversion: {
      ...native,
      identity: { mint: 'TEST_QUOTE', market: 'conversion:TEST_QUOTE', quote: WRAPPED_SOL_MINT },
      price: { n: 5n, d: 7n },
    },
    baseDecimals: 6,
    quoteDecimals: 9,
    sourceState: {} as NonSolObservation['sourceState'],
    primaryFeeBps: { lp: 0n, protocol: 0n, creator: 0n },
    conversionFeePpm: 0n,
    adaptiveFee: false,
    costs: fixedCostProof({ n: 0n, d: 1n }, { n: 0n, d: 1n }, { n: 5n, d: 7n }),
  };
}
describe('non-SOL denomination and fee contract: explicit synthetic boundary inputs', () => {
  it('reassembles only identical confirmed slots and Clock evidence', () => {
    const clock = { owner: 'TEST_ONLY', data: ['AA==', 'base64'] as [string, string] },
      a = { owner: 'TEST_ONLY', data: ['AQ==', 'base64'] as [string, string] };
    const parts = [
      {
        keys: ['SysvarC1ock11111111111111111111111111111111', 'A'],
        batch: { context: { slot: 1 }, value: [clock, a] },
      },
      {
        keys: ['SysvarC1ock11111111111111111111111111111111', 'B'],
        batch: { context: { slot: 1 }, value: [clock, null] },
      },
    ];
    expect(mergeSameBank(['A', 'B'], parts).value).toEqual([a, null]);
    expect(() =>
      mergeSameBank(
        ['A', 'B'],
        [parts[0]!, { ...parts[1]!, batch: { ...parts[1]!.batch, context: { slot: 2 } } }],
      ),
    ).toThrow('CONVERSION_BANK_INCOHERENT');
  });
  it('rejects missing or conflicting batch evidence without inventing a bank timestamp', () => {
    expect(() => mergeSameBank(['A'], [])).toThrow();
    const p = { keys: ['A'], batch: { context: { slot: 1 }, value: [null] } };
    expect(() => mergeSameBank(['A'], [p])).toThrow('CONVERSION_CLOCK_MISSING');
  });
  it('uses intended traded token rather than first pool mint', () => {
    expect(orientedPrice('QUOTE', 'TOKEN', 'TOKEN', 'QUOTE', { n: 2n, d: 3n })).toEqual({
      n: 3n,
      d: 2n,
    });
    expect(() => orientedPrice('A', 'B', 'TOKEN', 'QUOTE', { n: 1n, d: 1n })).toThrow(
      'TERMINAL_TOKEN_POOL_IDENTITY_MISMATCH',
    );
  });
  it('inverts quote/SOL orientation before multiplying base-unit prices', () => {
    const price = orientedPrice(WRAPPED_SOL_MINT, 'QUOTE', 'QUOTE', WRAPPED_SOL_MINT, {
      n: 2n,
      d: 5n,
    });
    expect(price).toEqual({ n: 5n, d: 2n });
    expect(verifyNonSolQuorum([synthetic(0), synthetic(1)], 'TEST_BASE')).toEqual({
      n: 10n,
      d: 21n,
    });
  });
  it('does not apply decimals a second time to base-unit ratios', () => {
    const a = synthetic(0),
      b = synthetic(1);
    a.quoteDecimals = b.quoteDecimals = 6;
    expect(verifyNonSolQuorum([a, b], 'TEST_BASE')).toEqual({ n: 10n, d: 21n });
  });
  it('keeps zero-fee conversion representable and preserves a single native quote-premium fee', () => {
    expect(fixedCostProof({ n: 0n, d: 1n }, { n: 0n, d: 1n }, { n: 4n, d: 5n }).representable).toBe(
      true,
    );
    expect(
      fixedCostProof({ n: 125n, d: 10000n }, { n: 0n, d: 1n }, { n: 1n, d: 1n }).commonIntegerBps,
    ).toBe(125n);
  });
  it('rejects asymmetric compound costs instead of fitting them as size impact', () => {
    const p = fixedCostProof({ n: 125n, d: 10000n }, { n: 3000n, d: 1000000n }, { n: 1n, d: 1n });
    expect(p.exactSameRate).toBe(false);
    expect(p.unsupported).toBe('ASYMMETRIC_COMPOSED_FIXED_FEES');
    expect(p.buyPremium.n * p.sellDeduction.d).toBeGreaterThan(p.sellDeduction.n * p.buyPremium.d);
  });
  it('rejects foreign-unit fee ceilings even with a zero-fee bridge', () => {
    expect(
      fixedCostProof({ n: 125n, d: 10000n }, { n: 0n, d: 1n }, { n: 1n, d: 1000n }).unsupported,
    ).toBe('QUOTE_FEE_ROUNDING_NOT_LAMPORT_EQUIVALENT');
  });
  it('rejects invalid fee and price rationals', () => {
    expect(() => fixedCostProof({ n: 1n, d: 1n }, { n: 0n, d: 1n }, { n: 1n, d: 1n })).toThrow(
      'INVALID_FEES',
    );
    expect(() => orientedPrice('A', 'B', 'A', 'B', { n: 0n, d: 1n })).toThrow('INVALID_PRICE');
  });
  it('rejects stale FX and contradictory rates', () => {
    const a = synthetic(0),
      b = synthetic(1);
    b.conversion = { ...b.conversion, observedAtMs: Date.now() - 10000 };
    expect(() => verifyNonSolQuorum([a, b], 'TEST_BASE')).toThrow('STALE_OR_UNTRUSTED_CONVERSION');
    b.conversion = {
      ...a.conversion,
      source: 'publicnode',
      upstream: ENDPOINTS[1],
      price: { n: 100n, d: 1n },
    };
    expect(() => verifyNonSolQuorum([a, b], 'TEST_BASE')).toThrow('CONTRADICTORY_PRICE');
  });
  it('rejects source identity, quote mint and decimals conflicts', () => {
    const a = synthetic(0),
      b = synthetic(1);
    b.quoteDecimals = 8;
    expect(() => verifyNonSolQuorum([a, b], 'TEST_BASE')).toThrow('CONFLICTING_SOURCE_EVIDENCE');
    expect(() => verifyNonSolQuorum([a, synthetic(1)], 'WRONG_BASE')).toThrow(
      'CONFLICTING_SOURCE_EVIDENCE',
    );
  });
  it('rejects native and conversion regressions deterministically', () => {
    const prior = [synthetic(0), synthetic(1)],
      current = structuredClone(prior);
    current[0]!.conversion = { ...current[0]!.conversion, slot: 99n };
    expect(() => verifyNonSolQuorum(current, 'TEST_BASE', prior)).toThrow('REGRESSING_EVIDENCE');
    current[0]!.conversion = prior[0]!.conversion;
    current[0]!.native = { ...current[0]!.native, observedAtMs: prior[0]!.native.observedAtMs - 1 };
    expect(() => verifyNonSolQuorum(current, 'TEST_BASE', prior)).toThrow('REGRESSING_EVIDENCE');
  });
});
describe.skipIf(process.env['PAPERFUND_V2_NON_SOL_LIVE'] !== '1')(
  'read-only native non-SOL and composed market review',
  () => {
    it('captures exact native/FX identities and multi-size independent quotes without manufacturing fill authority', async () => {
      const provider = new NonSolProvider(),
        rows: unknown[] = [];
      for (const s of NON_SOL_SAMPLES) {
        const row: Record<string, unknown> = { ...s };
        try {
          await provider.inspect(s.mint);
          row['status'] = 'unexpected unguarded admission';
        } catch (error) {
          row['guard'] = String(error);
          row['review'] = provider.reviews.get(s.mint);
        }
        row['independent'] = await provider.independentQuotes(s.mint);
        rows.push(row);
        save('live-markets.json', rows);
      }
      expect(rows.length).toBe(4);
    }, 240000);
  },
);
