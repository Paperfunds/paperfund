import { describe, it, expect } from 'vitest';
import { sharedEvidence, compositeInterval } from './remaining-fixtures.js';
import {
  linkedBindings,
  linkedRoute,
  carryLinkedRoot,
  mergeLinkedSnapshots,
} from './shared-bridge.js';
import { newLinkedBranch, reconcileLinkedInterval, digest } from './external-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
const e = compositeInterval(),
  s = e.before,
  routes = linkedBindings(s),
  policy = { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 };
describe('one bridge revision across distinct genuine target bindings', () => {
  it('retains an atomic genuine two-mint bank and reconciles its zero-activity interval once', async () => {
    const s = sharedEvidence.before;
    expect(linkedBindings(s)).toHaveLength(2);
    const r = await reconcileLinkedInterval(
      newLinkedBranch('real', 'round', s),
      sharedEvidence,
      Date.parse(sharedEvidence.after.observedAt),
      10000,
    );
    expect(digest(r.branch.real)).toBe(digest(sharedEvidence.after));
    expect(r.events).toBe(0);
    for (const route of linkedBindings(s))
      await expect(
        transitionLinkedSnapshot(linkedRoute(s, route.mint), 100000000n, true, {
          nowMs: Date.parse(s.observedAt),
          maxAgeMs: 10000,
        }),
      ).rejects.toThrow();
  });
  it('consumes one bridge across consecutive two-target buys and partial/full sells (mixed-time controlled bank)', async () => {
    const a = await transitionLinkedSnapshot(
        linkedRoute(s, routes[0]!.mint),
        100000000n,
        true,
        policy,
      ),
      root = carryLinkedRoot(s, a.next),
      b = await transitionLinkedSnapshot(
        linkedRoute(root, routes[1]!.mint),
        100000000n,
        true,
        policy,
      ),
      reset = await transitionLinkedSnapshot(
        linkedRoute(s, routes[1]!.mint),
        100000000n,
        true,
        policy,
      );
    expect(b.quote.output).toBeLessThan(reset.quote.output);
    expect(b.next.accounts[routes[0]!.targetPool]).toEqual(a.next.accounts[routes[0]!.targetPool]);
    let state = carryLinkedRoot(root, b.next);
    const part = await transitionLinkedSnapshot(
      linkedRoute(state, routes[0]!.mint),
      a.quote.output / 3n,
      false,
      policy,
    );
    state = carryLinkedRoot(state, part.next);
    const fullB = await transitionLinkedSnapshot(
      linkedRoute(state, routes[1]!.mint),
      b.quote.output,
      false,
      policy,
    );
    state = carryLinkedRoot(state, fullB.next);
    const restA = await transitionLinkedSnapshot(
      linkedRoute(state, routes[0]!.mint),
      a.quote.output - a.quote.output / 3n,
      false,
      policy,
    );
    expect(part.quote.output + fullB.quote.output + restA.quote.output).toBeLessThan(200000000n);
  });
  it('replays the retained genuine Orca swap once into the controlled composite without erasing either paper target', async () => {
    const b = newLinkedBranch('scope', 'hour', s);
    for (const route of routes) {
      const p = await transitionLinkedSnapshot(
        linkedRoute(b.simulated, route.mint),
        100000000n,
        true,
        policy,
      );
      b.simulated = carryLinkedRoot(b.simulated, p.next);
    }
    const before = digest(b.simulated),
      r = await reconcileLinkedInterval(b, e, Date.parse(e.after.observedAt), 10000);
    expect(r.events).toBe(1);
    expect(digest(r.branch.simulated)).not.toBe(before);
    expect(digest(r.branch.simulated)).not.toBe(digest(r.branch.real));
    for (const route of routes)
      expect(r.branch.simulated.accounts[route.targetPool]).toEqual(
        b.simulated.accounts[route.targetPool],
      );
    const repeated = await reconcileLinkedInterval(
      r.branch,
      e,
      Date.parse(e.after.observedAt),
      10000,
    );
    expect(digest(repeated.branch)).toBe(digest(r.branch));
  });
  it('rejects different banks, conflicting copies, duplicate targets and changed route bindings', () => {
    const a = linkedRoute(s, routes[0]!.mint),
      b = linkedRoute(s, routes[1]!.mint);
    expect(() => mergeLinkedSnapshots([a, { ...b, slot: b.slot + 1 }])).toThrow(
      'LINKED_BANK_OR_BRIDGE_MISMATCH',
    );
    const conflict = structuredClone(b);
    conflict.accounts[s.bridgePool] = {
      ...conflict.accounts[s.bridgePool]!,
      base64: conflict.accounts[s.bridgePool]!.base64 + 'AA',
    };
    expect(() => mergeLinkedSnapshots([a, conflict])).toThrow('LINKED_SHARED_ACCOUNT_CONFLICT');
    expect(() => mergeLinkedSnapshots([a, a])).toThrow('LINKED_SHARED_BINDING_CONFLICT');
    expect(() => linkedRoute(s, 'unknown')).toThrow('LINKED_MINT_NOT_BOUND');
    expect(() => carryLinkedRoot(s, { ...a, targetPool: b.targetPool })).toThrow(
      'LINKED_SUCCESSOR_ROUTE_CHANGED',
    );
  });
});
