import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '@paperfund/db';
import { ExecutionRouter } from '@paperfund/execution';
import { CompetitionService } from '../src/competition.js';

describe('mint-scoped persisted fill history', () => {
  it('keeps user scoping and mint filtering on every cursor page, with token decimals', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const service = new CompetitionService(
      { pool: { query } } as unknown as DatabaseService,
      new ExecutionRouter(),
    );
    const mint = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
    await service.trades('user-a', { limit: 100 }, mint);
    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/where ca.user_id = \$1\s+and a.mint_address = \$3/),
      ['user-a', 101, mint],
    ]);
    const cursor = Buffer.from(
      JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', id: 'fill' }),
    ).toString('base64url');
    await service.trades('user-a', { limit: 100, cursor }, mint);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('a.mint_address = $5'),
      ['user-a', 101, '2026-10-01T00:00:00Z', 'fill', mint],
    ]);
    expect(query.mock.calls[1]?.[0]).toContain('a.decimals as token_decimals');
    expect(query.mock.calls[1]?.[0]).toContain('ca.id as competition_account_id');
    expect(query.mock.calls[1]?.[0]).toContain('j.competition_account_id=ca.id');
  });
});

it('serializes optional evidence arriving after an initial PumpSwap history read, without fetching FX', async () => {
  const time = new Date('2026-10-09T15:28:44.052Z');
  const mint = '3n51PDRJaKKJQyFA2zeqHNKvMavTsbd8RyoAJcHPpump';
  let saved = false;
  const evidence = {
    status: 'AVAILABLE',
    version: 'CAPTURED_EXECUTION_FX_V1',
    source: 'COINBASE_SOL_USD_LAST_TRADE',
    rate: '109.33',
    fxAt: '2026-10-09T15:28:43Z',
    requestedAt: '2026-10-09T15:28:44Z',
    retrievedAt: '2026-10-09T15:28:44Z',
  };
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('from fills f')
      ? [
          {
            id: 'buy',
            executed_at: time,
            mint_address: mint,
            side: 'BUY',
            protocol_id: 'PUMP_SWAP',
            owner_user_id: 'user',
            competition_account_id: 'account',
            hourly_round_id: 'round',
            base_quantity: '2523552150633',
            actual_input_lamports: '976324365',
            token_decimals: 6,
            chart_state: null,
          },
        ]
      : sql.includes('select evidence') && saved
        ? [{ evidence }]
        : [],
  }));
  const lookup = vi.fn();
  const service = new CompetitionService(
    { pool: { query } } as unknown as DatabaseService,
    new ExecutionRouter(),
    () => time,
    undefined,
    { lookup },
  );
  expect((await service.trades('user', { limit: 100 }, mint)).items[0]?.sol_usd_fx).toEqual({
    status: 'UNAVAILABLE',
    reason: 'HISTORICAL_FX_NOT_CAPTURED',
  });
  saved = true;
  expect((await service.trades('user', { limit: 100 }, mint)).items[0]).toMatchObject({
    sol_usd_fx: evidence,
    actual_input_lamports: '976324365',
    base_quantity: '2523552150633',
  });
  expect(lookup).not.toHaveBeenCalled();
});
