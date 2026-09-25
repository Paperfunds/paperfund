import type {
  Account,
  BuyPreflight,
  BuyResult,
  HourlyResult,
  MarketSupport,
  Page,
  PositionValuationResponse,
  Round,
  SellResult,
  Trade,
  User,
} from '@paperfund/shared/browser';

export const PAGE_CHANNEL = 'paperfund:page-bridge:v1';

export type WalletOperation = 'GET_PUBLIC_KEY' | 'CONNECT' | 'SIGN_AUTH_MESSAGE';
export type PageBridgeRequest = {
  channel: typeof PAGE_CHANNEL;
  direction: 'REQUEST';
  requestId: string;
  operation: WalletOperation;
  message?: string;
};
export type PageBridgeResponse = {
  channel: typeof PAGE_CHANNEL;
  direction: 'RESPONSE';
  requestId: string;
  ok: boolean;
  walletAddress?: string;
  signature?: string;
  error?: string;
};
export type PageNavigationMessage = {
  channel: typeof PAGE_CHANNEL;
  direction: 'NAVIGATION';
  url: string;
};

export type ApiOperation =
  | 'ME'
  | 'CHALLENGE'
  | 'VERIFY'
  | 'LOGOUT'
  | 'CURRENT_ROUND'
  | 'ENTER_ROUND'
  | 'ACCOUNT'
  | 'MARKET'
  | 'PREFLIGHT'
  | 'POSITIONS'
  | 'BUY'
  | 'SELL'
  | 'TRADES'
  | 'RESULTS';

export interface ExtensionApiRequest {
  kind: 'PAPERFUND_API_V1';
  operation: ApiOperation;
  payload?: Record<string, string>;
}
export interface ExtensionApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; status?: number };
}

export interface ApiContract {
  ME: { user: User };
  CHALLENGE: { challengeId: string; message: string };
  VERIFY: { user: User; expiresAt: string };
  LOGOUT: undefined;
  CURRENT_ROUND: { round: Round | null; serverTime: string };
  ENTER_ROUND: Account;
  ACCOUNT: Account;
  MARKET: MarketSupport;
  PREFLIGHT: BuyPreflight;
  POSITIONS: PositionValuationResponse;
  BUY: BuyResult;
  SELL: SellResult;
  TRADES: Page<Trade>;
  RESULTS: Page<HourlyResult>;
}

export function isExtensionApiRequest(value: unknown): value is ExtensionApiRequest {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<ExtensionApiRequest>;
  const operations: ApiOperation[] = [
    'ME',
    'CHALLENGE',
    'VERIFY',
    'LOGOUT',
    'CURRENT_ROUND',
    'ENTER_ROUND',
    'ACCOUNT',
    'MARKET',
    'PREFLIGHT',
    'POSITIONS',
    'BUY',
    'SELL',
    'TRADES',
    'RESULTS',
  ];
  if (input.kind !== 'PAPERFUND_API_V1' || !operations.includes(input.operation as ApiOperation))
    return false;
  return (
    input.payload === undefined ||
    (typeof input.payload === 'object' &&
      input.payload !== null &&
      Object.values(input.payload).every((item) => typeof item === 'string'))
  );
}
