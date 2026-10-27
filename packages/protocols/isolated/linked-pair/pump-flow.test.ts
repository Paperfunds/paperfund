import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { pumpInterval, PUMP_BRIDGE } from './pump-fixtures.js';
import {
  decodeSwap,
  newLinkedBranch,
  reconcileLinkedInterval,
  type Receipt,
} from './external-flow.js';
import { transitionExternalPump } from './pump-external.js';
import { transitionLinkedSnapshot } from './native-transition.js';
const events = JSON.parse(
  readFileSync(
    new URL(
      '../../../../docs/linked-pair-20261021/pump-bridge/native-events.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { slot: number; signature: string; data: Record<string, string> }[];
const keys = (t: Receipt) => [
  ...t.transaction.message.accountKeys,
  ...(t.meta.loadedAddresses?.writable ?? []),
  ...(t.meta.loadedAddresses?.readonly ?? []),
];
function eventSpec(index: number) {
  const ev = events[index]!,
    t = pumpInterval.blocks
      .flatMap((b) => b.result.transactions)
      .find((t) => t.transaction.signatures[0] === ev.signature)!,
    k = keys(t);
  const all = [
    ...t.transaction.message.instructions,
    ...t.meta.innerInstructions.flatMap((g) => g.instructions),
  ];
  for (const ix of all) {
    if (
      k[ix.programIdIndex] !== 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' ||
      k[ix.accounts[0]!] !== PUMP_BRIDGE
    )
      continue;
    const swap = decodeSwap(pumpInterval.before, ix, k);
    if (swap?.pump) return { ev, t, k, spec: swap.pump };
  }
  throw Error('NO_SINGLE_POOL_SPEC');
}
// The event pre-reserves below are actual native emit_cpi values, reconstructed onto the retained
// account layout for a pool-local conformance vector. They are NOT claimed as new atomic RPC banks.
it('matches all 19 retained single-pool legacy/V2 BUY/SELL events, exact outputs, fees and actual token transfers', async () => {
  let checked = 0;
  for (let i = 0; i < events.length; i++) {
    if (['0', ''].includes(events[i]!.data.lpFeeBasisPoints!)) continue;
    const { ev, t, k, spec } = eventSpec(i),
      s = structuredClone(pumpInterval.before),
      d = ev.data,
      raw = Buffer.from(s.accounts[PUMP_BRIDGE]!.base64, 'base64');
    const write = (a: string, n: string) => {
      const b = Buffer.from(s.accounts[a]!.base64, 'base64');
      b.writeBigUInt64LE(BigInt(n), 64);
      s.accounts[a] = { ...s.accounts[a]!, base64: b.toString('base64') };
    };
    write('2xFA3mweP12gUDFDa3vyHoMStxy597uv1tVDvxMueLKA', d.poolBaseTokenReserves!);
    write('9sh2FMDdESMmqKF5A7tFrSAwAiUDrabcSXvB38JCEbeK', d.poolQuoteTokenReserves!);
    const v = BigInt.asUintN(128, BigInt(d.virtualQuoteReserves!));
    raw.writeBigUInt64LE(v & ((1n << 64n) - 1n), 245);
    raw.writeBigUInt64LE(v >> 64n, 253);
    s.accounts[PUMP_BRIDGE] = { ...s.accounts[PUMP_BRIDGE]!, base64: raw.toString('base64') };
    const result = await transitionExternalPump(s, spec, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    });
    expect(result.output.toString()).toBe(d.baseAmountOut ?? d.userQuoteAmountOut);
    expect(result.quote.fees.lp.toString()).toBe(d.lpFee);
    expect(result.quote.fees.protocol.toString()).toBe(d.protocolFee);
    expect(result.quote.fees.creator.toString()).toBe(d.coinCreatorFee);
    expect(result.quote.fees.buyback.toString()).toBe(d.buybackFee);
    const transfers = t.meta.innerInstructions
      .flatMap((g) => g.instructions)
      .filter((ix) =>
        [
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        ].includes(k[ix.programIdIndex]!),
      )
      .map((ix) => ({ ix, raw: Buffer.from(bs58.decode(ix.data)) }))
      .filter((x) => [3, 12].includes(x.raw[0]!))
      .map(({ ix, raw }) => ({
        from: k[ix.accounts[0]!]!,
        to: k[ix.accounts[raw[0] === 12 ? 2 : 1]!]!,
        amount: raw.readBigUInt64LE(1),
      }));
    for (const transfer of result.transfers) expect(transfers).toContainEqual(transfer);
    if (i < 2) {
      const next = events[i + 1]!.data;
      expect(result.quote.post.base.toString()).toBe(next.poolBaseTokenReserves);
      expect(result.quote.post.quote.toString()).toBe(next.poolQuoteTokenReserves);
      expect(result.quote.post.virtual.toString()).toBe(next.virtualQuoteReserves);
    }
    checked++;
  }
  expect(checked).toBe(19);
});
it('rejects a real interval containing unretained multi-hop pool dependencies without resetting prior paper impact', async () => {
  const branch = newLinkedBranch('account', 'round', pumpInterval.before),
    before = structuredClone(branch);
  const p = await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
    nowMs: Date.parse(branch.simulated.observedAt),
    maxAgeMs: 10000,
  });
  branch.simulated = p.next;
  const carried = structuredClone(branch);
  await expect(
    reconcileLinkedInterval(
      newLinkedBranch('a', 'r', pumpInterval.before),
      pumpInterval,
      Date.parse(pumpInterval.after.observedAt),
      10000,
    ),
  ).rejects.toThrow('MULTI_HOP_DEPENDENCY_MISSING');
  await expect(
    reconcileLinkedInterval(branch, pumpInterval, Date.parse(pumpInterval.after.observedAt), 10000),
  ).rejects.toThrow('MULTI_HOP_DEPENDENCY_MISSING');
  expect(branch).toEqual(carried);
  expect(branch.simulated).not.toEqual(before.simulated);
});

