import type {
  Account,
  BuyPreflight,
  HourlyResult,
  LeaderboardEntry,
  LiveHourlyLeaderboard,
  MarketSupport,
  Page,
  PositionValuationResponse,
  RewardAllocation,
  Round,
  Trade,
  User,
} from './types.js';

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = configuredBase
  ? configuredBase.replace(/\/$/, '')
  : 'http://127.0.0.1:3000';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      'API_UNAVAILABLE',
      'Paperfund is temporarily unreachable. Check the API and try again.',
    );
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; requestId?: string };
  } | null;
  if (!response.ok) {
    const error = new ApiError(
      payload?.error?.code ?? 'HTTP_ERROR',
      payload?.error?.message ?? 'The request failed.',
      payload?.error?.requestId,
      response.status,
    );
    if (error.code === 'UNAUTHENTICATED') {
      window.dispatchEvent(new Event('paperfund:unauthenticated'));
    }
    throw error;
  }
  return payload as T;
}

function query(cursor?: string): string {
  return cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
}

export const api = {
  challenge: (walletAddress: string) =>
    request<{ challengeId: string; message: string }>('/api/v1/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ walletAddress }),
    }),
  verify: (input: {
    walletAddress: string;
    challengeId: string;
    message: string;
    signature: string;
  }) =>
    request<{ user: User; expiresAt: string }>('/api/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  me: () => request<{ user: User }>('/api/v1/auth/me'),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
  currentRound: () =>
    request<{ round: Round | null; serverTime: string }>('/api/v1/rounds/current'),
  enterRound: () => request<Account>('/api/v1/rounds/current/enter', { method: 'POST' }),
  account: () => request<Account>('/api/v1/rounds/current/account'),
  market: (mint: string) => request<MarketSupport>(`/api/v1/markets/${encodeURIComponent(mint)}`),
  buyPreflight: (mint: string) =>
    request<BuyPreflight>(`/api/v1/trades/buy-preflight?mint=${encodeURIComponent(mint)}`),
  positions: () => request<PositionValuationResponse>('/api/v1/positions'),
  buy: (mint: string, paperSol: string, key: string) =>
    request<BuyResult>('/api/v1/trades/buy', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ mint, paperSol }),
    }),
  sell: (mint: string, quantity: string, key: string) =>
    request<SellResult>('/api/v1/trades/sell', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ mint, quantity }),
    }),
  trades: (cursor?: string) => request<Page<Trade>>(`/api/v1/trades${query(cursor)}`),
  results: (cursor?: string) =>
    request<Page<HourlyResult>>(`/api/v1/results/hourly${query(cursor)}`),
  hourlyRewardPool: (roundId: string) =>
    request<unknown>(`/api/v1/rewards/hourly/${encodeURIComponent(roundId)}`),
  hourlyRewards: () => request<unknown>('/api/v1/rewards/hourly/current'),
  dailyRewards: () => request<unknown>('/api/v1/rewards/daily/current'),
  rewardAllocations: () => request<RewardAllocation[]>('/api/v1/rewards/me'),
  hourly: () =>
    request<{
      round: { id: string; starts_at: string; ends_at_exclusive: string; state: string };
      entries: LeaderboardEntry[];
    } | null>('/api/v1/leaderboards/hourly'),
  liveHourly: (roundId?: string) =>
    request<LiveHourlyLeaderboard | null>(
      `/api/v1/leaderboards/hourly/live${roundId ? `?roundId=${encodeURIComponent(roundId)}` : ''}`,
    ),
  daily: () =>
    request<{
      dailyCompetition: { id: string; starts_at: string; ends_at_exclusive: string; state: string };
      entries: LeaderboardEntry[];
    } | null>('/api/v1/leaderboards/daily'),
};

export interface BuyResult {
  tokenMint: string;
  executionProtocol: string;
  actualPaperSolSpentLamports: string;
  tokenQuantityReceivedBaseUnits: string;
  feeLamports: string;
  executedAt: string;
}
export interface SellResult {
  tokenMint: string;
  executionProtocol: string;
  tokenAmountSoldBaseUnits: string;
  paperSolCreditedLamports: string;
  feeLamports: string;
  realizedPnlLamports: string;
  executedAt: string;
}

const friendlyErrors: Record<string, string> = {
  INSUFFICIENT_EXECUTABLE_LIQUIDITY:
    'Insufficient executable liquidity for this quantity. Check the current max executable exit.',
  ZERO_EXECUTABLE_OUTPUT: 'This quantity currently produces no positive SOL after fees.',
  POSITION_VALUATION_FAILED:
    'BUY paused: an open position cannot be fully valued. Partial SELL may still be available.',
  MAX_BUY_RATIO_EXCEEDED: 'Buy exceeds the 20% per-order limit.',
  INSUFFICIENT_PAPER_SOL: 'Not enough Paper SOL.',
  TOKEN_SLOT_LIMIT_REACHED: 'You have used all token slots for this round.',
  ROUND_NOT_OPEN: 'This round is no longer open.',
  OUTSIDE_ROUND_WINDOW: 'The trading window has closed.',
  UNSUPPORTED_MARKET: 'This token is not supported yet.',
  MARKET_ACCOUNT_NOT_FOUND: 'This token is not supported yet.',
  MARKET_STATE_UNAVAILABLE: 'Authoritative market data is temporarily unavailable.',
  RPC_TIMEOUT: 'The market data provider timed out. Try again shortly.',
  RPC_ERROR: 'The market data provider is temporarily unavailable.',
  ROUND_ACCOUNT_NOT_FOUND: 'Enter the current round before trading.',
  UNAUTHENTICATED: 'Your session expired. Sign in again.',
  API_UNAVAILABLE: 'Paperfund is temporarily unreachable. Check the API and try again.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return friendlyErrors[error.code] ?? error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
