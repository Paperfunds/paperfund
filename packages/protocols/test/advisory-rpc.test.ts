import { afterEach, expect, it, vi } from 'vitest';
import { SolanaRpcClient } from '../src/pump-fun.js';
import {
  withAdvisoryRead,
  rpcProviderIdentity,
  type AdvisoryReadContext,
} from '../src/rpc-read-context.js';
import { parseEnvironment } from '@paperfund/config';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function context(signal: AbortSignal): AdvisoryReadContext {
  return { signal, metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 } };
}
function reply(slot: number) {
  return new Response(JSON.stringify({ result: { context: { slot }, value: [null] } }));
}
it('pins minimum slots across advisory reads and retries a regressing provider response', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(10))
    .mockResolvedValueOnce(reply(9))
    .mockResolvedValueOnce(reply(11));
  const rpc = new SolanaRpcClient({ url: 'https://example.invalid', fetchImplementation: fetcher });
  const c = context(AbortSignal.timeout(3000));
  await withAdvisoryRead(c, async () => {
    await rpc.getMultipleAccounts(['mint']);
    expect((await rpc.getMultipleAccounts(['mint'])).context.slot).toBe(11);
  });
  expect(JSON.parse(fetcher.mock.calls[1]![1].body).params[1].minContextSlot).toBe(10);
  expect(c.metrics).toMatchObject({ rpcRequests: 3, retries: 1 });
});
it('honors Retry-After and parent cancellation instead of stacking retries', async () => {
  vi.useFakeTimers();
  const ctrl = new AbortController(),
    c = context(ctrl.signal);
  const fetcher = vi.fn(
    async () => new Response('limited', { status: 429, headers: { 'retry-after': '5' } }),
  );
  const rpc = new SolanaRpcClient({ url: 'https://example.invalid', fetchImplementation: fetcher });
  const failed = expect(
    withAdvisoryRead(c, () => rpc.getMultipleAccounts(['mint'])),
  ).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetcher).toHaveBeenCalledTimes(1);
  ctrl.abort();
  await failed;
  expect(c.metrics.rateLimitedUntil! - Date.now()).toBeGreaterThan(4000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps authoritative retry policy outside the advisory context', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response('offline', { status: 503 }));
  const rpc = new SolanaRpcClient({ url: 'https://example.invalid', fetchImplementation: fetcher });
  const fail = expect(rpc.getMultipleAccounts(['mint'])).rejects.toThrow('3 attempts');
  await vi.advanceTimersByTimeAsync(300);
  await fail;
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('accepts public/Helius configuration and exposes only a sanitized provider identity', () => {
  const base = {
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    REDIS_URL: 'redis://localhost',
  };
  expect(parseEnvironment(base).SOLANA_RPC_URL).toContain('api.mainnet-beta.solana.com');
  const key = 'example-private-key';
  const cfg = parseEnvironment({
    ...base,
    SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=' + key,
    SOLANA_WS_URL: 'wss://mainnet.helius-rpc.com/?api-key=' + key,
  });
  expect(rpcProviderIdentity(cfg.SOLANA_RPC_URL)).toBe('HELIUS');
  expect(rpcProviderIdentity(cfg.SOLANA_RPC_URL)).not.toContain(key);
  expect(() => parseEnvironment({ ...base, SOLANA_WS_URL: 'https://wrong.invalid' })).toThrow();
});
