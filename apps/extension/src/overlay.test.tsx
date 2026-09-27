// @vitest-environment jsdom

import './test/setup.js';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account, PositionValuationResponse, Round } from '@paperfund/shared/browser';

import { Overlay } from './overlay.js';

const apiRequest = vi.fn();
const walletRequest = vi.fn();
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
  walletRequest: (...arguments_: unknown[]) => walletRequest(...arguments_),
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

const MINT = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const round: Round = {
  id: 'round-1',
  startsAt: '2099-01-01T18:00:00.000Z',
  endsAtExclusive: '2099-01-01T19:00:00.000Z',
  state: 'OPEN',
  startingPaperSolLamports: '10000000000',
  maxUniqueTokens: 5,
  maxBuyRatioBps: 2000,
  rewardFinalizationGracePeriodSeconds: 60,
};
const account: Account = {
  accountId: 'account-1',
  roundId: round.id,
  paperSolLamports: '8000000000',
  startingPaperSolLamports: '10000000000',
  realizedPnlLamports: '0',
  slotsUsed: 1,
  slotLimit: 5,
  roundState: 'OPEN',
  positions: [],
};
const valuation: PositionValuationResponse = {
  accountId: account.accountId,
  roundId: round.id,
  cashLamports: account.paperSolLamports,
  startingPaperSolLamports: account.startingPaperSolLamports,
  valuationStatus: 'AVAILABLE',
  executablePositionsLamports: '1000000000',
  portfolioEquityLamports: '9000000000',
  livePnlLamports: '-1000000000',
  valuedAt: new Date().toISOString(),
  positions: [],
};

function terminal(mint: string | null = MINT, id: 'AXIOM' | 'GMGN' | 'TERMINAL' = 'AXIOM') {
  return {
    terminal: id,
    mint,
    status: mint ? ('SUPPORTED_ROUTE' as const) : ('NO_MARKET' as const),
    url: 'https://axiom.trade/',
  };
}
function defaultApi(operation: string) {
  if (operation === 'ME') return Promise.reject(new Error('unauthenticated'));
  if (operation === 'CURRENT_ROUND')
    return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
  if (operation === 'MARKET')
    return Promise.resolve({
      mint: MINT,
      supported: true,
      executionProtocol: 'PUMP_FUN',
      tokenDecimals: 6,
    });
  throw new Error(`Unexpected ${operation}`);
}

beforeEach(() => {
  apiRequest.mockImplementation(defaultApi);
  walletRequest.mockReset();
});

