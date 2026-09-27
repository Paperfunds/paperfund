// @vitest-environment jsdom

import './test/setup.js';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Overlay } from './overlay.js';
import type { TerminalId, TerminalTokenState } from './terminal.js';

const apiRequest = vi.fn();
vi.mock('./client.js', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status?: number,
    ) {
      super(message);
    }
  },
  apiRequest: (...arguments_: unknown[]) => apiRequest(...arguments_),
  walletRequest: vi.fn(),
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

const MINT_A = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const MINT_B = '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump';
const MINT_C = 'BewoWqr56gfPQXzWiMUSCVY4fJbthPZrdj17L3qCXEmg';
const round = {
  id: 'shared-round',
  startsAt: '2099-01-01T18:00:00.000Z',
  endsAtExclusive: '2099-01-01T19:00:00.000Z',
  state: 'OPEN',
  startingPaperSolLamports: '10000000000',
  maxUniqueTokens: 5,
  maxBuyRatioBps: 2000,
  rewardFinalizationGracePeriodSeconds: 60,
};

function terminal(id: TerminalId): TerminalTokenState {
  return { terminal: id, mint: MINT_A, status: 'SUPPORTED_ROUTE', url: `https://${id}/token` };
}

describe('multi-terminal account continuity', () => {
  it('buys on Axiom, partially sells on GMGN, and sells all on Terminal with one account', async () => {
    let cash = 10_000_000_000n;
    let quantity = 0n;
    const tradeHistory: Array<{ id: string; side: 'BUY' | 'SELL'; base: bigint }> = [];
    const operations: Array<{ operation: string; mint?: string; quantity?: string }> = [];

    const account = () => ({
      accountId: 'one-shared-account',
      roundId: round.id,
      paperSolLamports: cash.toString(),
      startingPaperSolLamports: '10000000000',
      realizedPnlLamports: '0',
      slotsUsed: tradeHistory.length ? 1 : 0,
      slotLimit: 5,
      roundState: 'OPEN',
      positions: [],
    });
    const position = () => ({
      id: 'one-shared-position',
      mint: MINT_A,
      originMarketId: 'server-market',
      originProtocol: 'PUMP_FUN',
      tokenDecimals: 6,
      tokenQuantityBaseUnits: quantity.toString(),
      costBasisPaperSolLamports: '2000000000',
      realizedPnlLamports: '0',
      valuation: {
        status: 'AVAILABLE',
        executablePaperSolLamports: (
          ((quantity * 21n) / 10n / 1_000_000n) *
          1_000_000_000n
        ).toString(),
        unrealizedPnlLamports: '100000000',
        currentProtocol: 'PUMP_FUN',
        evidenceFingerprint: 'authoritative-fixture',
        observedAt: '2099-01-01T18:30:00.000Z',
        chainSlot: '1',
        valuedAt: '2099-01-01T18:30:00.000Z',
      },
    });

    apiRequest.mockImplementation(async (operation: string, payload?: Record<string, string>) => {
      operations.push({
        operation,
        ...(payload?.['mint'] ? { mint: payload['mint'] } : {}),
        ...(payload?.['quantity'] ? { quantity: payload['quantity'] } : {}),
      });
      if (operation === 'ME') return { user: { id: 'shared-user', walletAddress: MINT_A } };
      if (operation === 'CURRENT_ROUND') return { round, serverTime: '2099-01-01T18:30:00.000Z' };
      if (operation === 'ACCOUNT') return account();
      if (operation === 'POSITIONS')
        return {
          accountId: account().accountId,
          roundId: round.id,
          cashLamports: cash.toString(),
          startingPaperSolLamports: '10000000000',
          valuationStatus: 'AVAILABLE',
          executablePositionsLamports: quantity ? '2100000000' : '0',
          portfolioEquityLamports: (cash + (quantity ? 2_100_000_000n : 0n)).toString(),
          livePnlLamports: quantity ? '100000000' : '0',
          valuedAt: '2099-01-01T18:30:00.000Z',
          positions: quantity ? [position()] : [],
        };
      if (operation === 'TRADES')
        return {
          items: tradeHistory.map((trade) => ({
            id: trade.id,
            order_id: trade.id,
            hourly_round_id: round.id,
            side: trade.side,
            execution_context: 'NORMAL_USER',
            mint_address: MINT_A,
            protocol_id: 'PUMP_FUN',
            base_quantity: trade.base.toString(),
            quote_lamports: '1000000000',
            fee_lamports: '0',
            actual_input_lamports: trade.side === 'BUY' ? '2000000000' : null,
            actual_output_lamports: trade.side === 'SELL' ? '1050000000' : null,
            realized_pnl_lamports: '0',
            executed_at: '2099-01-01T18:31:00.000Z',
          })),
          nextCursor: null,
        };
      if (operation === 'RESULTS') return { items: [], nextCursor: null };
      if (operation === 'MARKET')
        return {
          mint: payload?.['mint'],
          supported: true,
          executionProtocol: 'PUMP_FUN',
          tokenDecimals: 6,
        };
      if (operation === 'PREFLIGHT')
        return {
          maxBuyLamports: '2000000000',
          valuationStatus: 'AVAILABLE',
          slotAvailable: true,
          requiresNewSlot: quantity === 0n && tradeHistory.length === 0,
          protocol: 'PUMP_FUN',
        };
      if (operation === 'BUY') {
        cash -= 2_000_000_000n;
        quantity = 2_000_000n;
        tradeHistory.unshift({ id: 'buy-axiom', side: 'BUY', base: quantity });
        return {
          tokenMint: MINT_A,
          executionProtocol: 'PUMP_FUN',
          actualPaperSolSpentLamports: '2000000000',
          tokenQuantityReceivedBaseUnits: quantity.toString(),
          feeLamports: '0',
          executedAt: '2099-01-01T18:31:00.000Z',
        };
      }
      if (operation === 'SELL') {
        const sold =
          payload?.['quantity'] === 'ALL' ? quantity : BigInt(payload?.['quantity'] ?? '0');
        quantity -= sold;
        cash += sold === 1_000_000n ? 1_050_000_000n : 1_100_000_000n;
        tradeHistory.unshift({ id: `sell-${tradeHistory.length}`, side: 'SELL', base: sold });
        return {
          tokenMint: MINT_A,
          executionProtocol: 'PUMP_FUN',
          tokenAmountSoldBaseUnits: sold.toString(),
          paperSolCreditedLamports: sold === 1_000_000n ? '1050000000' : '1100000000',
          feeLamports: '0',
          realizedPnlLamports: '50000000',
          executedAt: '2099-01-01T18:32:00.000Z',
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });

    const view = render(
      <Overlay
        terminal={terminal('AXIOM')}
        collapsed={false}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
      />,
    );
    const input = await screen.findByLabelText('Paper SOL amount');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'BUY · PAPER ONLY' }));
    await waitFor(() => expect(quantity).toBe(2_000_000n));

    view.rerender(
      <Overlay
        terminal={terminal('GMGN')}
        collapsed={false}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
      />,
    );
    expect(await screen.findByText(/GMGN/)).toBeVisible();
    expect(await screen.findByText('CURRENT POSITION')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: '50%' }).at(-1)!);
    await waitFor(() => expect(quantity).toBe(1_000_000n));

    view.rerender(
      <Overlay
        terminal={terminal('TERMINAL')}
        collapsed={false}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
      />,
    );
    expect(await screen.findByText(/TERMINAL/)).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'SELL ALL' }));
    await waitFor(() => expect(quantity).toBe(0n));

    expect(cash).toBe(10_100_000_000n);
    expect(tradeHistory).toHaveLength(3);
    expect(account()).toMatchObject({ accountId: 'one-shared-account', slotsUsed: 1 });
    expect(operations.filter((entry) => ['BUY', 'SELL'].includes(entry.operation))).toEqual([
      expect.objectContaining({ operation: 'BUY', mint: MINT_A }),
      expect.objectContaining({ operation: 'SELL', mint: MINT_A, quantity: '1000000' }),
      expect.objectContaining({ operation: 'SELL', mint: MINT_A, quantity: 'ALL' }),
    ]);
  });

  it('keeps three simultaneous tab mints isolated while sharing account reads', async () => {
    const submitted: string[] = [];
    apiRequest.mockImplementation(async (operation: string, payload?: Record<string, string>) => {
      if (operation === 'ME') return { user: { id: 'shared-user', walletAddress: MINT_A } };
      if (operation === 'CURRENT_ROUND') return { round, serverTime: '2099-01-01T18:30:00.000Z' };
      if (operation === 'ACCOUNT')
        return {
          accountId: 'shared-account',
          roundId: round.id,
          paperSolLamports: '10000000000',
          startingPaperSolLamports: '10000000000',
          realizedPnlLamports: '0',
          slotsUsed: 0,
          slotLimit: 5,
          roundState: 'OPEN',
          positions: [],
        };
      if (operation === 'POSITIONS')
        return {
          accountId: 'shared-account',
          roundId: round.id,
          cashLamports: '10000000000',
          startingPaperSolLamports: '10000000000',
          valuationStatus: 'AVAILABLE',
          executablePositionsLamports: '0',
          portfolioEquityLamports: '10000000000',
          livePnlLamports: '0',
          valuedAt: '2099-01-01T18:30:00.000Z',
          positions: [],
        };
      if (operation === 'TRADES' || operation === 'RESULTS') return { items: [], nextCursor: null };
      if (operation === 'MARKET')
        return {
          mint: payload?.['mint'],
          supported: true,
          executionProtocol: 'PUMP_FUN',
          tokenDecimals: 6,
        };
      if (operation === 'PREFLIGHT')
        return {
          maxBuyLamports: '2000000000',
          valuationStatus: 'AVAILABLE',
          slotAvailable: true,
          requiresNewSlot: true,
          protocol: 'PUMP_FUN',
        };
      if (operation === 'BUY') {
        submitted.push(payload?.['mint'] ?? '');
        return {
          tokenMint: payload?.['mint'],
          executionProtocol: 'PUMP_FUN',
          actualPaperSolSpentLamports: '100000000',
          tokenQuantityReceivedBaseUnits: '100000',
          feeLamports: '0',
          executedAt: '2099-01-01T18:31:00.000Z',
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });

    const contexts: Array<[TerminalId, string]> = [
      ['AXIOM', MINT_A],
      ['GMGN', MINT_B],
      ['TERMINAL', MINT_C],
    ];
    const views = contexts.map(([id, mint]) =>
      render(
        <Overlay
          terminal={{ ...terminal(id), mint }}
          collapsed={false}
          onCollapsed={vi.fn()}
          onDisable={vi.fn()}
        />,
      ),
    );
    for (const [index, view] of views.entries()) {
      const scoped = within(view.container);
      await scoped.findByText('Authoritative max');
      const input = view.container.querySelector('input');
      if (!input) throw new Error('Expected an amount input.');
      fireEvent.change(input, { target: { value: '0.1' } });
      fireEvent.click(await scoped.findByRole('button', { name: 'BUY · PAPER ONLY' }));
      await waitFor(() => expect(submitted).toHaveLength(index + 1));
    }
    expect(submitted).toEqual([MINT_A, MINT_B, MINT_C]);

    views[0]!.rerender(
      <Overlay
        terminal={{ ...terminal('AXIOM'), mint: MINT_C }}
        collapsed={false}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
      />,
    );
    expect(within(views[1]!.container).getByText(/GMGN/)).toBeVisible();
    expect(within(views[2]!.container).getByText(/TERMINAL/)).toBeVisible();
  });
});
