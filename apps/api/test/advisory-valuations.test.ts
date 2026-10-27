import { afterEach, describe, expect, it, vi } from 'vitest';
import { identifier, paperSolBaseUnits, utcInstant } from '@paperfund/core';
import {
  ExecutionRouter,
  marketStateFingerprint,
  type ProtocolAdapter,
  type MarketState,
  type MarketIdentity,
} from '@paperfund/execution';
import { advisoryReadContext } from '@paperfund/protocols';
import { AdvisoryValuations } from '../src/advisory-valuations.js';
import { CompetitionService } from '../src/competition.js';
import type { DatabaseService } from '@paperfund/db';
const mint = '3n51PDRJaKKJQyFA2zeqHNKvMavTsbd8RyoAJcHPpump';
const identity = {
  protocolId: identifier('PUMP_SWAP', 'ProtocolId'),
  marketId: identifier('pool', 'MarketId'),
  tokenMint: identifier(mint, 'TokenMint'),
};
function state(slot = 10n): MarketState {
  return {
    identity,
    observedAt: utcInstant(new Date().toISOString()),
    chainSlot: slot,
    chainBlockId: null,
    adapterVersion: 'test',
    normalizationVersion: 'test',
    normalizedState: { reserve: '10000', chainTime: new Date().toISOString() },
  };
}
function fixture(load = vi.fn(async () => state())) {
  const adapter: ProtocolAdapter = {
    protocolId: identity.protocolId,
    adapterVersion: 'test',
    loadMarketState: load,
    simulateBuy: async () => {
      throw Error('unused');
    },
    simulateSell: async () => {
      throw Error('unused');
    },
    valuePositionForExit: async (request, s) => ({
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(request.tokenQuantity * 2n),
      feeBreakdown: { fees: [], totalPaperSolFees: paperSolBaseUnits(0n) },
      marketStateFingerprint: marketStateFingerprint(s),
      adapterVersion: 'test',
    }),
  };
  const router = new ExecutionRouter([adapter]);
  return { load, router, broker: new AdvisoryValuations(router) };
}
afterEach(() => vi.useRealTimers());
describe('advisory capture separation and bounded admission', () => {
  it('shares snapshots between viewed/preflight requests but leaves authoritative state loading uncached', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      f.broker.preflight(identity, 10n, 10n, 'viewed'),
      f.broker.preflight(identity, 20n, 10n),
    ]);
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(a.exit.full.outputLamports).toBe(20n);
    expect(b.exit.full.outputLamports).toBe(40n);
    await f.router.loadPositionRoute(identity);
    expect(f.load).toHaveBeenCalledTimes(2);
    expect(advisoryReadContext()).toBeUndefined();
  });
  it('does not share mutable state objects across consumers', async () => {
    const f = fixture();
    const first = await f.broker.capture(identity, 'viewed');
    (first.route.state.normalizedState as Record<string, unknown>).reserve = 'corrupt';
    const next = await f.broker.capture(identity, 'viewed');
    expect(next.route.state.normalizedState.reserve).toBe('10000');
  });
  it('rejects older slots after the short advisory cache expires', async () => {
    vi.useFakeTimers();
    const f = fixture(vi.fn().mockResolvedValueOnce(state(20n)).mockResolvedValueOnce(state(19n)));
    await f.broker.capture(identity, 'viewed');
    await vi.advanceTimersByTimeAsync(251);
    await expect(f.broker.capture(identity, 'viewed')).rejects.toThrow('SNAPSHOT_SLOT_REGRESSION');
  });
  it('reserves capacity for viewed requests without an unbounded queue', async () => {
    const finishes: Array<(s: MarketState) => void> = [];
    const f = fixture(vi.fn(() => new Promise<MarketState>((r) => finishes.push(r))));
    const a = f.broker.capture(identity, 'background');
    const secondId = { ...identity, marketId: identifier('other', 'MarketId') };
    const b = f.broker.capture(secondId, 'background');
    await expect(
      f.broker.capture({ ...identity, marketId: identifier('third', 'MarketId') }, 'background'),
    ).rejects.toThrow('ADVISORY_BUSY');
    const c = f.broker.capture(
      { ...identity, marketId: identifier('viewed', 'MarketId') },
      'viewed',
    );
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(f.load).toHaveBeenCalledTimes(3);
    finishes.forEach((r, i) =>
      r({
        ...state(),
        identity:
          i === 0
            ? identity
            : i === 1
              ? secondId
              : { ...identity, marketId: identifier('viewed', 'MarketId') },
      }),
    );
    await Promise.all([a, b, c]);
  });
  it('cancels only the final shared consumer and enforces a capture deadline', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const f = fixture(
      vi.fn(() => {
        signal = advisoryReadContext()!.signal;
        return new Promise<MarketState>(() => {});
      }),
    );
    const ctrl = new AbortController();
    const a = f.broker.capture(identity, 'viewed', ctrl.signal),
      b = f.broker.capture(identity, 'viewed');
    const ae = expect(a).rejects.toThrow();
    ctrl.abort();
    await ae;
    expect(signal.aborted).toBe(false);
    const be = expect(b).rejects.toThrow('ADVISORY_DEADLINE_EXCEEDED');
    await vi.advanceTimersByTimeAsync(2200);
    await be;
    expect(signal.aborted).toBe(true);
    expect(f.broker.concurrent).toBe(0);
  });
});
function row() {
  return {
    account_id: 'account',
    round_id: 'round',
    round_state: 'OPEN',
    ends_at: new Date(Date.now() + 60000),
    id: 'position',
    market_id: 'pool',
    venue: 'PUMP_SWAP',
    decimals: 6,
    quantity: '10',
    basis: '10',
    realized: '2',
    updated_at: new Date(),
    financial_version: '1',
  };
}
it('returns exact quantities, slot/revision and denies another owner without RPC', async () => {
  const f = fixture();
  const original = row();
  const query = vi.fn(async (config: { values: unknown[] }) => ({
    rows: config.values[0] === 'owner' ? [original] : [],
  }));
  const service = new CompetitionService(
    { pool: { query } } as unknown as DatabaseService,
    f.router,
  );
  const response = await service.viewedPosition('owner', mint);
  expect(response).toMatchObject({
    status: 'AVAILABLE',
    accountId: 'account',
    roundId: 'round',
    position: { tokenQuantityBaseUnits: '10', valuation: { executablePaperSolLamports: 20n } },
    chainSlot: 10n,
  });
  expect(response.revision).toHaveLength(64);
  const foreign = await service.viewedPosition('foreign', mint);
  expect(foreign.position).toBeNull();
  expect(f.load).toHaveBeenCalledTimes(1);
});
it('rejects a position changed in another tab during capture', async () => {
  const f = fixture();
  let reads = 0;
  const original = row();
  const query = vi.fn(async () => ({
    rows: [++reads === 1 ? original : { ...original, quantity: '20' }],
  }));
  const service = new CompetitionService(
    { pool: { query } } as unknown as DatabaseService,
    f.router,
  );
  expect(await service.viewedPosition('owner', mint)).toMatchObject({
    status: 'UNAVAILABLE',
    reason: 'POSITION_REVISION_CHANGED',
    position: { tokenQuantityBaseUnits: '20', valuation: { status: 'UNAVAILABLE' } },
  });
});
it('rejects hourly rollover during capture', async () => {
  const f = fixture();
  let reads = 0;
  const original = row();
  const query = vi.fn(async () => ({ rows: ++reads === 1 ? [original] : [] }));
  const service = new CompetitionService(
    { pool: { query } } as unknown as DatabaseService,
    f.router,
  );
  expect(await service.viewedPosition('owner', mint)).toMatchObject({
    status: 'ROUND_CLOSED',
    position: null,
  });
});

