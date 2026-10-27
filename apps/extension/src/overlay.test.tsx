// @vitest-environment jsdom

import './test/setup.js';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account, PositionValuationResponse, Round, Trade } from '@paperfund/shared/browser';

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

function terminal(mint: string | null = MINT, id: 'AXIOM' | 'GMGN' | 'PADRE' = 'AXIOM') {
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
  it('preserves ticket DOM, focus, amount and scroll when account polling replaces account data', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'ACCOUNT') return Promise.resolve({ ...account });
      if (operation === 'POSITIONS') return Promise.resolve({ ...valuation });
      if (operation === 'PREFLIGHT')
        return Promise.resolve({
          maxBuyLamports: '1800000000',
          slotAvailable: true,
          valuationStatus: 'AVAILABLE',
        });
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      return defaultApi(operation);
    });
    render(<Overlay terminal={terminal()} onCollapsed={vi.fn()} onDisable={vi.fn()} />);
    const input = await screen.findByLabelText('Paper SOL amount');
    const shell = screen.getByLabelText('Paperfund paper trading overlay');
    const button = screen.getByRole('button', { name: 'BUY · PAPER ONLY' });
    fireEvent.change(input, { target: { value: '0.123' } });
    input.focus();
    shell.scrollTop = 123;
    const marketCalls = apiRequest.mock.calls.filter(([op]) => op === 'MARKET').length;
    const callback = intervals.mock.calls.find(([, delay]) => delay === 4500)?.[0];
    expect(typeof callback).toBe('function');
    await act(async () => {
      if (typeof callback === 'function') callback();
    });
    expect(screen.getByLabelText('Paper SOL amount')).toBe(input);
    expect(input).toHaveValue('0.123');
    expect(document.activeElement).toBe(input);
    expect(shell.scrollTop).toBe(123);
    expect(screen.getByRole('button', { name: 'BUY · PAPER ONLY' })).toBe(button);
    expect(apiRequest.mock.calls.filter(([op]) => op === 'MARKET')).toHaveLength(marketCalls);
    intervals.mockRestore();
  });

  it('retains successful SELL and committed cash when the subsequent account and market reads fail', async () => {
    let sold = false;
    const position = {
      id: 'p',
      mint: MINT,
      originMarketId: 'curve',
      originProtocol: 'PUMP_FUN',
      tokenDecimals: 6,
      tokenQuantityBaseUnits: '1000000',
      costBasisPaperSolLamports: '1000000000',
      realizedPnlLamports: '0',
      valuation: {
        status: 'AVAILABLE',
        executablePaperSolLamports: '1100000000',
        unrealizedPnlLamports: '100000000',
      },
    };
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'ACCOUNT')
        return sold
          ? Promise.reject(new Error('RPC failed'))
          : Promise.resolve({ ...account, positions: [position] });
      if (operation === 'POSITIONS')
        return sold
          ? Promise.reject(new Error('RPC failed'))
          : Promise.resolve({ ...valuation, positions: [position] });
      if (operation === 'PREFLIGHT')
        return Promise.resolve({
          maxBuyLamports: '1800000000',
          slotAvailable: true,
          valuationStatus: 'AVAILABLE',
        });
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET' && sold) return Promise.reject(new Error('RPC failed'));
      if (operation === 'SELL') {
        sold = true;
        return Promise.resolve({
          tokenMint: MINT,
          paperSolCreditedLamports: '1100000000',
          realizedPnlLamports: '100000000',
          newCashBalanceLamports: '9100000000',
          remainingQuantityBaseUnits: '0',
          remainingCostBasisLamports: '0',
          executedAt: new Date().toISOString(),
        });
      }
      return defaultApi(operation);
    });
    render(<Overlay terminal={terminal()} onCollapsed={vi.fn()} onDisable={vi.fn()} />);
    const sell = await screen.findByRole('button', { name: 'SELL ALL' });
    await waitFor(() => expect(sell).toBeEnabled());
    fireEvent.click(sell);
    expect(await screen.findByText(/Sold all: received 1.1 SOL/)).toBeVisible();
    expect(await screen.findByText('Account data reconnecting…')).toBeVisible();
    expect(screen.getByText('9.1 SOL')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'SELL ALL' })).not.toBeInTheDocument();
    expect(screen.queryByText('RECENT ACTIVITY')).not.toBeInTheDocument();
  });
  it('keeps exact max exit available when every preset exceeds reserves and sends the server quantity', async () => {
    const quote = {
      executable: false,
      quantityBaseUnits: '250000',
      outputLamports: null,
      reason: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
    };
    const position = {
      id: 'p',
      mint: MINT,
      originMarketId: 'curve',
      originProtocol: 'PUMP_FUN',
      tokenDecimals: 6,
      tokenQuantityBaseUnits: '1000000',
      costBasisPaperSolLamports: '1000000000',
      realizedPnlLamports: '0',
      valuation: { status: 'UNAVAILABLE', reason: 'LIQUIDITY_LIMITED', valuedAt: '' },
      sellPreflight: {
        status: 'LIQUIDITY_LIMITED',
        full: quote,
        percentages: { '25': quote, '50': quote, '75': quote, '100': quote },
        maxExecutableQuantityBaseUnits: '12345',
        maxExecutableOutputLamports: '10000',
        executablePortionPnlLamports: '-12335000',
        executablePortionCostBasisLamports: '12345000',
        currentProtocol: 'PUMP_FUN',
        evidenceFingerprint: 'test',
        observedAt: '',
        chainSlot: '1',
      },
    };
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'ACCOUNT') return Promise.resolve({ ...account, positions: [position] });
      if (operation === 'POSITIONS')
        return Promise.resolve({
          ...valuation,
          positions: [position],
          valuationStatus: 'UNAVAILABLE',
          portfolioEquityLamports: null,
        });
      if (operation === 'PREFLIGHT')
        return Promise.resolve({
          marketSupported: true,
          valuationStatus: 'UNAVAILABLE',
          maxBuyLamports: null,
          slotAvailable: true,
        });
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'SELL')
        return Promise.resolve({
          tokenMint: MINT,
          tokenAmountSoldBaseUnits: '12345',
          paperSolCreditedLamports: '10000',
          feeLamports: '0',
          realizedPnlLamports: '-12335000',
        });
      return defaultApi(operation);
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    const max = await screen.findByRole('button', { name: 'SELL MAX EXECUTABLE' });
    await waitFor(() => expect(max).toBeEnabled());
    expect(screen.getByRole('button', { name: 'SELL ALL' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: '25%' }).at(-1)).toBeDisabled();
    expect(await screen.findByText(/BUY paused: portfolio equity/)).toBeVisible();
    fireEvent.click(max);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        'SELL',
        expect.objectContaining({ mint: MINT, quantity: '12345' }),
      ),
    );
  });
  it('does not resurrect a closed position from the older account response', async () => {
    const marker = vi.fn();
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'ACCOUNT')
        return Promise.resolve({
          ...account,
          positions: [
            {
              mint: MINT,
              tokenQuantityBaseUnits: '1000000',
              costBasisPaperSolLamports: '1000000000',
              tokenDecimals: 6,
            },
          ],
        });
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS') return Promise.resolve({ items: [] });
      if (operation === 'PREFLIGHT') return Promise.resolve({ maxBuyLamports: '1000000000' });
      return defaultApi(operation);
    });
    render(
      <Overlay
        terminal={terminal()}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
        onAverageEntryChange={marker}
      />,
    );
    expect(await screen.findByText('No position in this token.')).toBeVisible();
    expect(screen.queryByText('PF AVG ENTRY')).not.toBeInTheDocument();
    expect(marker).not.toHaveBeenCalledWith(expect.objectContaining({ mint: MINT }));
  });

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
    expect(await screen.findByText('Market route temporarily unavailable.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'BUY · PAPER ONLY' })).not.toBeInTheDocument();
  });

  it('distinguishes a temporary RPC failure from an unsupported market', async () => {
    const { ApiError } = await import('./client.js');
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'CURRENT_ROUND')
        return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
      if (operation === 'ACCOUNT') return Promise.resolve(account);
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'MARKET')
        return Promise.reject(new ApiError('RPC_TIMEOUT', 'Solana RPC request timed out.', 503));
      return Promise.reject(new Error('unused'));
    });
    render(
      <Overlay terminal={terminal()} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );

    expect(await screen.findByText('Market data reconnecting…')).toBeVisible();
    expect(screen.queryByText('Market route temporarily unavailable.')).not.toBeInTheDocument();
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

  it.each(['AXIOM', 'GMGN', 'PADRE'] as const)(
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
      expect(await screen.findByText('Market route temporarily unavailable.')).toBeVisible();
      expect(screen.queryByText('Pump.fun')).not.toBeInTheDocument();
    },
  );

  it.each(['AVAILABLE', 'UNAVAILABLE'] as const)(
    'shows a valued current position %s and submits exact partial SELL and SELL ALL intents',
    async (status) => {
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
      if (status === 'UNAVAILABLE')
        Object.assign(position, {
          valuation: {
            status: 'UNAVAILABLE',
            reason: 'RPC unavailable',
            valuedAt: '',
          },
        });
      const valued = { ...valuation, positions: [position] };
      apiRequest.mockImplementation((operation: string) => {
        if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
        if (operation === 'CURRENT_ROUND')
          return Promise.resolve({ round, serverTime: '2099-01-01T18:30:00.000Z' });
        if (operation === 'ACCOUNT') return Promise.resolve({ ...account, positions: [position] });
        if (operation === 'POSITIONS') return Promise.resolve(valued);
        if (operation === 'VIEWED_POSITION') {
          const time = new Date().toISOString();
          return Promise.resolve({
            userId: 'u',
            accountId: account.accountId,
            roundId: round.id,
            mint: MINT,
            status,
            reason: status === 'AVAILABLE' ? null : 'RPC unavailable',
            revision: 'fixture',
            financialVersion: '1',
            positionUpdatedAt: time,
            snapshotAt: time,
            chainTime: time,

            chainSlot: '1',
            completedAt: time,
            position: {
              ...position,
              valuation:
                status === 'AVAILABLE'
                  ? { ...position.valuation, observedAt: time, chainSlot: '1', valuedAt: time }
                  : position.valuation,
            },
          });
        }
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
        <Overlay
          terminal={terminal()}
          collapsed={false}
          onCollapsed={vi.fn()}
          onDisable={vi.fn()}
        />,
      );
      expect(await screen.findByText('CURRENT POSITION')).toBeVisible();
      expect(screen.queryByText('Unrealized P&L')).not.toBeInTheDocument();
      const summary = screen.getByLabelText('Current round token summary');
      expect([...summary.querySelectorAll('small')].map((item) => item.textContent)).toEqual([
        'Bought',
        'Sold',
        'Holding Value',
        'P&L',
      ]);
      expect(summary.querySelectorAll('b')[2]).toHaveTextContent(
        status === 'AVAILABLE' ? '1.2 SOL' : 'Unavailable',
      );
      expect(summary).not.toHaveTextContent('101');
      expect(summary.querySelectorAll('b')[3]).toHaveTextContent(
        status === 'AVAILABLE' ? '+0.2 SOL' : 'Unavailable',
      );
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
    },
  );

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

describe('chart expected-mint delivery', () => {
  it('publishes the backend-resolved mint before Paperfund authentication without position markers', async () => {
    const publish = vi.fn();
    render(
      <Overlay
        terminal={terminal('pool')}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
        onMarkersChange={publish}
      />,
    );
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith({
        context: 'pool',
        mint: MINT,
        url: 'https://axiom.trade/',
        markers: [],
        marketBinding: { requestedContext: 'pool', mint: MINT },
      }),
    );
    expect(apiRequest.mock.calls.some(([operation]) => operation === 'TRADES')).toBe(false);
  });
  it('rejects stale resolved chart mints while navigation waits for its backend market', async () => {
    const publish = vi.fn();
    const nextMint = '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump';
    let resolveNext!: (market: unknown) => void;
    apiRequest.mockImplementation((operation: string, request?: { mint: string }) => {
      if (operation === 'MARKET' && request?.mint === nextMint)
        return new Promise((resolve) => {
          resolveNext = resolve;
        });
      return defaultApi(operation);
    });
    const view = render(
      <Overlay
        terminal={terminal()}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
        onMarkersChange={publish}
      />,
    );
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ mint: MINT })),
    );
    publish.mockClear();
    view.rerender(
      <Overlay
        terminal={terminal(nextMint)}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
        onMarkersChange={publish}
      />,
    );
    await waitFor(() => expect(resolveNext).toBeTypeOf('function'));
    expect(
      publish.mock.calls.some(([value]) => value?.context === nextMint && value?.mint === MINT),
    ).toBe(false);
    await act(async () =>
      resolveNext({
        mint: nextMint,
        supported: true,
        executionProtocol: 'PUMP_FUN',
        tokenDecimals: 6,
      }),
    );
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ context: nextMint, mint: nextMint, markers: [] }),
      ),
    );
  });
});

