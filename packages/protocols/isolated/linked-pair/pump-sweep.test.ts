import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import bs58 from 'bs58';
import {
  digest,
  newLinkedBranch,
  reconcileLinkedInterval,
  type ProviderInterval,
  type Instruction,
} from './external-flow.js';
import { pumpSweepBucket, transitionPumpSweep } from './pump-sweep.js';
import { transitionExternalPump } from './pump-external.js';
const e = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261024/local-extension-test/provider-461061044-461061048.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
) as ProviderInterval;
const POOL = '87Yrp4WVCaZDHHVessadssCVxBwaUUBTycHX4whnzCbb',
  VAULT = '7RHRvW4L6UKjtkWfN3xj486Y8sk7tHQFTW7WC4BHHdB7';
const tx = e.blocks
  .flatMap((b) => b.result.transactions)
  .find((t) => t.transaction.signatures[0]!.startsWith('X43DjAQ7'))!;
const keys = [
  ...tx.transaction.message.accountKeys,
  ...tx.meta.loadedAddresses!.writable,
  ...tx.meta.loadedAddresses!.readonly,
];
const sweeps = tx.transaction.message.instructions.filter(
  (i) => pumpSweepBucket(i, keys) && keys[i.accounts[2]!] === POOL,
);
const state = (s: typeof e.before) => {
  const b = Buffer.from(s.accounts[POOL]!.base64, 'base64');
  return {
    virtual: BigInt.asIntN(128, b.readBigUInt64LE(245) + (b.readBigUInt64LE(253) << 64n)),
    protocol: b.readBigUInt64LE(271),
    creator: b.readBigUInt64LE(279),
    quote: Buffer.from(s.accounts[VAULT]!.base64, 'base64').readBigUInt64LE(64),
  };
};
it('replays the complete genuine finalized fee-sweep interval and matches every protected after-account', async () => {
  expect(digest(e)).toBe('d4e231b514e739ce9f309904565a74c89bbf5ffc5e0d9e5112536021995fbb0f');
  const branch = newLinkedBranch('fixture', 'fixture', e.before),
    before = digest(branch),
    r = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000);
  expect(r.events).toBe(2);
  expect(r.failedTransactions).toBe(707);
  expect(digest(branch)).toBe(before);
  expect(r.branch.simulated.accounts[POOL]).toEqual(e.after.accounts[POOL]);
  expect(r.branch.simulated.accounts[VAULT]).toEqual(e.after.accounts[VAULT]);
  expect(state(r.branch.simulated)).toEqual({
    virtual: 57804003394n,
    protocol: 0n,
    creator: 0n,
    quote: 478076515216n,
  });
  const replay = await reconcileLinkedInterval(
    JSON.parse(JSON.stringify(r.branch)),
    e,
    Date.parse(e.after.observedAt),
    10000,
  );
  expect(replay.replay).toBe(true);
  expect(digest(replay.branch)).toBe(digest(r.branch));
});
it('native sweeps preserve effective quote liquidity, withdraw exactly the reserved bucket and are no-ops when repeated', async () => {
  let s = structuredClone(e.before);
  for (const ix of sweeps) {
    const b = state(s),
      q = await transitionPumpSweep(s, ix, keys),
      a = state(q.next);
    expect(a.quote + a.virtual).toBe(b.quote + b.virtual);
    expect(b.quote - a.quote).toBe(q.amount);
    expect(q.amount).toBe(q.bucket === 'protocol' ? b.protocol : b.creator);
    expect((await transitionPumpSweep(q.next, ix, keys)).amount).toBe(0n);
    s = q.next;
  }
  expect(s.accounts[POOL]).toEqual(e.after.accounts[POOL]);
});
it('carries controlled prior paper impact and counterfactual fees through genuine sweeps without resetting reserves', async () => {
  const branch = newLinkedBranch('controlled-paper', 'controlled-paper', e.before),
    ix = sweeps[0]!,
    a = ix.accounts.map((i) => keys[i]!);
  const prior = await transitionExternalPump(
    branch.simulated,
    {
      pool: POOL,
      buy: true,
      legacy: false,
      exactOutput: false,
      amount: 100000000n,
      bound: 0n,
      userBase: a[0]!,
      userQuote: a[0]!,
      protocolRecipient: '',
      creatorRecipient: '',
      buybackRecipient: a[7]!,
    },
    { nowMs: Date.parse(e.before.observedAt), maxAgeMs: 10000 },
  );
  branch.simulated = prior.next;
  const before = state(prior.next),
    r = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000),
    after = state(r.branch.simulated);
  expect(after.quote + after.virtual).toBe(before.quote + before.virtual);
  expect(after.creator).toBe(0n);
  expect(after.protocol).toBe(0n);
  expect(r.branch.simulated.accounts[VAULT]).not.toEqual(r.branch.real.accounts[VAULT]);
  expect(r.branch.inventoryDeltas).not.toEqual({});
  const restored = JSON.parse(JSON.stringify(r.branch));
  expect(digest(restored)).toBe(digest(r.branch));
  expect(
    (await reconcileLinkedInterval(restored, e, Date.parse(e.after.observedAt), 10000)).replay,
  ).toBe(true);
});
it('rejects wrong recipient, ATA, program, argument layout and missing transfer evidence without mutating input', async () => {
  const ix = sweeps[0]!,
    original = digest(e.before),
    bad = (at: number) => {
      const v = structuredClone(ix);
      v.accounts[at] = v.accounts[0]!;
      return v;
    };
  await expect(transitionPumpSweep(e.before, bad(6), keys)).rejects.toThrow('PUMP_SWEEP_RECIPIENT');
  await expect(transitionPumpSweep(e.before, bad(7), keys)).rejects.toThrow(
    'PUMP_SWEEP_RECIPIENT_ATA',
  );
  await expect(transitionPumpSweep(e.before, bad(4), keys)).rejects.toThrow('PUMP_SWEEP_BINDING');
  const malformed = {
    ...ix,
    data: bs58.encode(Buffer.concat([Buffer.from(bs58.decode(ix.data)), Buffer.from([0])])),
  } as Instruction;
  await expect(transitionPumpSweep(e.before, malformed, keys)).rejects.toThrow('PUMP_SWEEP_LAYOUT');
  const incomplete = structuredClone(e),
    t = incomplete.blocks
      .flatMap((b) => b.result.transactions)
      .find((t) => t.transaction.signatures[0] === tx.transaction.signatures[0])!;
  for (const g of t.meta.innerInstructions)
    g.instructions = g.instructions.filter(
      (i) =>
        !(
          keys[i.programIdIndex] === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' &&
          keys[i.accounts[0]!] === VAULT
        ),
    );
  await expect(
    reconcileLinkedInterval(
      newLinkedBranch('a', 'r', e.before),
      incomplete,
      Date.parse(e.after.observedAt),
      10000,
    ),
  ).rejects.toThrow('PUMP_TRANSFER_EVIDENCE_MISSING');
  expect(digest(e.before)).toBe(original);
});
