import { afterEach, expect, it, vi } from 'vitest';
import { SolanaRpcClient } from '../src/pump-fun.js';
import { SolanaJsonRpcClient } from '../../db/src/creator-fee-ingestion.js';
const key = 'SyntheticRpcCredential_05f725c6291c4f59bf9352ad2ff4cfd7';
const url = 'https://mainnet.helius-rpc.com/?api-key=' + key;
const noLeak = (text: string) => {
  expect(text.includes(key)).toBe(false);
  expect(text.includes(url)).toBe(false);
};
afterEach(() => vi.unstubAllGlobals());
it('scrubs transport retry diagnostics and exhaustion while preserving retry count and classification', async () => {
  const events: unknown[] = [];
  const fetcher = vi.fn(async () => {
    throw Error('HTTP 401 at ' + url + ' ' + key);
  });
  const rpc = new SolanaRpcClient({
    url,
    fetchImplementation: fetcher,
    log: (_event, metadata) => events.push(metadata),
  });
  let error: unknown;
  try {
    await rpc.getMultipleAccounts(['11111111111111111111111111111111']);
  } catch (e) {
    error = e;
  }
  noLeak(JSON.stringify(events));
  noLeak((error as Error).message);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect((error as { code: string }).code).toBe('RPC_UNAVAILABLE');
  expect(JSON.stringify(events).includes('confirmed')).toBe(true);
});
it('scrubs RPC-provider error messages from the independent ingestion client', async () => {
  const retry: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: -32000, message: 'Rejected ' + url + ' ' + key } }),
        ),
    ),
  );
  const rpc = new SolanaJsonRpcClient(url, {
    maxAttempts: 2,
    minimumRequestIntervalMs: 0,
    onRetry: (input) => retry.push(input),
  });
  let error: unknown;
  try {
    await rpc.getSignaturesForAddress('11111111111111111111111111111111', { limit: 1 });
  } catch (e) {
    error = e;
  }
  noLeak(JSON.stringify(retry));
  noLeak((error as Error).message);
  expect((error as { code: string }).code).toBe('RPC_UNAVAILABLE');
});