describe('chart mint independence from trade preflight', () => {
  it('publishes a resolved chart mint even when BUY preflight is unavailable', async () => {
    const publish = vi.fn();
    apiRequest.mockImplementation((operation: string) => {
      if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
      if (operation === 'ACCOUNT') return Promise.resolve(account);
      if (operation === 'POSITIONS') return Promise.resolve(valuation);
      if (operation === 'TRADES' || operation === 'RESULTS')
        return Promise.resolve({ items: [], nextCursor: null });
      if (operation === 'PREFLIGHT') return Promise.reject(new Error('Market reconnecting'));
      return defaultApi(operation);
    });
    render(
      <Overlay
        terminal={terminal()}
        onCollapsed={vi.fn()}
        onDisable={vi.fn()}
        onMarkersChange={publish}
      />,
    );
    await waitFor(() =>
      expect(apiRequest.mock.calls.some(([operation]) => operation === 'PREFLIGHT')).toBe(true),
    );
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ context: MINT, mint: MINT })),
    );
  });
});

it('persists Paperfund Trades visibility independently of round entry', async () => {
  apiRequest.mockImplementation((operation: string) => {
    if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
    if (operation === 'ACCOUNT' || operation === 'POSITIONS') return Promise.resolve(null);
    if (operation === 'RESULTS' || operation === 'TRADES')
      return Promise.resolve({ items: [], nextCursor: null });
    return defaultApi(operation);
  });
  const store = vi.spyOn(chrome.storage.local, 'set');
  const publish = vi.fn();
  render(
    <Overlay
      terminal={terminal()}
      onCollapsed={vi.fn()}
      onDisable={vi.fn()}
      onMarkersChange={publish}
    />,
  );
  const toggle = await screen.findByRole('checkbox', { name: 'Paperfund Trades' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(store).toHaveBeenCalledWith({ paperfundTradesVisible: false });
  await waitFor(() =>
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u',
        history: expect.objectContaining({ visible: false }),
      }),
    ),
  );
  store.mockRestore();
});

