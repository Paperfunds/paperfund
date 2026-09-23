import { describe, expect, it } from 'vitest';

import {
  competitionConfig,
  identifier,
  paperSolFromSolString,
  settleHourlyAccount,
  tokenBaseUnits,
  utcInstant,
  type CompetitionAccount,
  type CompetitionAccountId,
  type ExecutionId,
  type ForcedSettlementExecution,
  type HourlyRound,
  type HourlyRoundId,
  type LedgerEntryId,
  type MarketId,
  type OrderId,
  type Position,
  type ProtocolId,
  type TokenMint,
  type TokenSlot,
  type UserId,
  type WalletAddress,
} from '../src/index.js';

const roundId = identifier('round-1', 'HourlyRoundId') as HourlyRoundId;
const accountId = identifier('account-1', 'CompetitionAccountId') as CompetitionAccountId;
const userId = identifier('user-1', 'UserId') as UserId;
const finalizedAt = utcInstant('2026-09-23T16:00:01Z');

function id<Name extends string>(value: string, name: Name) {
  return identifier(value, name);
}

function round(state: HourlyRound['state'] = 'SETTLING'): HourlyRound {
  return {
    id: roundId,
    state,
    startsAt: utcInstant('2026-09-23T15:00:00Z'),
    endsAtExclusive: utcInstant('2026-09-23T16:00:00Z'),
    configurationVersion: competitionConfig.version,
  };
}

function tokenSlot(mint: TokenMint, index: number): TokenSlot {
  return {
    slotNumber: index,
    tokenMint: mint,
    firstSuccessfulBuyOrderId: id(`buy-${index.toString()}`, 'OrderId') as OrderId,
    consumedAt: utcInstant(`2026-09-23T15:0${index.toString()}:00Z`),
  };
}

function account(balance: string, slots: readonly TokenSlot[]): CompetitionAccount {
  return {
    id: accountId,
    userId,
    walletAddress: id('wallet-1', 'WalletAddress') as WalletAddress,
    hourlyRoundId: roundId,
    paperSolBalance: paperSolFromSolString(balance),
    tokenSlots: slots,
  };
}

function position(
  label: string,
  quantity = 100n,
  basis = '2',
  protocol = `protocol-${label}`,
  market = `market-${label}`,
): Position {
  return {
    competitionAccountId: accountId,
    hourlyRoundId: roundId,
    tokenMint: id(`mint-${label}`, 'TokenMint') as TokenMint,
    marketId: id(market, 'MarketId') as MarketId,
    protocolId: id(protocol, 'ProtocolId') as ProtocolId,
    tokenAmount: tokenBaseUnits(quantity),
    paperSolCostBasis: paperSolFromSolString(basis),
    updatedAt: utcInstant('2026-09-23T15:30:00Z'),
  };
}

function settlement(
  target: Position,
  proceeds: string,
  suffix = target.tokenMint,
  sold = target.tokenAmount,
): ForcedSettlementExecution {
  const orderId = id(`settlement-order-${suffix}`, 'OrderId') as OrderId;
  return {
    order: {
      id: orderId,
      side: 'SELL',
      competitionAccountId: accountId,
      hourlyRoundId: roundId,
      tokenMint: target.tokenMint,
      marketId: target.marketId,
      protocolId: target.protocolId,
      tokenInput: sold,
      requestedAt: utcInstant('2026-09-23T16:00:00Z'),
    },
    execution: {
      id: id(`settlement-execution-${suffix}`, 'ExecutionId') as ExecutionId,
      orderId,
      quote: {
        orderId,
        marketId: target.marketId,
        protocolId: target.protocolId,
        adapterVersion: 'fake-v1',
        marketStateRecordedAt: utcInstant('2026-09-23T16:00:00Z'),
        requestedInput: { asset: 'TOKEN', tokenMint: target.tokenMint, amount: sold },
        simulatedOutput: { asset: 'PAPER_SOL', amount: paperSolFromSolString(proceeds) },
        fees: [],
      },
      actualInput: { asset: 'TOKEN', tokenMint: target.tokenMint, amount: sold },
      actualOutput: { asset: 'PAPER_SOL', amount: paperSolFromSolString(proceeds) },
      executedAt: utcInstant('2026-09-23T16:00:00.500Z'),
    },
    ledgerEntryIds: {
      input: id(`forced-token-${suffix}`, 'LedgerEntryId') as LedgerEntryId,
      output: id(`forced-paper-${suffix}`, 'LedgerEntryId') as LedgerEntryId,
    },
  };
}

function settle(
  currentAccount: CompetitionAccount,
  positions: readonly Position[],
  executions: readonly ForcedSettlementExecution[],
  currentRound = round(),
) {
  return settleHourlyAccount({
    round: currentRound,
    account: currentAccount,
    positions,
    settlementExecutions: executions,
    startingPaperSolBaseUnits: competitionConfig.startingPaperSolBaseUnits,
    finalizedAt,
  });
}

