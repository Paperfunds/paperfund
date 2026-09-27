import { describe, expect, it } from 'vitest';

import { buildPayoutBatches } from '../src/payout-execution.js';

const recipients = [
  { allocationId: 'a', destination: 'wallet-a', lamports: 7n },
  { allocationId: 'b', destination: 'wallet-b', lamports: 5n },
  { allocationId: 'c', destination: 'wallet-c', lamports: 3n },
];

describe('payout execution intents', () => {
  it('deterministically batches ordered exact-lamport recipients', () => {
    const input = {
      planId: 'plan',
      network: 'devnet' as const,
      treasury: 'treasury',
      recipients,
      maxRecipientsPerBatch: 2,
    };
    const first = buildPayoutBatches(input);
    const second = buildPayoutBatches(input);
    expect(first).toEqual(second);
    expect(first.map((batch) => batch.totalLamports)).toEqual([12n, 3n]);
    expect(first.map((batch) => batch.recipients.map((row) => row.allocationId))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('commits the environment and ordered destinations into the hash', () => {
    const base = buildPayoutBatches({
      planId: 'plan',
      network: 'devnet',
      treasury: 'treasury',
      recipients,
      maxRecipientsPerBatch: 3,
    })[0]!;
    const reordered = buildPayoutBatches({
      planId: 'plan',
      network: 'devnet',
      treasury: 'treasury',
      recipients: [...recipients].reverse(),
      maxRecipientsPerBatch: 3,
    })[0]!;
    const mainnet = buildPayoutBatches({
      planId: 'plan',
      network: 'mainnet-beta',
      treasury: 'treasury',
      recipients,
      maxRecipientsPerBatch: 3,
    })[0]!;
    expect(new Set([base.intentHash, reordered.intentHash, mainnet.intentHash]).size).toBe(3);
  });

  it('rejects duplicates and non-positive transfers', () => {
    expect(() =>
      buildPayoutBatches({
        planId: 'plan',
        network: 'devnet',
        treasury: 'treasury',
        recipients: [recipients[0]!, recipients[0]!],
        maxRecipientsPerBatch: 2,
      }),
    ).toThrow('Duplicate');
    expect(() =>
      buildPayoutBatches({
        planId: 'plan',
        network: 'devnet',
        treasury: 'treasury',
        recipients: [{ ...recipients[0]!, lamports: 0n }],
        maxRecipientsPerBatch: 2,
      }),
    ).toThrow('positive');
  });
});
