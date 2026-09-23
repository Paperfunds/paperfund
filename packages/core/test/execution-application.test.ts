import { describe, expect, it } from 'vitest';

import {
  applySuccessfulBuyExecution,
  applySuccessfulSellExecution,
  competitionConfig,
  createRoundCreditLedgerEntry,
  identifier,
  initializeCompetitionAccount,
  paperSolBaseUnits,
  paperSolFromSolString,
  tokenBaseUnits,
  type BuyOrderRequest,
  type CompetitionAccount,
  type CompetitionAccountId,
  type ExecutionId,
  type HourlyRoundId,
  type LedgerEntryId,
  type MarketId,
  type OrderId,
  type Position,
  type ProtocolId,
  type SellOrderRequest,
  type SimulatedExecution,
  type TokenMint,
  type UserId,
  type UtcInstant,
  type WalletAddress,
} from '../src/index.js';

const accountId = identifier('account-1', 'CompetitionAccountId') as CompetitionAccountId;
const roundId = identifier('round-1', 'HourlyRoundId') as HourlyRoundId;
const tokenMint = identifier('mint-1', 'TokenMint') as TokenMint;
const marketId = identifier('market-1', 'MarketId') as MarketId;
const protocolId = identifier('protocol-1', 'ProtocolId') as ProtocolId;
const buyOrderId = identifier('buy-order-1', 'OrderId') as OrderId;
const sellOrderId = identifier('sell-order-1', 'OrderId') as OrderId;
const buyExecutionId = identifier('buy-execution-1', 'ExecutionId') as ExecutionId;
const sellExecutionId = identifier('sell-execution-1', 'ExecutionId') as ExecutionId;
const executedAt = '2026-09-23T15:10:00.000Z' as UtcInstant;

function ledgerId(value: string): LedgerEntryId {
  return identifier(value, 'LedgerEntryId') as LedgerEntryId;
}

function account(balance = '10'): CompetitionAccount {
  return {
    ...initializeCompetitionAccount({
      accountId,
      userId: identifier('user-1', 'UserId') as UserId,
      walletAddress: identifier('wallet-1', 'WalletAddress') as WalletAddress,
      hourlyRoundId: roundId,
      config: competitionConfig,
    }),
    paperSolBalance: paperSolFromSolString(balance),
  };
}

function buyOrder(): BuyOrderRequest {
  return {
    id: buyOrderId,
    side: 'BUY',
    competitionAccountId: accountId,
    hourlyRoundId: roundId,
    tokenMint,
    marketId,
    protocolId,
    paperSolInput: paperSolFromSolString('2'),
    requestedAt: '2026-09-23T15:09:00.000Z' as UtcInstant,
  };
}

function buyExecution(cost = '2', received = 100n): SimulatedExecution {
  const order = buyOrder();
  return {
    id: buyExecutionId,
    orderId: order.id,
    quote: {
      orderId: order.id,
      marketId,
      protocolId,
      adapterVersion: 'fake-v1',
      marketStateRecordedAt: executedAt,
      requestedInput: { asset: 'PAPER_SOL', amount: order.paperSolInput },
      simulatedOutput: { asset: 'TOKEN', tokenMint, amount: tokenBaseUnits(received) },
      fees: [
        {
          category: 'PROTOCOL',
          amount: { asset: 'PAPER_SOL', amount: paperSolFromSolString('0.01') },
        },
      ],
    },
    actualInput: { asset: 'PAPER_SOL', amount: paperSolFromSolString(cost) },
    actualOutput: { asset: 'TOKEN', tokenMint, amount: tokenBaseUnits(received) },
    executedAt,
  };
}

function applyBuy(
  currentAccount = account(),
  positions: readonly Position[] = [],
  execution = buyExecution(),
) {
  return applySuccessfulBuyExecution({
    account: currentAccount,
    positions,
    order: buyOrder(),
    execution,
    tokenSlotsLimit: competitionConfig.maxUniqueTokensPerRound,
    ledgerEntryIds: { input: ledgerId('buy-paper'), output: ledgerId('buy-token') },
  });
}

function sellOrder(): SellOrderRequest {
  return {
    id: sellOrderId,
    side: 'SELL',
    competitionAccountId: accountId,
    hourlyRoundId: roundId,
    tokenMint,
    marketId,
    protocolId,
    tokenInput: tokenBaseUnits(100n),
    requestedAt: '2026-09-23T15:19:00.000Z' as UtcInstant,
  };
}

