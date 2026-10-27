import { capturePumpLinkedGroup } from './pump-capture.js';
import { pumpInterval } from './pump-fixtures.js';
import { describe, it, expect } from 'vitest';
import { LinkedEngine, validatePumpPool } from './engine.js';
import { pumpBank, PUMP_BRIDGE } from './pump-fixtures.js';
import { linkedBindings, linkedRoute, carryLinkedRoot } from './shared-bridge.js';
import { transitionLinkedSnapshot } from './native-transition.js';
import { WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
const bank = pumpBank(),
  policy = { nowMs: Date.parse(bank.observedAt), maxAgeMs: 10000 };
const engine = new LinkedEngine({
  purpose: 'READ_ONLY_STAGE1_VALIDATION',
  bridgeBinding: { quoteMint: bank.quoteMint, pool: PUMP_BRIDGE },
});
describe('real slot459684978 native two-Pump route', () => {
  it('matches retained native BUYs and consumes successors through full/partial SELL', async () => {
    for (const r of linkedBindings(bank)) {
      const s = linkedRoute(bank, r.mint),
        before = JSON.stringify(s),
        buy = await transitionLinkedSnapshot(s, 10000000n, true, policy);
      expect(buy.quote.output.toString()).toBe(
        r.mint.startsWith('F4') ? '316527268786' : '94947938740',
      );
      expect(JSON.stringify(s)).toBe(before);
      const full = await transitionLinkedSnapshot(buy.next, buy.quote.output, false, policy);
      expect(full.quote.output).toBeLessThan(10000000n);
      const part = await transitionLinkedSnapshot(buy.next, buy.quote.output / 4n, false, policy),
        rest = await transitionLinkedSnapshot(
          part.next,
          buy.quote.output - buy.quote.output / 4n,
          false,
          policy,
        );
      expect(part.quote.output + rest.quote.output).toBeLessThan(10000000n);
      const valuation = await engine.quote(buy.next, buy.quote.output, false, policy);
      expect(valuation.output).toBe(full.quote.output);
    }
  });
  it('shares bridge consumption across distinct targets and repeated BUYs', async () => {
    let s = bank;
    const results = [];
    for (const r of [...linkedBindings(bank), ...linkedBindings(bank)]) {
      const q = await transitionLinkedSnapshot(linkedRoute(s, r.mint), 10000000n, true, policy);
      results.push(q.quote.output);
      s = carryLinkedRoot(s, q.next);
    }
    expect(results[2]!).toBeLessThan(results[0]!);
    expect(results[3]!).toBeLessThan(results[1]!);
    const p = await validatePumpPool(s, PUMP_BRIDGE, s.quoteMint, WRAPPED_SOL_MINT);
    expect(p.math.protocolBucket).toBeGreaterThan(
      (await validatePumpPool(bank, PUMP_BRIDGE, bank.quoteMint, WRAPPED_SOL_MINT)).math
        .protocolBucket,
    );
  });
});

it('captures both canonical targets and one native bridge in a single finalized account bank', async () => {
  const s = pumpInterval.before,
    mints = linkedBindings(s).map((r) => r.mint);
  let reads = 0;
  const capture = await capturePumpLinkedGroup(
    async (addresses) => {
      reads++;
      return {
        commitment: 'finalized',
        context: { slot: s.slot },
        value: addresses.map((a) =>
          s.accounts[a]
            ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
            : null,
        ),
      };
    },
    mints,
    s.quoteMint,
    s.bridgePool,
    () => Date.parse(s.observedAt),
  );
  expect(reads).toBe(2);
  expect(capture.snapshot.accounts).toEqual(s.accounts);
  expect(capture.snapshot.slot).toBe(459703404);
  expect(linkedBindings(capture.snapshot)).toHaveLength(2);
  await expect(
    capturePumpLinkedGroup(
      async () => ({ commitment: 'processed', context: { slot: s.slot }, value: [] }) as never,
      mints,
      s.quoteMint,
      s.bridgePool,
    ),
  ).rejects.toThrow('FINALIZED');
});
it('uses SOL market-cap fees, preserves target holder rewards and rejects stale, missing or unsupported native states', async () => {
  const p = await validatePumpPool(bank, PUMP_BRIDGE, bank.quoteMint, WRAPPED_SOL_MINT);
  expect([p.math.lpBps, p.math.protocolBps, p.math.creatorBps]).toEqual([20n, 5n, 5n]);
  for (const r of linkedBindings(bank)) {
    const q = await engine.quote(linkedRoute(bank, r.mint), 10000000n, true, policy);
    expect(q.creatorFeeDestination).toBe('HOLDER_REWARD');
    expect(q.bridge.detail.nativeInstruction).toBe('buy_exact_quote_in_v2');
    expect(q.bridge.feeMint).toBe(WRAPPED_SOL_MINT);
    expect(q.bridge.creator).toBeGreaterThan(0n);
  }
  await expect(
    engine.quote(bank, 10000000n, true, { ...policy, nowMs: policy.nowMs + 11000 }),
  ).rejects.toThrow('STALE');
  const missing = structuredClone(bank);
  delete missing.accounts[PUMP_BRIDGE];
  await expect(engine.quote(missing, 10000000n, true, policy)).rejects.toThrow();
  const unsupported = structuredClone(bank),
    raw = Buffer.from(unsupported.accounts[PUMP_BRIDGE]!.base64, 'base64');
  raw[243] = 1;
  unsupported.accounts[PUMP_BRIDGE] = {
    ...unsupported.accounts[PUMP_BRIDGE]!,
    base64: raw.toString('base64'),
  };
  await expect(engine.quote(unsupported, 10000000n, true, policy)).rejects.toThrow('UNSUPPORTED');
  await expect(
    new LinkedEngine({ purpose: 'READ_ONLY_STAGE1_VALIDATION' }).quote(
      bank,
      10000000n,
      true,
      policy,
    ),
  ).rejects.toThrow('BINDING');
});
