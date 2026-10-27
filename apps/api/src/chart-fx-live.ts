import { createHash } from 'node:crypto';
import type { HistoricalFxProvider, FxResult } from './chart-fx.js';
export const CAPTURED_FX_VERSION = 'CAPTURED_EXECUTION_FX_V1';
export const COINBASE_FX_SOURCE = 'COINBASE_SOL_USD_LAST_TRADE';
const unavailable = (reason: string): FxResult => ({ status: 'UNAVAILABLE', reason });
/** Unauthenticated exchange reference captured near a new BUY, never historical backfill. */
export class CoinbaseExecutionFxProvider implements HistoricalFxProvider {
  private latest: { expires: number; value: Promise<FxResult> } | undefined;
  private requests: number[] = [];
  constructor(
    private fetcher: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  async lookup(time: Date): Promise<FxResult> {
    const target = time.getTime();
    if (!Number.isFinite(target) || Math.abs(this.now() - target) > 5000)
      return unavailable('CAPTURED_FX_EXECUTION_WINDOW_EXPIRED');
    if (!this.latest || this.latest.expires < this.now())
      this.latest = { expires: this.now() + 250, value: this.read(target) };
    const result = await this.latest.value;
    if (result.status !== 'AVAILABLE') return result;
    if (Math.abs(Date.parse(result.fxAt) - target) > 5000) return unavailable('STALE_CAPTURED_FX');
    return { ...result, requestedAt: new Date(Math.floor(target / 1000) * 1000).toISOString() };
  }
  private async read(target: number): Promise<FxResult> {
    let failure = 'CAPTURED_FX_PROVIDER_UNAVAILABLE';
    for (let attempt = 0; attempt < 2; attempt++) {
      this.requests = this.requests.filter((t) => this.now() - t < 1000);
      if (this.requests.length >= 5) return unavailable('CAPTURED_FX_RATE_LIMITED');
      this.requests.push(this.now());
      try {
        const response = await this.fetcher(
          attempt === 0
            ? 'https://api.exchange.coinbase.com/products/SOL-USD/ticker'
            : 'https://api.exchange.coinbase.com/products/SOL-USD/trades?limit=100',
          { signal: AbortSignal.timeout(700) },
        );
        if (!response.ok) {
          if (response.status !== 429 && response.status < 500)
            return unavailable('CAPTURED_FX_PROVIDER_REJECTED');
        } else {
          const payload: unknown = await response.json();
          const retrieved = this.now();
          // The ticker may lag the public trade tape. Only actual, timestamped exchange
          // trades inside both freshness windows qualify; this is never old-fill repair.
          const candidates = attempt === 0 ? [payload] : Array.isArray(payload) ? payload : [];
          failure = 'INVALID_CAPTURED_FX';
          for (const item of candidates.slice(0, 100)) {
            if (!item || typeof item !== 'object') continue;
            const raw = item as { price?: unknown; time?: unknown; trade_id?: unknown };
            if (
              typeof raw.price !== 'string' ||
              !/^\d+(?:\.\d{1,18})?$/.test(raw.price) ||
              BigInt(raw.price.replace('.', '')) <= 0n ||
              typeof raw.trade_id !== 'number' ||
              !Number.isSafeInteger(raw.trade_id) ||
              raw.trade_id < 0 ||
              typeof raw.time !== 'string'
            )
              continue;
            const observed = Date.parse(raw.time);
            if (!Number.isFinite(observed)) continue;
            if (
              observed > retrieved + 1000 ||
              retrieved - observed > 5000 ||
              Math.abs(observed - target) > 5000
            ) {
              failure = 'STALE_CAPTURED_FX';
              continue;
            }
            return {
              status: 'AVAILABLE',
              version: CAPTURED_FX_VERSION,
              source: COINBASE_FX_SOURCE,
              feedId: 'SOL-USD',
              requestedAt: '',
              fxAt: raw.time,
              rate: raw.price,
              retrievedAt: new Date(retrieved).toISOString(),
              sourceObservationId: String(raw.trade_id),
              responseHash: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
            };
          }
        }
      } catch {
        /* A bounded presentation failure cannot reject a committed BUY. */
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return unavailable(failure);
  }
}
