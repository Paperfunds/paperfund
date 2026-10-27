import { describe, expect, it } from 'vitest';
import type { Trade, Position, HistoricalChartFx } from '@paperfund/shared/browser';
import { usdAverageEntry } from './chart-usd.js';
const time = '2026-10-08T12:00:00.000Z';
function buy(id: string, quantity: string, cost: string, rate: string | undefined): Trade {
  const fx: HistoricalChartFx = rate
    ? {
        status: 'AVAILABLE',
        version: 'v1',
        source: 'PYTH_HERMES_TIMESTAMP',
        feedId: 'feed',
        rate,
        requestedAt: time,
        fxAt: time,
        retrievedAt: time,
        rawPrice: '150',
        exponent: 0,
        confidence: '1',
        responseHash: 'hash',
        fillTimestamp: time,
      }
    : { status: 'UNAVAILABLE', reason: 'HISTORICAL_FX_PROVIDER_NOT_CONFIGURED' };
  return {
    id,
    mint_address: 'mint',
    hourly_round_id: 'round',
    side: 'BUY',
    executed_at: time,
    base_quantity: quantity,
    actual_input_lamports: cost,
    sol_usd_fx: fx,
  } as Trade;
}
function position(quantity: string, cost: string, decimals = 6) {
  return {
    mint: 'mint',
    tokenQuantityBaseUnits: quantity,
    costBasisPaperSolLamports: cost,
    tokenDecimals: decimals,
  } as Position;
}
function sell(id: string, quantity: string, removed: string) {
  return {
    id,
    mint_address: 'mint',
    hourly_round_id: 'round',
    side: 'SELL',
    executed_at: time,
    base_quantity: quantity,
    cost_basis_lamports_removed: removed,
  } as Trade;
}
describe('USD acquisition basis and market cap', () => {
  it('uses all-in actual BUY cost and authoritative supply with token decimals', () => {
    const result = usdAverageEntry(
      [buy('a', '2000000', '1000000000', '150')],
      position('2000000', '1000000000'),
      'round',
      '1000000000000000',
      6,
    );
    expect(result).toMatchObject({
      priceUsd: '75',
      marketCapUsd: '75000000000',
      details: { remainingUsdBasis: '150' },
    });
  });
  it('weights multiple BUYs in USD cost, then removes partial SELL basis proportionally', () => {
    const fills = [
      buy('a', '2000000', '1000000000', '100'),
      buy('b', '2000000', '2000000000', '200'),
      sell('c', '1000000', '750000000'),
    ];
    const result = usdAverageEntry(
      fills,
      position('3000000', '2250000000'),
      'round',
      '1000000000000000',
      6,
    );
    expect(result).toMatchObject({
      priceUsd: '125',
      marketCapUsd: '125000000000',
      details: { remainingUsdBasis: '375' },
    });
  });
  it('removes complete exits and permits a new position after an old unavailable FX cycle', () => {
    const fills = [
      buy('a', '1000000', '1000000000', undefined),
      sell('b', '1000000', '1000000000'),
    ];
    expect(usdAverageEntry(fills, position('0', '0'), 'round', '1000000000000000', 6).reason).toBe(
      'NO_OPEN_POSITION',
    );
    fills.push(buy('c', '1000000', '1000000000', '150'));
    expect(
      usdAverageEntry(fills, position('1000000', '1000000000'), 'round', '1000000000000000', 6)
        .priceUsd,
    ).toBe('150');
  });
  it('reports missing/invalid FX, missing supply and incomplete history separately', () => {
    const fills = [buy('a', '1000000', '1000000000', undefined)];
    expect(usdAverageEntry(fills, position('1000000', '1000000000'), 'round', '1', 6).reason).toBe(
      'HISTORICAL_FX_PROVIDER_NOT_CONFIGURED',
    );
    fills[0] = buy('a', '1000000', '1000000000', '0');
    expect(usdAverageEntry(fills, position('1000000', '1000000000'), 'round', '1', 6).reason).toBe(
      'INVALID_HISTORICAL_FX',
    );
    fills[0] = buy('a', '1000000', '1000000000', '150');
    expect(
      usdAverageEntry(fills, position('1000000', '1000000000'), 'round', undefined, 6).reason,
    ).toBe('AUTHORITATIVE_SUPPLY_UNAVAILABLE');
    expect(usdAverageEntry(fills, position('2000000', '1000000000'), 'round', '1', 6).reason).toBe(
      'POSITION_HISTORY_RECONCILIATION_PENDING',
    );
    expect(usdAverageEntry(fills, position('1000000', '1000000000'), 'round', '1', 9).reason).toBe(
      'TOKEN_DECIMALS_MISMATCH',
    );
  });
  it('uses exact canonical integer SOL basis removal and survives JSON restoration', () => {
    const fills = JSON.parse(
      JSON.stringify([buy('a', '3', '10', '100'), sell('b', '1', '3')]),
    ) as Trade[];
    const result = usdAverageEntry(fills, position('2', '7', 0), 'round', '100', 0);
    expect(result.details.remainingUsdBasis).toBe('0.000000666666666666666666667');
    expect(result.marketCapUsd).toBe('0.00003333333333333333333335');
    fills[1]!.cost_basis_lamports_removed = '4';
    expect(usdAverageEntry(fills, position('2', '6', 0), 'round', '100', 0).reason).toBe(
      'CHART_SOL_BASIS_RECONCILIATION_FAILED',
    );
  });
});

it('uses saved execution capture within five seconds before the fill without changing weighted basis', () => {
  const fill = buy('a', '1000000', '1000000000', '105.95');
  if (fill.sol_usd_fx?.status === 'AVAILABLE') {
    fill.sol_usd_fx.version = 'CAPTURED_EXECUTION_FX_V1';
    fill.sol_usd_fx.fxAt = '2026-10-08T11:59:58.000Z';
    fill.sol_usd_fx.source = 'COINBASE_SOL_USD_LAST_TRADE';
    fill.sol_usd_fx.sourceObservationId = '123';
  }
  expect(
    usdAverageEntry([fill], position('1000000', '1000000000'), 'round', '1000000000000000', 6),
  ).toMatchObject({ priceUsd: '105.95' });
});
