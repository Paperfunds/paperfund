// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { Account, Round } from './types.js';
import './test/setup.js';

const now = new Date();
const round: Round = {
  id: 'round-1',
  startsAt: new Date(now.getTime() - 1_000).toISOString(),
  endsAtExclusive: new Date(now.getTime() + 3_600_000).toISOString(),
  state: 'OPEN',
  startingPaperSolLamports: '10000000000',
  maxUniqueTokens: 5,
  maxBuyRatioBps: 2000,
  rewardFinalizationGracePeriodSeconds: 60,
};
const account: Account = {
  accountId: 'account-1',
  roundId: 'round-1',
  paperSolLamports: '8000000000',
  startingPaperSolLamports: '10000000000',
  realizedPnlLamports: '0',
  slotsUsed: 1,
  slotLimit: 5,
  roundState: 'OPEN',
  positions: [
    {
      id: 'position-1',
      mint: '11111111111111111111111111111111',
      originMarketId: 'market-1',
      originProtocol: 'PUMP_FUN',
      tokenDecimals: 6,
      tokenQuantityBaseUnits: '1000000',
      costBasisPaperSolLamports: '2000000000',
      realizedPnlLamports: '0',
      valuation: { status: 'UNAVAILABLE' },
    },
  ],
};

function response(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function mockApi(
  options: { authenticated?: boolean; entered?: boolean; marketError?: string } = {},
) {
  let entered = options.entered ?? false;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/me'))
      return options.authenticated
        ? response({ user: { id: 'user-1', walletAddress: '11111111111111111111111111111111' } })
        : response(
            { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } },
            401,
          );
    if (url.endsWith('/rounds/current'))
      return response({ round, serverTime: new Date().toISOString() });
    if (url.endsWith('/rounds/current/account'))
      return entered
        ? response(account)
        : response({ error: { code: 'ROUND_ACCOUNT_NOT_FOUND', message: 'Not entered.' } }, 404);
    if (url.endsWith('/rounds/current/enter')) {
      entered = true;
      return response(account);
    }
    if (url.includes('/results/hourly')) return response({ items: [], nextCursor: null });
    if (url.includes('/trades') && (!init?.method || init.method === 'GET'))
      return response({ items: [], nextCursor: null });
    if (url.includes('/markets/'))
      return options.marketError
        ? response({ error: { code: options.marketError, message: 'Rejected.' } }, 422)
        : response({
            mint: account.positions[0]!.mint,
            supported: true,
            executionProtocol: 'PUMP_FUN',
            status: 'ACTIVE_BONDING_CURVE',
            tokenDecimals: 6,
          });
    if (url.endsWith('/trades/sell'))
      return response({
        tokenMint: account.positions[0]!.mint,
        executionProtocol: 'PUMP_FUN',
        tokenAmountSoldBaseUnits:
          JSON.parse(String(init?.body)).quantity === 'ALL'
            ? '1000000'
            : JSON.parse(String(init?.body)).quantity,
        paperSolCreditedLamports: '900000000',
        feeLamports: '1000000',
        realizedPnlLamports: '100000000',
        executedAt: now.toISOString(),
      });
    if (url.endsWith('/trades/buy'))
      return response({
        tokenMint: account.positions[0]!.mint,
        executionProtocol: 'PUMP_FUN',
        actualPaperSolSpentLamports: '1000000000',
        tokenQuantityReceivedBaseUnits: '500000',
        feeLamports: '1000000',
        executedAt: now.toISOString(),
      });
    if (url.endsWith('/leaderboards/hourly'))
      return response({
        round: { ...round, state: 'FINALIZED' },
        entries: [
          {
            user_id: 'user-1',
            wallet_address: account.positions[0]!.mint,
            score: '2000000000',
            final_settled_balance_lamports: '12000000000',
            rank: 1,
            tied: false,
            tieGroupSize: 1,
          },
        ],
      });
    if (url.endsWith('/leaderboards/daily'))
      return response({
        dailyCompetition: {
          id: 'daily-1',
          starts_at: now.toISOString(),
          ends_at_exclusive: now.toISOString(),
          state: 'OPEN',
        },
        entries: [
          {
            user_id: 'user-1',
            wallet_address: account.positions[0]!.mint,
            score: '2000000000',
            completed_hourly_round_count: 2,
            rank: 1,
            tied: true,
            tieGroupSize: 2,
          },
        ],
      });
    return response({}, 200);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp(path = '/trade') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Paperfund web app', () => {
  it('shows the unauthenticated product state', async () => {
    mockApi();
    renderApp();
    expect(await screen.findByText('Trade the market.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeEnabled();
  });

  it('distinguishes a connected wallet from an authenticated session', async () => {
    mockApi();
    window.solana = {
      connect: vi
        .fn()
        .mockResolvedValue({ publicKey: { toString: () => '11111111111111111111111111111111' } }),
      signMessage: vi.fn(),
    };
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Wallet' }));
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeEnabled();
  });

  it('enters the current round and shows the authoritative account', async () => {
    mockApi({ authenticated: true });
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: /Enter Round/i }));
    expect((await screen.findAllByText('8 SOL')).length).toBeGreaterThan(0);
    expect(screen.getByText('Open positions')).toBeInTheDocument();
  });

  it('inspects a market, submits BUY, and maps a typed BUY error', async () => {
    const fetchMock = mockApi({ authenticated: true, entered: true });
    renderApp();
    const mint = account.positions[0]!.mint;
    await userEvent.type(await screen.findByLabelText('Token mint'), mint);
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(await screen.findByText('Supported market')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Paper SOL amount'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Buy with Paper SOL' }));
    expect(await screen.findByText('BUY FILLED')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/trades/buy'),
      expect.objectContaining({ method: 'POST' }),
    );

    fetchMock.mockImplementationOnce(() =>
      response({ error: { code: 'MAX_BUY_RATIO_EXCEEDED', message: 'Rejected.' } }, 409),
    );
    await userEvent.type(screen.getByLabelText('Paper SOL amount'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Buy with Paper SOL' }));
    expect(await screen.findByText('Buy exceeds the 20% per-order limit.')).toBeInTheDocument();
  });

  it('renders positions and supports exact partial SELL and SELL ALL', async () => {
    const fetchMock = mockApi({ authenticated: true, entered: true });
    renderApp();
    expect(await screen.findByText('Valuation unavailable')).toBeInTheDocument();
    const sellInput = screen.getByLabelText('Token base units to sell');
    const position = sellInput.closest('article')!;
    await userEvent.click(within(position).getByRole('button', { name: '25%' }));
    expect(sellInput).toHaveValue('250000');
    await userEvent.click(within(position).getByRole('button', { name: 'Sell' }));
    expect(await screen.findByText('SELL FILLED')).toBeInTheDocument();
    await userEvent.click(within(position).getByRole('button', { name: 'Sell All' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => String(init?.body).includes('"quantity":"ALL"')),
      ).toBe(true),
    );
  });

  it('renders backend ranks and tie metadata on hourly and daily boards', async () => {
    mockApi({ authenticated: true });
    const { unmount } = renderApp('/hourly');
    expect(await screen.findByText('+2 SOL')).toBeInTheDocument();
    unmount();
    renderApp('/daily');
    expect(await screen.findByText('T2')).toBeInTheDocument();
    expect(screen.getByText('YOU')).toBeInTheDocument();
  });

  it('detects a new round without carrying the old account into it', async () => {
    mockApi({ authenticated: true, entered: true });
    const changedRound = { ...round, id: 'round-2' };
    const originalFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    originalFetch.mockImplementation((input: RequestInfo | URL) =>
      String(input).endsWith('/rounds/current')
        ? response({ round: changedRound, serverTime: new Date().toISOString() })
        : String(input).endsWith('/auth/me')
          ? response({ user: { id: 'user-1', walletAddress: account.positions[0]!.mint } })
          : String(input).endsWith('/rounds/current/account')
            ? response(account)
            : String(input).includes('/trades')
              ? response({ items: [], nextCursor: null })
              : response({ items: [], nextCursor: null }),
    );
    renderApp();
    expect(await screen.findByText('New round available')).toBeInTheDocument();
  });
});
