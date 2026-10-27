import { describe, expect, it, vi } from 'vitest';
import { CoinbaseExecutionFxProvider, CAPTURED_FX_VERSION } from '../src/chart-fx-live.js';
import { historicalFillFx, saveCapturedFillFx } from '../src/chart-fx.js';
import type { DatabaseService } from '@paperfund/db';
const now = Date.parse('2026-10-08T18:10:16.654Z');
function fixture(delta = -2500, status = 200) {
  const fetcher = vi.fn(async (url: string) => ({
    ok: status === 200,
    status,
    json: async () => {
      const trade = {
        price: '105.95',
        time: new Date(now + delta).toISOString(),
        trade_id: 357096647,
      };
      return url.includes('/trades?') ? [trade] : trade;
    },
  })) as unknown as typeof fetch;
  return { fetcher, source: new CoinbaseExecutionFxProvider(fetcher, () => now) };
}
describe('free execution-time SOL/USD capture', () => {
  it('reads unauthenticated SOL-USD with its source trade ID and accepts a fresh prior observation', async () => {
    const { source, fetcher } = fixture();
    const quote = await source.lookup(new Date(now));
    expect(quote).toMatchObject({
      status: 'AVAILABLE',
      rate: '105.95',
      version: CAPTURED_FX_VERSION,
      source: 'COINBASE_SOL_USD_LAST_TRADE',
      sourceObservationId: '357096647',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.exchange.coinbase.com/products/SOL-USD/ticker',
      expect.not.objectContaining({ headers: expect.anything() }),
    );
    await source.lookup(new Date(now));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not look up current prices for historical fills and rejects stale/future observations', async () => {
    const f = fixture();
    expect(await f.source.lookup(new Date(now - 10000))).toMatchObject({
      reason: 'CAPTURED_FX_EXECUTION_WINDOW_EXPIRED',
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    for (const delta of [-6000, 2000])
      expect(await fixture(delta).source.lookup(new Date(now))).toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'STALE_CAPTURED_FX',
      });
  });
  it('bounds provider failure and does not invent a rate', async () => {
    const { source, fetcher } = fixture(0, 503);
    expect(await source.lookup(new Date(now))).toMatchObject({ status: 'UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reads only archived evidence for old fills, without any optional historical provider', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const db = { pool: { query } } as unknown as DatabaseService;
    expect(await historicalFillFx(db, 'old', new Date(now - 100000))).toEqual({
      status: 'UNAVAILABLE',
      reason: 'HISTORICAL_FX_NOT_CAPTURED',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('a capture persistence failure is a presentation result, not a thrown trade failure', async () => {
    const db = {
      pool: {
        query: async () => {
          throw Error('offline');
        },
      },
    } as unknown as DatabaseService;
    const quote = await fixture().source.lookup(new Date(now));
    expect(
      await saveCapturedFillFx(db, 'fill', new Date(now), Promise.resolve(quote)),
    ).toMatchObject({ status: 'UNAVAILABLE' });
  });
});

it('recovers a stale ticker from fresh timestamped public trades without relaxing freshness', async () => {
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.includes('/ticker')
        ? { price: '109.33', time: new Date(now - 6000).toISOString(), trade_id: 1 }
        : [{ price: '109.34', time: new Date(now - 100).toISOString(), trade_id: 2 }],
  })) as unknown as typeof fetch;
  expect(
    await new CoinbaseExecutionFxProvider(fetcher, () => now).lookup(new Date(now)),
  ).toMatchObject({
    status: 'AVAILABLE',
    rate: '109.34',
    sourceObservationId: '2',
    fxAt: new Date(now - 100).toISOString(),
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not accept a fresh tape trade outside the actual fill window', async () => {
  const { source } = fixture(500);
  expect(await source.lookup(new Date(now - 5000))).toMatchObject({
    status: 'UNAVAILABLE',
    reason: 'STALE_CAPTURED_FX',
  });
});
