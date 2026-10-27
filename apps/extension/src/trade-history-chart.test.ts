import { describe, expect, it } from 'vitest';
import type { Trade } from '@paperfund/shared/browser';
import { historicalTrades } from './trade-history-chart.js';
function fill(
  id: string,
  side: 'BUY' | 'SELL',
  q: string,
  sol: string,
  rate = '100',
  round = 'round',
): Trade {
  const t = new Date(Date.parse('2026-10-08T12:00:00Z') + Number(id) * 1000).toISOString();
  return {
    id,
    order_id: 'order-' + id,
    execution_context: 'NORMAL_USER',
    protocol_id: 'PUMP_FUN',
    quote_lamports: sol,
    fee_lamports: '0',
    realized_pnl_lamports: '0',
    side,
    base_quantity: q,
    actual_input_lamports: side === 'BUY' ? sol : null,
    actual_output_lamports: side === 'SELL' ? sol : null,
    competition_account_id: 'account-' + round,
    owner_user_id: 'user',
    hourly_round_id: round,
    mint_address: 'mint',
    token_decimals: 0,
    token_supply_base_units: '1000',
    executed_at: t,
    sol_usd_fx: {
      status: 'AVAILABLE',
      version: 'CAPTURED_EXECUTION_FX_V1',
      source: 'COINBASE_SOL_USD_LAST_TRADE',
      rate,
      requestedAt: t,
      fxAt: t,
      retrievedAt: t,
    },
  } as Trade;
}
const plan = (fills: Trade[]) => historicalTrades(fills, 'user', 'mint', '1000', 0);
describe('historical quantity-weighted USD cycles', () => {
  it('single BUY makes a BUY average and time-anchored native marker', () => {
    const result = plan([fill('1', 'BUY', '10', '1000000000')]);
    expect(result.drawings).toHaveLength(2);
    expect(result.drawings.find((d) => d.kind === 'BUY_AVG')?.levelUsd).toBe('10000');
    expect(result.drawings.find((d) => d.kind === 'BUY')?.time).toBe(
      Date.parse('2026-10-08T12:00:01Z') / 1000,
    );
  });
  it('weights actual SELL proceeds by sold quantity and retains history after complete exit', () => {
    const fills = [
      fill('1', 'BUY', '10', '1000000000'),
      fill('2', 'SELL', '2', '200000000'),
      fill('3', 'SELL', '8', '800000000', '200'),
    ];
    const result = plan(fills);
    // (20+160) USD / 10 tokens * 1000 supply = 18000, rather than the unweighted cap mean of 15000.
    expect(result.drawings.find((d) => d.kind === 'SELL_AVG')?.levelUsd).toBe('18000');
    expect(result.drawings.filter((d) => d.kind === 'SELL')).toHaveLength(2);
    expect(result.drawings.find((d) => d.kind === 'BUY_AVG')).toBeDefined();
  });
  it('separates a rebuy cycle and round reset, survives JSON restoration and deduplicates fills', () => {
    const fills = [
      fill('1', 'BUY', '10', '1000000000'),
      fill('2', 'SELL', '10', '1000000000'),
      fill('3', 'BUY', '20', '1000000000'),
      fill('4', 'BUY', '5', '1000000000', '100', 'next'),
    ];
    const result = plan(JSON.parse(JSON.stringify([...fills, fills[0]])));
    expect(result.diagnostics.cycles).toBe(3);
    expect(new Set(result.drawings.map((d) => d.id)).size).toBe(result.drawings.length);
    expect(result.drawings.filter((d) => d.kind === 'BUY_AVG').map((d) => d.levelUsd)).toEqual([
      '10000',
      '5000',
      '20000',
    ]);
  });
  it('omits unpriced averages, does not fabricate SELLs for write-offs and fails closed on incomplete history', () => {
    const buy = fill('1', 'BUY', '10', '1000000000');
    buy.chart_closures = [{ id: 'writeoff', quantity: '10', at: '2026-10-08T13:00:00Z' }];
    expect(plan([buy]).drawings.some((d) => d.kind.startsWith('SELL'))).toBe(false);
    const sell = fill('2', 'SELL', '10', '1000000000');
    sell.sol_usd_fx = { status: 'UNAVAILABLE', reason: 'HISTORICAL_FX_NOT_CAPTURED' };
    const result = plan([buy, sell]);
    expect(result.drawings.some((d) => d.kind === 'SELL_AVG')).toBe(false);
    expect(result.diagnostics.unavailable).toContain('HISTORICAL_FX_NOT_CAPTURED');
    expect(plan([fill('2', 'SELL', '11', '1')]).drawings).toHaveLength(0);
  });
  it('never crosses token/account scope and limits rendering without deleting the input history', () => {
    const wrong = fill('1', 'BUY', '1', '1');
    wrong.mint_address = 'other';
    expect(plan([wrong]).drawings).toHaveLength(0);
    const foreign = fill('9', 'BUY', '1', '1');
    foreign.owner_user_id = 'other';
    expect(plan([foreign]).drawings).toHaveLength(0);
    const unscoped = fill('2', 'BUY', '1', '1');
    delete unscoped.competition_account_id;
    expect(plan([unscoped]).diagnostics.unavailable).toContain(
      'HISTORICAL_ACCOUNT_SCOPE_UNAVAILABLE',
    );
    const many = Array.from({ length: 60 }, (_, i) =>
      fill(String(i + 1), 'BUY', '1', '1000000000'),
    );
    const result = plan(many);
    expect(result.drawings.filter((d) => d.kind === 'BUY')).toHaveLength(50);
    expect(many).toHaveLength(60);
  });
});

