import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { IsolatedHighWater } from './high-water.js';
import { synthetic, rebind, TOKEN, POLICY, START } from './test-support.js';
import { fingerprint } from './model.js';
const roots: string[] = [];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'paperfund-simple-v2-'));
  roots.push(directory);
  return { directory, store: new IsolatedHighWater(directory, POLICY) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'paperfund-simple-v2-'))
      throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(root, { recursive: true, force: true });
  }
});
describe('isolated durable provider high-water authority', () => {
  it('lost persisted authority does not silently create a new baseline', async () => {
    const { directory, store } = await setup();
    await store.accept(synthetic(TOKEN, START + 2), START + 2);
    await unlink(join(directory, 'authority.json'));
    await expect(
      new IsolatedHighWater(directory, POLICY).accept(synthetic(), START + 2),
    ).rejects.toThrow('HIGH_WATER_MISSING');
  });
  it('requires isolated storage and persists across fresh store objects', async () => {
    expect(() => new IsolatedHighWater('packages/db', POLICY)).toThrow('ISOLATED_STORAGE_REQUIRED');
    const { directory, store } = await setup();
    const recent = synthetic(TOKEN, START + 2);
    await store.accept(recent, START + 2);
    const restart = new IsolatedHighWater(directory, POLICY);
    await expect(restart.accept(synthetic(TOKEN, START + 1), START + 2)).rejects.toThrow(
      'REGRESSING_EVIDENCE',
    );
    await restart.accept(recent, START + 2);
    await restart.accept(synthetic(TOKEN, START + 3), START + 3);
  });
  for (const kind of ['native', 'fx'] as const) {
    it(
      kind + ' timestamp and slot regressions reject independently, with immutable durable state',
      async () => {
        const { directory, store } = await setup(),
          i = { ...TOKEN, quote: 'QUOTE' },
          prev = synthetic(i, START + 10, undefined, undefined, undefined, { n: 2n, d: 1n });
        await store.accept(prev, START + 10);
        const before = await readFile(join(directory, 'authority.json'), 'utf8');
        for (const field of ['observedAtMs', 'slot'] as const) {
          const next = structuredClone(
              synthetic(i, START + 11, undefined, undefined, undefined, { n: 2n, d: 1n }),
            ),
            o = kind === 'fx' ? next.conversion!.observations[0]! : next.observations[0]!;
          Object.assign(
            o,
            field === 'slot' ? { slot: BigInt(START + 9) } : { observedAtMs: START + 9 },
          );
          // Quote skew is checked after chronological validation, so this specifically verifies the cursor gate.
          await expect(store.accept(rebind(next), START + 11)).rejects.toThrow(
            'REGRESSING_EVIDENCE',
          );
          expect(await readFile(join(directory, 'authority.json'), 'utf8')).toBe(before);
        }
      },
    );
    it(
      kind + ' same-cursor conflict rejects; primary-source swapping cannot reset authority',
      async () => {
        const { store } = await setup(),
          i = { ...TOKEN, quote: 'QUOTE' },
          prev = synthetic(i, START, undefined, undefined, undefined, { n: 2n, d: 1n });
        await store.accept(prev, START);
        const conflict = structuredClone(prev),
          o = kind === 'fx' ? conflict.conversion!.observations[0]! : conflict.observations[0]!;
        Object.assign(o, { price: { n: o.price.n * 1001n, d: o.price.d * 1000n } });
        if (kind === 'fx') Object.assign(conflict.conversion!, { price: o.price });
        await expect(store.accept(rebind(conflict), START)).rejects.toThrow(
          'CONFLICTING_SOURCE_EVIDENCE',
        );
        const switched = structuredClone(prev);
        const observations =
          kind === 'fx' ? switched.conversion!.observations : switched.observations;
        Object.assign(kind === 'fx' ? switched.conversion! : switched, {
          observations: [...observations].reverse(),
        });
        await expect(store.accept(rebind(switched), START)).rejects.toThrow(
          'SOURCE_PROVENANCE_CHANGED',
        );
      },
    );
  }
  it('conversion authority is shared across tokens using the same quote currency', async () => {
    const { store } = await setup(),
      a = { ...TOKEN, quote: 'QUOTE' },
      b = { ...a, mint: 'other', market: 'other-market' };
    await store.accept(
      synthetic(a, START + 2, undefined, undefined, undefined, { n: 2n, d: 1n }),
      START + 2,
    );
    await expect(
      store.accept(
        synthetic(b, START + 1, undefined, undefined, undefined, { n: 2n, d: 1n }),
        START + 2,
      ),
    ).rejects.toThrow('REGRESSING_EVIDENCE');
    await store.accept(
      synthetic(b, START + 3, undefined, undefined, undefined, { n: 2n, d: 1n }),
      START + 3,
    );
  });
  it('batch validation is atomic and cannot commit one good token ahead of a bad token', async () => {
    const { directory, store } = await setup(),
      e = synthetic();
    await store.accept(e, START);
    const before = await readFile(join(directory, 'authority.json'), 'utf8');
    await expect(
      store.acceptBatch([synthetic(TOKEN, START + 2), synthetic(TOKEN, START + 1)], START + 2),
    ).rejects.toThrow('REGRESSING_EVIDENCE');
    expect(await readFile(join(directory, 'authority.json'), 'utf8')).toBe(before);
  });
  it('quote and fee evidence cannot regress or conflict at the same authoritative cursor', async () => {
    const { store } = await setup();
    // Slot skew is widened only in this synthetic policy to isolate chronological quote validation.
    const wide = { ...POLICY, maxQuoteSlotSkew: 2n },
      tracker = new IsolatedHighWater(store.directory, wide);
    const prev = synthetic();
    await tracker.accept(prev, START);
    const reg = structuredClone(synthetic(TOKEN, START + 1));
    Object.assign(reg.calibration.quotes[0]!, {
      observedAtMs: START - 1,
      slot: BigInt(START) - 1n,
    });
    await expect(tracker.accept(reg, START + 1)).rejects.toThrow('REGRESSING_QUOTE_EVIDENCE');
    const conflict = structuredClone(prev);
    Object.assign(conflict.calibration.quotes[1]!, {
      output: conflict.calibration.quotes[1]!.output - 1n,
    });
    await expect(tracker.accept(conflict, START)).rejects.toThrow('CONFLICTING_QUOTE_EVIDENCE');
    const fee = synthetic(TOKEN, START + 1);
    Object.assign(fee, { feeObservedAtMs: START - 1 });
    await expect(tracker.accept(rebind(fee), START + 1)).rejects.toThrow('REGRESSING_FEE_EVIDENCE');
  });
  it('whole-version baseline prevents gradual movement ratcheting', async () => {
    const { directory } = await setup(),
      p = { ...POLICY, maxMovementBps: 1000n },
      store = new IsolatedHighWater(directory, p);
    await store.accept(synthetic(), START);
    await store.accept(synthetic(TOKEN, START + 1, { n: 105n, d: 100000n }), START + 1);
    await expect(
      store.accept(synthetic(TOKEN, START + 2, { n: 11025n, d: 10_000_000n }), START + 2),
    ).rejects.toThrow('CONTRADICTORY_PRICE');
  });
  it('corruption, policy changes and abandoned writer locks fail closed', async () => {
    const { directory, store } = await setup();
    await store.accept(synthetic(), START);
    await expect(
      new IsolatedHighWater(directory, { ...POLICY, version: 'different' }).accept(
        synthetic(),
        START,
      ),
    ).rejects.toThrow('HIGH_WATER_VERSION_MISMATCH');
    const lock = await open(join(directory, 'authority.lock'), 'wx');
    await expect(store.accept(synthetic(), START)).rejects.toThrow('HIGH_WATER_BUSY');
    await lock.close();
    await unlink(join(directory, 'authority.lock'));
    await writeFile(join(directory, 'authority.json'), 'corrupt');
    await expect(store.accept(synthetic(), START)).rejects.toThrow('HIGH_WATER_CORRUPTED');
  });
  it('repeated observations do not mutate caller-owned provenance', async () => {
    const { store } = await setup(),
      e = synthetic(),
      hash = fingerprint(e);
    await store.accept(e, START);
    await store.accept(e, START);
    expect(fingerprint(e)).toBe(hash);
  });
});
