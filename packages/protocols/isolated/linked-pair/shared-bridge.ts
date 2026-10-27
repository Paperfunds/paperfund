/** Coherent account/round branch, with one copy of each pool shared by verified routes. */
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { LinkedTransitionError } from './native-transition.js';
export interface LinkedBinding {
  mint: string;
  quoteMint: string;
  targetPool: string;
  bridgePool: string;
}
export type RoutedSnapshot = Stage1Snapshot & { linkedRoutes?: LinkedBinding[] };
const fail = (reason: string): never => {
  throw new LinkedTransitionError(reason);
};
export function linkedBindings(s: Stage1Snapshot): LinkedBinding[] {
  return (
    (s as RoutedSnapshot).linkedRoutes ?? [
      { mint: s.mint, quoteMint: s.quoteMint, targetPool: s.targetPool, bridgePool: s.bridgePool },
    ]
  );
}
export function linkedRoute(s: Stage1Snapshot, mint: string, bridgePool?: string): Stage1Snapshot {
  const routes = linkedBindings(s),
    binding = routes.find((r) => r.mint === mint && (!bridgePool || r.bridgePool === bridgePool));
  if (!binding) return fail('LINKED_MINT_NOT_BOUND');
  if (new Set(routes.map((r) => [r.mint, r.bridgePool].join(':'))).size !== routes.length)
    fail('LINKED_SHARED_BINDING_CONFLICT');
  return { ...s, ...binding };
}
export function carryLinkedRoot(root: Stage1Snapshot, next: Stage1Snapshot): Stage1Snapshot {
  const original = linkedBindings(root),
    selected = original.find(
      (r) =>
        r.mint === next.mint &&
        r.targetPool === next.targetPool &&
        r.bridgePool === next.bridgePool &&
        r.quoteMint === next.quoteMint,
    );
  if (
    !selected ||
    selected.targetPool !== next.targetPool ||
    next.bridgePool !== selected.bridgePool ||
    next.quoteMint !== selected.quoteMint
  )
    fail('LINKED_SUCCESSOR_ROUTE_CHANGED');
  return {
    ...next,
    mint: root.mint,
    targetPool: root.targetPool,
    quoteMint: root.quoteMint,
    bridgePool: root.bridgePool,
  };
}
export function mergeLinkedSnapshots(snapshots: Stage1Snapshot[]): Stage1Snapshot {
  const first = snapshots[0];
  if (!first || snapshots.length < 2) return fail('LINKED_TWO_MARKETS_REQUIRED');
  const accounts: Stage1Snapshot['accounts'] = {},
    absent = new Set<string>();
  for (const s of snapshots) {
    if (s.slot !== first.slot || s.observedAt !== first.observedAt)
      fail('LINKED_BANK_OR_BRIDGE_MISMATCH');
    for (const [address, account] of Object.entries(s.accounts)) {
      const old = accounts[address];
      if (old && (old.base64 !== account.base64 || old.owner !== account.owner))
        fail('LINKED_SHARED_ACCOUNT_CONFLICT');
      accounts[address] = structuredClone(account);
    }
    s.absentAccounts.forEach((a) => absent.add(a));
  }
  for (const a of absent) if (accounts[a]) fail('LINKED_ABSENCE_CONFLICT');
  const merged: RoutedSnapshot = {
    ...structuredClone(first),
    accounts,
    absentAccounts: [...absent].sort(),
    linkedRoutes: snapshots
      .map((s) => ({
        mint: s.mint,
        quoteMint: s.quoteMint,
        targetPool: s.targetPool,
        bridgePool: s.bridgePool,
      }))
      .sort((a, b) => a.mint.localeCompare(b.mint)),
  };
  for (const binding of merged.linkedRoutes!) linkedRoute(merged, binding.mint);
  return merged;
}