it('refreshes delayed PumpSwap FX evidence promptly and clears the specific history reason', async () => {
  await chrome.storage.local.set({ paperfundTradesVisible: true });
  const timers = vi.spyOn(globalThis, 'setTimeout');
  let saved = false;
  apiRequest.mockImplementation((operation: string) => {
    if (operation === 'ME') return Promise.resolve({ user: { id: 'u', walletAddress: MINT } });
    if (operation === 'ACCOUNT') return Promise.resolve(account);
    if (operation === 'POSITIONS') return Promise.resolve(valuation);
    if (operation === 'PREFLIGHT')
      return Promise.resolve({
        maxBuyLamports: '1000000000',
        slotAvailable: true,
        valuationStatus: 'AVAILABLE',
      });
    if (operation === 'RESULTS') return Promise.resolve({ items: [], nextCursor: null });
    if (operation === 'MARKET')
      return Promise.resolve({
        mint: MINT,
        supported: true,
        executionProtocol: 'PUMP_SWAP',
        tokenDecimals: 6,
        tokenSupplyBaseUnits: '1000000000000000',
      });
    if (operation === 'TRADES')
      return Promise.resolve({
        items: [
          {
            id: 'buy',
            side: 'BUY',
            mint_address: MINT,
            owner_user_id: 'u',
            competition_account_id: 'account-1',
            hourly_round_id: round.id,
            executed_at: '2026-10-09T15:28:44Z',
            base_quantity: '1000000',
            actual_input_lamports: '1000000000',
            token_decimals: 6,
    token_supply_base_units: '1000000000000000',
            sol_usd_fx: saved
              ? {
                  status: 'AVAILABLE',
                  version: 'CAPTURED_EXECUTION_FX_V1',
                  source: 'COINBASE_SOL_USD_LAST_TRADE',
                  rate: '109.33',
                  fxAt: '2026-10-09T15:28:44Z',
                  requestedAt: '2026-10-09T15:28:44Z',
                  retrievedAt: '2026-10-09T15:28:44Z',
                }
              : { status: 'UNAVAILABLE', reason: 'HISTORICAL_FX_NOT_CAPTURED' },
          },
        ],
        nextCursor: null,
      });
    return defaultApi(operation);
  });
  try {
    render(<Overlay terminal={terminal()} onCollapsed={vi.fn()} onDisable={vi.fn()} />);
    await screen.findByText(/BUY · 15:28:44 UTC · HISTORICAL_FX_NOT_CAPTURED/);
    const timer = timers.mock.calls.find(([, delay]) => delay === 1000)?.[0];
    expect(typeof timer).toBe('function');
    saved = true;
    await act(async () => {
      if (typeof timer === 'function') timer();
    });
    await waitFor(() =>
      expect(screen.queryByText(/BUY · 15:28:44 UTC · HISTORICAL_FX_NOT_CAPTURED/)).toBeNull(),
    );
  } finally {
    timers.mockRestore();
  }
});

