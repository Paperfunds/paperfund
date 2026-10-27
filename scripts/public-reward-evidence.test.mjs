import { describe, it, expect } from 'vitest';
import { creatorObservations } from './public-reward-evidence.mjs';
const event = {
  transactionSignature: '1'.repeat(88),
  eventIndex: 2,
  eventTime: '2026-10-20T00:00:00Z',
  creatorFeeLamports: '9007199254740993',
  privateKey: 'must-not-leak',
};
describe('public creator-fee evidence', () => {
  it('preserves exact amounts beyond Number precision and excludes private fields', () => {
    const result = creatorObservations([event]);
    expect(result.total).toBe('9007199254740993');
    expect(JSON.stringify(result)).not.toContain('privateKey');
    expect(result.rows[0].status).toBe('OBSERVED_REVIEW');
  });
  it('does not count repeated chain event identities twice', () => {
    expect(creatorObservations([event, event]).total).toBe(event.creatorFeeLamports);
  });
  it('fails the aggregate closed for malformed or conflicting evidence', () => {
    expect(creatorObservations([event, { ...event, creatorFeeLamports: '9' }]).total).toBeNull();
    expect(
      creatorObservations([event, { ...event, eventIndex: 3, creatorFeeLamports: undefined }])
        .total,
    ).toBeNull();
  });
  it('distinguishes missing evidence from an empty, observed event collection', () => {
    expect(creatorObservations(undefined).total).toBeNull();
    expect(creatorObservations([]).total).toBe('0');
  });
});