function sellExecution(sold = 100n, proceeds = '3'): SimulatedExecution {
  const order = sellOrder();
  return {
    id: sellExecutionId,
    orderId: order.id,
    quote: {
      orderId: order.id,
      marketId,
      protocolId,
      adapterVersion: 'fake-v1',
      marketStateRecordedAt: executedAt,
      requestedInput: { asset: 'TOKEN', tokenMint, amount: order.tokenInput },
      simulatedOutput: { asset: 'PAPER_SOL', amount: paperSolFromSolString(proceeds) },
      fees: [],
    },
    actualInput: { asset: 'TOKEN', tokenMint, amount: tokenBaseUnits(sold) },
    actualOutput: { asset: 'PAPER_SOL', amount: paperSolFromSolString(proceeds) },
    executedAt,
  };
}

function boughtState(quantity = 100n, basis = '2') {
  const buy = applyBuy(account(), [], buyExecution(basis, quantity));
  if (!buy.ok) throw new Error(`Test setup failed: ${buy.reason}`);
  return buy;
}

function applySell(
  currentAccount: CompetitionAccount,
  positions: readonly Position[],
  execution = sellExecution(),
) {
  return applySuccessfulSellExecution({
    account: currentAccount,
    positions,
    order: sellOrder(),
    execution,
    ledgerEntryIds: { input: ledgerId('sell-token'), output: ledgerId('sell-paper') },
  });
}

describe('successful BUY execution application', () => {
  it('debits Paper SOL, creates the exact position and basis, and consumes a slot', () => {
    const result = applyBuy();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.account.paperSolBalance).toBe(paperSolFromSolString('8'));
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({
      tokenMint,
      marketId,
      protocolId,
      tokenAmount: 100n,
      paperSolCostBasis: paperSolFromSolString('2'),
    });
    expect(result.tokenSlots).toHaveLength(1);
    expect(result.tokenSlots[0]?.firstSuccessfulBuyOrderId).toBe(buyOrderId);
  });

  it('adds quantity and actual cost on rebuy without consuming another slot', () => {
    const first = boughtState();
    const second = applyBuy(first.account, first.positions, buyExecution('1', 40n));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.positions[0]?.tokenAmount).toBe(140n);
    expect(second.positions[0]?.paperSolCostBasis).toBe(paperSolFromSolString('3'));
    expect(second.tokenSlots).toHaveLength(1);
  });

  it('allows an authoritative cost exactly equal to available Paper SOL', () => {
    const result = applyBuy(account('2'), [], buyExecution('2', 100n));
    expect(result.ok && result.account.paperSolBalance).toBe(0n);
  });

  it('rejects a cost greater than available Paper SOL', () => {
    expect(applyBuy(account('1'), [], buyExecution('2', 100n))).toEqual({
      ok: false,
      reason: 'BUY_COST_EXCEEDS_AVAILABLE_PAPER_SOL',
    });
  });

  it('rejects zero input and zero output explicitly', () => {
    expect(applyBuy(account(), [], buyExecution('0', 100n))).toEqual({
      ok: false,
      reason: 'EXECUTION_AMOUNT_MUST_BE_POSITIVE',
    });
    expect(applyBuy(account(), [], buyExecution('2', 0n))).toEqual({
      ok: false,
      reason: 'ZERO_EXECUTION_OUTPUT',
    });
  });

  it('fails safely when a new successful token would exceed the slot limit', () => {
    let state = boughtState();
    for (let index = 2; index <= 5; index += 1) {
      const nextMint = identifier(`mint-${index.toString()}`, 'TokenMint') as TokenMint;
      const order = { ...buyOrder(), tokenMint: nextMint };
      const execution = {
        ...buyExecution('1', 1n),
        actualOutput: { asset: 'TOKEN' as const, tokenMint: nextMint, amount: tokenBaseUnits(1n) },
      };
      const result = applySuccessfulBuyExecution({
        account: state.account,
        positions: state.positions,
        order,
        execution,
        tokenSlotsLimit: 5,
        ledgerEntryIds: {
          input: ledgerId(`paper-${index.toString()}`),
          output: ledgerId(`token-${index.toString()}`),
        },
      });
      if (!result.ok) throw new Error(`Test setup failed: ${result.reason}`);
      state = result;
    }
    const sixthMint = identifier('mint-6', 'TokenMint') as TokenMint;
    const sixth = applySuccessfulBuyExecution({
      account: state.account,
      positions: state.positions,
      order: { ...buyOrder(), tokenMint: sixthMint },
      execution: {
        ...buyExecution('1', 1n),
        actualOutput: { asset: 'TOKEN', tokenMint: sixthMint, amount: tokenBaseUnits(1n) },
      },
      tokenSlotsLimit: 5,
      ledgerEntryIds: { input: ledgerId('paper-6'), output: ledgerId('token-6') },
    });
    expect(sixth).toEqual({ ok: false, reason: 'TOKEN_SLOT_LIMIT_REACHED' });
  });

  it('keeps separate positions for the same mint in distinct markets', () => {
    const first = boughtState();
    const secondMarket = identifier('market-2', 'MarketId') as MarketId;
    const order = { ...buyOrder(), marketId: secondMarket };
    const execution = {
      ...buyExecution('1', 20n),
      quote: { ...buyExecution('1', 20n).quote, marketId: secondMarket },
    };
    const result = applySuccessfulBuyExecution({
      account: first.account,
      positions: first.positions,
      order,
      execution,
      tokenSlotsLimit: 5,
      ledgerEntryIds: { input: ledgerId('paper-2'), output: ledgerId('token-2') },
    });
    expect(result.ok && result.positions).toHaveLength(2);
    expect(result.ok && result.tokenSlots).toHaveLength(1);
  });

  it('does not mutate account, positions, slots, execution, or fee arrays', () => {
    const currentAccount = account();
    const positions: readonly Position[] = [];
    const execution = buyExecution();
    const originalAccount = structuredClone(currentAccount);
    const originalExecution = structuredClone(execution);

    const result = applyBuy(currentAccount, positions, execution);
    expect(result.ok).toBe(true);
    expect(currentAccount).toEqual(originalAccount);
    expect(positions).toEqual([]);
    expect(execution).toEqual(originalExecution);
    if (result.ok) {
      expect(result.account).not.toBe(currentAccount);
      expect(result.tokenSlots).not.toBe(currentAccount.tokenSlots);
      expect(result.ledgerEntries[0]).toMatchObject({ executionFees: execution.quote.fees });
      expect(
        (result.ledgerEntries[0] as { executionFees: readonly unknown[] }).executionFees,
      ).not.toBe(execution.quote.fees);
    }
  });
});

