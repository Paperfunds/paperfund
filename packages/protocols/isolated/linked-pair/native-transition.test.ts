import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Stage1NonSolPumpSwap,
  type Stage1Snapshot,
} from '../../src/experimental/non-sol-pump-swap.js';
import { transitionLinkedSnapshot, assertUnchangedExternalAnchor } from './native-transition.js';
const evidence = JSON.parse(
  readFileSync(
    new URL('../../../../docs/linked-pair-20261021/market-quotes.json', import.meta.url),
    'utf8',
  ),
);
const snapshot = evidence.markets[0].state.normalizedState.stage1Snapshot as Stage1Snapshot;
const policy = { nowMs: Date.parse(snapshot.observedAt), maxAgeMs: 10000 };
const engine = new Stage1NonSolPumpSwap({
  purpose: 'READ_ONLY_STAGE1_VALIDATION',
  bridgeBinding: { quoteMint: snapshot.quoteMint, pool: snapshot.bridgePool },
});
describe('real captured Seal Dog native linked-route successor (candidate only)', () => {
  it('matches recorded native entry and preserves the input snapshot', async () => {
    const before = JSON.stringify(snapshot);
    const buy = await transitionLinkedSnapshot(snapshot, 100000000n, true, policy);
    expect(buy.quote.output.toString()).toBe(evidence.markets[0].quote.buy.output);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(buy.next.accounts[snapshot.bridgePool]).not.toEqual(
      snapshot.accounts[snapshot.bridgePool],
    );
    expect(buy.next.accounts[snapshot.targetPool]).not.toEqual(
      snapshot.accounts[snapshot.targetPool],
    );
    expect(buy.receipt.beforeHash).not.toBe(buy.receipt.afterHash);
    expect(BigInt(buy.receipt.orcaProtocolFee) + BigInt(buy.receipt.orcaLpFee)).toBe(
      buy.quote.bridge.lp,
    );
  });
  it('values and fully exits the post-BUY state through the same native path', async () => {
    const buy = await transitionLinkedSnapshot(snapshot, 100000000n, true, policy);
    const valuation = await engine.quote(buy.next, buy.quote.output, false, policy);
    const sell = await transitionLinkedSnapshot(buy.next, buy.quote.output, false, policy);
    expect(sell.quote.output).toBe(valuation.output);
    expect(sell.quote.output).toBeLessThan(100000000n);
    expect(sell.receipt.beforeHash).toBe(buy.receipt.afterHash);
  });
  it('consumes target, bridge and adaptive fee state across partial exits and repeated entries', async () => {
    const buy = await transitionLinkedSnapshot(snapshot, 100000000n, true, policy);
    const second = await transitionLinkedSnapshot(buy.next, 100000000n, true, policy);
    expect(second.quote.output).toBeLessThan(buy.quote.output);
    const quantity = buy.quote.output;
    const first = await transitionLinkedSnapshot(buy.next, quantity / 4n, false, policy);
    const last = await transitionLinkedSnapshot(
      first.next,
      quantity - quantity / 4n,
      false,
      policy,
    );
    expect(last.receipt.beforeHash).toBe(first.receipt.afterHash);
    expect(first.quote.output + last.quote.output).toBeLessThan(100000000n);
    // Independent pre-state quotes are the original bug, not a valid sequential oracle.
    const oldRemainder = await engine.quote(buy.next, quantity - quantity / 4n, false, policy);
    expect(last.quote.output).not.toBe(oldRemainder.output);
  });
  it('does not transplant chain changes, missing routes or older observations into a paper branch', () => {
    const fresh = structuredClone(snapshot);
    expect(() => assertUnchangedExternalAnchor(snapshot, fresh)).not.toThrow();
    const later = structuredClone(fresh);
    later.slot++;
    expect(() => assertUnchangedExternalAnchor(snapshot, later)).toThrow(
      'EXTERNAL_FRONTIER_UNPROVEN',
    );
    const changed = structuredClone(fresh);
    changed.accounts[snapshot.targetPool] = {
      ...changed.accounts[snapshot.targetPool]!,
      base64: changed.accounts[snapshot.targetPool]!.base64 + 'AA',
    };
    expect(() => assertUnchangedExternalAnchor(snapshot, changed)).toThrow(
      'EXTERNAL_RECONCILIATION_REQUIRED',
    );
    const gone = structuredClone(fresh);
    delete gone.accounts[snapshot.bridgePool];
    expect(() => assertUnchangedExternalAnchor(snapshot, gone)).toThrow(
      'EXTERNAL_RECONCILIATION_REQUIRED',
    );
    const different = structuredClone(fresh);
    different.bridgePool = snapshot.targetPool;
    expect(() => assertUnchangedExternalAnchor(snapshot, different)).toThrow('ROUTE_CHANGED');
    fresh.slot = snapshot.slot - 1;
    expect(() => assertUnchangedExternalAnchor(snapshot, fresh)).toThrow('REGRESSING_ANCHOR');
  });
  it('fails stale or missing cutoff state instead of producing a zero-valued settlement', async () => {
    const before = JSON.stringify(snapshot);
    await expect(
      transitionLinkedSnapshot(snapshot, 100000000n, true, {
        ...policy,
        nowMs: policy.nowMs + 10001,
      }),
    ).rejects.toThrow();
    const buy = await transitionLinkedSnapshot(snapshot, 100000000n, true, policy);
    const gone = structuredClone(buy.next);
    delete gone.accounts[snapshot.bridgePool];
    await expect(transitionLinkedSnapshot(gone, buy.quote.output, false, policy)).rejects.toThrow();
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('carries depletion across 100 small exits without replaying pre-exit reserves', async () => {
    const buy = await transitionLinkedSnapshot(snapshot, 100000000n, true, policy);
    let current = buy.next,
      total = 0n,
      held = buy.quote.output;
    for (let i = 0; i < 100; i++) {
      const amount = i === 99 ? held : buy.quote.output / 100n;
      const exit = await transitionLinkedSnapshot(current, amount, false, policy);
      total += exit.quote.output;
      held -= amount;
      current = exit.next;
    }
    expect(held).toBe(0n);
    expect(total).toBeLessThan(100000000n);
    expect(current).not.toEqual(buy.next);
  }, 15000);
});
