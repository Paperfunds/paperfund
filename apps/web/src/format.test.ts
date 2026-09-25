import { describe, expect, it } from 'vitest';

import {
  formatUnits,
  lamportsToSolInput,
  percentageQuantity,
  solTextToLamports,
} from './format.js';

describe('exact financial formatting', () => {
  it('parses SOL text without floating point', () => {
    expect(solTextToLamports('2.000000001')).toBe(2_000_000_001n);
    expect(solTextToLamports('1e2')).toBeNull();
    expect(lamportsToSolInput(2_000_000_001n)).toBe('2.000000001');
  });

  it('rounds partial sells down and never exceeds the position', () => {
    expect(percentageQuantity('7', 25)).toBe('1');
    expect(percentageQuantity('7', 75)).toBe('5');
    expect(percentageQuantity('7', 100)).toBe('7');
    expect(formatUnits('123456789', 6, 4)).toBe('123.4567');
  });
});
