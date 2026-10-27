import { CAPTURED_FX_VERSION } from './chart-fx-live.js';
import { createHash } from 'node:crypto';
import type { DatabaseService } from '@paperfund/db';
import type { HistoricalChartFx } from '@paperfund/shared/browser';

export const SOL_USD_FEED = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
export const CHART_FX_VERSION = 'HISTORICAL_FX_AT_EXECUTION_V1';
export type FxResult = HistoricalChartFx;
export interface HistoricalFxProvider {
  lookup(time: Date): Promise<FxResult>;
}
const unavailable = (reason: string): FxResult => ({ status: 'UNAVAILABLE', reason });

/** Display-only Pyth timestamp reference. Never consulted by execution or accounting. */
export class PythHistoricalFxProvider implements HistoricalFxProvider {
  private cache = new Map<number, { expires: number; value: Promise<FxResult> }>();
  private requests: number[] = [];
  constructor(
    private key: () => string | undefined = () => process.env['PYTH_API_KEY'],
    private fetcher: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  lookup(time: Date): Promise<FxResult> {
    const seconds = Math.floor(time.getTime() / 1000);
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      return Promise.resolve(unavailable('INVALID_FILL_TIMESTAMP'));
    if (!this.key()) return Promise.resolve(unavailable('HISTORICAL_FX_PROVIDER_NOT_CONFIGURED'));
    const cached = this.cache.get(seconds);
    if (cached && cached.expires > this.now()) return cached.value;
    const value = this.read(seconds);
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    const item = { expires: this.now() + 30000, value };
    this.cache.set(seconds, item);
    void value.then((result) => {
      if (result.status === 'AVAILABLE') item.expires = Infinity;
    });
    return value;
  }
  private async read(seconds: number): Promise<FxResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.requests = this.requests.filter((t) => this.now() - t < 10000);
      if (this.requests.length >= 10) return unavailable('HISTORICAL_FX_RATE_LIMITED');
      this.requests.push(this.now());
      try {
        const response = await this.fetcher(
          `https://pyth.dourolabs.app/hermes/v2/updates/price/${seconds}?ids[]=${SOL_USD_FEED}`,
          {
            headers: { Authorization: `Bearer ${this.key()}` },
            signal: AbortSignal.timeout(700),
          },
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 403)
            return unavailable('HISTORICAL_FX_PROVIDER_UNAUTHORIZED');
          if (response.status === 404) return unavailable('HISTORICAL_FX_UNAVAILABLE');
          if (response.status !== 429 && response.status < 500)
            return unavailable('HISTORICAL_FX_PROVIDER_REJECTED');
          if (attempt === 2) return unavailable('HISTORICAL_FX_PROVIDER_UNAVAILABLE');
        } else {
          const raw = (await response.json()) as {
            parsed?: {
              id: string;
              price: { price: string; expo: number; conf: string; publish_time: number };
            }[];
            binary?: unknown;
          };
          const quote = raw.parsed?.find((p) => p.id === SOL_USD_FEED)?.price;
          if (
            !quote ||
            !/^\d+$/.test(quote.price) ||
            BigInt(quote.price) <= 0n ||
            !/^\d+$/.test(quote.conf) ||
            BigInt(quote.conf) >= BigInt(quote.price) ||
            !Number.isInteger(quote.expo) ||
            Math.abs(quote.expo) > 18 ||
            !Number.isSafeInteger(quote.publish_time) ||
            quote.publish_time < seconds ||
            quote.publish_time - seconds > 5
          )
            return unavailable('INVALID_HISTORICAL_FX');
          const digits = quote.price.padStart(-quote.expo + 1, '0');
          const rate =
            quote.expo >= 0
              ? quote.price + '0'.repeat(quote.expo)
              : `${digits.slice(0, quote.expo)}.${digits.slice(quote.expo)}`;
          return {
            status: 'AVAILABLE',
            version: CHART_FX_VERSION,
            source: 'PYTH_HERMES_TIMESTAMP',
            feedId: SOL_USD_FEED,
            requestedAt: new Date(seconds * 1000).toISOString(),
            fxAt: new Date(quote.publish_time * 1000).toISOString(),
            rate,
            rawPrice: quote.price,
            exponent: quote.expo,
            confidence: quote.conf,
            retrievedAt: new Date(this.now()).toISOString(),
            responseHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
          };
        }
      } catch {
        if (attempt === 2) return unavailable('HISTORICAL_FX_PROVIDER_UNAVAILABLE');
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    return unavailable('HISTORICAL_FX_UNAVAILABLE');
  }
}
const provider = new PythHistoricalFxProvider();
/** Compatibility wrapper; new chart reads persist the associated evidence. */
export async function historicalSolUsd(time: Date): Promise<string | null> {
  const result = await provider.lookup(time);
  return result.status === 'AVAILABLE' ? result.rate : null;
}

