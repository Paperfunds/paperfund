/** Current-model cutoff evidence only. No historical flow reconstruction or financial authority. */
import { createMarketStateEvidence, type MarketStateEvidence } from '@paperfund/execution';
import type { CutoffFrontier } from '../../../../packages/db/isolated/linked-pair/cutoff.js';
import type { Stage1Snapshot } from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
const clockAddress = 'SysvarC1ock11111111111111111111111111111111';
const reject = (reason: string): never => {
  throw Error('CURRENT_QUOTE_CUTOFF_' + reason);
};
export function qualifyCurrentQuoteCutoff(
  evidence: MarketStateEvidence,
  frontier: CutoffFrontier,
  cutoff: string,
) {
  const at = Date.parse(cutoff),
    last = frontier.last,
    next = frontier.next;
  if (
    !Number.isFinite(at) ||
    at % 3600000 !== 0 ||
    frontier.schema !== 'LINKED_UTC_FRONTIER_V1' ||
    frontier.commitment !== 'finalized' ||
    frontier.interval !== null
  )
    reject('FRONTIER');
  if (
    !Number.isSafeInteger(last.slot) ||
    last.slot < 0 ||
    !Number.isSafeInteger(next.slot) ||
    next.slot <= last.slot ||
    next.parentSlot !== last.slot ||
    next.previousBlockhash !== last.blockhash ||
    !last.blockhash ||
    !next.blockhash ||
    !Number.isSafeInteger(last.blockTime) ||
    !Number.isSafeInteger(next.blockTime) ||
    last.blockTime * 1000 >= at ||
    next.blockTime * 1000 < at
  )
    reject('BOUNDARY');
  if (
    evidence.adapterVersion !== 'paper-current-executable-v1' ||
    evidence.normalizationVersion !== 'paper-current-accounts-v1' ||
    createMarketStateEvidence(evidence).fingerprint !== evidence.fingerprint
  )
    reject('STATE');
  const s = evidence.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot;
  const raw = Buffer.from(s?.accounts?.[clockAddress]?.base64 ?? '', 'base64');
  if (
    s?.accounts?.[clockAddress]?.owner !== 'Sysvar1111111111111111111111111111111111111' ||
    raw.length !== 40 ||
    raw.readBigUInt64LE(0) !== BigInt(last.slot) ||
    raw.readBigInt64LE(32) !== BigInt(last.blockTime) ||
    s.slot !== last.slot ||
    evidence.chainSlot !== BigInt(last.slot) ||
    s.mint !== evidence.identity.tokenMint ||
    evidence.identity.marketId !== 'paper-current-quote:' + s.mint ||
    Date.parse(s.observedAt) !== last.blockTime * 1000 ||
    evidence.observedAt !== s.observedAt ||
    at - last.blockTime * 1000 > 10000
  )
    reject('BANK');
  // These are technical consistency checks on retained inputs. The existing protected
  // provider/UTC/source acceptance must independently authenticate those inputs.
  return {
    schema: 'CURRENT_QUOTE_CUTOFF_TECHNICAL_V1' as const,
    cutoff,
    slot: last.slot,
    evidenceFingerprint: evidence.fingerprint,
    frontier: structuredClone(frontier),
    evidence: structuredClone(evidence),
    financialAccepted: false as const,
  };
}
