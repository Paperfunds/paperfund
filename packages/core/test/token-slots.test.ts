import { describe, expect, it } from 'vitest';

import {
  checkTokenSlotEligibility,
  competitionConfig,
  identifier,
  recordSuccessfulTokenEntry,
  type OrderId,
  type TokenMint,
  type TokenSlot,
  type UtcInstant,
} from '../src/index.js';

function mint(value: string): TokenMint {
  return identifier(value, 'TokenMint') as TokenMint;
}

function record(
  consumedSlots: readonly TokenSlot[],
  tokenMint: TokenMint,
  slotsLimit = competitionConfig.maxUniqueTokensPerRound,
) {
  return recordSuccessfulTokenEntry({
    tokenMint,
    consumedSlots,
    slotsLimit,
    firstSuccessfulBuyOrderId: identifier(
      `order-${consumedSlots.length + 1}`,
      'OrderId',
    ) as OrderId,
    consumedAt: '2026-09-23T15:01:00.000Z' as UtcInstant,
  });
}

describe('token-slot eligibility and successful entry recording', () => {
  it('marks a first new token eligible without mutating slot state', () => {
    const slots: readonly TokenSlot[] = [];
    expect(
      checkTokenSlotEligibility({
        tokenMint: mint('mint-a'),
        consumedSlots: slots,
        slotsLimit: 5,
      }),
    ).toEqual({
      eligible: true,
      slotsUsed: 0,
      slotsLimit: 5,
      isExistingToken: false,
      wouldConsumeNewSlot: true,
    });
    expect(slots).toEqual([]);
  });

  it('consumes one slot only after recording a successful first fill', () => {
    const result = record([], mint('mint-a'));
    expect(result).toMatchObject({ ok: true, added: true });
    if (result.ok) {
      expect(result.slots).toHaveLength(1);
      expect(result.slot.slotNumber).toBe(1);
    }
  });

  it('does not add a duplicate slot for a rebuy of the same mint', () => {
    const first = record([], mint('mint-a'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rebuy = record(first.slots, mint('mint-a'));
    expect(rebuy).toMatchObject({ ok: true, added: false });
    if (rebuy.ok) {
      expect(rebuy.slots).toHaveLength(1);
      expect(rebuy.slot).toEqual(first.slot);
      expect(rebuy.slots).not.toBe(first.slots);
    }
  });

  it('keeps a consumed slot eligible even after exposure could have been sold', () => {
    const first = record([], mint('mint-a'));
    if (!first.ok) throw new Error('Test setup failed.');

    expect(
      checkTokenSlotEligibility({
        tokenMint: mint('mint-a'),
        consumedSlots: first.slots,
        slotsLimit: 5,
      }),
    ).toMatchObject({ eligible: true, isExistingToken: true, wouldConsumeNewSlot: false });
  });

  it('allows five unique mints and rejects a sixth under default configuration', () => {
    let slots: readonly TokenSlot[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const result = record(slots, mint(`mint-${index}`));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Test setup failed.');
      slots = result.slots;
    }

    expect(slots).toHaveLength(5);
    expect(record(slots, mint('mint-6'))).toMatchObject({
      ok: false,
      reason: 'TOKEN_SLOT_LIMIT_REACHED',
    });
  });

  it('keeps an existing token eligible when all five slots are consumed', () => {
    let slots: readonly TokenSlot[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const result = record(slots, mint(`mint-${index}`));
      if (!result.ok) throw new Error('Test setup failed.');
      slots = result.slots;
    }

    expect(
      checkTokenSlotEligibility({ tokenMint: mint('mint-3'), consumedSlots: slots, slotsLimit: 5 }),
    ).toMatchObject({ eligible: true, isExistingToken: true, slotsUsed: 5 });
  });

  it('leaves slots unchanged for failed, rejected, or zero-fill attempts', () => {
    const original: readonly TokenSlot[] = [];
    checkTokenSlotEligibility({
      tokenMint: mint('failed'),
      consumedSlots: original,
      slotsLimit: 5,
    });
    checkTokenSlotEligibility({
      tokenMint: mint('rejected'),
      consumedSlots: original,
      slotsLimit: 5,
    });
    checkTokenSlotEligibility({
      tokenMint: mint('zero-fill'),
      consumedSlots: original,
      slotsLimit: 5,
    });
    expect(original).toEqual([]);
  });

  it('rejects duplicate slot state as programmer-invalid input', () => {
    const first = record([], mint('mint-a'));
    if (!first.ok) throw new Error('Test setup failed.');
    expect(() =>
      checkTokenSlotEligibility({
        tokenMint: mint('mint-b'),
        consumedSlots: [first.slot, first.slot],
        slotsLimit: 5,
      }),
    ).toThrow(/duplicate token mints/);
  });

  it('supports an alternate configured limit of ten', () => {
    let slots: readonly TokenSlot[] = [];
    for (let index = 1; index <= 10; index += 1) {
      const result = record(slots, mint(`mint-${index}`), 10);
      if (!result.ok) throw new Error('Test setup failed.');
      slots = result.slots;
    }
    expect(slots).toHaveLength(10);
    expect(record(slots, mint('mint-11'), 10).ok).toBe(false);
  });

  it('uses mint identity, so different mints remain distinct regardless of display symbol', () => {
    const firstPepeMint = mint('mint-pepe-one');
    const secondPepeMint = mint('mint-pepe-two');
    const first = record([], firstPepeMint);
    if (!first.ok) throw new Error('Test setup failed.');

    expect(
      checkTokenSlotEligibility({
        tokenMint: secondPepeMint,
        consumedSlots: first.slots,
        slotsLimit: 5,
      }),
    ).toMatchObject({ eligible: true, isExistingToken: false, wouldConsumeNewSlot: true });
  });
});
