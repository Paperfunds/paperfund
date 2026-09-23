import { paperSolBaseUnits, type PaperSolBaseUnits } from './money.js';
import { BASIS_POINTS_PER_WHOLE, type BasisPoints } from './percentages.js';

function assertNonNegative(value: bigint, name: string): void {
  if (value < 0n) {
    throw new RangeError(`${name} cannot be negative.`);
  }
}

export function calculatePortfolioEquity(
  availablePaperSolCash: PaperSolBaseUnits,
  authoritativePositionValues: readonly PaperSolBaseUnits[],
): PaperSolBaseUnits {
  assertNonNegative(availablePaperSolCash, 'Available Paper SOL cash');

  const total = authoritativePositionValues.reduce<bigint>((equity, positionValue, index) => {
    assertNonNegative(positionValue, `Position value at index ${index.toString()}`);
    return equity + positionValue;
  }, availablePaperSolCash);

  return paperSolBaseUnits(total);
}

/** Uses integer division, so any fractional base unit is always rounded down. */
export function calculateMaxBuyByRatio(
  portfolioEquity: PaperSolBaseUnits,
  maxBuyRatioBps: BasisPoints,
): PaperSolBaseUnits {
  assertNonNegative(portfolioEquity, 'Portfolio equity');
  return paperSolBaseUnits((portfolioEquity * maxBuyRatioBps) / BASIS_POINTS_PER_WHOLE);
}

export function calculateEffectiveMaxBuy(
  availablePaperSolCash: PaperSolBaseUnits,
  maxBuyByRatio: PaperSolBaseUnits,
): PaperSolBaseUnits {
  assertNonNegative(availablePaperSolCash, 'Available Paper SOL cash');
  assertNonNegative(maxBuyByRatio, 'Maximum buy by ratio');
  return availablePaperSolCash < maxBuyByRatio ? availablePaperSolCash : maxBuyByRatio;
}
