export const TOKEN_SLOT_REJECTION_REASONS = ['TOKEN_SLOT_LIMIT_REACHED'];
function validateSlotState(consumedSlots, slotsLimit) {
    if (!Number.isInteger(slotsLimit) || slotsLimit <= 0) {
        throw new RangeError('Token slot limit must be a positive integer.');
    }
    if (consumedSlots.length > slotsLimit) {
        throw new RangeError('Consumed token slots cannot exceed the configured limit.');
    }
    const uniqueMints = new Set(consumedSlots.map(({ tokenMint }) => tokenMint));
    if (uniqueMints.size !== consumedSlots.length) {
        throw new RangeError('Consumed token slots cannot contain duplicate token mints.');
    }
}
export function checkTokenSlotEligibility(input) {
    validateSlotState(input.consumedSlots, input.slotsLimit);
    const isExistingToken = input.consumedSlots.some(({ tokenMint }) => tokenMint === input.tokenMint);
    const metadata = {
        slotsUsed: input.consumedSlots.length,
        slotsLimit: input.slotsLimit,
        isExistingToken,
        wouldConsumeNewSlot: !isExistingToken,
    };
    if (!isExistingToken && input.consumedSlots.length === input.slotsLimit) {
        return { eligible: false, reason: 'TOKEN_SLOT_LIMIT_REACHED', ...metadata };
    }
    return { eligible: true, ...metadata };
}
/**
 * Records only a successful, non-zero first buy fill. Order submission, rejection, failure, and
 * zero-fill paths must never call this function.
 */
export function recordSuccessfulTokenEntry(input) {
    const eligibility = checkTokenSlotEligibility(input);
    const copiedSlots = [...input.consumedSlots];
    if (!eligibility.eligible) {
        return { ok: false, reason: eligibility.reason, slots: copiedSlots };
    }
    const existingSlot = copiedSlots.find(({ tokenMint }) => tokenMint === input.tokenMint);
    if (existingSlot) {
        return { ok: true, added: false, slot: existingSlot, slots: copiedSlots };
    }
    const slot = {
        slotNumber: copiedSlots.length + 1,
        tokenMint: input.tokenMint,
        firstSuccessfulBuyOrderId: input.firstSuccessfulBuyOrderId,
        consumedAt: input.consumedAt,
    };
    return { ok: true, added: true, slot, slots: [...copiedSlots, slot] };
}
//# sourceMappingURL=token-slots.js.map