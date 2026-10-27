import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { DatabaseService } from '@paperfund/db';
import { ExecutionRouter } from '@paperfund/execution';
const calls = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), sell: vi.fn(), all: vi.fn() }));
vi.mock('@paperfund/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executePaperBuy: calls.execute,
  executePaperSell: calls.sell,
  executePaperSellAll: calls.all,
}));
vi.mock('../src/chart-fx.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveCapturedFillFx: calls.save,
}));
import { CompetitionService } from '../src/competition.js';
const time = new Date('2026-10-08T18:10:16Z');
const mint = '8Wtg9wQCuDVLrQqH8pw2yKyvurmrjEeFcp9ysdDKpump';
function service(
  lookup = vi.fn(async () => ({ status: 'UNAVAILABLE' as const, reason: 'OUTAGE' })),
) {
  const database = {
    pool: { query: async () => ({ rows: [{ id: 'market', venue: 'PUMP_FUN' }] }) },
  } as unknown as DatabaseService;
  const s = new CompetitionService(database, new ExecutionRouter(), () => time, undefined, {
    lookup,
  });
  vi.spyOn(s, 'getCurrentAccount').mockResolvedValue({ id: 'account', positions: [] } as Awaited<
    ReturnType<CompetitionService['getCurrentAccount']>
  >);
  return { s, lookup };
}
beforeEach(() => {
  calls.execute.mockReset();
  calls.save.mockReset();
  calls.save.mockResolvedValue({ status: 'UNAVAILABLE', reason: 'OUTAGE' });
});
describe('optional chart capture around successful BUY', () => {
  it('keeps the same execution intent/result and saves evidence only after commit', async () => {
    const { s, lookup } = service();
    const result = { fillId: 'fill', executedAt: time };
    let committed = false;
    calls.execute.mockImplementation(async () => {
      await Promise.resolve();
      committed = true;
      return result;
    });
    calls.save.mockImplementation(async (_db, fillId, executedAt, quote) => {
      expect(committed).toBe(true);
      expect(fillId).toBe('fill');
      expect(executedAt).toBe(time);
      return await quote;
    });
    expect(await s.buy('user', { mint, paperSol: '1', idempotencyKey: 'order' })).toBe(result);
    expect(lookup).toHaveBeenCalledWith(time);
    expect(calls.execute).toHaveBeenCalledWith(
      s.database,
      s.router,
      expect.objectContaining({
        requestedPaperSolLamports: 1000000000n,
        authoritativeTimestamp: time,
      }),
    );
  });
  it('never reports a failed BUY because optional capture persistence failed after commit', async () => {
    const { s } = service();
    const result = { fillId: 'fill', executedAt: time };
    calls.execute.mockResolvedValue(result);
    calls.save.mockRejectedValue(new Error('display database unavailable'));
    expect(await s.buy('user', { mint, paperSol: '1', idempotencyKey: 'order' })).toBe(result);
  });
  it('does not write capture evidence for a rejected BUY', async () => {
    const { s } = service();
    calls.execute.mockRejectedValue(new Error('execution rejected'));
    await expect(s.buy('user', { mint, paperSol: '1', idempotencyKey: 'order' })).rejects.toThrow(
      'execution rejected',
    );
    expect(calls.save).not.toHaveBeenCalled();
  });
});

describe('optional successful SELL FX capture', () => {
  it.each(['ALL', '3'])(
    'captures %s SELL after commit without changing execution amounts',
    async (quantity) => {
      const { s, lookup } = service();
      vi.mocked(s.getCurrentAccount).mockResolvedValue({
        id: 'account',
        positions: [{ id: 'position', mint_address: mint, market_id: 'market' }],
      } as Awaited<ReturnType<CompetitionService['getCurrentAccount']>>);
      const result = { fillId: 'sell-fill', executedAt: time };
      calls.all.mockResolvedValue(result);
      calls.sell.mockResolvedValue(result);
      calls.save.mockRejectedValue(new Error('FX persistence unavailable'));
      expect(await s.sell('user', { mint, quantity, idempotencyKey: 'sell' })).toBe(result);
      expect(lookup).toHaveBeenCalledWith(time);
      expect(calls.save).toHaveBeenCalledWith(s.database, 'sell-fill', time, expect.any(Promise));
    },
  );
});

it.each(['BUY', 'SELL'])(
  'returns successful %s while optional FX persistence is still pending',
  async (side) => {
    const { s } = service();
    vi.mocked(s.getCurrentAccount).mockResolvedValue({
      id: 'account',
      positions: [{ id: 'position', mint_address: mint, market_id: 'market' }],
    } as Awaited<ReturnType<CompetitionService['getCurrentAccount']>>);
    const result = { fillId: 'fill', executedAt: time };
    calls.execute.mockResolvedValue(result);
    calls.all.mockResolvedValue(result);
    let finish!: (value: unknown) => void;
    calls.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const trade =
      side === 'BUY'
        ? s.buy('user', { mint, paperSol: '1', idempotencyKey: 'buy' })
        : s.sell('user', { mint, quantity: 'ALL', idempotencyKey: 'sell' });
    expect(await trade).toBe(result);
    expect(calls.save).toHaveBeenCalled();
    finish({ status: 'UNAVAILABLE', reason: 'OUTAGE' });
  },
);