it('keeps an actual partial SELL average through a forced write-off and excludes rejected intents', () => {
  const buy = fill('1', 'BUY', '10', '1000000000');
  buy.chart_closures = [{ id: 'forced-close', quantity: '8', at: '2026-10-08T13:00:00Z' }];
  const result = plan([buy, fill('2', 'SELL', '2', '200000000')]);
  expect(result.drawings.filter((d) => d.kind === 'SELL')).toHaveLength(1);
  expect(result.drawings.find((d) => d.kind === 'SELL_AVG')?.levelUsd).toBe('10000');
  const rejected = { ...fill('3', 'BUY', '5', '1000000000'), side: 'REJECTED' } as unknown as Trade;
  expect(plan([rejected]).drawings).toHaveLength(0);
});

it('explains the observed PumpSwap stale BUY and priced SELL, then restores BUY after delayed evidence', () => {
  const buy = fill('1', 'BUY', '2523552150633', '976324365');
  const sell = fill('2', 'SELL', '2523552150633', '840552228', '109.33');
  for (const f of [buy, sell]) {
    f.protocol_id = 'PUMP_SWAP';
    f.token_decimals = 6;
    f.token_supply_base_units = '950543882019389';
  }
  const fx = buy.sol_usd_fx!;
  buy.sol_usd_fx = { status: 'UNAVAILABLE', reason: 'STALE_CAPTURED_FX' };
  const compute = () => historicalTrades([buy, sell], 'user', 'mint', '950543882019389', 6);
  const missing = compute();
  expect(missing.diagnostics.cycles).toBe(1);
  expect(missing.drawings.map((d) => d.kind)).toEqual(['SELL_AVG', 'SELL']);
  expect(missing.diagnostics.unavailableDrawings).toEqual([
    expect.objectContaining({ fillId: '1', kind: 'BUY', reason: 'STALE_CAPTURED_FX' }),
    expect.objectContaining({ fillId: '1', kind: 'BUY_AVG', reason: 'STALE_CAPTURED_FX' }),
  ]);
  // Independent fixture: late valid evidence, not a repair of the immutable live failure.
  buy.sol_usd_fx = fx;
  expect(compute().drawings.map((d) => d.kind)).toEqual(['BUY_AVG', 'SELL_AVG', 'BUY', 'SELL']);
});
it('weights multiple BUYs and reports the exact fill missing SOL amounts or invalid FX', () => {
  const buys = [fill('1', 'BUY', '10', '1000000000'), fill('2', 'BUY', '20', '2000000000', '200')];
  expect(plan(buys).drawings.find((d) => d.kind === 'BUY_AVG')?.levelUsd).toBe(
    '16666.666666666666666666666666666',
  );
  buys[1]!.actual_input_lamports = null;
  expect(plan(buys).diagnostics.unavailableDrawings).toContainEqual(
    expect.objectContaining({ fillId: '2', reason: 'ACTUAL_FILL_SOL_AMOUNT_UNAVAILABLE' }),
  );
  buys[1]!.actual_input_lamports = '2000000000';
  buys[1]!.sol_usd_fx = {
    ...buys[0]!.sol_usd_fx!,
    status: 'AVAILABLE',
    rate: '0',
  } as NonNullable<Trade['sol_usd_fx']>;
  expect(plan(buys).diagnostics.unavailable).toContain('INVALID_HISTORICAL_FX');
});

