import { paperSolBaseUnits } from './money.js';
import { BASIS_POINTS_PER_WHOLE } from './percentages.js';
function assertNonNegative(value, name) {
    if (value < 0n) {
        throw new RangeError(`${name} cannot be negative.`);
    }
}
export function calculatePortfolioEquity(availablePaperSolCash, authoritativePositionValues) {
    assertNonNegative(availablePaperSolCash, 'Available Paper SOL cash');
    const total = authoritativePositionValues.reduce((equity, positionValue, index) => {
        assertNonNegative(positionValue, `Position value at index ${index.toString()}`);
        return equity + positionValue;
    }, availablePaperSolCash);
    return paperSolBaseUnits(total);
}
/** Uses integer division, so any fractional base unit is always rounded down. */
export function calculateMaxBuyByRatio(portfolioEquity, maxBuyRatioBps) {
    assertNonNegative(portfolioEquity, 'Portfolio equity');
    return paperSolBaseUnits((portfolioEquity * maxBuyRatioBps) / BASIS_POINTS_PER_WHOLE);
}
export function calculateEffectiveMaxBuy(availablePaperSolCash, maxBuyByRatio) {
    assertNonNegative(availablePaperSolCash, 'Available Paper SOL cash');
    assertNonNegative(maxBuyByRatio, 'Maximum buy by ratio');
    return availablePaperSolCash < maxBuyByRatio ? availablePaperSolCash : maxBuyByRatio;
}
//# sourceMappingURL=portfolio.js.map