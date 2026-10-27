import type { Position } from '@paperfund/shared/browser';

export function averageEntryPriceText(position: Position, significantDigits = 8): string | null {
  const quantity = BigInt(position.tokenQuantityBaseUnits);
  const cost = BigInt(position.costBasisPaperSolLamports);
  if (quantity <= 0n || cost < 0n) return null;
  const numerator = cost * 10n ** BigInt(position.tokenDecimals);
  const denominator = quantity * 1_000_000_000n;
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return whole.toString();
  // Include leading fractional zeroes before the requested significant digits.
  // Tiny but nonzero positions must never be displayed as zero or "0.".
  const leadingZeroes = Math.max(0, denominator.toString().length - remainder.toString().length);
  const precision = Math.max(significantDigits + leadingZeroes, position.tokenDecimals);
  const fraction = ((remainder * 10n ** BigInt(precision)) / denominator)
    .toString()
    .padStart(precision, '0')
    .replace(/0+$/, '');
  return `${whole}.${fraction}`;
}