it('keeps an unpriced first PumpSwap BUY separate from a priced rebuy of the exact same mint', () => {
  const fills = [
    fill('1', 'BUY', '2523552150633', '976324365'),
    fill('2', 'SELL', '2523552150633', '840552228', '109.33'),
    fill('3', 'BUY', '1632383768618', '481373575', '109.68'),
    fill('4', 'SELL', '1632383768618', '489226709', '109.66'),
  ];
  fills[0]!.sol_usd_fx = { status: 'UNAVAILABLE', reason: 'STALE_CAPTURED_FX' };
  for (const f of fills) {
    f.protocol_id = 'PUMP_SWAP';
    f.token_decimals = 6;
    f.token_supply_base_units = '950543882019389';
  }
  const result = historicalTrades(fills, 'user', 'mint', '950543882019389', 6);
  expect(result.diagnostics.cycles).toBe(2);
  expect(result.drawings.filter((d) => d.cycleId === '1').map((d) => d.kind)).toEqual([
    'SELL_AVG',
    'SELL',
  ]);
  expect(result.drawings.filter((d) => d.cycleId === '3').map((d) => d.kind)).toEqual([
    'BUY_AVG',
    'SELL_AVG',
    'BUY',
    'SELL',
  ]);
  expect(result.drawings.find((d) => d.kind === 'BUY_AVG')?.levelUsd).toBe(
    '30743.944747365100553017752047528',
  );
  expect(result.drawings.filter((d) => d.kind === 'SELL')).toHaveLength(2);
  expect(result.diagnostics.unavailableDrawings?.map((d) => d.fillId)).toEqual(['1', '1']);
});

// Read-only fixture copied from the preserved emoji butt executions; no database mutation.
const emojiMint = '9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump';
function emojiFills(): Trade[] {
  return (['BUY', 'SELL'] as const).map((side, i) => {
    const t = ['2026-10-09T20:03:36.717Z', '2026-10-09T20:04:47.845Z'][i]!;
    const f = fill(String(i + 1), side, '3924958318471', ['988623928', '939232797'][i]!, ['108.65', '108.56'][i]!);
    return { ...f, id: ['authoritative-buy-fill:5adce649407ff17cca7c2e68fdd85e06e9f3a3ec15f671b86dcddd79bfc61a08','authoritative-sell-all-fill:9cfec74961551c3decaf2ee61d3f60d44bddc1246ce7d7040f833fc2eb7e3977'][i]!, mint_address: emojiMint, executed_at: t, token_decimals: 6,
      protocol_id: 'SOLANA_ROUTE', token_supply_base_units: '1000000000000000',
      hourly_round_id: 'hourly:2026-10-09T20:00:00.000Z',
      sol_usd_fx: { ...f.sol_usd_fx!, status: 'AVAILABLE', rate: ['108.65', '108.56'][i]!,
        requestedAt: t.slice(0, 19) + '.000Z', fillTimestamp: t,
        fxAt: ['2026-10-09T20:03:36.503011588Z','2026-10-09T20:04:47.437938911Z'][i]!,
        retrievedAt: ['2026-10-09T20:03:36.830Z','2026-10-09T20:04:47.977Z'][i]! } } as Trade;
  });
}
it.each(['GOOGLx', 'PUMP', 'WSOL', 'bonding curve'])('history is independent of current %s executable support', () => {
  const result = historicalTrades(emojiFills(), 'user', emojiMint, '975024561658805', 6);
  expect(result.drawings.map(d => d.kind)).toEqual(['BUY_AVG','SELL_AVG','BUY','SELL']);
  expect(result.drawings[0]?.levelUsd).toBe('27366.912222151701419257351876807');
  expect(result.drawings[1]?.levelUsd).toBe('25978.138917419274507030706690727');
  expect(result.drawings.filter(d => d.kind === 'BUY' || d.kind === 'SELL').map(d => d.time)).toEqual([1791576216,1791576287]);
  expect(historicalTrades(emojiFills(), 'user', emojiMint, null, 6).drawings).toEqual(result.drawings);
});
it('requires independent decimals and archived supply, never substitutes current supply', () => {
  const fills = emojiFills();
  expect(historicalTrades(fills,'user',emojiMint,null,undefined).diagnostics.unavailable).toContain('CHART_TOKEN_METADATA_MISSING');
  expect(historicalTrades(fills,'user',emojiMint,null,19).diagnostics.unavailable).toContain('INVALID_TOKEN_DECIMALS');
  expect(historicalTrades(fills,'user',emojiMint,null,5).diagnostics.unavailable).toContain('TOKEN_DECIMALS_MISMATCH');
  fills[0]!.token_supply_base_units = null;
  expect(historicalTrades(fills,'user',emojiMint,'1000000000000000',6).drawings.map(d => d.kind)).toEqual(['SELL_AVG','SELL']);
  expect(historicalTrades([],'user',emojiMint,null,undefined).drawings).toEqual([]);
});
it('quantity weights execution-time caps when supply changes within a cycle', () => {
  const fills = [fill('1','BUY','10','1000000000'),fill('2','BUY','20','2000000000')];
  fills[1]!.token_supply_base_units = '500';
  expect(plan(fills).drawings.find(d => d.kind === 'BUY_AVG')?.levelUsd).toBe('6666.666666666666666666666666666');
});