describe('Paperfund overlay', () => {
  it('shows explicit unauthenticated wallet state', async () => {
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByRole('button', { name: 'CONNECT WALLET' })).toBeVisible();
  });

  it('returns to explicit sign-in state when the authenticated session expires', async () => {
    const { ApiError } = await import('./client.js');
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT')
        return Promise.reject(new ApiError('UNAUTHENTICATED', 'Authentication is required.', 401));
      if (operation === 'POSITIONS' || operation === 'TRADES' || operation === 'RESULTS')
        return new Promise(() => undefined);
      if (operation === 'MARKET') return Promise.resolve({ mint: MINT, supported: false });
      throw new Error(`Unexpected ${operation}`);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByText('Authentication is required.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'CONNECT WALLET' })).toBeVisible();
  });

  it('shows round entry and completed-round feedback for an authenticated user', async () => {
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT' || operation === 'POSITIONS') return Promise.resolve(null);
      if (operation === 'TRADES') return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'RESULTS')
        return Promise.resolve({
          items: [
            {
              id: 'r',
              hourly_round_id: 'old',
              starts_at: '',
              ends_at_exclusive: '',
              starting_paper_sol_lamports: '10000000000',
              final_settled_balance_lamports: '11420000000',
              hourly_pnl_lamports: '1420000000',
              finalized_at: '',
            },
          ],
          nextCursor: null,
        });
      if (operation === 'MARKET') return Promise.resolve({ mint: MINT, supported: false });
      throw new Error(`Unexpected ${operation}`);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByRole('button', { name: 'ENTER ROUND' })).toBeVisible();
    expect(await screen.findByText('+1.42 SOL')).toBeVisible();
  });

  it('loads authoritative MAX and submits a BUY bound to the loaded mint', async () => {
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT') return Promise.resolve(account);
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET')
        return Promise.resolve({
          mint: MINT,
          supported: true,
          executionProtocol: 'PUMP_FUN',
          tokenDecimals: 6,
        });
      if (operation === 'PREFLIGHT')
        return Promise.resolve({
          maxBuyLamports: '1800000000',
          portfolioEquityLamports: '9000000000',
          cashLamports: '8000000000',
          valuationStatus: 'AVAILABLE',
          slotAvailable: true,
          requiresNewSlot: true,
          protocol: 'PUMP_FUN',
        });
      if (operation === 'BUY')
        return Promise.resolve({
          tokenMint: MINT,
          executionProtocol: 'PUMP_FUN',
          actualPaperSolSpentLamports: '1800000000',
          tokenQuantityReceivedBaseUnits: '1230000',
          feeLamports: '0',
          executedAt: '',
        });
      throw new Error(`Unexpected ${operation}`);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    const max = await screen.findByRole('button', { name: 'MAX' });
    await waitFor(() => expect(max).toBeEnabled());
    fireEvent.click(max);
    expect(screen.getByDisplayValue('1.8')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'BUY · PAPER ONLY' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        'BUY',
        expect.objectContaining({ mint: MINT, paperSol: '1.8' }),
      ),
    );
  });

  it('disables trading for an unsupported token', async () => {
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT') return Promise.resolve(account);
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET') return Promise.resolve({ mint: MINT, supported: false });
      return Promise.reject(new Error('unused'));
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByText('Not supported by Paperfund yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'BUY · PAPER ONLY' })).not.toBeInTheDocument();
  });

  it('recovers market state after a transient API outage', async () => {
    let offline = true;
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.reject(new Error('unauthenticated'));
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'MARKET') {
        if (offline) return Promise.reject(new Error('Paperfund API is unavailable.'));
        return Promise.resolve({
          mint: MINT,
          supported: true,
          executionProtocol: 'PUMP_FUN',
          tokenDecimals: 6,
        });
      }
      throw new Error(`Unexpected ${operation}`);
    });
    const { rerender } = render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByText('Paperfund API is unavailable.')).toBeVisible();
    offline = false;
    rerender(
      <Overlay
        terminal={terminal(null)}
        collapsed={false}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
      />,
    );
    rerender(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    await waitFor(() =>
      expect(apiRequest.mock.calls.filter(([operation]) => operation === 'MARKET')).toHaveLength(2),
    );
    expect(screen.queryByText('Paperfund API is unavailable.')).not.toBeInTheDocument();
  });

  it.each(['AXIOM', 'GMGN', 'TERMINAL'] as const)(
    'immediately invalidates old-token controls on a mint change for %s',
    async (terminalId) => {
      let resolveOld: ((value: unknown) => void) | undefined;
      apiRequest.mockImplementation((operation: string, payload?: { mint?: string }) => {
        if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
        if (operation === 'CURRENT_ROUND')
          return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
        if (operation === 'ACCOUNT') return Promise.resolve(account);
        if (operation === 'POSITIONS') return Promise.resolve(valuation);
        if (operation === 'TRADES' || operation === 'RESULTS')
          return Promise.resolve({ items: [], nextCursor: null });
        if (operation === 'MARKET' && payload?.mint === MINT)
          return new Promise((resolve) => {
            resolveOld = resolve;
          });
        if (operation === 'MARKET')
          return Promise.resolve({ mint: payload?.mint, supported: false });
        throw new Error(`Unexpected ${operation}`);
      });
      const view = render(
        <Overlay
          terminal={terminal(MINT, terminalId)}
          collapsed={false}
          onCollapsed={vi.fn()}
          onDisable={vi.fn()}
        />,
      );
      const other = '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump';
      view.rerender(
        <Overlay
          terminal={terminal(other, terminalId)}
          collapsed={false}
          onCollapsed={vi.fn()}
          onDisable={vi.fn()}
        />,
      );
      resolveOld?.({ mint: MINT, supported: true, executionProtocol: 'PUMP_FUN' });
      expect(await screen.findByText('Not supported by Paperfund yet')).toBeVisible();
      expect(screen.queryByText('Pump.fun')).not.toBeInTheDocument();
    },
  );

  it('shows a valued current position and submits exact partial SELL and SELL ALL intents', async () => {
    const position = {
      id: 'p',
      mint: MINT,
      originMarketId: 'market',
      originProtocol: 'PUMP_FUN',
      tokenDecimals: 0,
      tokenQuantityBaseUnits: '101',
      costBasisPaperSolLamports: '1000000000',
      realizedPnlLamports: '0',
      valuation: {
        status: 'AVAILABLE',
        executablePaperSolLamports: '1200000000',
        unrealizedPnlLamports: '200000000',
        currentProtocol: 'PUMP_SWAP',
        evidenceFingerprint: 'f',
        observedAt: '',
        chainSlot: null,
        valuedAt: '',
      },
    };
    const valued = { ...valuation, positions: [position] };
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT') return Promise.resolve({ ...account, positions: [position] });
      if (operation === 'POSITIONS') return Promise.resolve(valued);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET')
        return Promise.resolve({
          mint: MINT,
          supported: true,
          executionProtocol: 'PUMP_SWAP',
          tokenDecimals: 0,
        });
      if (operation === 'PREFLIGHT')
        return Promise.resolve({
          maxBuyLamports: '1000000000',
          valuationStatus: 'AVAILABLE',
          slotAvailable: true,
          requiresNewSlot: false,
          protocol: 'PUMP_SWAP',
        });
      if (operation === 'SELL')
        return Promise.resolve({
          tokenMint: MINT,
          executionProtocol: 'PUMP_SWAP',
          tokenAmountSoldBaseUnits: '25',
          paperSolCreditedLamports: '300000000',
          feeLamports: '0',
          realizedPnlLamports: '50000000',
          executedAt: '',
        });
      throw new Error(`Unexpected ${operation}`);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByText('CURRENT POSITION')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: '25%' }).at(-1)!);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        'SELL',
        expect.objectContaining({ quantity: '25', mint: MINT }),
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'SELL ALL' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'SELL ALL' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        'SELL',
        expect.objectContaining({ quantity: 'ALL', mint: MINT }),
      ),
    );
  });

  it('surfaces a typed BUY rejection without exposing internals', async () => {
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT') return Promise.resolve(account);
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET')
        return Promise.resolve({
          mint: MINT,
          supported: true,
          executionProtocol: 'PUMP_FUN',
          tokenDecimals: 6,
        });
      if (operation === 'PREFLIGHT')
        return Promise.resolve({
          maxBuyLamports: '1000000000',
          valuationStatus: 'AVAILABLE',
          slotAvailable: true,
          requiresNewSlot: true,
          protocol: 'PUMP_FUN',
        });
      if (operation === 'BUY')
        return Promise.reject(new Error('Buy exceeds the 20% per-order limit.'));
      throw new Error(`Unexpected ${operation}`);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    const max = await screen.findByRole('button', { name: 'MAX' });
    await waitFor(() => expect(max).toBeEnabled());
    fireEvent.click(max);
    fireEvent.click(screen.getByRole('button', { name: 'BUY · PAPER ONLY' }));
    expect(await screen.findByText('Buy exceeds the 20% per-order limit.')).toBeVisible();
  });

  it('does not carry an old account into a newly detected round', async () => {
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({
          round: { ...round, id: 'round-2' },
          serverTime: '2099-01-01T18:30:00.000Z',
        });
      if (operation === 'ACCOUNT') return Promise.resolve(account);
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET') return Promise.resolve({ mint: MINT, supported: true });
      throw new Error(`Unexpected ${operation}`);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByRole('button', { name: 'ENTER ROUND' })).toBeVisible();
    expect(screen.queryByText('8 SOL')).not.toBeInTheDocument();
  });
});
