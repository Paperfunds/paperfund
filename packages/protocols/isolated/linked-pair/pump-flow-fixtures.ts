/** Controlled chronology composed from a retained native V2 receipt; not a new atomic mainnet bank. */
import { readFileSync } from 'node:fs';
import { pumpInterval, PUMP_BRIDGE } from './pump-fixtures.js';
import { decodeSwap, type Receipt, type ProviderInterval } from './external-flow.js';
import { transitionExternalPump } from './pump-external.js';
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

export async function controlledPumpInterval(): Promise<ProviderInterval> {
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
  const interval = {
    ...structuredClone(pumpInterval),
    before: s,
    after,
    slots: [block.slot],
    anchor: { blockhash: block.result.previousBlockhash },
    blocks: [{ slot: block.slot, result: { ...block.result, transactions: [t] } }],
  };
  return interval;
}
