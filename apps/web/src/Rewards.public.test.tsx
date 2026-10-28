// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { RewardsPage } from './Rewards.js';
import './test/setup.js';

function renderWithEvidence(evidence: { stop: string; payoutsActive: boolean } | null) {
  const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
    const path = String(request);
    if (path.endsWith('/website/rewards')) {
      if (!evidence) return new Response(null, { status: 503 });
      return new Response(
        JSON.stringify({
          ...evidence,
          observations: [],
          payoutHistory: [],
          payoutHistoryStatus: 'NO_RECORDED_PAYOUTS',
          qualifiedLamports: '0',
          reservedLamports: '0',
          observedCreatorFeesLamports: '0',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RewardsPage user={null} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('shows a truthful financial hold without obsolete private-beta wording', async () => {
  renderWithEvidence({ stop: 'ASSERTED', payoutsActive: false });
  expect(
    await screen.findByText('Real-SOL payouts on hold · Financial authorization required'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/invite.only technical beta/i)).not.toBeInTheDocument();
});

it('never claims active payouts when financial STOP is asserted even if a flag disagrees', async () => {
  renderWithEvidence({ stop: 'ASSERTED', payoutsActive: true });
  expect(
    await screen.findByText('Real-SOL payouts on hold · Financial authorization required'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Real-SOL payout channel enabled')).not.toBeInTheDocument();
});

it('uses the live payout signal only when financial STOP is not asserted', async () => {
  renderWithEvidence({ stop: 'CLEARED', payoutsActive: true });
  expect(await screen.findByText('Real-SOL payout channel enabled')).toBeInTheDocument();
});

it('never invents an active status when payment evidence cannot be loaded', async () => {
  renderWithEvidence(null);
  expect(await screen.findByText('Real-SOL payout status unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Real-SOL payout channel enabled')).not.toBeInTheDocument();
});
