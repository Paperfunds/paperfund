import { describe, expect, it } from 'vitest';

import {
  basisPoints,
  calculateEffectiveMaxBuy,
  calculateMaxBuyByRatio,
  calculatePortfolioEquity,
  paperSolBaseUnits,
  paperSolFromSolString,
  type PaperSolBaseUnits,
} from '../src/index.js';

describe('portfolio equity', () => {
  it('returns cash when there are no positions', () => {
    expect(calculatePortfolioEquity(paperSolFromSolString('10'), [])).toBe(10_000_000_000n);
  });

  it('adds cash and already-valued positions exactly', () => {
    expect(
      calculatePortfolioEquity(paperSolFromSolString('6'), [
        paperSolFromSolString('2.5'),
        paperSolFromSolString('1.5'),
      ]),
    ).toBe(10_000_000_000n);
  });

  it('supports zero cash, zero-value positions, and multiple positions', () => {
    expect(
      calculatePortfolioEquity(paperSolBaseUnits(0n), [
        paperSolBaseUnits(0n),
        paperSolFromSolString('2'),
        paperSolFromSolString('3'),
      ]),
    ).toBe(5_000_000_000n);
  });

  it('rejects negative cash and negative position values', () => {
    expect(() => calculatePortfolioEquity(-1n as PaperSolBaseUnits, [])).toThrow(/cash/);
    expect(() =>
      calculatePortfolioEquity(paperSolBaseUnits(0n), [-1n as PaperSolBaseUnits]),
    ).toThrow(/Position value/);
  });

  it('supports values far beyond Number safe-integer range', () => {
    const huge = paperSolBaseUnits(10n ** 40n);
    expect(calculatePortfolioEquity(huge, [huge, huge])).toBe(3n * 10n ** 40n);
  });
});

describe('maximum buy calculations', () => {
  it('calculates exactly 20% of 10 Paper SOL', () => {
    expect(calculateMaxBuyByRatio(paperSolFromSolString('10'), basisPoints(2_000n))).toBe(
      2_000_000_000n,
    );
  });

  it('honors alternative configured ratios', () => {
    expect(calculateMaxBuyByRatio(paperSolFromSolString('10'), basisPoints(1_250n))).toBe(
      1_250_000_000n,
    );
  });

  it('always rounds fractional base units down', () => {
    expect(calculateMaxBuyByRatio(paperSolBaseUnits(9n), basisPoints(2_000n))).toBe(1n);
  });

  it('caps the effective maximum at available cash', () => {
    expect(calculateEffectiveMaxBuy(paperSolFromSolString('1'), paperSolFromSolString('2'))).toBe(
      1_000_000_000n,
    );
    expect(calculateEffectiveMaxBuy(paperSolFromSolString('6'), paperSolFromSolString('2'))).toBe(
      2_000_000_000n,
    );
  });
});
