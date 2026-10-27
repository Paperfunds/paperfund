import { ValuationTransport } from './valuation-transport.js';
import { isExtensionApiRequest, type ApiOperation, type ExtensionApiResponse } from './messages.js';
import { ReadTransport } from './read-transport.js';

const TOKEN_KEY = 'paperfundSessionToken';
const API_BASE = __PAPERFUND_API_BASE_URL__;
const reads = new ReadTransport();
const valuations = new ValuationTransport();

interface Route {
  method: 'GET' | 'POST';
  path(payload: Record<string, string>): string;
  body?(payload: Record<string, string>): Record<string, string>;
  idempotent?: boolean;
  authenticated?: boolean;
}

const routes: Record<ApiOperation, Route> = {
  ME: { method: 'GET', path: () => '/api/v1/auth/me', authenticated: true },
  CHALLENGE: {
    method: 'POST',
    path: () => '/api/v1/auth/challenge',
    body: (p) => ({ walletAddress: required(p, 'walletAddress') }),
  },
  VERIFY: {
    method: 'POST',
    path: () => '/api/v1/auth/verify',
    body: (p) => ({
      walletAddress: required(p, 'walletAddress'),
      challengeId: required(p, 'challengeId'),
      message: required(p, 'message'),
      signature: required(p, 'signature'),
      transport: 'extension',
    }),
  },
  LOGOUT: { method: 'POST', path: () => '/api/v1/auth/logout', authenticated: true },
  CURRENT_ROUND: { method: 'GET', path: () => '/api/v1/rounds/current' },
  ENTER_ROUND: { method: 'POST', path: () => '/api/v1/rounds/current/enter', authenticated: true },
  ACCOUNT: { method: 'GET', path: () => '/api/v1/rounds/current/account', authenticated: true },
  CHART_METADATA: {
    method: 'GET',
    authenticated: true,
    path: (p) => '/api/v1/chart-metadata/' + encodeURIComponent(required(p, 'context')),
  },
  MARKET: {
    method: 'GET',
    authenticated: true,
    path: (p) => `/api/v1/markets/${encodeURIComponent(required(p, 'mint'))}`,
  },
  PREFLIGHT: {
    method: 'GET',
    path: (p) => `/api/v1/trades/buy-preflight?mint=${encodeURIComponent(required(p, 'mint'))}`,
    authenticated: true,
  },
  VIEWED_POSITION: {
    method: 'GET',
    path: (p) => `/api/v1/positions/viewed?mint=${encodeURIComponent(required(p, 'mint'))}`,
    authenticated: true,
  },
  POSITIONS: { method: 'GET', path: () => '/api/v1/positions', authenticated: true },
  BUY: {
    method: 'POST',
    path: () => '/api/v1/trades/buy',
    body: (p) => ({ mint: required(p, 'mint'), paperSol: required(p, 'paperSol') }),
    idempotent: true,
    authenticated: true,
  },
  SELL: {
    method: 'POST',
    path: () => '/api/v1/trades/sell',
    body: (p) => ({ mint: required(p, 'mint'), quantity: required(p, 'quantity') }),
    idempotent: true,
    authenticated: true,
  },
  TRADES: {
    method: 'GET',
    path: (p) =>
      `/api/v1/trades?limit=100${p['mint'] ? `&mint=${encodeURIComponent(p['mint'])}` : ''}${p['cursor'] ? `&cursor=${encodeURIComponent(p['cursor'])}` : ''}`,
    authenticated: true,
  },
  RESULTS: { method: 'GET', path: () => '/api/v1/results/hourly?limit=1', authenticated: true },
};

function required(payload: Record<string, string>, key: string): string {
  const value = payload[key];
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

async function sessionToken(): Promise<string | undefined> {
  const stored = await chrome.storage.session.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' ? token : undefined;
}

async function handle(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionApiResponse> {
  if (!isExtensionApiRequest(message))
    return {
      ok: false,
      error: { code: 'INVALID_EXTENSION_MESSAGE', message: 'Request was rejected.' },
    };
  try {
    const route = routes[message.operation];
    const payload = message.payload ?? {};
    const token = route.authenticated ? await sessionToken() : undefined;
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (route.body) headers['content-type'] = 'application/json';
    if (route.idempotent) headers['idempotency-key'] = required(payload, 'idempotencyKey');
    const url = `${API_BASE}${route.path(payload)}`;
    const fetchRequest = () =>
      fetch(url, {
        method: route.method,
        headers,
        signal: AbortSignal.timeout(15_000),
        ...(route.body ? { body: JSON.stringify(route.body(payload)) } : {}),
      });
    if (route.method === 'POST') {
      reads.invalidate();
      valuations.invalidate();
    }
    const response = ['VIEWED_POSITION', 'MARKET', 'PREFLIGHT', 'POSITIONS'].includes(
      message.operation,
    )
      ? await valuations.read(
          `${token ?? ''}:${url}`,
          `${sender.tab?.id}:${message.requestId ?? crypto.randomUUID()}`,
          (signal) => fetch(url, { method: 'GET', headers, signal }),
          message.operation === 'MARKET'
            ? 10000
            : message.operation === 'VIEWED_POSITION'
              ? 3500
              : 15000,
        )
      : route.method === 'GET'
        ? await reads.read(`${token ?? ''}:${url}`, fetchRequest, 0)
        : await fetchRequest();
    if (route.method === 'POST') reads.invalidate();
    const data = response.status === 204 ? undefined : await response.json().catch(() => null);
    if (!response.ok) {
      const error = data as { error?: { code?: string; message?: string } } | null;
      if (response.status === 401) await chrome.storage.session.remove(TOKEN_KEY);
      return {
        ok: false,
        error: {
          code: error?.error?.code ?? 'HTTP_ERROR',
          message: error?.error?.message ?? 'The request failed.',
          status: response.status,
          ...(response.headers.get('retry-after')
            ? {
                retryAfterMs: Math.max(
                  0,
                  Number(response.headers.get('retry-after')) * 1000 ||
                    Date.parse(response.headers.get('retry-after')!) - Date.now(),
                ),
              }
            : {}),
        },
      };
    }
    if (message.operation === 'VERIFY') {
      const verified = data as { sessionToken?: unknown };
      if (typeof verified.sessionToken !== 'string')
        throw new Error('The API did not return an extension session.');
      await chrome.storage.session.set({ [TOKEN_KEY]: verified.sessionToken });
      delete verified.sessionToken;
    }
    if (message.operation === 'LOGOUT') await chrome.storage.session.remove(TOKEN_KEY);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'EXTENSION_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed.',
      },
    };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const cancel = message as { kind?: string; requestId?: string };
  if (
    cancel?.kind === 'PAPERFUND_CANCEL_VIEWED_V1' &&
    typeof cancel.requestId === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(cancel.requestId)
  ) {
    valuations.cancel(`${sender.tab?.id}:${cancel.requestId}`);
    return false;
  }
  if (!isExtensionApiRequest(message)) return false;
  void handle(message, sender).then(sendResponse);
  return true;
});
