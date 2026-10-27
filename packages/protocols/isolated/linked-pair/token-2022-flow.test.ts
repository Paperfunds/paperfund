import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  digest,
  newLinkedBranch,
  reconcileLinkedInterval,
  type ProviderInterval,
} from './external-flow.js';
import { feePolicies, requiredTokenFeeMints, WITHHELD_PREFIX } from './token-2022-flow.js';
const e = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
) as ProviderInterval;
const MINT = 'imE1nbjWM9QGUzxH2WHYNjcrUqgh9tT8RFYoj9UnMj3',
  MID = 'B1BAF7Gh6RvZ3qG5VmoWZzhmNtvcFaST7tbnGVHPgz1j',
  CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const run = (
  packet = e,
  branch = newLinkedBranch('token2022-fixture', 'token2022-fixture', packet.before),
) => reconcileLinkedInterval(branch, packet, Date.parse(packet.after.observedAt), 10000);
it('replays genuine slot 461064721 with exact gross/net/withheld amounts, protected successors and duplicate recovery', async () => {
  expect(digest(e)).toBe('f17647b504a9185c94bf8535d03ee2310eabf4f6eb7f59700d261de07a267001');
  const original = structuredClone(e);
  delete original.token2022;
  expect(digest(original)).toBe('657e1af836cef8eb81f6a3b13f4a28bc00d0fee2e069bb450f74116bf53ff64a');
  await expect(run(original)).rejects.toThrow('TRANSACTION_TOKEN_EFFECTS_UNRECONCILED');
  expect(requiredTokenFeeMints(e.before, e.blocks)).toContain(MINT);
  const r = await run();
  expect(r.events).toBe(1);
  expect(r.failedTransactions).toBe(626);
  expect(
    r.token2022Transfers.filter((t) => t.mint === MINT).map((t) => [t.gross, t.net, t.withheld]),
  ).toEqual([
    ['26265025179486', '25477074424101', '787950755385'],
    ['25477074424101', '24712762191377', '764312232724'],
  ]);
  expect(r.branch.real).toEqual(e.after);
  expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
  const restored = JSON.parse(JSON.stringify(r.branch)),
    again = await run(e, restored);
  expect(again.replay).toBe(true);
  expect(digest(again.branch)).toBe(digest(restored));
});
it('preserves controlled prior spendable and unspendable paper differences without inventing a fill', async () => {
  const branch = newLinkedBranch('paper-differences', 'paper-differences', e.before);
  branch.inventoryDeltas[MID] = '100';
  branch.inventoryDeltas[WITHHELD_PREFIX + MID] = '17';
  const original = digest(branch),
    r = await run(e, branch);
  expect(digest(branch)).toBe(original);
  expect(r.branch.inventoryDeltas[MID]).toBe('100');
  expect(r.branch.inventoryDeltas[WITHHELD_PREFIX + MID]).toBe('17');
  expect(digest((await run(e, JSON.parse(JSON.stringify(r.branch)))).branch)).toBe(
    digest(r.branch),
  );
});
it('uses native integer ceiling and maximum-fee cap from a retained epoch-covered schedule', () => {
  const p = feePolicies(e.token2022, e.before, e.after).get(MINT)!;
  expect(p.fee(1n)).toBe(1n);
  expect(p.fee(10000n)).toBe(300n);
  expect(p.fee(26265025179486n)).toBe(787950755385n);
  expect(p.fee(100000000000000000000n)).toBe(100000000000000000n);
});
it('rejects inconsistent Clock, missing mint policy, historical epoch gaps and unsupported extensions', async () => {
  const bad = structuredClone(e);
  bad.token2022!.contextSlot++;
  await expect(run(bad)).rejects.toThrow('TOKEN_2022_WITNESS_CONTEXT');
  const missing = structuredClone(e);
  delete missing.token2022!.mints[MINT];
  await expect(run(missing)).rejects.toThrow('TOKEN_2022_FEE_POLICY_MISSING');
  const early = structuredClone(e.before),
    clock = Buffer.from(early.accounts[CLOCK]!.base64, 'base64');
  clock.writeBigUInt64LE(905n, 16);
  early.accounts[CLOCK]!.base64 = clock.toString('base64');
  const earlyEnd = structuredClone(e.after);
  earlyEnd.accounts[CLOCK]!.base64 = clock.toString('base64');
  expect(() => feePolicies(e.token2022, early, earlyEnd)).toThrow(
    'TOKEN_2022_POLICY_HISTORY_UNAVAILABLE',
  );
  const extension = structuredClone(e.token2022!),
    raw = Buffer.from(extension.mints[MINT]!.base64, 'base64');
  raw.writeUInt16LE(14, 166);
  extension.mints[MINT]!.base64 = raw.toString('base64');
  expect(() => feePolicies(extension, e.before, e.after)).toThrow();
});
it('rejects changed provider balances without mutating the predecessor or consuming liquidity', async () => {
  const bad = structuredClone(e),
    tx = bad.blocks
      .flatMap((b) => b.result.transactions)
      .find((t) => t.transaction.signatures[0]!.startsWith('3ppg3Ekb'))!;
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...tx.meta.loadedAddresses!.writable,
    ...tx.meta.loadedAddresses!.readonly,
  ];
  tx.meta.postTokenBalances.find((b) => keys[b.accountIndex] === MID)!.uiTokenAmount.amount = '1';
  const branch = newLinkedBranch('failure', 'failure', e.before),
    before = digest(branch);
  await expect(run(bad, branch)).rejects.toThrow('TRANSACTION_TOKEN_EFFECTS_UNRECONCILED');
  expect(digest(branch)).toBe(before);
});