it.each(['GOOGLx','PUMP'])('unsupported %s market publishes valid historical drawings while BUY stays disabled', async () => {
  const markers = vi.fn();
  apiRequest.mockImplementation((op: string) => {
    if(op==='ME') return Promise.resolve({user:{id:'u',walletAddress:MINT}});
    if(op==='CHART_METADATA') return Promise.resolve({requestedContext:MINT,mint:MINT,tokenProgram:'Token2022',tokenDecimals:6,tokenSupplyBaseUnits:'975024561658805',chainSlot:'123'});
    if(op==='MARKET') return Promise.resolve({mint:MINT,supported:false,reason:'POSITION_EXECUTION_ROUTE_UNAVAILABLE'});
    if(op==='TRADES') return Promise.resolve({items: ['BUY','SELL'].map((side,i) => ({ id:'historic-'+i,side,mint_address:MINT,owner_user_id:'u',competition_account_id:'archived',hourly_round_id:'archived-round',token_decimals:6,token_supply_base_units:'1000000000000000',base_quantity:'3924958318471',executed_at:['2026-10-09T20:03:36.717Z','2026-10-09T20:04:47.845Z'][i],actual_input_lamports:side==='BUY'?'988623928':null,actual_output_lamports:side==='SELL'?'939232797':null,sol_usd_fx:{status:'AVAILABLE',version:'CAPTURED_EXECUTION_FX_V1',source:'COINBASE_SOL_USD_LAST_TRADE',rate:i?'108.56':'108.65',fxAt:i?'2026-10-09T20:04:47Z':'2026-10-09T20:03:36Z',requestedAt:i?'2026-10-09T20:04:47Z':'2026-10-09T20:03:36Z',retrievedAt:i?'2026-10-09T20:04:47Z':'2026-10-09T20:03:36Z'}})),nextCursor:null});
    if(op==='ACCOUNT') return Promise.resolve({...account,positions:[]});
    if(op==='POSITIONS') return Promise.resolve({...valuation,positions:[]});
    if(op==='RESULTS') return Promise.resolve({items:[],nextCursor:null});
    if(op==='PREFLIGHT') return Promise.reject(Error('unsupported'));
    return defaultApi(op);
  });
  render(<Overlay terminal={terminal()} onCollapsed={vi.fn()} onDisable={vi.fn()} onMarkersChange={markers}/>);
  await waitFor(() => expect(markers.mock.calls.some(([data]) => data?.history?.drawings.length===4)).toBe(true));
  const data=markers.mock.calls.findLast(([data]) => data?.history?.drawings.length===4)![0];
  expect(data.history.diagnostics.metadataReason).toBe('MARKET_UNSUPPORTED_HISTORY_AVAILABLE');
  expect(data.markers.some((m: { kind:string })=>m.kind==='AVERAGE')).toBe(false);
  expect(screen.queryByRole('button',{name:'BUY · PAPER ONLY'})).toBeNull();
  expect(screen.getByText('Market route temporarily unavailable.')).toBeInTheDocument();
});


