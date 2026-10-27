import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { it, expect } from 'vitest';
import { supportedLinkedExit } from './supported-exit.js';
import { transitionLinkedSnapshot } from './native-transition.js';
import {
  newLinkedBranch,
  reconcileLinkedInterval,
  digest,
  type ProviderInterval,
} from './external-flow.js';
const evidence = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261021/flow/provider-459438275-459438282.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
) as ProviderInterval;
const s = evidence.before,
  policy = { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 };
it('finds the genuine finite-reserve prefix from retained liquidity and never reloads it for the residual', async () => {
  // Hypothetical supply-sized holding exercises capacity; no Paperfund ownership is claimed.
  const supply = Buffer.from(s.accounts[s.mint]!.base64, 'base64').readBigUInt64LE(36),
    before = digest(s);
  await expect(transitionLinkedSnapshot(s, supply, false, policy)).rejects.toMatchObject({
    code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
  });
  const prefix = await supportedLinkedExit(s, supply);
  expect(prefix.quantity).toBe(451004209269370n);
  expect(prefix.output).toBe(9491373975n);
  const first = await transitionLinkedSnapshot(s, prefix.quantity, false, policy);
  expect(first.quote.output).toBe(prefix.output);
  await expect(
    transitionLinkedSnapshot(s, prefix.quantity + 1n, false, policy),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' });
  const rest = await supportedLinkedExit(first.next, supply - prefix.quantity);
  expect(rest.quantity).toBe(0n);
  expect(rest.output).toBe(0n);
  expect(digest(s)).toBe(before);
  expect((await supportedLinkedExit(s, supply)).output).toBe(prefix.output);
}, 15000);
it('continues after a real native partial and intervening retained genuine Orca flow without double consuming either', async () => {
  const b = newLinkedBranch('account', 'round', s),
    buy = await transitionLinkedSnapshot(s, 100000000n, true, policy),
    quarter = buy.quote.output / 4n;
  const partial = await transitionLinkedSnapshot(buy.next, quarter, false, policy);
  b.simulated = partial.next;
  const reconciled = await reconcileLinkedInterval(
      b,
      evidence,
      Date.parse(evidence.after.observedAt),
      10000,
    ),
    remaining = buy.quote.output - quarter,
    quote = await supportedLinkedExit(reconciled.branch.simulated, remaining);
  expect(reconciled.events).toBe(1);
  expect(quote.quantity).toBe(remaining);
  expect(quote.output).toBeGreaterThan(0n);
  const last = await transitionLinkedSnapshot(reconciled.branch.simulated, remaining, false, {
    nowMs: Date.parse(evidence.after.observedAt),
    maxAgeMs: 10000,
  });
  expect(last.quote.output).toBe(quote.output);
  expect(
    (
      await reconcileLinkedInterval(
        reconciled.branch,
        evidence,
        Date.parse(evidence.after.observedAt),
        10000,
      )
    ).branch,
  ).toEqual(reconciled.branch);
}, 15000);
it('does not classify missing state as executable zero', async () => {
  const bad = structuredClone(s);
  delete bad.accounts[s.bridgePool];
  await expect(supportedLinkedExit(bad, 1000000000n)).rejects.toThrow();
  await expect(supportedLinkedExit(s, 0n)).rejects.toThrow('INVALID_SETTLEMENT_QUANTITY');
});
