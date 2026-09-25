import type {
  ApiContract,
  ApiOperation,
  ExtensionApiRequest,
  ExtensionApiResponse,
  PageBridgeRequest,
  PageBridgeResponse,
  WalletOperation,
} from './messages.js';
import { PAGE_CHANNEL } from './messages.js';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function apiRequest<K extends ApiOperation>(
  operation: K,
  payload?: Record<string, string>,
): Promise<ApiContract[K]> {
  const request: ExtensionApiRequest = {
    kind: 'PAPERFUND_API_V1',
    operation,
    ...(payload ? { payload } : {}),
  };
  const response = (await chrome.runtime.sendMessage(request)) as ExtensionApiResponse<
    ApiContract[K]
  >;
  if (!response.ok)
    throw new ApiError(
      response.error?.code ?? 'EXTENSION_REQUEST_FAILED',
      response.error?.message ?? 'Request failed.',
      response.error?.status,
    );
  return response.data as ApiContract[K];
}

export async function walletRequest(
  operation: WalletOperation,
  message?: string,
): Promise<PageBridgeResponse> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error('Wallet request timed out.'));
    }, 30_000);
    const receive = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      const response = event.data as Partial<PageBridgeResponse>;
      if (
        response.channel !== PAGE_CHANNEL ||
        response.direction !== 'RESPONSE' ||
        response.requestId !== requestId ||
        typeof response.ok !== 'boolean'
      )
        return;
      window.clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (!response.ok)
        reject(
          new Error(typeof response.error === 'string' ? response.error : 'Wallet request failed.'),
        );
      else resolve(response as PageBridgeResponse);
    };
    window.addEventListener('message', receive);
    window.postMessage(
      {
        channel: PAGE_CHANNEL,
        direction: 'REQUEST',
        requestId,
        operation,
        ...(message ? { message } : {}),
      } satisfies PageBridgeRequest,
      location.origin,
    );
  });
}

const friendlyErrors: Record<string, string> = {
  MAX_BUY_RATIO_EXCEEDED: 'Buy exceeds the 20% per-order limit.',
  INSUFFICIENT_PAPER_SOL: 'Not enough Paper SOL.',
  TOKEN_SLOT_LIMIT_REACHED: 'All token slots are already used.',
  ROUND_NOT_OPEN: 'This round is no longer open.',
  OUTSIDE_ROUND_WINDOW: 'The trading window has closed.',
  UNSUPPORTED_MARKET: 'Not supported by Paperfund yet.',
  MARKET_ACCOUNT_NOT_FOUND: 'Not supported by Paperfund yet.',
  MARKET_STATE_UNAVAILABLE: 'Authoritative market data is unavailable.',
  PROTOCOL_DISABLED: 'This execution venue is temporarily disabled.',
  ROUND_ACCOUNT_NOT_FOUND: 'Enter the current round before trading.',
  UNAUTHENTICATED: 'Your session expired. Sign in again.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return friendlyErrors[error.code] ?? error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
