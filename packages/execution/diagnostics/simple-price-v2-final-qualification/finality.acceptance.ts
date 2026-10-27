import { it, expect } from 'vitest';
import { blockDecision, exactSlotMetadata } from './finality.js';
const a = { blockhash: 'A', previousBlockhash: 'P', parentSlot: 99 };
it('abandoned fork, missing finality and unavailable exact-slot history all hold', () => {
  expect(blockDecision(100, 101, a, { ...a, blockhash: 'FORK' })).toContain('REVIEW');
  expect(blockDecision(100, 99, a, a)).toContain('REVIEW');
  expect(blockDecision(100, null, a, a)).toContain('REVIEW');
  expect(exactSlotMetadata(100, a, []).decision).toContain('REVIEW');
  expect(
    exactSlotMetadata(100, a, [{ source: 'historical-unavailable', slot: 101, finalized: a }])
      .decision,
  ).toContain('REVIEW');
});
it('a matching operator never masks a contradictory operator', () => {
  expect(
    exactSlotMetadata(100, a, [
      { source: 'first', slot: 100, finalized: a },
      { source: 'second', slot: 100, finalized: { ...a, previousBlockhash: 'OTHER' } },
    ]).decision,
  ).toContain('CONFLICT');
});
it('matching block metadata cannot authenticate different historical account values', () => {
  const first = { slot: 100, accountsHash: 'X' },
    second = { slot: 100, accountsHash: 'Y' };
  expect(first.accountsHash).not.toBe(second.accountsHash);
  expect(blockDecision(first.slot, 101, a, a)).toBe(blockDecision(second.slot, 101, a, a));
  expect(blockDecision(100, 101, a, a)).toContain('ACCOUNT_INCLUSION_NOT_PROVEN');
  // Neither this helper nor ordinary RPC metadata supplies account-state/fork binding.
});