describe('successful SELL execution application', () => {
  it('closes a profitable full position and realizes all basis', () => {
    const state = boughtState();
    const result = applySell(state.account, state.positions, sellExecution(100n, '3'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.positions).toEqual([]);
    expect(result.account.paperSolBalance).toBe(paperSolFromSolString('11'));
    expect(result.realizedPnl).toBe(paperSolFromSolString('1'));
  });

  it('represents a losing full sell as an exact signed P&L', () => {
    const state = boughtState();
    const result = applySell(state.account, state.positions, sellExecution(100n, '1.5'));
    expect(result.ok && result.realizedPnl).toBe(-500_000_000n);
  });

  it('removes proportional basis for a partial sell', () => {
    const state = boughtState();
    const result = applySell(state.account, state.positions, sellExecution(25n, '0.75'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.positions[0]?.tokenAmount).toBe(75n);
    expect(result.positions[0]?.paperSolCostBasis).toBe(paperSolFromSolString('1.5'));
    expect(result.realizedPnl).toBe(paperSolFromSolString('0.25'));
  });

  it('rounds partial basis removal down and clears the remainder on the final sell', () => {
    const state = boughtState(3n, '0.00000001');
    const partial = applySell(state.account, state.positions, sellExecution(1n, '0.000000003'));
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.positions[0]?.paperSolCostBasis).toBe(7n);
    expect(partial.realizedPnl).toBe(0n);

    const final = applySell(partial.account, partial.positions, sellExecution(2n, '0.000000007'));
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.positions).toEqual([]);
    expect(final.realizedPnl).toBe(0n);
  });

  it('rejects selling more than held or selling a nonexistent position', () => {
    const state = boughtState();
    expect(applySell(state.account, state.positions, sellExecution(101n, '3'))).toEqual({
      ok: false,
      reason: 'SELL_QUANTITY_EXCEEDS_POSITION',
    });
    expect(applySell(state.account, [], sellExecution())).toEqual({
      ok: false,
      reason: 'POSITION_NOT_FOUND',
    });
  });

  it('rejects zero sold quantity and zero proceeds explicitly', () => {
    const state = boughtState();
    expect(applySell(state.account, state.positions, sellExecution(0n, '1'))).toEqual({
      ok: false,
      reason: 'EXECUTION_AMOUNT_MUST_BE_POSITIVE',
    });
    expect(applySell(state.account, state.positions, sellExecution(1n, '0'))).toEqual({
      ok: false,
      reason: 'ZERO_EXECUTION_OUTPUT',
    });
  });

  it('retains the consumed token slot after a full close', () => {
    const state = boughtState();
    const result = applySell(state.account, state.positions);
    expect(result.ok && result.tokenSlots).toEqual(state.tokenSlots);
    expect(result.ok && result.tokenSlots).toHaveLength(1);
  });

  it('does not mutate caller-owned account, positions, slots, or execution', () => {
    const state = boughtState();
    const execution = sellExecution(25n, '0.75');
    const originalAccount = structuredClone(state.account);
    const originalPositions = structuredClone(state.positions);
    const originalExecution = structuredClone(execution);

    const result = applySell(state.account, state.positions, execution);
    expect(result.ok).toBe(true);
    expect(state.account).toEqual(originalAccount);
    expect(state.positions).toEqual(originalPositions);
    expect(execution).toEqual(originalExecution);
    if (result.ok) expect(result.account.tokenSlots).not.toBe(state.account.tokenSlots);
  });
});

