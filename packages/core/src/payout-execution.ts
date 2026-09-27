import { createHash } from 'node:crypto';

export const PAYOUT_INTENT_VERSION = 'paperfund-payout-intent-v1';

export type PayoutNetwork = 'localnet' | 'devnet' | 'mainnet-beta';

export interface PayoutRecipient {
  readonly allocationId: string;
  readonly destination: string;
  readonly lamports: bigint;
}

export interface PayoutBatchIntent {
  readonly version: typeof PAYOUT_INTENT_VERSION;
  readonly planId: string;
  readonly batchIndex: number;
  readonly network: PayoutNetwork;
  readonly treasury: string;
  readonly recipients: readonly PayoutRecipient[];
  readonly totalLamports: bigint;
  readonly intentHash: string;
}

function canonicalIntent(
  input: Omit<PayoutBatchIntent, 'intentHash' | 'totalLamports' | 'version'>,
) {
  return JSON.stringify({
    version: PAYOUT_INTENT_VERSION,
    planId: input.planId,
    batchIndex: input.batchIndex,
    network: input.network,
    treasury: input.treasury,
    recipients: input.recipients.map((recipient) => ({
      allocationId: recipient.allocationId,
      destination: recipient.destination,
      lamports: recipient.lamports.toString(),
    })),
  });
}

export function buildPayoutBatches(input: {
  readonly planId: string;
  readonly network: PayoutNetwork;
  readonly treasury: string;
  readonly recipients: readonly PayoutRecipient[];
  readonly maxRecipientsPerBatch: number;
}): readonly PayoutBatchIntent[] {
  if (!Number.isSafeInteger(input.maxRecipientsPerBatch) || input.maxRecipientsPerBatch < 1)
    throw new Error('maxRecipientsPerBatch must be a positive safe integer.');
  if (input.recipients.some((recipient) => recipient.lamports <= 0n))
    throw new Error('Payout recipients must have positive lamport amounts.');
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    if (seen.has(recipient.allocationId)) throw new Error('Duplicate payout allocation.');
    seen.add(recipient.allocationId);
  }
  const batches: PayoutBatchIntent[] = [];
  for (let offset = 0; offset < input.recipients.length; offset += input.maxRecipientsPerBatch) {
    const recipients = input.recipients.slice(offset, offset + input.maxRecipientsPerBatch);
    const batchIndex = batches.length;
    const canonical = canonicalIntent({
      planId: input.planId,
      batchIndex,
      network: input.network,
      treasury: input.treasury,
      recipients,
    });
    batches.push({
      version: PAYOUT_INTENT_VERSION,
      planId: input.planId,
      batchIndex,
      network: input.network,
      treasury: input.treasury,
      recipients,
      totalLamports: recipients.reduce((sum, recipient) => sum + recipient.lamports, 0n),
      intentHash: createHash('sha256').update(canonical).digest('hex'),
    });
  }
  return batches;
}
