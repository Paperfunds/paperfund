/** Genesis schedule witness + finalized block chronology. No wall-clock epoch inference. */
import { EpochSchedule } from '@solana/web3.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import type { ProviderInterval } from './external-flow.js';
export const CLOCK_ACCOUNT = 'SysvarC1ock11111111111111111111111111111111';
export const EPOCH_SCHEDULE_ACCOUNT = 'SysvarEpochSchedu1e111111111111111111111111';
const OWNER = 'Sysvar1111111111111111111111111111111111111';
type Account = { owner: string; base64: string };
export interface EpochWitness {
  schema: 'FINALIZED_EPOCH_SCHEDULE_V1';
  contextSlot: number;
  clock: Account;
  schedule: Account;
}
const fail = (reason: string): never => { throw Error('EPOCH_' + reason); };
export function verifiedClock(account: Account, slot: number) {
  const b = Buffer.from(account?.base64 ?? '', 'base64');
  if (account?.owner !== OWNER || b.length !== 40 || !Number.isSafeInteger(slot) ||
      slot < 0 || b.readBigUInt64LE(0) !== BigInt(slot)) fail('CLOCK_CONTEXT');
  const fields = [b.readBigInt64LE(8), b.readBigUInt64LE(16), b.readBigUInt64LE(24), b.readBigInt64LE(32)];
  if (fields.some(v => v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER))) fail('CLOCK_RANGE');
  return { start: Number(fields[0]), epoch: Number(fields[1]), leader: Number(fields[2]), seconds: Number(fields[3]) };
}
export function epochProgression(before: Stage1Snapshot, after: Stage1Snapshot,
  blocks: ProviderInterval['blocks'], witness?: EpochWitness) {
  const a = verifiedClock(before.accounts[CLOCK_ACCOUNT]!, before.slot),
    b = verifiedClock(after.accounts[CLOCK_ACCOUNT]!, after.slot);
  if(b.seconds<a.seconds || b.epoch<a.epoch)fail('REGRESSION');
  const changed = a.epoch !== b.epoch || a.start !== b.start || a.leader !== b.leader;
  if (!witness) {
    if (changed) fail('WITNESS_REQUIRED');
    return (_slot: number) => a;
  }
  if (witness.schema !== 'FINALIZED_EPOCH_SCHEDULE_V1' || witness.contextSlot < after.slot)
    fail('WITNESS_CONTEXT');
  const w = verifiedClock(witness.clock, witness.contextSlot), raw = Buffer.from(witness.schedule?.base64 ?? '', 'base64');
  if (witness.schedule?.owner !== OWNER || raw.length !== 33 || raw[16]! > 1) fail('SCHEDULE_LAYOUT');
  const values = [raw.readBigUInt64LE(0), raw.readBigUInt64LE(8), raw.readBigUInt64LE(17), raw.readBigUInt64LE(25)];
  if (values.some(v => v > BigInt(Number.MAX_SAFE_INTEGER)) || values[0] === 0n) fail('SCHEDULE_RANGE');
  const [length, offset, firstEpoch, firstSlot] = values.map(Number),
    schedule = new EpochSchedule(length!, offset!, !!raw[16], firstEpoch!, firstSlot!);
  // Warmup banks require their own leader-schedule proof. Current normal epochs use genesis constants.
  if (before.slot < firstSlot! || offset! > length! || (!raw[16] && (firstEpoch !== 0 || firstSlot !== 0)))
    fail('SCHEDULE_UNSUPPORTED');
  const metadata = (slot: number) => ({ epoch: schedule.getEpoch(slot),
    leader: firstEpoch! + Math.floor((slot - firstSlot! + offset!) / length!) });
  for (const [slot, c] of [[before.slot, a], [after.slot, b], [witness.contextSlot, w]] as const) {
    const m = metadata(slot);
    if (m.epoch !== c.epoch || m.leader !== c.leader || c.start > c.seconds) fail('SCHEDULE_CLOCK_MISMATCH');
  }
  if (b.epoch < a.epoch || b.seconds < a.seconds || w.epoch < b.epoch) fail('REGRESSION');
  const starts = new Map<number, number>([[a.epoch, a.start]]);
  if(b.epoch-a.epoch>blocks.length)fail('BOUNDARY_EVIDENCE_MISSING');
  let previousSeconds=a.seconds;
  for(const block of blocks){
    if(!Number.isSafeInteger(block.result.blockTime)||block.result.blockTime<previousSeconds||block.result.blockTime>b.seconds)
      fail('BLOCK_TIME_INCONSISTENT');
    previousSeconds=block.result.blockTime;
  }
  for (let epoch = a.epoch + 1; epoch <= b.epoch; epoch++) {
    const boundary = blocks.find(block => block.slot === schedule.getFirstSlotInEpoch(epoch));
    // A skipped boundary has no retained exact epoch-start Clock here. Never estimate its timestamp.
    if (!boundary || !Number.isSafeInteger(boundary.result.blockTime)) fail('BOUNDARY_EVIDENCE_MISSING');
    starts.set(epoch, boundary!.result.blockTime);
  }
  if (starts.get(b.epoch) !== b.start || (w.epoch === b.epoch && w.start !== b.start)) fail('START_TIMESTAMP_MISMATCH');
  return (slot: number) => {
    const m = metadata(slot), start = starts.get(m.epoch);
    if (start === undefined || slot < before.slot || slot > after.slot) return fail('SLOT_OUTSIDE_PROOF');
    return { ...m, start, seconds: 0 };
  };
}
