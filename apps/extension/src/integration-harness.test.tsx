// @vitest-environment jsdom

import './test/setup.js';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Overlay } from './overlay.js';

const MINT_A = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const MINT_B = '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump';
const user = { id: 'fixture-user', walletAddress: MINT_A };
const round = {
  id: 'fixture-round',
  startsAt: '2099-01-01T18:00:00.000Z',
  endsAtExclusive: '2099-01-01T19:00:00.000Z',
  state: 'OPEN',
  startingPaperSolLamports: '10000000000',
  maxUniqueTokens: 5,
  maxBuyRatioBps: 2000,
  rewardFinalizationGracePeriodSeconds: 60,
};

let authenticated = false;
let entered = false;
let quantity = 0n;
let trades: Array<Record<string, string>> = [];

function account() {
  return {
    accountId: 'fixture-account',
    roundId: round.id,
    paperSolLamports: quantity ? '8000000000' : '10000000000',
    startingPaperSolLamports: '10000000000',
    realizedPnlLamports: '0',
    slotsUsed: quantity ? 1 : 0,
    slotLimit: 5,
    roundState: 'OPEN',
    positions: [],
  };
}
function position() {
  return {
    id: 'fixture-position',
    mint: MINT_A,
    originMarketId: 'fixture-market',
    originProtocol: 'PUMP_FUN',
    tokenDecimals: 6,
    tokenQuantityBaseUnits: quantity.toString(),
    costBasisPaperSolLamports: '2000000000',
    realizedPnlLamports: '0',
    valuation: {
      status: 'AVAILABLE',
      executablePaperSolLamports: '2100000000',
      unrealizedPnlLamports: '100000000',
      currentProtocol: 'PUMP_FUN',
      evidenceFingerprint: 'fixture',
      observedAt: '2099-01-01T18:30:00.000Z',
      chainSlot: '1',
      valuedAt: '2099-01-01T18:30:00.000Z',
    },
  };
}
function ok(data?: unknown) {
  return Promise.resolve({ ok: true, data });
}
function fail(code: string) {
  return Promise.resolve({ ok: false, error: { code, message: code } });
}

beforeAll(async () => {
  window.postMessage = ((message: unknown) => {
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', { data: message, origin: location.origin, source: window }),
      ),
    );
  }) as typeof window.postMessage;
  Object.defineProperty(window, 'solana', {
    configurable: true,
    value: {
      publicKey: { toString: () => MINT_A },
      connect: async () => ({ publicKey: { toString: () => MINT_A } }),
      signMessage: async () => ({ signature: new Uint8Array(64).fill(7) }),
    },
  });
  await import('./page-bridge.js');
});