describe('domain ledger and conservation invariants', () => {
  it('creates a deterministic positive round credit matching initialization', () => {
    const initialized = account();
    const id = ledgerId('round-credit');
    const entry = createRoundCreditLedgerEntry({
      id,
      account: initialized,
      creditedAt: executedAt,
    });
    expect(entry).toEqual({
      id,
      competitionAccountId: accountId,
      eventType: 'ROUND_CREDIT',
      asset: 'PAPER_SOL',
      amount: 10_000_000_000n,
      occurredAt: executedAt,
    });
  });

  it('uses account-perspective signs and caller-controlled IDs/timestamps', () => {
    const buy = boughtState();
    expect(buy.ledgerEntries).toMatchObject([
      { id: ledgerId('buy-paper'), eventType: 'BUY_PAPER_SOL_DEBIT', amount: -2_000_000_000n },
      { id: ledgerId('buy-token'), eventType: 'BUY_TOKEN_CREDIT', amount: 100n },
    ]);
    expect(buy.ledgerEntries.every(({ occurredAt }) => occurredAt === executedAt)).toBe(true);

    const sell = applySell(buy.account, buy.positions, sellExecution(25n, '0.75'));
    expect(sell.ok).toBe(true);
    if (!sell.ok) return;
    expect(sell.ledgerEntries).toMatchObject([
      { id: ledgerId('sell-token'), eventType: 'SELL_TOKEN_DEBIT', amount: -25n },
      {
        id: ledgerId('sell-paper'),
        eventType: 'SELL_PAPER_SOL_CREDIT',
        amount: 750_000_000n,
      },
    ]);
  });

  it('keeps state deltas exactly equal to authoritative fills and ledger postings', () => {
    const beforeBuy = account();
    const buy = applyBuy(beforeBuy);
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    expect(beforeBuy.paperSolBalance - buy.account.paperSolBalance).toBe(2_000_000_000n);
    expect(buy.positions[0]?.tokenAmount).toBe(100n);
    expect(buy.ledgerEntries[0]?.amount).toBe(-2_000_000_000n);
    expect(buy.ledgerEntries[1]?.amount).toBe(100n);

    const sell = applySell(buy.account, buy.positions, sellExecution(25n, '0.75'));
    expect(sell.ok).toBe(true);
    if (!sell.ok) return;
    expect(sell.account.paperSolBalance - buy.account.paperSolBalance).toBe(750_000_000n);
    expect(buy.positions[0]!.tokenAmount - sell.positions[0]!.tokenAmount).toBe(25n);
    expect(sell.ledgerEntries[0]?.amount).toBe(-25n);
    expect(sell.ledgerEntries[1]?.amount).toBe(750_000_000n);
  });

  it('rejects identity, asset, and position-scope inconsistencies without throwing', () => {
    const mismatchedExecution = {
      ...buyExecution(),
      orderId: identifier('other-order', 'OrderId') as OrderId,
    };
    expect(applyBuy(account(), [], mismatchedExecution)).toEqual({
      ok: false,
      reason: 'EXECUTION_IDENTITY_MISMATCH',
    });

    const wrongAssetExecution: SimulatedExecution = {
      ...buyExecution(),
      actualInput: { asset: 'TOKEN', tokenMint, amount: tokenBaseUnits(1n) },
    };
    expect(applyBuy(account(), [], wrongAssetExecution)).toEqual({
      ok: false,
      reason: 'EXECUTION_ASSET_MISMATCH',
    });

    const state = boughtState();
    const foreignPosition: Position = {
      ...state.positions[0]!,
      competitionAccountId: identifier(
        'another-account',
        'CompetitionAccountId',
      ) as CompetitionAccountId,
    };
    expect(applySell(state.account, [foreignPosition])).toEqual({
      ok: false,
      reason: 'INCOMPATIBLE_POSITION_IDENTITY',
    });
  });

  it('uses only bigint base-unit arithmetic in ledger amounts', () => {
    const buy = boughtState();
    expect(buy.ledgerEntries.every(({ amount }) => typeof amount === 'bigint')).toBe(true);
    expect(typeof paperSolBaseUnits(1n)).toBe('bigint');
  });
});
