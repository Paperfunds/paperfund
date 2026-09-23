import type { OrderId, TokenMint } from './identifiers.js';
import type { UtcInstant } from './time.js';
import type { TokenSlot } from './types.js';

export const TOKEN_SLOT_REJECTION_REASONS = ['TOKEN_SLOT_LIMIT_REACHED'] as const;
export type TokenSlotRejectionReason = (typeof TOKEN_SLOT_REJECTION_REASONS)[number];

interface TokenSlotMetadata {
  readonly slotsUsed: number;
  readonly slotsLimit: number;
  readonly isExistingToken: boolean;
  readonly wouldConsumeNewSlot: boolean;
}

export type TokenSlotEligibilityResult =
  | ({ readonly eligible: true } & TokenSlotMetadata)
  | ({ readonly eligible: false; readonly reason: TokenSlotRejectionReason } & TokenSlotMetadata);

function validateSlotState(consumedSlots: readonly TokenSlot[], slotsLimit: number): void {
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

export function checkTokenSlotEligibility(input: {
  readonly tokenMint: TokenMint;
  readonly consumedSlots: readonly TokenSlot[];
  readonly slotsLimit: number;
}): TokenSlotEligibilityResult {
  validateSlotState(input.consumedSlots, input.slotsLimit);

  const isExistingToken = input.consumedSlots.some(
    ({ tokenMint }) => tokenMint === input.tokenMint,
  );
  const metadata: TokenSlotMetadata = {
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

export type RecordSuccessfulTokenEntryResult =
  | {
      readonly ok: true;
      readonly added: boolean;
      readonly slot: TokenSlot;
      readonly slots: readonly TokenSlot[];
    }
  | {
      readonly ok: false;
      readonly reason: TokenSlotRejectionReason;
      readonly slots: readonly TokenSlot[];
    };

/**
 * Records only a successful, non-zero first buy fill. Order submission, rejection, failure, and
 * zero-fill paths must never call this function.
 */
export function recordSuccessfulTokenEntry(input: {
  readonly tokenMint: TokenMint;
  readonly consumedSlots: readonly TokenSlot[];
  readonly slotsLimit: number;
  readonly firstSuccessfulBuyOrderId: OrderId;
  readonly consumedAt: UtcInstant;
}): RecordSuccessfulTokenEntryResult {
  const eligibility = checkTokenSlotEligibility(input);
  const copiedSlots = [...input.consumedSlots];

  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason, slots: copiedSlots };
  }

  const existingSlot = copiedSlots.find(({ tokenMint }) => tokenMint === input.tokenMint);
  if (existingSlot) {
    return { ok: true, added: false, slot: existingSlot, slots: copiedSlots };
  }

  const slot: TokenSlot = {
    slotNumber: copiedSlots.length + 1,
    tokenMint: input.tokenMint,
    firstSuccessfulBuyOrderId: input.firstSuccessfulBuyOrderId,
    consumedAt: input.consumedAt,
  };
  return { ok: true, added: true, slot, slots: [...copiedSlots, slot] };
}
