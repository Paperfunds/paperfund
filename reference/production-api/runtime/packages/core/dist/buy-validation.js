import { calculateEffectiveMaxBuy, calculateMaxBuyByRatio, calculatePortfolioEquity, } from './portfolio.js';
import { checkTokenSlotEligibility } from './token-slots.js';
export const BUY_REJECTION_REASONS = [
    'BUY_AMOUNT_MUST_BE_POSITIVE',
    'TOKEN_SLOT_LIMIT_REACHED',
    'INSUFFICIENT_PAPER_SOL',
    'MAX_BUY_RATIO_EXCEEDED',
];
function calculateBuyLimits(input) {
    const portfolioEquity = calculatePortfolioEquity(input.availablePaperSolCash, input.authoritativePositionValues);
    const maxBuyByRatio = calculateMaxBuyByRatio(portfolioEquity, input.maxBuyRatioBps);
    const effectiveMaxBuy = calculateEffectiveMaxBuy(input.availablePaperSolCash, maxBuyByRatio);
    return { portfolioEquity, maxBuyByRatio, effectiveMaxBuy };
}
/**
 * The ratio caps each new buy order only. Existing exposure to the target token is intentionally
 * not added to the requested buy and never reduces this per-order cap.
 */
export function validateBuyAmount(input) {
    if (input.requestedBuyAmount <= 0n) {
        return { ok: false, reason: 'BUY_AMOUNT_MUST_BE_POSITIVE' };
    }
    const limits = calculateBuyLimits(input);
    if (input.requestedBuyAmount > input.availablePaperSolCash) {
        return { ok: false, reason: 'INSUFFICIENT_PAPER_SOL', ...limits };
    }
    if (input.requestedBuyAmount > limits.maxBuyByRatio) {
        return { ok: false, reason: 'MAX_BUY_RATIO_EXCEEDED', ...limits };
    }
    return { ok: true, ...limits };
}
/**
 * Pure admission check only. The application layer must later run this validation and the related
 * balance/slot updates inside one authoritative transaction or lock boundary.
 */
export function validatePreBuy(input) {
    if (input.requestedBuyAmount <= 0n) {
        return { ok: false, reason: 'BUY_AMOUNT_MUST_BE_POSITIVE' };
    }
    // This establishes structurally valid financial inputs before ordinary eligibility checks.
    const limits = calculateBuyLimits({
        availablePaperSolCash: input.availablePaperSolCash,
        authoritativePositionValues: input.authoritativePositionValues,
        maxBuyRatioBps: input.config.maxBuyRatioBps,
    });
    const tokenSlot = checkTokenSlotEligibility({
        tokenMint: input.tokenMint,
        consumedSlots: input.consumedTokenSlots,
        slotsLimit: input.config.maxUniqueTokensPerRound,
    });
    const details = { ...limits, tokenSlot };
    if (!tokenSlot.eligible) {
        return { ok: false, reason: tokenSlot.reason, ...details };
    }
    if (input.requestedBuyAmount > input.availablePaperSolCash) {
        return { ok: false, reason: 'INSUFFICIENT_PAPER_SOL', ...details };
    }
    if (input.requestedBuyAmount > limits.maxBuyByRatio) {
        return { ok: false, reason: 'MAX_BUY_RATIO_EXCEEDED', ...details };
    }
    return { ok: true, ...details };
}
//# sourceMappingURL=buy-validation.js.map