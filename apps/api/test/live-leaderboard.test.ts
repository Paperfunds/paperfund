import { expect, it, vi } from 'vitest';
import { identifier, paperSolBaseUnits, utcInstant } from '@paperfund/core';
import {
  ExecutionRouter,
  marketStateFingerprint,
  type ProtocolAdapter,
} from '@paperfund/execution';
import { buildLiveStandings } from '../src/live-leaderboard.js';
import { CompetitionService } from '../src/competition.js';

const now = new Date('2026-09-30T12:30:00Z');
const round = {
  id: 'round',
  starts_at: new Date('2026-09-30T12:00:00Z'),
  ends_at_exclusive: new Date('2026-09-30T13:00:00Z'),
  state: 'OPEN',
};
const position = {
  market: 'pool',
  venue: 'REFERENCE',
  mint: 'mint',
  quantity: '100',
  basis: '100',
};
const account = (id: string, cash = '1000', positions: (typeof position)[] = []) => ({
  user_id: id,
  wallet_address: `wallet:${id}`,
  cash,
  starting: '1000',
  slots: positions.length,
  positions,
});

function fixture(accounts = [account('a'), account('b')]) {
  let state = 'OPEN';
  let active = 0;
  let maximumActive = 0;
  const load = vi.fn(async (identity: Parameters<ProtocolAdapter['loadMarketState']>[0]) => {
    maximumActive = Math.max(maximumActive, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return {
      identity,
      observedAt: utcInstant(now),
      chainSlot: 1n,
      chainBlockId: null,
      adapterVersion: 'test',
      normalizationVersion: 'test',
      normalizedState: {},
    };
  });
  const adapter: ProtocolAdapter = {
    protocolId: identifier('REFERENCE', 'ProtocolId'),
    adapterVersion: 'test',
    loadMarketState: load,
    async simulateBuy() {
      throw new Error('read-only');
    },
    async simulateSell() {
      throw new Error('read-only');
    },
    async valuePositionForExit(request, snapshot) {
      return {
        identity: request.identity,
        tokenQuantity: request.tokenQuantity,
        paperSolValue: paperSolBaseUnits(request.tokenQuantity * 2n),
        feeBreakdown: { fees: [], totalPaperSolFees: paperSolBaseUnits(0n) },
        marketStateFingerprint: marketStateFingerprint(snapshot),
        adapterVersion: 'test',
      };
    },
  };
  const query = vi.fn(async (sql: string) => {
    if (!sql.trimStart().startsWith('select'))
      throw new Error('Live standings must never write rewards/payouts or financial state');
    if (sql.includes('from competition_accounts ca join users')) return { rows: accounts };
    if (sql.includes('select state from hourly_rounds')) return { rows: [{ state }] };
    if (sql.includes('from hourly_rounds')) return { rows: [{ ...round, state }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const database = { pool: { query } } as never;
  const router = new ExecutionRouter([adapter]);
  return {
    accounts,
    database,
    router,
    query,
    load,
    adapter,
    maxActive: () => maximumActive,
    setState: (value: string) => {
      state = value;
    },
    service: new CompetitionService(database, router, () => now),
  };
}

it('ranks two or more accounts exactly, shares tie ranks, and reflects BUY/SELL account snapshots', async () => {
  const f = fixture([account('a'), account('b'), account('c', '900')]);
  let board = await buildLiveStandings(f.database, f.router, 'round');
  expect(board.entries.map((row) => [row.user_id, row.rank, row.tied])).toEqual([
    ['a', 1, true],
    ['b', 1, true],
    ['c', 3, false],
  ]);
  f.accounts[1] = account('b', '850', [position]); // After BUY: cash plus full-exit value, not cost basis.
  board = await buildLiveStandings(f.database, f.router, 'round');
  expect(board.entries[0]).toMatchObject({
    user_id: 'b',
    rank: 1,
    score: '50',
    equityLamports: '1050',
    openPositions: 1,
    slotsUsed: 1,
  });
  f.accounts[1] = account('b', '950'); // After SELL: no stale position value.
  board = await buildLiveStandings(f.database, f.router, 'round');
  expect(board.entries.map((row) => row.user_id)).toEqual(['a', 'b', 'c']);
});

it('deduplicates same-market snapshots and limits concurrent independent market reads to four', async () => {
  const f = fixture(
    Array.from({ length: 12 }, (_, i) =>
      account(String(i), '900', [{ ...position, market: String(i % 6) }]),
    ),
  );
  const board = await buildLiveStandings(f.database, f.router, 'round');
  expect(board.status).toBe('AVAILABLE');
  expect(f.load).toHaveBeenCalledTimes(6);
  expect(f.maxActive()).toBeLessThanOrEqual(4);
});

it('hides all ranks if one position cannot be valued and never fabricates a cash-only score', async () => {
  const f = fixture([account('a'), account('b', '900', [position])]);
  f.load.mockRejectedValueOnce(new Error('RPC unavailable'));
  expect(await buildLiveStandings(f.database, f.router, 'round')).toMatchObject({
    status: 'UNAVAILABLE',
    entries: [],
  });
});

it('coalesces polling, transitions LIVE to SETTLING to authoritative FINALIZED and performs no writes', async () => {
  const f = fixture();
  const final = { round, entries: [{ user_id: 'a', score: '1', rank: 1 }] };
  vi.spyOn(f.service, 'hourlyLeaderboard').mockResolvedValue(final as never);
  const [a, b] = await Promise.all([
    f.service.liveHourlyLeaderboard('round'),
    f.service.liveHourlyLeaderboard('round'),
  ]);
  expect(a?.phase).toBe('LIVE');
  expect(b?.entries).toEqual(a?.entries);
  expect(
    f.query.mock.calls.filter(([sql]) => sql.includes('from competition_accounts ca join users')),
  ).toHaveLength(1);
  f.setState('SETTLING');
  expect(await f.service.liveHourlyLeaderboard('round')).toMatchObject({
    phase: 'SETTLING',
    entries: [],
  });
  f.setState('FINALIZED');
  expect(await f.service.liveHourlyLeaderboard('round')).toMatchObject({
    phase: 'FINALIZED',
    entries: final.entries,
  });
  expect(f.query.mock.calls.every(([sql]) => sql.trimStart().startsWith('select'))).toBe(true);
});

it('bounds participant workload rather than ranking a truncated field', async () => {
  const f = fixture(Array.from({ length: 1001 }, (_, i) => account(String(i))));
  expect(await buildLiveStandings(f.database, f.router, 'round')).toMatchObject({
    status: 'UNAVAILABLE',
    reason: 'LIVE_CAPACITY_LIMIT',
    entries: [],
  });
  expect(f.load).not.toHaveBeenCalled();
});
