import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quote as oldQuote } from '../simple-price-v2/model.js';
import { synthetic as oldSynthetic } from '../simple-price-v2/test-support.js';
import { quote, replayFill, MODEL_VERSION, snapshotHash, fingerprint } from './model.js';
import { POLICY, START, SOL, TOKEN } from './test-support.js';
import { directionalFixture } from './fixtures.js';
import { directionalBuy, directionalSell, costHash } from './costs.js';
import { IsolatedHighWater } from './high-water.js';
const i = { ...TOKEN, quote: 'PUMP' },
  e = directionalFixture(i, START);
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
describe('isolated directional contract', () => {
  it('retains every legacy SOL fill field except the explicit new model version', () => {
    const evidence = oldSynthetic();
    for (const budget of [20000000n, 100000000n, SOL, 2n * SOL]) {
      const old = oldQuote('BUY', budget, evidence, TOKEN, START, POLICY),
        next = quote('BUY', budget, evidence, TOKEN, START, POLICY);
      expect(next).toEqual({ ...old, modelVersion: MODEL_VERSION });
      const sell = oldQuote('SELL', old.output, evidence, TOKEN, START, POLICY);
      expect(quote('SELL', next.output, evidence, TOKEN, START, POLICY)).toEqual({
        ...sell,
        modelVersion: MODEL_VERSION,
      });
    }
  });
  it('separates fixed foreign-unit ceilings from size loss and never charges a net quote twice', () => {
    const buy = quote('BUY', SOL, e, i, START, POLICY),
      sell = quote('SELL', buy.output, e, i, START, POLICY);
    expect(buy.input).toBe(SOL);
    expect(sell.output).toBeLessThan(SOL);
    expect(SOL - sell.output).toBe(
      buy.costs.fixedFeeLamports +
        buy.costs.sizeImpactAndDustLamports +
        sell.costs.fixedFeeLamports +
        sell.costs.sizeImpactAndDustLamports,
    );
    expect(replayFill(buy)).toEqual(buy);
    expect(replayFill(sell)).toEqual(sell);
    writeFileSync(
      'artifacts/simple-price-v2-directional-review/fixture-numerical.json',
      JSON.stringify(
        { buy, sell },
        (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
  });
  it('retains at most the full peak net after 500 exits', () => {
    const buy = quote('BUY', SOL, e, i, START, POLICY),
      full = quote('SELL', buy.output, e, i, START, POLICY);
    let remaining = buy.output,
      total = 0n;
    for (let n = 0; n < 500; n++) {
      const q = n === 499 ? remaining : buy.output / 500n;
      total += quote('SELL', q, e, i, START, POLICY, undefined, buy.output).output;
      remaining -= q;
    }
    expect(total).toBeLessThanOrEqual(full.output);
    expect(full.output - total).toBeLessThan(500n);
  });
  it('reprices both directional adaptive fees using fresh evidence', () => {
    const newer = directionalFixture(i, START + 1, 4500n, 7600n),
      buy = quote('BUY', SOL, e, i, START, POLICY);
    expect(quote('BUY', SOL, newer, i, START + 1, POLICY, e).output).toBeLessThan(buy.output);
    expect(
      quote('SELL', buy.output, newer, i, START + 1, POLICY, e, buy.output).output,
    ).toBeLessThan(quote('SELL', buy.output, e, i, START, POLICY).output);
  });
  it('reprices current partial exits after a genuine fresh price rise or fall', () => {
    const buy = quote('BUY', SOL, e, i, START, POLICY),
      base = quote('SELL', buy.output / 2n, e, i, START, POLICY, undefined, buy.output).output;
    const up = directionalFixture(i, START + 1, 1600n, 1600n, { n: 11n, d: 500n }),
      down = directionalFixture(i, START + 1, 1600n, 1600n, { n: 9n, d: 500n });
    expect(
      quote('SELL', buy.output / 2n, up, i, START + 1, POLICY, e, buy.output).output,
    ).toBeGreaterThan(base);
    expect(
      quote('SELL', buy.output / 2n, down, i, START + 1, POLICY, e, buy.output).output,
    ).toBeLessThan(base);
  });
  it.each(['missing', 'variable', 'stale', 'conflict', 'double'])(
    'rejects %s fee authority',
    (kind) => {
      const bad = structuredClone(e) as Mutable<typeof e>;
      if (kind === 'missing') Object.assign(bad.directionalCosts!, { SELL: undefined });
      if (kind === 'variable') bad.directionalCosts!.BUY.proofs[0]!.rateMax.n++;
      if (kind === 'stale') bad.directionalCosts!.SELL.proofs[0]!.observedAtMs -= 10000;
      if (kind === 'conflict') bad.directionalCosts!.SELL.proofs[0]!.upstream = 'forged';
      if (kind === 'double') bad.fees = [{ category: 'DUPLICATED', bps: 325n }];
      bad.calibration.snapshotHash = snapshotHash(bad);
      expect(() => quote('BUY', SOL, bad, i, START, POLICY)).toThrow();
    },
  );
  it('keeps a fee-only waterfall exact in foreign units including sub-lamport rounding', () => {
    const b = directionalBuy(1000000n, e),
      s = directionalSell(1000000n, e);
    // Independent hand calculation: bridge=1600; quote budget=19,968,000; fee basis=floor(/1.0325).
    expect(b.notional + b.fees.reduce((a, f) => a + f.amount, 0n) + b.dust).toBe(1000000n);
    expect(s.net).toBe(965952n); // 1,000,000*(1-.0325)*(1-.0016), exactly integral here.
    expect(b.notional).toBe(966973n);
  });
  it('persists directional chronology across objects, permits fresh same-second slots and rejects replay conflicts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paperfund-simple-v2-directional-'));
    await new IsolatedHighWater(dir, POLICY).accept(e, START);
    await new IsolatedHighWater(dir, POLICY).accept(e, START);
    const sameClock = (buy: bigint) => {
      const next = directionalFixture(i, START + 1, buy, 1800n);
      for (const o of [
        ...next.observations,
        ...next.conversion!.observations,
        ...next.directionalCosts!.BUY.proofs,
        ...next.directionalCosts!.SELL.proofs,
        ...next.calibration.quotes,
      ])
        Object.assign(o, { observedAtMs: START });
      Object.assign(next, { feeObservedAtMs: START });
      for (const q of next.calibration.quotes) Object.assign(q, { feesHash: costHash(next) });
      Object.assign(next.calibration, { snapshotHash: snapshotHash(next) });
      return next;
    };
    const newer = sameClock(1700n);
    await new IsolatedHighWater(dir, POLICY).accept(newer, START + 1);
    await expect(new IsolatedHighWater(dir, POLICY).accept(e, START + 1)).rejects.toThrow(
      'REGRESSING',
    );
    const conflict = sameClock(1900n);
    await expect(new IsolatedHighWater(dir, POLICY).accept(conflict, START + 1)).rejects.toThrow(
      'CONFLICTING_FEE',
    );
    expect(fingerprint(newer.directionalCosts)).not.toBe(fingerprint(e.directionalCosts));
  });
  it('accepts repeated same-bank observations with fresh receipt references without weakening cost conflict checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paperfund-simple-v2-directional-'));
    await new IsolatedHighWater(dir, POLICY).accept(e, START);
    const again = structuredClone(e);
    for (const o of [
      ...again.observations,
      ...again.conversion!.observations,
      ...again.directionalCosts!.BUY.proofs,
      ...again.directionalCosts!.SELL.proofs,
    ])
      Object.assign(o, { reference: 'FRESH_RECEIPT_SAME_BANK' });
    for (const q of again.calibration.quotes) Object.assign(q, { feesHash: costHash(again) });
    Object.assign(again.calibration, { snapshotHash: snapshotHash(again) });
    await new IsolatedHighWater(dir, POLICY).accept(again, START);
  });
});
