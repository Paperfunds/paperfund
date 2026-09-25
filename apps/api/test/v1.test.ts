import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AuthService } from '../src/auth.js';
import type { CompetitionService } from '../src/competition.js';

const config = {
  LOG_LEVEL: 'silent' as const,
  COOKIE_SECURE: false,
  COOKIE_SAME_SITE: 'lax' as const,
  AUTH_SESSION_TTL_SECONDS: 3600,
  ALLOWED_ORIGINS: 'http://localhost:3000',
  API_RATE_LIMIT_WINDOW_SECONDS: 60,
  API_RATE_LIMIT_AUTH_MAX: 20,
  API_RATE_LIMIT_TRADE_MAX: 30,
};

function services() {
  const now = new Date('2026-09-25T12:30:00.000Z');
  let quantity = 0n;
  const auth = {
    async authenticate(token: string | undefined) {
      return token === 'valid' ? { id: 'user:one', walletAddress: 'wallet' } : null;
    },
    async logout() {},
  } as unknown as AuthService;
  const position = () =>
    quantity > 0n
      ? [
          {
            id: 'position:one',
            market_id: 'market:one',
            mint_address: '11111111111111111111111111111111',
            decimals: 6,
            venue: 'PUMP_FUN',
            remaining_base_units: quantity.toString(),
            cost_basis_lamports: '2000000000',
            realized_pnl_lamports: '0',
          },
        ]
      : [];
  const competition = {
    async getCurrentRound() {
      return {
        id: 'round:one',
        startsAt: new Date('2026-09-25T12:00:00Z'),
        endsAtExclusive: new Date('2026-09-25T13:00:00Z'),
        state: 'OPEN',
        startingPaperSolLamports: 10_000_000_000n,
        maxUniqueTokens: 5,
        maxBuyRatioBps: 2000,
        rewardFinalizationGracePeriodSeconds: 60,
      };
    },
    async enterRound() {
      return { id: 'account:one', paperSolBalanceLamports: 10_000_000_000n };
    },
    async getCurrentAccount() {
      return {
        id: 'account:one',
        hourly_round_id: 'round:one',
        starting_paper_sol_lamports: '10000000000',
        paper_sol_balance_lamports: '8000000000',
        realized_pnl_lamports: '0',
        state: 'OPEN',
        max_unique_tokens: 5,
        slots_used: quantity > 0n ? 1 : 0,
        positions: position(),
      };
    },
    async buy() {
      quantity = 100n;
      return {
        orderId: 'order:buy',
        fillId: 'fill:buy',
        executionId: 'execution:buy',
        competitionAccountId: 'account:one',
        protocolId: 'PUMP_FUN',
        requestedPaperSolLamports: 2_000_000_000n,
        actualPaperSolInputLamports: 2_000_000_000n,
        actualTokenOutputBaseUnits: 100n,
        feeLamports: 10_000n,
        marketStateFingerprint: 'fingerprint',
        paperSolBalanceLamports: 8_000_000_000n,
        position: { remainingBaseUnits: 100n, costBasisLamports: 2_000_000_000n },
        executedAt: now,
      };
    },
    async sell(_userId: string, input: { quantity: string }) {
      const sold = input.quantity === 'ALL' ? quantity : BigInt(input.quantity);
      quantity -= sold;
      return {
        orderId: 'order:sell',
        fillId: 'fill:sell',
        executionId: 'execution:sell',
        competitionAccountId: 'account:one',
        protocolId: 'PUMP_FUN',
        actualTokenInputBaseUnits: sold,
        actualNetPaperSolOutputLamports: 1_000_000_000n,
        feeLamports: 10_000n,
        costBasisLamportsRemoved: 1_000_000_000n,
        fillRealizedPnlLamports: 0n,
        paperSolBalanceLamports: 9_000_000_000n,
        marketStateFingerprint: 'fingerprint',
        position: {
          remainingBaseUnits: quantity,
          costBasisLamports: quantity === 0n ? 0n : 1_000_000_000n,
        },
        executedAt: now,
      };
    },
    async getPositions() {
      return { accountId: 'account:one', roundId: 'round:one', positions: position() };
    },
    async trades() {
      return { items: [], nextCursor: null };
    },
    async hourlyResults() {
      return { items: [], nextCursor: null };
    },
    async dailyLeaderboard() {
      return { entries: [] };
    },
    async hourlyLeaderboard() {
      return { entries: [] };
    },
    async currentDailyCompetition() {
      return { id: 'daily:one' };
    },
    async marketSupport() {
      return { supported: true };
    },
  } as unknown as CompetitionService;
  return { auth, competition };
}

describe('V1 competition API', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('rejects unauthenticated financial access with the common error envelope', async () => {
    const app = buildApp({
      config,
      database: { healthCheck: async () => true },
      redis: { healthCheck: async () => true },
      ...services(),
      logger: false,
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/positions' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(response.json().error.requestId).toBeTypeOf('string');
  });

  it('supports an exact-unit enter, BUY, portfolio, and sell-all client flow', async () => {
    const app = buildApp({
      config,
      database: { healthCheck: async () => true },
      redis: { healthCheck: async () => true },
      ...services(),
      logger: false,
    });
    apps.push(app);
    const headers = { authorization: 'Bearer valid' };
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/rounds/current/enter', headers })).json()
        .paperSolBalanceLamports,
    ).toBe('10000000000');
    const buy = await app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { ...headers, 'idempotency-key': 'buy-1' },
      payload: { mint: '11111111111111111111111111111111', paperSol: '2' },
    });
    expect(buy.statusCode).toBe(200);
    expect(buy.json()).toMatchObject({
      actualPaperSolSpentLamports: '2000000000',
      tokenQuantityReceivedBaseUnits: '100',
    });
    const positions = await app.inject({ method: 'GET', url: '/api/v1/positions', headers });
    expect(positions.json().positions[0].tokenQuantityBaseUnits).toBe('100');
    const sell = await app.inject({
      method: 'POST',
      url: '/api/v1/trades/sell',
      headers: { ...headers, 'idempotency-key': 'sell-1' },
      payload: { mint: '11111111111111111111111111111111', quantity: 'ALL' },
    });
    expect(sell.statusCode).toBe(200);
    expect(sell.json()).toMatchObject({
      tokenAmountSoldBaseUnits: '100',
      remainingQuantityBaseUnits: '0',
    });
  });
});
