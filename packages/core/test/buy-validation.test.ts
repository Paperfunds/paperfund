import { describe, expect, it } from 'vitest';

import {
  basisPoints,
  competitionConfig,
  identifier,
  paperSolFromSolString,
  validateBuyAmount,
  validatePreBuy,
  type OrderId,
  type PaperSolBaseUnits,
  type TokenMint,
  type TokenSlot,
  type UtcInstant,
} from '../src/index.js';

function mint(value: string): TokenMint {
  return identifier(value, 'TokenMint') as TokenMint;
}

function slotsFor(...mints: TokenMint[]): readonly TokenSlot[] {
  return mints.map((tokenMint, index) => ({
    slotNumber: index + 1,
    tokenMint,
    firstSuccessfulBuyOrderId: identifier(`order-${index + 1}`, 'OrderId') as OrderId,
    consumedAt: '2026-09-23T15:01:00.000Z' as UtcInstant,
  }));
}

describe('buy amount validation', () => {
  it('allows exactly 20% and values below the limit', () => {
    const exact = validateBuyAmount({
      requestedBuyAmount: paperSolFromSolString('2'),
      availablePaperSolCash: paperSolFromSolString('10'),
      authoritativePositionValues: [],
      maxBuyRatioBps: competitionConfig.maxBuyRatioBps,
    });
    const below = validateBuyAmount({
      requestedBuyAmount: paperSolFromSolString('1.999999999'),
      availablePaperSolCash: paperSolFromSolString('10'),
      authoritativePositionValues: [],
      maxBuyRatioBps: competitionConfig.maxBuyRatioBps,
    });

    expect(exact).toMatchObject({ ok: true, maxBuyByRatio: 2_000_000_000n });
    expect(below.ok).toBe(true);
  });

  it('rejects one base unit above the ratio limit', () => {
    expect(
      validateBuyAmount({
        requestedBuyAmount: paperSolFromSolString('2.000000001'),
        availablePaperSolCash: paperSolFromSolString('10'),
        authoritativePositionValues: [],
        maxBuyRatioBps: competitionConfig.maxBuyRatioBps,
      }),
    ).toMatchObject({ ok: false, reason: 'MAX_BUY_RATIO_EXCEEDED' });
  });

  it('honors a configured ratio and reports exact rounded-down limits', () => {
    const result = validateBuyAmount({
      requestedBuyAmount: paperSolFromSolString('1.25'),
      availablePaperSolCash: paperSolFromSolString('10'),
      authoritativePositionValues: [],
      maxBuyRatioBps: basisPoints(1_250n),
    });
    expect(result).toMatchObject({ ok: true, maxBuyByRatio: 1_250_000_000n });

    const rounded = validateBuyAmount({
      requestedBuyAmount: 1n as PaperSolBaseUnits,
      availablePaperSolCash: 9n as PaperSolBaseUnits,
      authoritativePositionValues: [],
      maxBuyRatioBps: basisPoints(2_000n),
    });
    expect(rounded).toMatchObject({ ok: true, maxBuyByRatio: 1n });
  });

  it('rejects insufficient cash even when total equity supports the request', () => {
    expect(
      validateBuyAmount({
        requestedBuyAmount: paperSolFromSolString('2'),
        availablePaperSolCash: paperSolFromSolString('1'),
        authoritativePositionValues: [paperSolFromSolString('9')],
        maxBuyRatioBps: competitionConfig.maxBuyRatioBps,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_PAPER_SOL',
      portfolioEquity: 10_000_000_000n,
      maxBuyByRatio: 2_000_000_000n,
      effectiveMaxBuy: 1_000_000_000n,
    });
  });

  it('rejects zero and negative requested buys with the stable positive-amount code', () => {
    for (const requestedBuyAmount of [0n, -1n] as const) {
      expect(
        validateBuyAmount({
          requestedBuyAmount: requestedBuyAmount as PaperSolBaseUnits,
          availablePaperSolCash: paperSolFromSolString('10'),
          authoritativePositionValues: [],
          maxBuyRatioBps: competitionConfig.maxBuyRatioBps,
        }),
      ).toEqual({ ok: false, reason: 'BUY_AMOUNT_MUST_BE_POSITIVE' });
    }
  });

  it('does not turn the per-order cap into a permanent token-exposure cap', () => {
    const result = validateBuyAmount({
      requestedBuyAmount: paperSolFromSolString('2'),
      availablePaperSolCash: paperSolFromSolString('4'),
      // TOKEN_A is already worth 60% of this portfolio. The new order is still capped at 20%
      // of total pre-buy equity, not at 20% minus existing TOKEN_A exposure.
      authoritativePositionValues: [paperSolFromSolString('6')],
      maxBuyRatioBps: competitionConfig.maxBuyRatioBps,
    });

    expect(result).toMatchObject({
      ok: true,
      portfolioEquity: 10_000_000_000n,
      maxBuyByRatio: 2_000_000_000n,
    });
  });
});

describe('combined pre-buy validation', () => {
  const existingMint = mint('mint-a');
  const fullSlots = slotsFor(
    existingMint,
    mint('mint-b'),
    mint('mint-c'),
    mint('mint-d'),
    mint('mint-e'),
  );

  it('passes a 2 Paper SOL new-token buy against a 10 Paper SOL cash portfolio', () => {
    expect(
      validatePreBuy({
        tokenMint: mint('new-mint'),
        requestedBuyAmount: paperSolFromSolString('2'),
        availablePaperSolCash: paperSolFromSolString('10'),
        authoritativePositionValues: [],
        consumedTokenSlots: [],
        config: competitionConfig,
      }),
    ).toMatchObject({ ok: true, effectiveMaxBuy: 2_000_000_000n });
  });

  it('rejects 2 Paper SOL plus one base unit by ratio', () => {
    expect(
      validatePreBuy({
        tokenMint: mint('new-mint'),
        requestedBuyAmount: paperSolFromSolString('2.000000001'),
        availablePaperSolCash: paperSolFromSolString('10'),
        authoritativePositionValues: [],
        consumedTokenSlots: [],
        config: competitionConfig,
      }),
    ).toMatchObject({ ok: false, reason: 'MAX_BUY_RATIO_EXCEEDED' });
  });

  it('rejects insufficient cash before ratio when the ratio itself permits the buy', () => {
    expect(
      validatePreBuy({
        tokenMint: existingMint,
        requestedBuyAmount: paperSolFromSolString('2'),
        availablePaperSolCash: paperSolFromSolString('1'),
        authoritativePositionValues: [paperSolFromSolString('9')],
        consumedTokenSlots: fullSlots,
        config: competitionConfig,
      }),
    ).toMatchObject({ ok: false, reason: 'INSUFFICIENT_PAPER_SOL' });
  });

  it('rejects a sixth new token before evaluating cash or ratio', () => {
    expect(
      validatePreBuy({
        tokenMint: mint('sixth-mint'),
        requestedBuyAmount: paperSolFromSolString('9'),
        availablePaperSolCash: paperSolFromSolString('1'),
        authoritativePositionValues: [paperSolFromSolString('9')],
        consumedTokenSlots: fullSlots,
        config: competitionConfig,
      }),
    ).toMatchObject({ ok: false, reason: 'TOKEN_SLOT_LIMIT_REACHED' });
  });

  it('allows an existing token when all slots are used', () => {
    expect(
      validatePreBuy({
        tokenMint: existingMint,
        requestedBuyAmount: paperSolFromSolString('2'),
        availablePaperSolCash: paperSolFromSolString('10'),
        authoritativePositionValues: [],
        consumedTokenSlots: fullSlots,
        config: competitionConfig,
      }),
    ).toMatchObject({ ok: true, tokenSlot: { isExistingToken: true } });
  });

  it('allows another TOKEN_A buy when TOKEN_A already represents 60% of equity', () => {
    expect(
      validatePreBuy({
        tokenMint: existingMint,
        requestedBuyAmount: paperSolFromSolString('2'),
        availablePaperSolCash: paperSolFromSolString('4'),
        authoritativePositionValues: [paperSolFromSolString('6')],
        consumedTokenSlots: [fullSlots[0]!],
        config: competitionConfig,
      }),
    ).toMatchObject({
      ok: true,
      maxBuyByRatio: 2_000_000_000n,
      tokenSlot: { isExistingToken: true, wouldConsumeNewSlot: false },
    });
  });
});
