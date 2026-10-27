import { ExecutionEngineError } from '@paperfund/execution';
import { AsyncLocalStorage } from 'node:async_hooks';
export interface AdvisoryReadContext {
  signal: AbortSignal;
  minimumSlot?: number;
  metrics: {
    rpcRequests: number;
    rpcMs: number;
    retries: number;
    rateLimits: number;
    rateLimitedUntil?: number;
    routeDiscoveryMs?: number;
  };
}
const storageKey = Symbol.for('paperfund.advisory.read.v1');
const registry = globalThis as unknown as Record<symbol, unknown>;
const storage =
  (registry[storageKey] as AsyncLocalStorage<AdvisoryReadContext> | undefined) ??
  new AsyncLocalStorage<AdvisoryReadContext>();
registry[storageKey] = storage;
export const advisoryReadContext = () => storage.getStore();
export const withAdvisoryRead = <T>(context: AdvisoryReadContext, read: () => T): T =>
  storage.run(context, read);
export function rpcProviderIdentity(url: string): string {
  const host = new URL(url).hostname;
  return host.endsWith('.helius-rpc.com')
    ? 'HELIUS'
    : host === 'api.mainnet-beta.solana.com' || host === 'api.mainnet.solana.com'
      ? 'PUBLIC_SOLANA'
      : 'CUSTOM_RPC';
}

export const ADVISORY_CLOCK_ACCOUNT = 'SysvarC1ock11111111111111111111111111111111';
/** Bank Clock from the same atomic account response; not the last trade's timestamp. */
export function advisoryClockTime(
  account: { owner: string; data: readonly [string, string] } | null | undefined,
  slot: number,
): string {
  if (!account || account.owner !== 'Sysvar1111111111111111111111111111111111111')
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'SNAPSHOT_CLOCK_UNAVAILABLE');
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 40 || data.readBigUInt64LE(0) > BigInt(slot))
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'SNAPSHOT_CLOCK_UNAVAILABLE');
  const seconds = data.readBigInt64LE(32);
  if (seconds <= 0n || seconds > 8640000000000n)
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'SNAPSHOT_CLOCK_UNAVAILABLE');
  return new Date(Number(seconds) * 1000).toISOString();
}