export async function historicalFillFx(
  database: Pick<DatabaseService, 'pool'>,
  fillId: string,
  time: Date,
  source?: HistoricalFxProvider,
): Promise<FxResult> {
  try {
    const saved = (
      await database.pool.query<{ evidence: FxResult }>(
        'select evidence from chart_fill_fx_evidence where fill_id = $1 and version = any($2::text[]) order by version limit 1',
        [fillId, [CAPTURED_FX_VERSION, CHART_FX_VERSION]],
      )
    ).rows[0];
    if (saved) return saved.evidence;
    if (!source) {
      const failure = (
        await database.pool.query<{ reason: string }>(
          'select reason from chart_fill_fx_capture_failures where fill_id=$1 and version=$2',
          [fillId, CAPTURED_FX_VERSION],
        )
      ).rows[0];
      return unavailable(failure?.reason ?? 'HISTORICAL_FX_NOT_CAPTURED');
    }
    const result = await source.lookup(time);
    if (result.status !== 'AVAILABLE') return result;
    // Additive enrichment only. A concurrent insert selects the original immutable winner.
    await database.pool.query(
      `insert into chart_fill_fx_evidence(fill_id,version,executed_at,source,fx_at,rate,evidence)
      select id,$3,executed_at,$4,$5,$6,$7::jsonb from fills where id=$1 and executed_at=$2
      on conflict (fill_id,version) do nothing`,
      [
        fillId,
        time,
        result.version,
        result.source,
        result.fxAt,
        result.rate,
        JSON.stringify({ ...result, fillTimestamp: time.toISOString() }),
      ],
    );
    return (
      (
        await database.pool.query<{ evidence: FxResult }>(
          'select evidence from chart_fill_fx_evidence where fill_id = $1 and version = $2',
          [fillId, result.version],
        )
      ).rows[0]?.evidence ?? unavailable('HISTORICAL_FX_PERSISTENCE_UNAVAILABLE')
    );
  } catch {
    return unavailable('HISTORICAL_FX_PERSISTENCE_UNAVAILABLE');
  }
}

/** Called only after successful BUY commit; captured evidence must still match the actual immutable fill time. */
export async function saveCapturedFillFx(
  database: Pick<DatabaseService, 'pool'>,
  fillId: string,
  time: Date,
  observation: Promise<FxResult>,
): Promise<FxResult> {
  try {
    const result = await observation;
    let valid = result;
    if (
      result.status === 'AVAILABLE' &&
      (result.version !== CAPTURED_FX_VERSION ||
        Math.abs(Date.parse(result.fxAt) - time.getTime()) > 5000 ||
        Date.parse(result.requestedAt) !== Math.floor(time.getTime() / 1000) * 1000)
    )
      valid = unavailable('CAPTURED_FX_NOT_AT_FILL_TIME');
    if (valid.status === 'UNAVAILABLE') {
      await database.pool.query(
        'insert into chart_fill_fx_capture_failures(fill_id,version,status,reason) values($1,$2,$3,$4) on conflict do nothing',
        [fillId, CAPTURED_FX_VERSION, valid.status, valid.reason],
      );
      return historicalFillFx(database, fillId, time);
    }
    return await historicalFillFx(database, fillId, time, { lookup: async () => valid });
  } catch {
    return unavailable('CAPTURED_FX_PERSISTENCE_UNAVAILABLE');
  }
}
