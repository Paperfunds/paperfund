/** Controlled mechanics fixtures. Composite bank/tick/reward changes are NOT mainnet observations. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { convertIdlToCamelCase } from '@coral-xyz/anchor/dist/cjs/idl.js';
import { WHIRLPOOL_IDL } from '@orca-so/whirlpools-sdk';
import { orcaLink, readOrcaSnapshot } from '../../src/composed-pump-orca.js';
import { mergeLinkedSnapshots, linkedBindings } from './shared-bridge.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import type { ProviderInterval } from './external-flow.js';
const load = (name: string) =>
  JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../../../docs/linked-pair-20261021/flow/' + name, import.meta.url)),
    ).toString(),
  ) as ProviderInterval;
export const oldEvidence = load('provider-459438275-459438282.json.gz');
export const sharedEvidence = load('shared-provider-459669240-459669247.json.gz');
/** Real old bridge + two real current targets; explicitly mixed-time for positive mechanics checks only. */
export function compositeInterval(): ProviderInterval {
  const e = structuredClone(oldEvidence),
    current = sharedEvidence.before,
    second = linkedBindings(current).find((r) => r.mint !== e.before.mint)!;
  for (const point of ['before', 'after'] as const) {
    const primary = e[point],
      other = structuredClone(current);
    Object.assign(other, second, { slot: primary.slot, observedAt: primary.observedAt });
    for (const [key, a] of Object.entries(primary.accounts))
      other.accounts[key] = structuredClone(a);
    other.absentAccounts = primary.absentAccounts.filter((k) => !other.accounts[k]);
    delete (other as { linkedRoutes?: unknown }).linkedRoutes;
    e[point] = mergeLinkedSnapshots([primary, other]);
  }
  return e;
}
export const codec = new BorshAccountsCoder(convertIdlToCamelCase(WHIRLPOOL_IDL));
export function decode(s: Stage1Snapshot, direction = true) {
  return readOrcaSnapshot(
    orcaLink(s.bridgePool, s.accounts[s.bridgePool]!),
    s.accounts,
    direction,
    s.absentAccounts,
  );
}
export async function encodePool(s: Stage1Snapshot, data: unknown) {
  const raw = Buffer.from(s.accounts[s.bridgePool]!.base64, 'base64');
  (await codec.encode('whirlpool', data)).copy(raw);
  s.accounts[s.bridgePool] = { ...s.accounts[s.bridgePool]!, base64: raw.toString('base64') };
}
export async function crossingFixture(dynamic: boolean, rewards = true, zeroLiquidity = false) {
  const s = structuredClone(oldEvidence.before),
    d = decode(s),
    array = d.ticks.find((a) => a.data?.startTickIndex === 0)!,
    t = array.data!.ticks[0]!;
  t.initialized = true;
  t.liquidityNet = d.data.liquidity.divn(4);
  t.liquidityGross = t.liquidityNet.clone();
  t.feeGrowthOutsideA = new BN(17);
  t.feeGrowthOutsideB = new BN(23);
  t.rewardGrowthsOutside = [new BN(31), new BN(37), new BN(41)];
  if (rewards) {
    const reward = d.data.rewardInfos[0]!;
    reward.mint = new PublicKey(s.quoteMint);
    reward.vault = new PublicKey(orcaLink(s.bridgePool, s.accounts[s.bridgePool]!).vaultA);
    reward.emissionsPerSecondX64 = d.data.liquidity.muln(19);
    reward.growthGlobalX64 = new BN('340282366920938463463374607431768211400');
  }
  const clock = Buffer.from(
    s.accounts['SysvarC1ock11111111111111111111111111111111']!.base64,
    'base64',
  );
  d.data.rewardLastUpdatedTimestamp = new BN((clock.readBigInt64LE(32) - 5n).toString());
  if (zeroLiquidity) {
    t.liquidityNet = d.data.liquidity.neg();
    t.liquidityGross = d.data.liquidity.clone();
    d.data.liquidity = new BN(0);
  }
  await encodePool(s, d.data);
  const raw = Buffer.alloc(9988);
  createHash('sha256').update('account:TickArray').digest().copy(raw, 0, 0, 8);
  raw.writeInt32LE(array.data!.startTickIndex, 8);
  new PublicKey(s.bridgePool).toBuffer().copy(raw, 9956);
  const write = (at: number, value: BN) => {
    const v = BigInt.asUintN(128, BigInt(value.toString()));
    raw.writeBigUInt64LE(v & ((1n << 64n) - 1n), at);
    raw.writeBigUInt64LE(v >> 64n, at + 8);
  };
  array.data!.ticks.forEach((tick, i) => {
    const at = 12 + i * 113;
    raw[at] = Number(tick.initialized);
    write(at + 1, tick.liquidityNet);
    write(at + 17, tick.liquidityGross);
    write(at + 33, tick.feeGrowthOutsideA);
    write(at + 49, tick.feeGrowthOutsideB);
    tick.rewardGrowthsOutside.forEach((r, j) => write(at + 65 + j * 16, r));
  });
  let packed = raw;
  if (dynamic) {
    const header = Buffer.alloc(60);
    createHash('sha256').update('account:DynamicTickArray').digest().copy(header, 0, 0, 8);
    header.writeInt32LE(array.data!.startTickIndex, 8);
    new PublicKey(s.bridgePool).toBuffer().copy(header, 12);
    let bitmap = 0n;
    const ticks: Buffer[] = [];
    array.data!.ticks.forEach((tick, i) => {
      if (tick.initialized) {
        bitmap |= 1n << BigInt(i);
        ticks.push(raw.subarray(12 + i * 113, 12 + (i + 1) * 113));
      } else ticks.push(Buffer.from([0]));
    });
    header.writeBigUInt64LE(bitmap & ((1n << 64n) - 1n), 44);
    header.writeBigUInt64LE(bitmap >> 64n, 52);
    packed = Buffer.concat([header, ...ticks]);
  }
  s.accounts[array.address.toBase58()] = {
    ...s.accounts[array.address.toBase58()]!,
    base64: packed.toString('base64'),
  };
  return s;
}
