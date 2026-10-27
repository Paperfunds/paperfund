/** Acceptance-only finalized UTC frontier. Never substitutes later reserves for a cutoff bank. */
import {
  digest,
  reconcileLinkedInterval,
  type LinkedBranch,
  type ProviderInterval,
} from '../../../protocols/isolated/linked-pair/external-flow.js';
import { LinkedTransitionError } from '../../../protocols/isolated/linked-pair/native-transition.js';
export interface CutoffFrontier {
  schema: 'LINKED_UTC_FRONTIER_V1';
  commitment: 'finalized';
  last: { slot: number; blockhash: string; blockTime: number };
  next: {
    slot: number;
    parentSlot: number;
    previousBlockhash: string;
    blockhash: string;
    blockTime: number;
  };
  interval: ProviderInterval | null;
}
export interface CutoffSeal {
  version: 'LINKED_CUTOFF_SEAL_V1';
  accountId: string;
  roundId: string;
  cutoff: string;
  revision: string;
  beforeHash: string;
  branch: LinkedBranch;
  frontier: CutoffFrontier;
}
const reject = (m: string): never => {
  throw new LinkedTransitionError(m);
};
export async function reconcileCutoff(
  branch: LinkedBranch,
  frontier: CutoffFrontier,
  cutoff: string,
) {
  const ms = Date.parse(cutoff),
    last = frontier.last,
    next = frontier.next;
  if (
    frontier.schema !== 'LINKED_UTC_FRONTIER_V1' ||
    frontier.commitment !== 'finalized' ||
    !Number.isFinite(ms) ||
    ms % 3600000 !== 0
  )
    reject('LINKED_INVALID_UTC_FRONTIER');
  if (
    !Number.isSafeInteger(last.slot) ||
    !Number.isSafeInteger(next.slot) ||
    !Number.isSafeInteger(last.blockTime) ||
    !Number.isSafeInteger(next.blockTime) ||
    !last.blockhash ||
    !next.blockhash ||
    next.slot <= last.slot ||
    next.parentSlot !== last.slot ||
    next.previousBlockhash !== last.blockhash ||
    last.blockTime * 1000 >= ms ||
    next.blockTime * 1000 < ms
  )
    reject('LINKED_CUTOFF_BOUNDARY_UNPROVEN');
  const after = frontier.interval?.after ?? branch.real;
  if (after.slot !== last.slot) reject('LINKED_CUTOFF_SLOT_MISMATCH');
  const clock = Buffer.from(
    after.accounts['SysvarC1ock11111111111111111111111111111111']?.base64 ?? '',
    'base64',
  );
  if (
    clock.length !== 40 ||
    clock.readBigInt64LE(32) !== BigInt(last.blockTime) ||
    clock.readBigUInt64LE(0) !== BigInt(after.slot) ||
    ms - last.blockTime * 1000 > 10000
  )
    reject('LINKED_CUTOFF_BANK_UNAVAILABLE');
  if (frontier.interval) {
    const end = frontier.interval.blocks.at(-1);
    if (
      !end ||
      end.result.blockhash !== last.blockhash ||
      end.result.blockTime !== last.blockTime ||
      frontier.interval.blocks.some((x) => x.result.blockTime * 1000 >= ms)
    )
      reject('LINKED_POST_CUTOFF_FLOW');
  }
  const result = frontier.interval
    ? (
        await reconcileLinkedInterval(
          branch,
          frontier.interval,
          Date.parse(after.observedAt),
          10000,
        )
      ).branch
    : structuredClone(branch);
  if (digest(result.real) !== digest(after)) reject('LINKED_CUTOFF_ANCHOR_CHANGED');
  return result;
}
