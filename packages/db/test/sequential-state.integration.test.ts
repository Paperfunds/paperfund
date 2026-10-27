import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { identifier } from '@paperfund/core';
import type { MarketState } from '@paperfund/execution';
import {
  DisposableSequentialStore,
  sequentialStateHash,
  type SandboxTrade,
} from '../experimental/sequential-state.js';
import {
  previewSequentialRoute,
  type SimulationScope,
} from '../../protocols/src/experimental/sequential-route.js';
import type { PoolLink, CapturedAccount } from '../../protocols/src/solana-routes.js';

loadDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });
interface Fixture {
  name: string;
  state: Omit<MarketState, 'chainSlot'> & { chainSlot: string };
  expected: {
    inputLamports: string;
    buyBaseUnits: string;
    fullSellLamports: string;
    split: { partialProceeds: string; remainingSellProceeds: string };
    repeated: {
      secondBuyBaseUnits: string;
      sellAll: string;
      rebuyBaseUnits: string;
      rebuyExit: string;
    };
  };
}
const fixtures = (
  JSON.parse(
    readFileSync(
      new URL('../../protocols/test/fixtures/sequential-liquidity.json', import.meta.url),
      'utf8',
    ),
  ) as { fixtures: Fixture[] }
).fixtures;
const state = (f: Fixture): MarketState => ({
  ...structuredClone(f.state),
  chainSlot: BigInt(f.state.chainSlot),
});
const dbName = `paperfund_seq_test_${process.pid}_${Date.now()}`;
let admin: Pool, pool: Pool, url: string, store: DisposableSequentialStore;
beforeAll(async () => {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL required for disposable PostgreSQL tests');
  const adminUrl = new URL(process.env.DATABASE_URL),
    testUrl = new URL(process.env.DATABASE_URL);
  adminUrl.pathname = '/postgres';
  testUrl.pathname = '/' + dbName;
  url = testUrl.toString();
  admin = new Pool({ connectionString: adminUrl.toString() });
  // The generated name is validated before creating or dropping this one disposable database.
  if (!/^paperfund_seq_test_\d+_\d+$/.test(dbName)) throw new Error('Unsafe test database name');
  await admin.query(`create database "${dbName}"`);
  pool = new Pool({ connectionString: url });
  await pool.query(
    readFileSync(new URL('./fixtures/sequential-state.sql', import.meta.url), 'utf8'),
  );
  await pool.query('create table legacy_fills(id text primary key,payload jsonb not null)');
  await pool.query('insert into legacy_fills values($1,$2::jsonb)', [
    'immutable-prior-fill',
    JSON.stringify({ quantity: '99', cash: '123', adapter: 'legacy' }),
  ]);
  store = new DisposableSequentialStore(pool);
}, 30000);
afterAll(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`drop database if exists "${dbName}"`);
    await admin.end();
  }
});
function scope(): SimulationScope {
  return { accountId: randomUUID(), roundId: randomUUID() };
}
function request(
  s: SimulationScope,
  f: Fixture,
  side: 'BUY' | 'SELL',
  amount: bigint | 'ALL',
  key = randomUUID(),
): SandboxTrade {
  return {
    ...s,
    marketId: f.state.identity.marketId,
    side,
    amount,
    requestKey: key,
    executionId: 'execution:' + key,
  };
}
async function snapshot(s: SimulationScope) {
  return {
    checkpoint: (
      await pool.query('select * from seq_states where account_id=$1 and round_id=$2', [
        s.accountId,
        s.roundId,
      ])
    ).rows,
    transitions: (
      await pool.query(
        'select * from seq_trades where account_id=$1 and round_id=$2 order by revision',
        [s.accountId, s.roundId],
      )
    ).rows,
    legacy: (await pool.query('select * from legacy_fills order by id')).rows,
  };
}

