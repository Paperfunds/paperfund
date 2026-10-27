import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ExecutionRouter, createMarketStateEvidence } from '@paperfund/execution';
import { currentQuoteRouter, currentQuoteIdentity } from './router.js';
import { qualifyCurrentQuoteCutoff } from './cutoff.js';
import type { Stage1Snapshot } from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
const clockAddress = 'SysvarC1ock11111111111111111111111111111111';
const retained = JSON.parse(
  gunzipSync(
    readFileSync(
      'apps/api/isolated/current-quotes/fixtures/provider-interval.json.gz',
    ),
  ).toString(),
).after;
async function fixture() {
  const s = structuredClone(retained),
    cutoff = Math.ceil(Date.parse(s.observedAt) / 3600000) * 3600000,
    time = cutoff - 1000;
  s.observedAt = new Date(time).toISOString();
  const clock = s.accounts['SysvarC1ock11111111111111111111111111111111'],
    raw = Buffer.from(clock.base64, 'base64');
  raw.writeBigInt64LE(BigInt(time / 1000), 32);
  clock.base64 = raw.toString('base64');
  const f = currentQuoteRouter({
    enabled: true,
    baseline: new ExecutionRouter(),
    mints: [s.mint],
    snapshots: async () => [s],
    permission: async () => ({ discover: true, buy: true }),
    now: () => time,
  });
  const state = (await f.router.loadPositionRoute(currentQuoteIdentity(s.mint))).state;
  return {
    e: createMarketStateEvidence(state),
    cutoff: new Date(cutoff).toISOString(),
    frontier: {
      schema: 'LINKED_UTC_FRONTIER_V1' as const,
      commitment: 'finalized' as const,
      last: { slot: s.slot, blockhash: 'synthetic-last', blockTime: time / 1000 },
      next: {
        slot: s.slot + 1,
        parentSlot: s.slot,
        previousBlockhash: 'synthetic-last',
        blockhash: 'synthetic-next',
        blockTime: cutoff / 1000,
      },
      interval: null,
    },
  };
}
it('qualifies coherent pre-cutoff recorded current bank without requiring historical transaction flow', async () => {
  const f = await fixture(),
    r = qualifyCurrentQuoteCutoff(f.e, f.frontier, f.cutoff);
  expect(r.slot).toBe(f.e.chainSlot === null ? null : Number(f.e.chainSlot));
  expect(r.financialAccepted).toBe(false);
  expect(r.evidence).not.toBe(f.e);
});
it('never substitutes post-cutoff, stale, wrong-slot or unlinked evidence', async () => {
  const f = await fixture();
  for (const change of [
    (x: typeof f) => (x.frontier.last.blockTime = Date.parse(x.cutoff) / 1000),
    (x: typeof f) => (x.frontier.next.previousBlockhash = 'other'),
    (x: typeof f) => (x.frontier.next.blockTime = x.frontier.last.blockTime),
    (x: typeof f) => x.frontier.last.slot++,
    (x: typeof f) => (x.cutoff = new Date(Date.parse(x.cutoff) + 3600000).toISOString()),
  ]) {
    const x = structuredClone(f);
    change(x);
    expect(() => qualifyCurrentQuoteCutoff(x.e, x.frontier, x.cutoff)).toThrow(
      'CURRENT_QUOTE_CUTOFF',
    );
  }
});
it('rejects tampered fingerprint and Clock owner even with a recalculated fingerprint', async () => {
  const f = await fixture();
  const tampered = { ...f.e, normalizedState: { ...f.e.normalizedState, referenceBuyOutput: '1' } };
  expect(() => qualifyCurrentQuoteCutoff(tampered, f.frontier, f.cutoff)).toThrow('STATE');
  const x = await fixture();
  const s = x.e.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot;
  const account = s.accounts[clockAddress]!;
  s.accounts[clockAddress] = { ...account, owner: '11111111111111111111111111111111' };
  expect(() =>
    qualifyCurrentQuoteCutoff(createMarketStateEvidence(x.e), x.frontier, x.cutoff),
  ).toThrow('BANK');
});
