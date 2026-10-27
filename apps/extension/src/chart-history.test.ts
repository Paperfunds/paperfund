import { describe, expect, it, vi } from 'vitest';
import type { Trade, Position } from '@paperfund/shared/browser';
import { fillMarkers, tokenTradeSummary } from './chart-history.js';
import { markerShape, matchesSolPriceChart, type NativeChart } from './chart-native.js';

describe('persisted chart fill history', () => {
  it('shows authoritative executable SOL value rather than quantity and never zero on valuation failure', () => {
    const fills = [
      {
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'BUY',
        actual_input_lamports: '2407800000',
        quote_lamports: '2400000000',
        fee_lamports: '7800000',
        realized_pnl_lamports: '0',
      },
      {
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'SELL',
        actual_output_lamports: '2183200000',
        realized_pnl_lamports: '-224600000',
      },
    ] as unknown as Trade[];
    const position = {
      tokenQuantityBaseUnits: '987654321',
      valuation: {
        status: 'AVAILABLE',
        executablePaperSolLamports: '500000000',
        unrealizedPnlLamports: '-100000000',
      },
    } as Position;
    expect(tokenTradeSummary(fills, 'mint', 'round', position)).toEqual({
      bought: 2407800000n,
      sold: 2183200000n,
      holdingValue: 500000000n,
      pnl: -324600000n,
    });
    position.valuation = { status: 'UNAVAILABLE', reason: 'RPC unavailable', valuedAt: '' };
    expect(tokenTradeSummary(fills, 'mint', 'round', position)).toMatchObject({
      holdingValue: null,
      pnl: null,
    });
    expect(tokenTradeSummary(fills, 'mint', 'round')).toMatchObject({
      holdingValue: 0n,
      pnl: -224600000n,
    });
    fills[0]!.actual_input_lamports = null;
    expect(tokenTradeSummary(fills, 'mint', 'round').bought).toBeNull();
  });
  it('keeps missing SELL proceeds unavailable and preserves immutable realized P&L', () => {
    const fills = [
      {
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'SELL',
        actual_output_lamports: null,
        realized_pnl_lamports: '-900',
      },
    ] as unknown as Trade[];
    expect(tokenTradeSummary(fills, 'mint', 'round')).toMatchObject({ sold: null, pnl: -900n });
    fills[0]!.realized_pnl_lamports = undefined as never;
    expect(tokenTradeSummary(fills, 'mint', 'round').pnl).toBeNull();
  });
  it('keeps an exact current-round token summary after full exit and excludes other rounds/mints', () => {
    const fills = [
      {
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'BUY',
        actual_input_lamports: '1000000000',
        realized_pnl_lamports: '0',
      },
      {
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'SELL',
        actual_output_lamports: '1200000000',
        realized_pnl_lamports: '200000000',
      },
      {
        mint_address: 'other',
        hourly_round_id: 'round',
        side: 'BUY',
        actual_input_lamports: '500',
        realized_pnl_lamports: '0',
      },
      {
        mint_address: 'mint',
        hourly_round_id: 'old',
        side: 'BUY',
        actual_input_lamports: '500',
        realized_pnl_lamports: '0',
      },
    ] as unknown as Trade[];
    expect(tokenTradeSummary(fills, 'mint', 'round')).toEqual({
      bought: 1000000000n,
      sold: 1200000000n,
      holdingValue: 0n,
      pnl: 200000000n,
    });
  });
  it('restores entry and exit levels without an open position and uses net fill amounts', () => {
    const fills = [
      {
        id: 'buy',
        side: 'BUY',
        token_decimals: 6,
        base_quantity: '2000000',
        actual_input_lamports: '1000000000',
        executed_at: '2026-10-01T00:00:00Z',
      },
      {
        id: 'sell',
        side: 'SELL',
        token_decimals: 6,
        base_quantity: '2000000',
        actual_output_lamports: '1200000000',
        executed_at: '2026-10-01T00:01:00Z',
      },
    ] as unknown as Trade[];
    expect(fillMarkers(JSON.parse(JSON.stringify(fills)))).toEqual([
      { id: 'buy', kind: 'BUY', priceSol: '0.5', time: 1790812800 },
      { id: 'sell', kind: 'SELL', priceSol: '0.6', time: 1790812860 },
    ]);
    expect(markerShape(fillMarkers(fills)[1]!).text).toBe('PAPERFUND SELL / EXIT');
    expect(
      markerShape({ id: 'avg', kind: 'AVERAGE', priceSol: '0.5', time: 0 }).overrides.linestyle,
    ).toBe(0);
  });

  it('rejects an unrelated mint, USD scale, market-cap unit, or missing chart identity', () => {
    let symbol: ReturnType<NativeChart['symbolExt']> = {
      ticker: 'mint',
      currency_code: 'SOL',
      unit_id: 'price',
    };
    const api: NativeChart = {
      symbolExt: () => symbol,
      createShape: vi.fn(),
      removeEntity: vi.fn(),
    };
    expect(matchesSolPriceChart(api, 'mint')).toBe(true);
    expect(matchesSolPriceChart(api, 'other')).toBe(false);
    symbol = { ticker: 'mint', currency_code: 'USD' };
    expect(matchesSolPriceChart(api, 'mint')).toBe(false);
    symbol = { ticker: 'mint', currency_code: 'SOL', unit_id: 'market-cap' };
    expect(matchesSolPriceChart(api, 'mint')).toBe(false);
    symbol = null;
    expect(matchesSolPriceChart(api, 'mint')).toBe(false);
  });
});
