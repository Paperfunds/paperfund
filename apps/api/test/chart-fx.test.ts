import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '@paperfund/db';
import {
  PythHistoricalFxProvider,
  SOL_USD_FEED,
  historicalFillFx,
  CHART_FX_VERSION,
} from '../src/chart-fx.js';
const seconds = 1791460800;
function payload(publish_time = seconds) {
  return {
    parsed: [
      { id: SOL_USD_FEED, price: { price: '15012345678', expo: -8, conf: '10000', publish_time } },
    ],
  };
}
function provider(body = payload(), status = 200) {
  const fetcher = vi.fn(async () => ({
    ok: status === 200,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  return { source: new PythHistoricalFxProvider(() => 'test-only', fetcher), fetcher };
}
afterEach(() => vi.restoreAllMocks());
describe('historical display-only Pyth reference', () => {
  it('reports missing configuration without a network read', async () => {
    const fetcher = vi.fn();
    const source = new PythHistoricalFxProvider(() => undefined, fetcher);
    expect(await source.lookup(new Date(seconds * 1000))).toEqual({
      status: 'UNAVAILABLE',
      reason: 'HISTORICAL_FX_PROVIDER_NOT_CONFIGURED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the fill timestamp and exact exponent, deduplicating requests with provenance', async () => {
    const { source, fetcher } = provider();
    const time = new Date(seconds * 1000 + 123);
    const [a, b] = await Promise.all([source.lookup(time), source.lookup(time)]);
    expect(a).toMatchObject({
      status: 'AVAILABLE',
      rate: '150.12345678',
      source: 'PYTH_HERMES_TIMESTAMP',
      requestedAt: new Date(seconds * 1000).toISOString(),
      fxAt: new Date(seconds * 1000).toISOString(),
    });
    expect(b).toEqual(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/' + seconds + '?'),
      expect.anything(),
    );
  });
  it('rejects distant/past observations, zero rates, wrong feeds and missing data', async () => {
    for (const body of [
      payload(seconds + 6),
      payload(seconds - 1),
      { parsed: [] },
      {
        parsed: [
          { id: SOL_USD_FEED, price: { price: '0', expo: -8, conf: '0', publish_time: seconds } },
        ],
      },
    ])
      expect(await provider(body).source.lookup(new Date(seconds * 1000))).toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'INVALID_HISTORICAL_FX',
      });
  });
  it('does not retry authorization failures or invent a current-price fallback', async () => {
    const { source, fetcher } = provider(payload(), 401);
    expect(await source.lookup(new Date(seconds * 1000))).toMatchObject({
      reason: 'HISTORICAL_FX_PROVIDER_UNAUTHORIZED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds retryable outages and caches failures briefly', async () => {
    const { source, fetcher } = provider(payload(), 503);
    expect(await source.lookup(new Date(seconds * 1000))).toMatchObject({
      reason: 'HISTORICAL_FX_PROVIDER_UNAVAILABLE',
    });
    await source.lookup(new Date(seconds * 1000));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
describe('separate immutable fill FX enrichment', () => {
  it('restores saved evidence without requiring the provider or changing any fill', async () => {
    const result = await provider().source.lookup(new Date(seconds * 1000));
    const query = vi.fn(async () => ({ rows: [{ evidence: result }] }));
    const lookup = vi.fn();
    const database = { pool: { query } } as unknown as DatabaseService;
    expect(await historicalFillFx(database, 'fill', new Date(seconds * 1000), { lookup })).toEqual(
      result,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('persists versioned historical evidence and reuses the immutable insert winner', async () => {
    const result = await provider().source.lookup(new Date(seconds * 1000));
    let stored = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('insert')) {
        stored = true;
        return { rows: [] };
      }
      return { rows: stored ? [{ evidence: result }] : [] };
    });
    const database = { pool: { query } } as unknown as DatabaseService;
    expect(
      await historicalFillFx(database, 'fill', new Date(seconds * 1000), {
        lookup: async () => result,
      }),
    ).toEqual(result);
    expect(query.mock.calls[1]?.[0]).toContain('on conflict (fill_id,version) do nothing');
    expect(query.mock.calls[1]?.[0]).not.toMatch(/update fills|update ledger/i);
    expect(CHART_FX_VERSION).toBe('HISTORICAL_FX_AT_EXECUTION_V1');
  });
});