describe('fixture Axiom integration harness', () => {
  it('runs connect, entry, MAX, BUY, SPA invalidation, return, SELL ALL, and activity', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) => {
      const message = request as { operation: string; payload?: Record<string, string> };
      switch (message.operation) {
        case 'ME':
          return authenticated ? ok({ user }) : fail('UNAUTHENTICATED');
        case 'CHALLENGE':
          return ok({
            challengeId: 'fixture-challenge',
            message: [
              'Paperfund Authentication',
              'Purpose: Sign in to Paperfund (message only; no transaction)',
              `Wallet: ${MINT_A}`,
              'Nonce: abcdefghijklmnopqrstuvwxyz012345',
              'Issued At: 2099-01-01T18:30:00.000Z',
              'Expires At: 2099-01-01T18:35:00.000Z',
            ].join('\n'),
          });
        case 'VERIFY':
          authenticated = true;
          return ok({ user, expiresAt: '2099-01-01T20:00:00.000Z' });
        case 'CURRENT_ROUND':
          return ok({ round, serverTime: '2099-01-01T18:30:00.000Z' });
        case 'ACCOUNT':
          return entered ? ok(account()) : fail('ROUND_ACCOUNT_NOT_FOUND');
        case 'ENTER_ROUND':
          entered = true;
          return ok({ id: 'account:one', paperSolBalanceLamports: '10000000000' });
        case 'MARKET':
          return ok({
            mint: message.payload?.['mint'],
            supported: message.payload?.['mint'] === MINT_A,
            executionProtocol: message.payload?.['mint'] === MINT_A ? 'PUMP_FUN' : undefined,
            tokenDecimals: 6,
          });
        case 'PREFLIGHT':
          return ok({
            accountId: 'fixture-account',
            roundId: round.id,
            cashLamports: account().paperSolLamports,
            executablePositionsLamports: quantity ? '2100000000' : '0',
            portfolioEquityLamports: quantity ? '10100000000' : '10000000000',
            maxBuyByRatioLamports: quantity ? '2020000000' : '2000000000',
            maxBuyLamports: quantity ? '2020000000' : '2000000000',
            maxBuyRatioBps: '2000',
            slotsUsed: quantity ? 1 : 0,
            slotLimit: 5,
            targetAlreadyConsumesSlot: Boolean(quantity),
            requiresNewSlot: !quantity,
            slotAvailable: true,
            marketSupported: true,
            protocol: 'PUMP_FUN',
            marketStatus: 'ACTIVE_BONDING_CURVE',
            valuationStatus: 'AVAILABLE',
            unavailablePositionIds: [],
            serverTime: '2099-01-01T18:30:00.000Z',
          });
        case 'POSITIONS':
          return entered
            ? ok({
                accountId: 'fixture-account',
                roundId: round.id,
                cashLamports: account().paperSolLamports,
                startingPaperSolLamports: '10000000000',
                valuationStatus: 'AVAILABLE',
                executablePositionsLamports: quantity ? '2100000000' : '0',
                portfolioEquityLamports: quantity ? '10100000000' : account().paperSolLamports,
                livePnlLamports: quantity ? '100000000' : '0',
                valuedAt: '2099-01-01T18:30:00.000Z',
                positions: quantity ? [position()] : [],
              })
            : fail('ROUND_ACCOUNT_NOT_FOUND');
        case 'BUY':
          quantity = 1_230_000n;
          trades = [
            {
              id: 'buy',
              order_id: 'o',
              hourly_round_id: round.id,
              side: 'BUY',
              execution_context: 'NORMAL_USER',
              mint_address: MINT_A,
              protocol_id: 'PUMP_FUN',
              base_quantity: quantity.toString(),
              quote_lamports: '2000000000',
              fee_lamports: '0',
              actual_input_lamports: '2000000000',
              actual_output_lamports: null as unknown as string,
              realized_pnl_lamports: '0',
              executed_at: '2099-01-01T18:31:00.000Z',
            },
          ];
          return ok({
            tokenMint: MINT_A,
            executionProtocol: 'PUMP_FUN',
            actualPaperSolSpentLamports: '2000000000',
            tokenQuantityReceivedBaseUnits: quantity.toString(),
            feeLamports: '0',
            executedAt: '2099-01-01T18:31:00.000Z',
          });
        case 'SELL':
          quantity = 0n;
          trades.unshift({
            id: 'sell',
            order_id: 's',
            hourly_round_id: round.id,
            side: 'SELL',
            execution_context: 'NORMAL_USER',
            mint_address: MINT_A,
            protocol_id: 'PUMP_FUN',
            base_quantity: '1230000',
            quote_lamports: '2100000000',
            fee_lamports: '0',
            actual_input_lamports: null as unknown as string,
            actual_output_lamports: '2100000000',
            realized_pnl_lamports: '100000000',
            executed_at: '2099-01-01T18:32:00.000Z',
          });
          return ok({
            tokenMint: MINT_A,
            executionProtocol: 'PUMP_FUN',
            tokenAmountSoldBaseUnits: '1230000',
            paperSolCreditedLamports: '2100000000',
            feeLamports: '0',
            realizedPnlLamports: '100000000',
            executedAt: '2099-01-01T18:32:00.000Z',
          });
        case 'TRADES':
          return ok({ items: trades, nextCursor: null });
        case 'RESULTS':
          return ok({ items: [], nextCursor: null });
        default:
          return fail('UNEXPECTED');
      }
    });

    const a = {
      terminal: 'AXIOM' as const,
      mint: MINT_A,
      status: 'SUPPORTED_ROUTE' as const,
      url: `https://axiom.trade/meme/${MINT_A}?chain=sol`,
    };
    const view = render(
      <Overlay terminal={a} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'CONNECT WALLET' }));
    fireEvent.click(await screen.findByRole('button', { name: 'SIGN IN TO PAPERFUND' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ENTER ROUND' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'MAX' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
    fireEvent.click(screen.getByRole('button', { name: 'BUY · PAPER ONLY' }));
    expect(await screen.findByText('CURRENT POSITION')).toBeVisible();
    const b = {
      terminal: 'AXIOM' as const,
      mint: MINT_B,
      status: 'SUPPORTED_ROUTE' as const,
      url: `https://axiom.trade/meme/${MINT_B}?chain=sol`,
    };
    view.rerender(
      <Overlay terminal={b} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    expect(await screen.findByText('Not supported by Paperfund yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'BUY · PAPER ONLY' })).not.toBeInTheDocument();
    view.rerender(
      <Overlay terminal={a} collapsed={false} onCollapsed={vi.fn()} onDisable={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'SELL ALL' }));
    await waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'SELL',
          payload: expect.objectContaining({ quantity: 'ALL', mint: MINT_A }),
        }),
      ),
    );
    expect(await screen.findByText('SELL')).toBeVisible();
  });
});