describe('hourly forced-settlement orchestration', () => {
  it('fully settles a profitable single position and emits forced ledger semantics', () => {
    const open = position('a');
    const slots = [tokenSlot(open.tokenMint, 1)];
    const result = settle(account('8', slots), [open], [settlement(open, '3')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.round.state).toBe('FINALIZED');
    expect(result.positions).toEqual([]);
    expect(result.account.paperSolBalance).toBe(paperSolFromSolString('11'));
    expect(result.tokenSlots).toEqual(slots);
    expect(result.hourlyResult).toEqual({
      hourlyRoundId: roundId,
      competitionAccountId: accountId,
      userId,
      finalSettledPaperSol: paperSolFromSolString('11'),
      pnl: paperSolFromSolString('1'),
      finalizedAt,
    });
    expect(result.hourlyResult).not.toHaveProperty('rank');
    expect(result.ledgerEntries).toMatchObject([
      { eventType: 'FORCED_SETTLEMENT_TOKEN_DEBIT', amount: -100n },
      { eventType: 'FORCED_SETTLEMENT_PAPER_SOL_CREDIT', amount: 3_000_000_000n },
    ]);
  });

  it('calculates a losing result from final cash rather than trade P&L accumulation', () => {
    const open = position('a');
    const result = settle(
      account('8', [tokenSlot(open.tokenMint, 1)]),
      [open],
      [settlement(open, '0.5')],
    );
    expect(result.ok && result.hourlyResult.finalSettledPaperSol).toBe(
      paperSolFromSolString('8.5'),
    );
    expect(result.ok && result.hourlyResult.pnl).toBe(-1_500_000_000n);
  });

  it('finalizes a flat account with no open positions or fake ledger entry', () => {
    const result = settle(account('10', []), [], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hourlyResult.pnl).toBe(0n);
    expect(result.ledgerEntries).toEqual([]);
  });

  it('settles three positions in protocol, market, mint order regardless of input order', () => {
    const a = position('a', 10n, '1', 'protocol-b', 'market-a');
    const b = position('b', 20n, '2', 'protocol-a', 'market-z');
    const c = position('c', 30n, '3', 'protocol-a', 'market-a');
    const positions = [a, b, c];
    const slots = positions.map((item, index) => tokenSlot(item.tokenMint, index + 1));
    const settlements = [settlement(a, '1.1'), settlement(b, '2.2'), settlement(c, '3.3')];

    const forward = settle(account('4', slots), positions, settlements);
    const reversed = settle(
      account('4', slots),
      [...positions].reverse(),
      [...settlements].reverse(),
    );
    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;

    expect(forward.account.paperSolBalance).toBe(paperSolFromSolString('10.6'));
    expect(forward.positions).toEqual([]);
    expect(forward.tokenSlots).toEqual(slots);
    expect(forward.account).toEqual(reversed.account);
    expect(forward.hourlyResult).toEqual(reversed.hourlyResult);
    expect(forward.ledgerEntries).toEqual(reversed.ledgerEntries);
    expect(
      forward.ledgerEntries
        .filter(({ eventType }) => eventType === 'FORCED_SETTLEMENT_TOKEN_DEBIT')
        .map(({ tokenMint }) => tokenMint),
    ).toEqual([c.tokenMint, b.tokenMint, a.tokenMint]);
  });

  it('preserves exact account, token, P&L, and ledger conservation invariants', () => {
    const a = position('a', 100n, '2');
    const b = position('b', 50n, '1');
    const before = account('7', [tokenSlot(a.tokenMint, 1), tokenSlot(b.tokenMint, 2)]);
    const result = settle(before, [a, b], [settlement(a, '2.5'), settlement(b, '0.75')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paperCredits = result.ledgerEntries
      .filter(({ asset }) => asset === 'PAPER_SOL')
      .reduce<bigint>((total, entry) => total + entry.amount, 0n);
    expect(result.account.paperSolBalance - before.paperSolBalance).toBe(3_250_000_000n);
    expect(paperCredits).toBe(3_250_000_000n);
    expect(result.hourlyResult.pnl).toBe(
      result.account.paperSolBalance - competitionConfig.startingPaperSolBaseUnits,
    );
    expect(result.positions).toHaveLength(0);
  });

  it('does not mutate round, account, positions, slots, or executions', () => {
    const open = position('a');
    const slots = [tokenSlot(open.tokenMint, 1)];
    const currentRound = round();
    const currentAccount = account('8', slots);
    const positions = [open];
    const executions = [settlement(open, '3')];
    const snapshots = structuredClone({ currentRound, currentAccount, positions, executions });

    const result = settle(currentAccount, positions, executions, currentRound);
    expect(result.ok).toBe(true);
    expect({ currentRound, currentAccount, positions, executions }).toEqual(snapshots);
    if (result.ok) {
      expect(result.round).not.toBe(currentRound);
      expect(result.account).not.toBe(currentAccount);
      expect(result.tokenSlots).not.toBe(slots);
    }
  });
});

describe('settlement matching and idempotency failures', () => {
  const a = position('a');
  const b = position('b', 50n, '1');
  const slots = [tokenSlot(a.tokenMint, 1), tokenSlot(b.tokenMint, 2)];
  const currentAccount = account('7', slots);

  it('rejects a missing execution', () => {
    expect(settle(currentAccount, [a, b], [settlement(a, '2')])).toEqual({
      ok: false,
      reason: 'SETTLEMENT_EXECUTION_MISSING',
    });
  });

  it('rejects duplicate executions for one position', () => {
    expect(
      settle(currentAccount, [a, b], [settlement(a, '2', 'one'), settlement(a, '2', 'two')]),
    ).toEqual({ ok: false, reason: 'SETTLEMENT_EXECUTION_DUPLICATE' });
  });

  it('rejects an extra execution when no matching position exists', () => {
    expect(settle(currentAccount, [a], [settlement(a, '2'), settlement(b, '1')])).toEqual({
      ok: false,
      reason: 'SETTLEMENT_EXECUTION_UNEXPECTED',
    });
  });

  it.each(['token', 'market', 'protocol'] as const)(
    'rejects a wrong %s identity',
    (identityPart) => {
      const wrong: Position = {
        ...a,
        ...(identityPart === 'token'
          ? { tokenMint: id('wrong-mint', 'TokenMint') as TokenMint }
          : {}),
        ...(identityPart === 'market'
          ? { marketId: id('wrong-market', 'MarketId') as MarketId }
          : {}),
        ...(identityPart === 'protocol'
          ? { protocolId: id('wrong-protocol', 'ProtocolId') as ProtocolId }
          : {}),
      };
      expect(settle(currentAccount, [a], [settlement(wrong, '2')])).toEqual({
        ok: false,
        reason: 'SETTLEMENT_POSITION_MISMATCH',
      });
    },
  );

  it('rejects partial and greater-than-position quantities', () => {
    expect(
      settle(currentAccount, [a], [settlement(a, '1', 'partial', tokenBaseUnits(99n))]),
    ).toEqual({ ok: false, reason: 'SETTLEMENT_MUST_FULLY_CLOSE_POSITION' });
    expect(
      settle(currentAccount, [a], [settlement(a, '3', 'greater', tokenBaseUnits(101n))]),
    ).toEqual({ ok: false, reason: 'SETTLEMENT_MUST_FULLY_CLOSE_POSITION' });
  });

  it('propagates zero authoritative output as a typed failure', () => {
    expect(settle(currentAccount, [a], [settlement(a, '0')])).toEqual({
      ok: false,
      reason: 'ZERO_EXECUTION_OUTPUT',
    });
  });

  it('rejects settlement order/account identity for the wrong round', () => {
    const wrongRoundSettlement = settlement(a, '2');
    const changed = {
      ...wrongRoundSettlement,
      order: {
        ...wrongRoundSettlement.order,
        hourlyRoundId: id('round-2', 'HourlyRoundId') as HourlyRoundId,
      },
    };
    expect(settle(currentAccount, [a], [changed])).toEqual({
      ok: false,
      reason: 'SETTLEMENT_POSITION_MISMATCH',
    });
  });

  it('rejects non-settling and already-finalized rounds', () => {
    expect(settle(currentAccount, [a], [settlement(a, '2')], round('OPEN'))).toEqual({
      ok: false,
      reason: 'ROUND_NOT_IN_SETTLING_STATE',
    });
    expect(settle(currentAccount, [a], [settlement(a, '2')], round('FINALIZED'))).toEqual({
      ok: false,
      reason: 'ROUND_ALREADY_FINALIZED',
    });
  });

  it('rejects duplicate caller-supplied ledger identities', () => {
    const first = settlement(a, '2');
    const second = settlement(b, '1');
    const duplicate = {
      ...second,
      ledgerEntryIds: { ...second.ledgerEntryIds, input: first.ledgerEntryIds.input },
    };
    expect(settle(currentAccount, [a, b], [first, duplicate])).toEqual({
      ok: false,
      reason: 'SETTLEMENT_LEDGER_ID_DUPLICATE',
    });
  });

  it('rejects structurally invalid account slot state before finalization', () => {
    const invalidAccount = {
      ...currentAccount,
      tokenSlots: [tokenSlot(a.tokenMint, 1), tokenSlot(a.tokenMint, 2)],
    };
    expect(settle(invalidAccount, [a], [settlement(a, '2')])).toEqual({
      ok: false,
      reason: 'SETTLEMENT_ACCOUNT_INVALID',
    });
    expect(settle(account('8', []), [a], [settlement(a, '2')])).toEqual({
      ok: false,
      reason: 'SETTLEMENT_ACCOUNT_INVALID',
    });
  });

  it('rejects duplicate executions supplied to a zero-position account', () => {
    expect(settle(account('10', []), [], [settlement(a, '2'), settlement(a, '2', 'copy')])).toEqual(
      { ok: false, reason: 'SETTLEMENT_EXECUTION_DUPLICATE' },
    );
  });
});