it('carries prior impact through a real V2 BUY receipt on controlled single-transaction chronology and rejects duplicate consumption', async () => {
  const { ev, t, spec } = eventSpec(5),
    s = structuredClone(pumpInterval.before),
    d = ev.data;
  for (const [a, value] of [
    ['2xFA3mweP12gUDFDa3vyHoMStxy597uv1tVDvxMueLKA', d.poolBaseTokenReserves!],
    ['9sh2FMDdESMmqKF5A7tFrSAwAiUDrabcSXvB38JCEbeK', d.poolQuoteTokenReserves!],
  ]) {
    const b = Buffer.from(s.accounts[a!]!.base64, 'base64');
    b.writeBigUInt64LE(BigInt(value!), 64);
    s.accounts[a!] = { ...s.accounts[a!]!, base64: b.toString('base64') };
  }
  const pool = Buffer.from(s.accounts[PUMP_BRIDGE]!.base64, 'base64'),
    virtual = BigInt.asUintN(128, BigInt(d.virtualQuoteReserves!));
  pool.writeBigUInt64LE(virtual & ((1n << 64n) - 1n), 245);
  pool.writeBigUInt64LE(virtual >> 64n, 253);
  s.accounts[PUMP_BRIDGE] = { ...s.accounts[PUMP_BRIDGE]!, base64: pool.toString('base64') };
  const block = pumpInterval.blocks.find((b) => b.slot === ev.slot)!,
    clock = 'SysvarC1ock11111111111111111111111111111111';
  s.slot = block.result.parentSlot;
  s.observedAt = new Date((block.result.blockTime - 1) * 1000).toISOString();
  let raw = Buffer.from(s.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(s.slot), 0);
  raw.writeBigInt64LE(BigInt(block.result.blockTime - 1), 32);
  s.accounts[clock] = { ...s.accounts[clock]!, base64: raw.toString('base64') };
  const r = await transitionExternalPump(s, spec, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    }),
    after = r.next;
  after.slot = block.slot;
  after.observedAt = new Date(block.result.blockTime * 1000).toISOString();
  raw = Buffer.from(after.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(after.slot), 0);
  raw.writeBigInt64LE(BigInt(block.result.blockTime), 32);
  after.accounts[clock] = { ...after.accounts[clock]!, base64: raw.toString('base64') };
  // Endpoint balances and virtual reserves agree with the next actual emit_cpi event. Header,
  // transaction selection and non-pool account chronology are a controlled fixture, not a new RPC bank.
  expect(r.quote.post.base.toString()).toBe(events[6]!.data.poolBaseTokenReserves);
  expect(r.quote.post.quote.toString()).toBe(events[6]!.data.poolQuoteTokenReserves);
  expect(r.quote.post.virtual.toString()).toBe(events[6]!.data.virtualQuoteReserves);
  const interval = {
      ...structuredClone(pumpInterval),
      before: s,
      after,
      slots: [block.slot],
      anchor: { blockhash: block.result.previousBlockhash },
      blocks: [{ slot: block.slot, result: { ...block.result, transactions: [t] } }],
    },
    branch = newLinkedBranch('a', 'r', s),
    paper = await transitionLinkedSnapshot(s, 10000000n, true, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    });
  branch.simulated = paper.next;
  const changed = await reconcileLinkedInterval(
    branch,
    interval,
    Date.parse(after.observedAt),
    10000,
  );
  expect(changed.events).toBe(1);
  expect(changed.branch.real).toEqual(after);
  expect(changed.branch.simulated.accounts[PUMP_BRIDGE]).not.toEqual(after.accounts[PUMP_BRIDGE]);
  expect(changed.branch.inventoryDeltas).not.toEqual({});
  const duplicate = await reconcileLinkedInterval(
    changed.branch,
    interval,
    Date.parse(after.observedAt),
    10000,
  );
  expect(duplicate.replay).toBe(true);
  expect(duplicate.branch).toEqual(changed.branch);
});