it('keeps a slow unrelated holding out of viewed-position completion', async () => {
  let release!: (s: MarketState) => void;
  const f = fixture(
    vi.fn(async (requested: MarketIdentity) =>
      requested.tokenMint === mint ? state() : await new Promise<MarketState>((r) => (release = r)),
    ),
  );
  const other = { ...identity, tokenMint: identifier('other', 'TokenMint') };
  const slow = f.broker.capture(other, 'background');
  const fast = await f.broker.preflight(identity, 10n, 10n, 'viewed');
  expect(fast.exit.full.outputLamports).toBe(20n);
  expect(f.broker.concurrent).toBe(1);
  release({ ...state(), identity: other });
  await slow;
});
it('shares compatible snapshots with leaderboard valuation without caching execution', async () => {
  const f = fixture();
  const snapshot = await f.broker.router().loadPositionRoute(identity);
  const view = await f.broker.preflight(identity, 10n, 10n, 'viewed');
  expect(snapshot.state.chainSlot).toBe(view.exit.chainSlot);
  expect(f.load).toHaveBeenCalledTimes(1);
});

it('does not mistake a recent RPC receipt for a fresh on-chain bank snapshot', async () => {
  const f = fixture(
    vi.fn(async () => ({
      ...state(),
      normalizedState: { reserve: '10000', chainTime: new Date(Date.now() - 10000).toISOString() },
    })),
  );
  const original = row();
  const service = new CompetitionService(
    { pool: { query: async () => ({ rows: [original] }) } } as unknown as DatabaseService,
    f.router,
  );
  expect(await service.viewedPosition('owner', mint)).toMatchObject({
    status: 'UNAVAILABLE',
    reason: 'SNAPSHOT_FRESHNESS_UNAVAILABLE',
  });
});

it('bounds physical SQL waiters even after advisory callers time out', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const query = vi.fn(() => new Promise(() => {}));
  const service = new CompetitionService(
    { pool: { query } } as unknown as DatabaseService,
    f.router,
  );
  const calls = Array.from({ length: 8 }, () =>
    service.viewedPosition('owner', mint).catch((error) => error.message),
  );
  await expect(service.viewedPosition('owner', mint)).rejects.toThrow('ADVISORY_SQL_BUSY');
  await vi.advanceTimersByTimeAsync(600);
  expect(await Promise.all(calls)).toEqual(Array(8).fill('ADVISORY_SQL_TIMEOUT'));
  await expect(service.viewedPosition('owner', mint)).rejects.toThrow('ADVISORY_SQL_BUSY');
  expect(query).toHaveBeenCalledTimes(8);
});
