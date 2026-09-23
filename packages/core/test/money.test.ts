import { describe, expect, it } from 'vitest';

import {
  formatLamports,
  formatPaperSol,
  lamportsFromSolString,
  paperSolDeltaFromSolString,
  paperSolFromSolString,
} from '../src/index.js';

describe('exact money parsing', () => {
  it('parses SOL decimals into exact lamports', () => {
    expect(lamportsFromSolString('1.000000001')).toBe(1_000_000_001n);
    expect(formatLamports(lamportsFromSolString('42.5'))).toBe('42.5');
  });

  it('parses Paper SOL into exact base units', () => {
    expect(paperSolFromSolString('10')).toBe(10_000_000_000n);
    expect(formatPaperSol(paperSolFromSolString('10.250000000'))).toBe('10.25');
  });

  it('supports the smallest base unit', () => {
    expect(lamportsFromSolString('0.000000001')).toBe(1n);
    expect(paperSolFromSolString('0.000000001')).toBe(1n);
  });

  it('rejects excessive precision instead of rounding', () => {
    expect(() => lamportsFromSolString('1.0000000001')).toThrow(/precision/);
    expect(() => paperSolFromSolString('0.0000000001')).toThrow(/precision/);
  });

  it('rejects negative balances while signed deltas are explicit', () => {
    expect(() => lamportsFromSolString('-1')).toThrow(/Invalid decimal amount/);
    expect(() => paperSolFromSolString('-0.1')).toThrow(/Invalid decimal amount/);
    expect(paperSolDeltaFromSolString('-1.5')).toBe(-1_500_000_000n);
    expect(formatPaperSol(paperSolDeltaFromSolString('-1.5'))).toBe('-1.5');
  });

  it('parses values far beyond Number safe-integer range with no precision loss', () => {
    expect(lamportsFromSolString('12345678901234567890.123456789')).toBe(
      12_345_678_901_234_567_890_123_456_789n,
    );
  });

  it('rejects ambiguous decimal syntax', () => {
    expect(() => lamportsFromSolString('01.0')).toThrow();
    expect(() => lamportsFromSolString('1e3')).toThrow();
    expect(() => lamportsFromSolString(' 1')).toThrow();
  });
});
