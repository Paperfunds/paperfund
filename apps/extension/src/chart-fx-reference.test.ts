import { describe, expect, it } from 'vitest';
import type { Trade, Position } from '@paperfund/shared/browser';
import { chartFxReference } from './chart-fx-reference.js';
import { historicalTrades } from './trade-history-chart.js';
import { usdAverageEntry } from './chart-usd.js';
function records(): [Trade, Trade] {
  const buy = { id: 'buy', owner_user_id: 'owner', competition_account_id: 'account',
    hourly_round_id: 'round', mint_address: 'mint', side: 'BUY', executed_at: '2026-10-12T07:31:47.228Z',
    actual_input_lamports: '983917445', base_quantity: '15304196469584', token_decimals: 6,
    token_supply_base_units: '1000000000000000',
    sol_usd_fx: { status: 'UNAVAILABLE', reason: 'STALE_CAPTURED_FX' } } as Trade;
  const sell = { ...buy, id: 'sell', side: 'SELL', executed_at: '2026-10-12T07:31:52.002Z',
    actual_input_lamports: null, actual_output_lamports: '1135479532',
    sol_usd_fx: { status: 'AVAILABLE', version: 'CAPTURED_EXECUTION_FX_V1', source: 'COINBASE_SOL_USD_LAST_TRADE',
      feedId: 'SOL-USD', rate: '112.65', fxAt: '2026-10-12T07:31:50.281600029Z',
      requestedAt: '2026-10-12T07:31:52.000Z', retrievedAt: '2026-10-12T07:31:52.120Z',
      fillTimestamp: '2026-10-12T07:31:52.002Z', sourceObservationId: '357441178', responseHash: 'a'.repeat(64) } } as Trade;
  return [buy, sell];
}
describe('archived execution-window chart references', () => {
  it('recovers the BI-shaped BUY from trusted nearby archived evidence without changing either record', () => {
    const [buy, sell] = records(), before = JSON.stringify([buy, sell]);
    expect(chartFxReference(buy, [buy, sell])).toMatchObject({ fx: sell.sol_usd_fx,
      provenance: { kind: 'ARCHIVED_NEARBY_CAPTURE', sourceFillId: 'sell', targetFillId: 'buy',
        sourceOffsetMs: 3053, originalReason: 'STALE_CAPTURED_FX' } });
    expect(JSON.stringify([buy, sell])).toBe(before);
    const plan = historicalTrades([buy, sell], 'owner', 'mint', buy.token_supply_base_units, 6);
    expect(plan.drawings.map(d => d.kind).sort()).toEqual(['BUY', 'BUY_AVG', 'SELL', 'SELL_AVG']);
    expect(plan.diagnostics.fxReferences).toContainEqual(expect.objectContaining({ sourceFillId: 'sell', targetFillId: 'buy' }));
  });
  it('replays the same reference for current AVG with partial basis removal and removes it after full exit', () => {
    const [buy, sell] = records(); sell.base_quantity = '7652098234792';
    sell.cost_basis_lamports_removed = '491958722';
    const p = { mint: 'mint', tokenQuantityBaseUnits: '7652098234792', costBasisPaperSolLamports: '491958723', tokenDecimals: 6 } as Position;
    const avg = usdAverageEntry([buy, sell], p, 'round', buy.token_supply_base_units, 6);
    expect(avg.marketCapUsd).toBeDefined();
    expect(avg.details.fills).toEqual([expect.objectContaining({ fxReference: expect.objectContaining({ sourceFillId: 'sell' }) })]);
    sell.base_quantity = buy.base_quantity; delete sell.cost_basis_lamports_removed;
    expect(usdAverageEntry([buy, sell], p, 'round', buy.token_supply_base_units, 6).reason).toBe('NO_OPEN_POSITION');
  });
  it('tolerates delayed metadata and deduplicates restoration without contacting a current provider', () => {
    const [buy, sell] = records();
    expect(chartFxReference(buy, [buy])).toEqual({ reason: 'STALE_CAPTURED_FX' });
    const restored = JSON.parse(JSON.stringify([buy, sell, sell])) as Trade[];
    const plan = historicalTrades(restored, 'owner', 'mint', buy.token_supply_base_units, 6);
    expect(plan.drawings).toHaveLength(4);
    expect(new Set(plan.drawings.map(d => d.id)).size).toBe(4);
  });
  it.each(['owner_user_id', 'competition_account_id', 'hourly_round_id', 'mint_address'] as const)(
    'never borrows across %s', key => {
      const [buy, sell] = records(); sell[key] = 'foreign';
      expect(chartFxReference(buy, [sell])).toEqual({ reason: 'STALE_CAPTURED_FX' });
    });
  it.each(['fxAt', 'retrievedAt', 'fillTimestamp', 'requestedAt'] as const)('rejects mismatched/stale %s', key => {
    const [buy, sell] = records(); if (sell.sol_usd_fx?.status === 'AVAILABLE')
      sell.sol_usd_fx[key] = '2026-10-12T07:32:00.000Z';
    expect(chartFxReference(buy, [sell])).toEqual({ reason: 'STALE_CAPTURED_FX' });
  });
  it.each(['version', 'source', 'feedId', 'sourceObservationId', 'responseHash'] as const)(
    'requires trusted donor provenance %s', key => {
      const [buy, sell] = records(); if (sell.sol_usd_fx?.status === 'AVAILABLE') sell.sol_usd_fx[key] = 'wrong';
      expect(chartFxReference(buy, [sell])).toEqual({ reason: 'STALE_CAPTURED_FX' });
    });
  it('does not mask an invalid AVAILABLE own record or repair an unrelated later cycle', () => {
    const [buy, sell] = records(); buy.sol_usd_fx = { ...sell.sol_usd_fx, requestedAt: 'invalid' } as NonNullable<Trade['sol_usd_fx']>;
    expect(chartFxReference(buy, [sell])).toEqual({ reason: 'INVALID_HISTORICAL_FX' });
    buy.sol_usd_fx = { status: 'UNAVAILABLE', reason: 'HISTORICAL_FX_NOT_CAPTURED' };
    buy.executed_at = '2026-10-12T07:20:00.000Z';
    expect(chartFxReference(buy, [sell])).toEqual({ reason: 'HISTORICAL_FX_NOT_CAPTURED' });
  });
  it('accepts equivalent ticker/tape serialization but rejects contradictory values for one exchange trade', () => {
    const [buy, sell] = records(), other = { ...sell, id: 'other' };
    if (sell.sol_usd_fx?.status !== 'AVAILABLE') throw Error('fixture');
    other.sol_usd_fx = { ...sell.sol_usd_fx, fxAt: '2026-10-12T07:31:50.281600Z', responseHash: 'b'.repeat(64) };
    expect(chartFxReference(buy, [sell, other])).toHaveProperty('rateUnits');
    other.sol_usd_fx.rate = '120';
    expect(chartFxReference(buy, [sell, other])).toEqual({ reason: 'CONTRADICTORY_ARCHIVED_FX' });
  });
});