describe('GMGN panel reference values', () => {
  const position = { id: 'reference-position', mint: MINT, originMarketId: 'curve', originProtocol: 'PUMP_FUN',
    tokenDecimals: 6, tokenQuantityBaseUnits: '1000000', costBasisPaperSolLamports: '1000000000', realizedPnlLamports: '0',
    valuation: { status: 'AVAILABLE' as const, executablePaperSolLamports: '900000000', unrealizedPnlLamports: '-100000000' } };
  function fill(side: 'BUY' | 'SELL', index = 0, owner = 'u', accountId = 'account-1'): Trade {
    const at = '2099-01-01T18:10:' + String(index).padStart(2, '0') + 'Z';
    return { id: 'reference-' + index, order_id: 'order-' + index, owner_user_id: owner,
      competition_account_id: accountId, hourly_round_id: round.id, side, mint_address: MINT,
      execution_context: 'NORMAL_USER', protocol_id: 'PUMP_FUN', base_quantity: '1000000',
      quote_lamports: '1000000000', fee_lamports: '0', realized_pnl_lamports: '0',
      actual_input_lamports: side === 'BUY' ? '1000000000' : null,
      actual_output_lamports: side === 'SELL' ? '900000000' : null,
      executed_at: at, token_decimals: 6, token_supply_base_units: '1000000000',
      sol_usd_fx: { status: 'AVAILABLE', version: 'CAPTURED_EXECUTION_FX_V1', source: 'COINBASE_SOL_USD_LAST_TRADE',
        rate: '100', fxAt: at, requestedAt: at, retrievedAt: at } };
  }
  function setup(open = false) {
    const state = { owner: 'u', accountId: account.accountId, open, fills: [fill('BUY'), ...(open ? [] : [fill('SELL', 1)])],
      pendingHistory: false, resolvers: [] as ((value: unknown) => void)[] };
    apiRequest.mockImplementation((op: string, args?: { context?: string }) => {
      if (op === 'ME') return Promise.resolve({ user: { id: state.owner, walletAddress: MINT } });
      if (op === 'ACCOUNT') return Promise.resolve({ ...account, accountId: state.accountId, positions: state.open ? [position] : [] });
      if (op === 'POSITIONS') return Promise.resolve({ ...valuation, accountId: state.accountId, positions: state.open ? [position] : [] });
      if (op === 'CHART_METADATA') return Promise.resolve({ requestedContext: args?.context, mint: args?.context,
        tokenProgram: 'Token2022', tokenDecimals: 6, tokenSupplyBaseUnits: '1000000000', chainSlot: '123' });
      if (op === 'MARKET') return Promise.resolve({ mint: MINT, supported: true, executionProtocol: 'PUMP_FUN',
        tokenDecimals: 6, tokenSupplyBaseUnits: '1000000000' });
      if (op === 'TRADES') return state.pendingHistory ? new Promise(resolve => state.resolvers.push(resolve)) :
        Promise.resolve({ items: state.fills, nextCursor: null });
      if (op === 'RESULTS') return Promise.resolve({ items: [], nextCursor: null });
      if (op === 'PREFLIGHT') return Promise.resolve({ maxBuyLamports: '1000000000', slotAvailable: true, valuationStatus: 'AVAILABLE' });
      return defaultApi(op);
    });
    return state;
  }
  const props = { onCollapsed: vi.fn(), onDisable: vi.fn() };
  const gmgn = (mint = MINT) => ({ ...terminal(mint, 'GMGN'), url: 'https://gmgn.ai/sol/token/' + mint });
  it('adds authoritative USD current AVG without duplicating balances or quantity', async () => {
    setup(true); render(<Overlay terminal={gmgn()} {...props} />);
    const panel = await screen.findByLabelText('GMGN Paperfund references');
    await waitFor(() => expect(within(panel).getByText('PF AVG')).toBeInTheDocument());
    expect(within(panel).getAllByText('100000 USD market cap')).toHaveLength(2);
    expect(within(panel).getByText('Reference values — not chart-aligned')).toBeVisible();
    expect(within(panel).queryByText('Quantity')).toBeNull(); expect(within(panel).queryByText('P&L')).toBeNull();
  });
  it('retains completed-cycle averages and at most six recent fills after position closure', async () => {
    const state = setup(); state.fills = Array.from({ length: 8 }, (_, i) => fill(i % 2 ? 'SELL' : 'BUY', i));
    render(<Overlay terminal={gmgn()} {...props} />);
    const panel = await screen.findByLabelText('GMGN Paperfund references');
    await waitFor(() => expect(within(panel).getAllByText(/USD market cap/)).toHaveLength(6));
    expect(within(panel).queryByText('PF AVG')).toBeNull();
    expect(within(panel).getAllByText(/PF SELL AVG/)).toHaveLength(3);
    expect(within(panel).getAllByText('90000 USD market cap')).toHaveLength(3);
    expect(panel.querySelectorAll('details span[title]')).toHaveLength(6);
    expect(panel.querySelector('details [title="reference-0"]')).toBeNull();
    expect(panel.querySelector('details [title="reference-7"]')).not.toBeNull();
  });
  it('preserves missing FX reasons without manufacturing USD levels', async () => {
    const state = setup(true); state.fills[0]!.sol_usd_fx = { status: 'UNAVAILABLE', reason: 'HISTORICAL_FX_NOT_CAPTURED' };
    render(<Overlay terminal={gmgn()} {...props} />);
    const panel = await screen.findByLabelText('GMGN Paperfund references');
    await waitFor(() => expect(within(panel).getAllByText(/HISTORICAL_FX_NOT_CAPTURED/).length).toBeGreaterThan(0));
    expect(within(panel).queryByText(/USD market cap/)).toBeNull();
    expect(panel.querySelector('details [title="reference-0"]')).not.toBeNull();
  });
  it('removes the previous account references while replacement history is pending', async () => {
    const state = setup(true); render(<Overlay terminal={gmgn()} {...props} />);
    await screen.findByLabelText('GMGN Paperfund references');
    await waitFor(() => expect(screen.getAllByText('100000 USD market cap')).toHaveLength(2));
    state.owner = 'other-user'; state.accountId = 'other-account'; state.pendingHistory = true;
    const callbacks = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.map(([callback]) => callback);
    await act(async () => { for (const callback of callbacks) callback({ paperfundSessionToken: { newValue: 'synthetic-new-session' } }, 'session'); });
    await waitFor(() => expect(state.resolvers.length).toBeGreaterThan(0));
    expect(screen.queryByLabelText('GMGN Paperfund references')).toBeNull();
    await act(async () => { for (const resolve of state.resolvers) resolve({ items: state.fills, nextCursor: null }); });
    await waitFor(() => expect(screen.getByLabelText('GMGN Paperfund references')).toBeInTheDocument());
    expect(screen.queryByText('100000 USD market cap')).toBeNull();
    expect(screen.getByLabelText('GMGN Paperfund references').querySelector('details')).toBeNull();
  });
  it('clears old token references synchronously during navigation and rejects late old-token history', async () => {
    const state = setup(); const view = render(<Overlay terminal={gmgn()} {...props} />);
    await screen.findByLabelText('GMGN Paperfund references');
    await waitFor(() => expect(screen.getByText('90000 USD market cap')).toBeInTheDocument());
    state.pendingHistory = true;
    view.rerender(<Overlay terminal={gmgn('So11111111111111111111111111111111111111112')} {...props} />);
    expect(screen.queryByLabelText('GMGN Paperfund references')).toBeNull();
    await waitFor(() => expect(state.resolvers.length).toBeGreaterThan(0));
    await act(async () => { for (const resolve of state.resolvers) resolve({ items: state.fills, nextCursor: null }); });
    await waitFor(() => expect(screen.getByLabelText('GMGN Paperfund references')).toBeInTheDocument());
    expect(screen.queryByText('90000 USD market cap')).toBeNull();
  });
  it.each(['AXIOM', 'PADRE'] as const)('leaves %s UI without GMGN reference rows', async id => {
    setup(); render(<Overlay terminal={terminal(MINT, id)} {...props} />);
    await screen.findByRole('button', { name: 'SIGN OUT' });
    expect(screen.queryByLabelText('GMGN Paperfund references')).toBeNull();
    expect(screen.queryByText('Reference values — not chart-aligned')).toBeNull();
  });
});
