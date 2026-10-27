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
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export async function apiRequest<K extends ApiOperation>(
  operation: K,
  payload?: Record<string, string>,
  options?: { signal?: AbortSignal },
): Promise<ApiContract[K]> {
  const request: ExtensionApiRequest = {
    kind: 'PAPERFUND_API_V1',
    operation,
    ...(['VIEWED_POSITION', 'MARKET', 'PREFLIGHT', 'POSITIONS'].includes(operation)
      ? { requestId: crypto.randomUUID() }
      : {}),
    ...(payload ? { payload } : {}),
  };
  options?.signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  const canceled = new Promise<never>((_, reject) => {
    abort = () => {
      void chrome.runtime
        .sendMessage({ kind: 'PAPERFUND_CANCEL_VIEWED_V1', requestId: request.requestId })
        .catch(() => {});
      reject(new DOMException('Advisory canceled', 'AbortError'));
    };
    options?.signal?.addEventListener('abort', abort, { once: true });
  });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let response: ExtensionApiResponse<ApiContract[K]>;
  try {
    response = await Promise.race([
      chrome.runtime.sendMessage(request),
      canceled,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new ApiError(
                'EXTENSION_RESPONSE_TIMEOUT',
                'Paperfund did not receive a response. Refresh account state before retrying this trade.',
              ),
            ),
          operation === 'VIEWED_POSITION'
            ? 5000
            : operation === 'MARKET'
              ? 11000
              : ['PREFLIGHT', 'POSITIONS'].includes(operation)
                ? 17000
                : 20_000,
        );
        // Cleared below when the message completes.
        timers.push(timer);
      }),
    ]);
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      'EXTENSION_REQUEST_FAILED',
      'Paperfund extension connection failed. Reload this tab and check account state before retrying.',
    );
  } finally {
    if (abort) options?.signal?.removeEventListener('abort', abort);
    for (const timer of timers) clearTimeout(timer);
  }
  if (!response || typeof response.ok !== 'boolean')
    throw new ApiError(
      'EXTENSION_INVALID_RESPONSE',
      'Paperfund received an invalid extension response. Check account state before retrying.',
    );
  if (!response.ok)
    throw new ApiError(
      response.error?.code ?? 'EXTENSION_REQUEST_FAILED',
      response.error?.message ?? 'Request failed.',
      response.error?.status,
      response.error?.retryAfterMs,
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
  INSUFFICIENT_EXECUTABLE_LIQUIDITY:
    'Insufficient executable liquidity for this quantity. Check the current max executable exit.',
  ZERO_EXECUTABLE_OUTPUT: 'This quantity currently produces no positive SOL after fees.',
  POSITION_VALUATION_FAILED:
    'BUY paused: an open position cannot be fully valued. Partial SELL may still be available.',
  MAX_BUY_RATIO_EXCEEDED: 'Buy exceeds the 20% per-order limit.',
  INSUFFICIENT_PAPER_SOL: 'Not enough Paper SOL.',
  TOKEN_SLOT_LIMIT_REACHED: 'All token slots are already used.',
  ROUND_NOT_OPEN: 'This round is no longer open.',
  OUTSIDE_ROUND_WINDOW: 'The trading window has closed.',
  UNSUPPORTED_MARKET: 'Market route temporarily unavailable.',
  MARKET_ACCOUNT_NOT_FOUND: 'No executable market found for this context.',
  MARKET_STATE_UNAVAILABLE: 'Market data temporarily unavailable. Retrying…',
  RPC_UNAVAILABLE: 'Market data temporarily unavailable. Retrying...',
  RPC_ERROR: 'Market data temporarily unavailable. Retrying…',
  RPC_TIMEOUT: 'Market data temporarily unavailable. Retrying…',
  PROTOCOL_DISABLED: 'Market data temporarily unavailable. Retrying…',
  ROUND_ACCOUNT_NOT_FOUND: 'Enter the current round before trading.',
  UNAUTHENTICATED: 'Your session expired. Sign in again.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return `${friendlyErrors[error.code] ?? error.message} (${error.code})`;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
