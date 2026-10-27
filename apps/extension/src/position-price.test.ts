import { describe, expect, it } from 'vitest';

import type { Position } from '@paperfund/shared/browser';

import { averageEntryPriceText } from './position-price.js';

function position(quantity: string, cost: string): Position {
  return {
    id: 'position',
    mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',
    originMarketId: 'market',
    originProtocol: 'PUMP_FUN',
    tokenDecimals: 6,
    tokenQuantityBaseUnits: quantity,
    costBasisPaperSolLamports: cost,
    realizedPnlLamports: '0',
    valuation: { status: 'UNAVAILABLE', reason: 'fixture', valuedAt: '2099-01-01T00:00:00Z' },
  };
}

describe('authoritative average entry display', () => {
  it('preserves tiny nonzero values without floating point rounding', () => {
    expect(averageEntryPriceText(position('1000000000000000', '1'))).toBe('0.000000000000000001');
  });
  it('uses weighted cost basis after one or multiple buys', () => {
    expect(averageEntryPriceText(position('100000000', '2000000000'))).toBe('0.02');
    expect(averageEntryPriceText(position('150000000', '4500000000'))).toBe('0.03');
  });

  it('keeps the remaining weighted basis after a partial sell and removes it after full exit', () => {
    expect(averageEntryPriceText(position('75000000', '2250000000'))).toBe('0.03');
    expect(averageEntryPriceText(position('0', '0'))).toBeNull();
  });
});