describe.each(fixtures)('durable isolated $name', (f) => {
  const spend = BigInt(f.expected.inputLamports),
    qty = BigInt(f.expected.buyBaseUnits),
    market = f.state.identity.marketId;
  it('commits BUY/SELL in separate transactions with exact hashes and complete replay', async () => {
    const s = scope(),
      initial = await store.initialize(s, [state(f)]);
    const buy = await store.trade(request(s, f, 'BUY', spend));
    const holding = await store.load(s);
    expect(buy.output).toBe(qty);
    expect(buy.beforeHash).toBe(sequentialStateHash(initial));
    expect(buy.afterHash).toBe(sequentialStateHash(holding));
    expect(holding.positions[market]!.quantity).toBe(qty);
    expect(previewSequentialRoute(holding.simulation, s, market, qty, false).output).toBe(
      BigInt(f.expected.fullSellLamports),
    );
    const sell = await store.trade(request(s, f, 'SELL', 'ALL')),
      closed = await store.load(s);
    expect(sell.output).toBe(BigInt(f.expected.fullSellLamports));
    expect(sell.beforeHash).toBe(buy.afterHash);
    expect(sell.afterHash).toBe(sequentialStateHash(closed));
    expect(sell.poolTransitions.map((t) => t.before)).toEqual(
      buy.poolTransitions.map((t) => t.after),
    );
    expect(sell.evidence.model).toBe('ISOLATED_SEQUENTIAL_ROUTE_V1');
    expect(closed.positions[market]).toEqual({ quantity: 0n, basisLamports: 0n });
    expect(closed.cashLamports).toBe(10000000000n - spend + sell.output);
    expect(closed.realizedPnlLamports).toBe(sell.output - spend);
    expect((await snapshot(s)).transitions).toHaveLength(2);
  });
  it('persists partial SELL/remainder and preserves pool state across complete exit/rebuy', async () => {
    const s = scope();
    await store.initialize(s, [state(f)]);
    await store.trade(request(s, f, 'BUY', spend));
    const part = await store.trade(request(s, f, 'SELL', qty / 4n));
    expect(part.output).toBe(BigInt(f.expected.split.partialProceeds));
    expect(part.basisRemoved).toBe((spend * (qty / 4n)) / qty);
    const rest = await store.trade(request(s, f, 'SELL', 'ALL'));
    expect(rest.output).toBe(BigInt(f.expected.split.remainingSellProceeds));
    expect(part.basisRemoved + rest.basisRemoved).toBe(spend);
    const closed = await store.load(s);
    expect(closed.positions[market]!.quantity).toBe(0n);
    expect(await store.initialize(s, [state(f)])).toEqual(closed); // no silent reset
    const rebuy = await store.trade(request(s, f, 'BUY', spend));
    expect(rebuy.beforeHash).toBe(sequentialStateHash(closed));
    expect((await store.load(s)).simulation.sequence).toBe(4);
  });
  it('handles consecutive and concurrent BUYs in one serial order with no lost pool updates', async () => {
    const s = scope();
    await store.initialize(s, [state(f)]);
    const receipts = await Promise.all([
      store.trade(request(s, f, 'BUY', spend)),
      store.trade(request(s, f, 'BUY', spend)),
    ]);
    receipts.sort((a, b) => (a.revision < b.revision ? -1 : 1));
    expect(receipts.map((r) => r.output)).toEqual([
      qty,
      BigInt(f.expected.repeated.secondBuyBaseUnits),
    ]);
    expect(receipts[1]!.beforeHash).toBe(receipts[0]!.afterHash);
    const held = await store.load(s);
    expect(held.positions[market]!.quantity).toBe(qty + receipts[1]!.output);
    const exit = await store.trade(request(s, f, 'SELL', 'ALL'));
    expect(exit.output).toBe(BigInt(f.expected.repeated.sellAll));
    const rebuy = await store.trade(request(s, f, 'BUY', spend));
    expect(rebuy.output).toBe(BigInt(f.expected.repeated.rebuyBaseUnits));
    expect((await store.trade(request(s, f, 'SELL', 'ALL'))).output).toBe(
      BigInt(f.expected.repeated.rebuyExit),
    );
  });
  it('recovers through a new connection/store and returns the original receipt after an uncertain commit response', async () => {
    const s = scope();
    await store.initialize(s, [state(f)]);
    const req = request(s, f, 'BUY', spend),
      buy = await store.trade(req),
      before = await snapshot(s);
    const restartedPool = new Pool({ connectionString: url });
    try {
      const restarted = new DisposableSequentialStore(restartedPool);
      expect(await restarted.load(s)).toEqual(await store.load(s));
      expect(await restarted.trade(req)).toEqual(buy); // caller lost response; commit is already durable
      expect(await snapshot(s)).toEqual(before);
      const result = await restarted.trade(request(s, f, 'SELL', 'ALL'));
      expect(result.output).toBe(BigInt(f.expected.fullSellLamports));
    } finally {
      await restartedPool.end();
    }
  });
  it('rejects duplicates with changed intent and repeated execution identifiers without any effects', async () => {
    const s = scope();
    await store.initialize(s, [state(f)]);
    const req = request(s, f, 'BUY', spend),
      [a, b] = await Promise.all([store.trade(req), store.trade(req)]);
    expect(a).toEqual(b);
    const before = await snapshot(s);
    await expect(store.trade({ ...req, amount: spend - 1n })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(store.trade({ ...req, requestKey: randomUUID() })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(await snapshot(s)).toEqual(before);
  });
  it('rolls back rejected trades and database failures after checkpoint update, preserving prior fills', async () => {
    const s = scope();
    await store.initialize(s, [state(f)]);
    const before = await snapshot(s);
    await expect(store.trade(request(s, f, 'SELL', 'ALL'))).rejects.toMatchObject({
      code: 'INVALID_TRADE',
    });
    await expect(store.trade(request(s, f, 'BUY', 10000000001n))).rejects.toMatchObject({
      code: 'INVALID_TRADE',
    });
    await pool.query(
      "alter table seq_trades add constraint reject_test_execution check(execution_id <> 'db-failure')",
    );
    try {
      await expect(
        store.trade({ ...request(s, f, 'BUY', spend), executionId: 'db-failure' }),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await pool.query('alter table seq_trades drop constraint reject_test_execution');
    }
    expect(await snapshot(s)).toEqual(before);
    expect((await store.load(s)).simulation.sequence).toBe(0);
  });
});

describe('durable account/round boundaries and corruption', () => {
  it('serializes concurrent SELL ALL and permits only one liquidation', async () => {
    const f = fixtures[0]!,
      s = scope();
    await store.initialize(s, [state(f)]);
    await store.trade(request(s, f, 'BUY', BigInt(f.expected.inputLamports)));
    const results = await Promise.allSettled([
      store.trade(request(s, f, 'SELL', 'ALL')),
      store.trade(request(s, f, 'SELL', 'ALL')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const closed = await store.load(s);
    expect(closed.simulation.sequence).toBe(2);
    expect(closed.cashLamports).toBe(
      10000000000n - BigInt(f.expected.inputLamports) + BigInt(f.expected.fullSellLamports),
    );
    expect((await snapshot(s)).transitions).toHaveLength(2);
  });
  it('enforces global execution uniqueness during cross-account races with full loser rollback', async () => {
    const f = fixtures[0]!,
      a = scope(),
      b = scope();
    await store.initialize(a, [state(f)]);
    await store.initialize(b, [state(f)]);
    const id = randomUUID();
    const results = await Promise.allSettled(
      [a, b].map((s) =>
        store.trade({ ...request(s, f, 'BUY', BigInt(f.expected.inputLamports)), executionId: id }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(failure && failure.status === 'rejected' && failure.reason.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    const states = await Promise.all([store.load(a), store.load(b)]);
    expect(states.map((s) => s.simulation.sequence).sort()).toEqual([0, 1]);
    expect(
      (await pool.query('select count(*)::int count from seq_trades where execution_id=$1', [id]))
        .rows[0].count,
    ).toBe(1);
  });
  it('keeps completed experimental history unchanged when a later transaction fails', async () => {
    const f = fixtures[0]!,
      s = scope();
    await store.initialize(s, [state(f)]);
    await store.trade(request(s, f, 'BUY', BigInt(f.expected.inputLamports)));
    const before = await snapshot(s);
    await pool.query(
      "alter table seq_trades add constraint reject_later_execution check(execution_id <> 'later-failure')",
    );
    try {
      await expect(
        store.trade({ ...request(s, f, 'SELL', 'ALL'), executionId: 'later-failure' }),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await pool.query('alter table seq_trades drop constraint reject_later_execution');
    }
    expect(await snapshot(s)).toEqual(before);
    expect((await store.load(s)).simulation.sequence).toBe(1);
  });
  it('isolates identical real pools between accounts and between hourly rounds', async () => {
    const f = fixtures[0]!,
      s = scope(),
      other = { ...s, accountId: randomUUID() },
      later = { ...s, roundId: randomUUID() };
    for (const x of [s, other, later]) await store.initialize(x, [state(f)]);
    const a = await store.trade(request(s, f, 'BUY', BigInt(f.expected.inputLamports)));
    expect((await store.load(other)).simulation.sequence).toBe(0);
    expect((await store.load(later)).simulation.sequence).toBe(0);
    for (const x of [other, later])
      expect(
        (await store.trade(request(x, f, 'BUY', BigInt(f.expected.inputLamports)))).output,
      ).toBe(a.output);
  });
  it('persists bridge effects shared by two holdings after restart', async () => {
    const f = fixtures.find((x) => x.name === 'Hirenu')!,
      original = state(f),
      s = scope();
    const links = original.normalizedState['hops'] as PoolLink[],
      bridge = links[1]!;
    const accounts = original.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const other: MarketState = {
      ...original,
      identity: {
        ...original.identity,
        marketId: identifier('shared-bridge-position', 'MarketId'),
        tokenMint: identifier(bridge.mintA, 'TokenMint'),
      },
      normalizedState: {
        ...original.normalizedState,
        hops: [bridge],
        tokenDecimals: Buffer.from(accounts[bridge.mintA]!.base64, 'base64')[44]!.toString(),
      },
    };
    await store.initialize(s, [original, other]);
    await store.trade({ ...request(s, f, 'BUY', 1000000n), marketId: other.identity.marketId });
    const before = await store.load(s),
      bridgeQuantity = before.positions[other.identity.marketId]!.quantity;
    const oldQuote = previewSequentialRoute(
      before.simulation,
      s,
      other.identity.marketId,
      bridgeQuantity,
      false,
    ).output;
    await store.trade(request(s, f, 'BUY', BigInt(f.expected.inputLamports)));
    const held = await new DisposableSequentialStore(pool).load(s);
    const newQuote = previewSequentialRoute(
      held.simulation,
      s,
      other.identity.marketId,
      bridgeQuantity,
      false,
    ).output;
    expect(newQuote).not.toBe(oldQuote);
    expect(held.positions[other.identity.marketId]!.quantity).toBe(bridgeQuantity);
    expect(Object.keys(held.positions)).toHaveLength(2);
    expect(
      (await store.trade({ ...request(s, f, 'SELL', 'ALL'), marketId: other.identity.marketId }))
        .output,
    ).toBe(newQuote);
  });
  it('fails closed on missing, corrupted, incompatible checkpoints and initialization replacement', async () => {
    const f = fixtures[0]!,
      s = scope();
    await expect(store.load(s)).rejects.toMatchObject({ code: 'MISSING_STATE' });
    await expect(store.trade(request(s, f, 'BUY', 1n))).rejects.toMatchObject({
      code: 'MISSING_STATE',
    });
    await store.initialize(s, [state(f)]);
    await expect(store.initialize(s, [state(f)], 999n)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await pool.query(
      "update seq_states set document=jsonb_set(document,'{cashLamports}',$3::jsonb) where account_id=$1 and round_id=$2",
      [s.accountId, s.roundId, '"bad-integer"'],
    );
    const bad = await snapshot(s);
    await expect(store.load(s)).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    await expect(store.trade(request(s, f, 'BUY', 1n))).rejects.toMatchObject({
      code: 'CORRUPT_STATE',
    });
    expect(await snapshot(s)).toEqual(bad);
    const incompatible = scope();
    await store.initialize(incompatible, [state(f)]);
    await pool.query(
      "update seq_states set document=jsonb_set(document,'{version}','\"UNKNOWN\"') where account_id=$1 and round_id=$2",
      [incompatible.accountId, incompatible.roundId],
    );
    await expect(store.load(incompatible)).rejects.toMatchObject({ code: 'INCOMPATIBLE_STATE' });
  });
  it('rejects hash-consistent tampering when it contradicts immutable trade replay', async () => {
    const f = fixtures[0]!,
      s = scope();
    await store.initialize(s, [state(f)]);
    await store.trade(request(s, f, 'BUY', BigInt(f.expected.inputLamports)));
    const current = await store.load(s),
      corrupt = { ...current, cashLamports: current.cashLamports + 1n };
    const encoded = JSON.stringify(corrupt, (_, v) =>
      typeof v === 'bigint' ? { $sequentialInteger: v.toString() } : v,
    );
    await pool.query(
      'update seq_states set document=$3::jsonb,state_hash=$4 where account_id=$1 and round_id=$2',
      [s.accountId, s.roundId, encoded, sequentialStateHash(corrupt)],
    );
    await expect(store.load(s)).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    await expect(
      pool.query('delete from seq_trades where account_id=$1 and round_id=$2', [
        s.accountId,
        s.roundId,
      ]),
    ).rejects.toThrow(/immutable/);
  });
  it('rejects a non-disposable database before writing anything', async () => {
    const s = scope();
    await expect(
      new DisposableSequentialStore(admin).initialize(s, [state(fixtures[0]!)]),
    ).rejects.toMatchObject({ code: 'ISOLATION_REQUIRED' });
    expect(
      (await admin.query("select to_regclass('public.seq_states') as relation")).rows[0].relation,
    ).toBeNull();
  });
});
