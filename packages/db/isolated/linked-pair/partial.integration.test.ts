import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { ExecutionRouter } from '@paperfund/execution';
import { createDatabase, type DatabaseService } from '../../src/database.js';
import {
  createUser,
  createHourlyRound,
  createDailyCompetition,
  createAsset,
  createMarket,
  initializeCompetitionAccount,
  executePaperBuy,
  settleHourlyRound,
  reconcileAccountLedger,
  replayPersistedFill,
} from '../../src/financial-service.js';
import { LinkedStateStore, linkedCandidateRuntime, installLinkedTestSchema } from './store.js';
import type { CutoffFrontier } from './cutoff.js';
import type { ProviderInterval } from '../../../protocols/isolated/linked-pair/external-flow.js';
import { genericPumpSwapIdentity } from '../../../protocols/src/generic-pump-swap.js';
config({ path: resolve('.env'), quiet: true });
const retained = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261021/flow/provider-459438275-459438282.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
) as ProviderInterval;
const identity = genericPumpSwapIdentity(
  retained.before.mint,
  retained.before.quoteMint,
  retained.before.bridgePool,
);
const name = 'paperfund_linked_test_partial_' + process.pid + '_' + Date.now();
let db: DatabaseService,
  admin: Pool,
  url: string,
  counter = 0;
let originalGuard: string;
beforeAll(async () => {
  const a = new URL(process.env.DATABASE_URL!);
  a.pathname = '/postgres';
  admin = new Pool({ connectionString: a.toString() });
  await admin.query('create database "' + name + '"');
  a.pathname = '/' + name;
  url = a.toString();
  db = createDatabase(url);
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
  originalGuard = (
    await db.pool.query<{ definition: string }>(
      "select pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure) as definition",
    )
  ).rows[0]!.definition.replaceAll('\r\n', '\n');
  await installLinkedTestSchema(db.pool);
  await createDailyCompetition(db, {
    id: 'day',
    utcDate: '2026-10-21',
    startsAt: new Date('2026-10-21T00:00:00Z'),
    endsAtExclusive: new Date('2026-10-22T00:00:00Z'),
  });
  await createAsset(db, { id: 'base', mintAddress: identity.tokenMint, decimals: 6 });
  await createAsset(db, {
    id: 'sol',
    mintAddress: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  });
  await createMarket(db, {
    id: identity.marketId,
    baseAssetId: 'base',
    quoteAssetId: 'sol',
    venue: identity.protocolId,
    providerMarketId: identity.marketId,
  });
}, 30000);
afterAll(async () => {
  if (db) await db.close();
  if (admin) {
    await admin.query('drop database "' + name + '" with(force)');
    await admin.end();
  }
});
/** Real retained liquidity, synthetic bank/round timing ONLY: not an independently observed UTC cutoff. */
async function fixture() {
  const id = randomUUID(),
    round = 'round:' + id,
    account = 'account:' + id,
    user = 'user:' + id,
    cutoff = new Date(Date.UTC(2026, 9, 21, 3 + counter++));
  await createHourlyRound(db, {
    id: round,
    startsAt: new Date(cutoff.getTime() - 3600000),
    endsAtExclusive: cutoff,
    state: 'OPEN',
    rulesVersion: 'linked-cutoff-test',
  });
  await createUser(db, { id: user, walletAddress: 'wallet:' + id });
  await initializeCompetitionAccount(db, {
    accountId: account,
    userId: user,
    hourlyRoundId: round,
    idempotencyKey: 'init:' + id,
  });
  const s = structuredClone(retained.before),
    clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(s.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(s.slot), 0);
  raw.writeBigInt64LE(BigInt(cutoff.getTime() / 1000 - 1), 32);
  s.accounts[clock] = { ...s.accounts[clock]!, base64: raw.toString('base64') };
  s.observedAt = new Date(cutoff.getTime() - 500).toISOString();
  let now = Date.parse(s.observedAt),
    providerReads = 0;
  const frontier: CutoffFrontier = {
    schema: 'LINKED_UTC_FRONTIER_V1',
    commitment: 'finalized',
    last: { slot: s.slot, blockTime: cutoff.getTime() / 1000 - 1, blockhash: 'test-last' },
    next: {
      slot: s.slot + 1,
      parentSlot: s.slot,
      previousBlockhash: 'test-last',
      blockhash: 'test-next',
      blockTime: cutoff.getTime() / 1000,
    },
    interval: null,
  };
  const store = new LinkedStateStore(db, account, round);
  await store.initialize(s);
  const options = {
    now: () => now,
    interval: async () => {
      providerReads++;
      return null;
    },
    permission: async () => ({ discover: true, buy: true, authorizeLive: async () => undefined }),
    cutoffFrontier: async () => frontier,
  };
  const runtime = linkedCandidateRuntime(db, store, options),
    router = new ExecutionRouter([runtime.adapter]);
  const buy = (marketId: string = identity.marketId, key = 'buy:' + randomUUID()) =>
    executePaperBuy(runtime.database, router, {
      competitionAccountId: account,
      marketId,
      requestedPaperSolLamports: 100000000n,
      idempotencyKey: key,
      authoritativeTimestamp: new Date(now),
    });
  const settle = (database = runtime.database, engine = router) =>
    settleHourlyRound(database, engine, {
      hourlyRoundId: round,
      authoritativeTimestamp: new Date(cutoff.getTime() + 120000),
    });
  return {
    account,
    round,
    cutoff,
    s,
    frontier,
    store,
    options,
    runtime,
    router,
    buy,
    settle,
    advance: () => {
      now = cutoff.getTime() + 120000;
    },
    reads: () => providerReads,
  };
}
async function counts(account: string) {
  return (
    await db.pool.query(
      `select (select count(*) from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1)::text fills,(select count(*) from linked_candidate.receipts where account_id=$1)::text receipts,(select count(*) from journal_transactions where competition_account_id=$1)::text journals,(select paper_sol_balance_lamports::text from competition_accounts where id=$1) cash`,
      [account],
    )
  ).rows[0];
}
async function partial(f: Awaited<ReturnType<typeof fixture>>, leaveDust = false) {
  const database = {
    ...f.runtime.database,
    preparePersistedSettlementStep: (
      input: Parameters<NonNullable<DatabaseService['preparePersistedSettlementStep']>>[0],
    ) => f.runtime.planSettlementStep(input, leaveDust ? input.quantity - 1n : input.quantity / 4n),
  };
  return f.settle(database);
}
async function stepRows(account: string) {
  return (
    await db.pool.query(
      'select * from linked_candidate.settlement_steps where account_id=$1 order by revision',
      [account],
    )
  ).rows;
}
it('continues a genuine native partial checkpoint automatically using the successor and exact remaining basis', async () => {
  const f = await fixture(),
    buy = await f.buy();
  f.advance();
  const first = await partial(f);
  expect(first.state).toBe('SETTLING');
  expect(first.forcedSells).toHaveLength(1);
  expect(first.forcedSells[0]!.actualTokenInputBaseUnits).toBe(buy.actualTokenOutputBaseUnits / 4n);
  expect(
    (await db.pool.query('select 1 from legacy_source_reviews where hourly_round_id=$1', [f.round]))
      .rows,
  ).toEqual([]);
  const before = await f.store.load(),
    last = await f.settle();
  expect(last.failures).toEqual([]);
  expect(last.state).toBe('FINALIZED');
  expect(last.forcedSells).toHaveLength(1);
  expect(last.forcedSells[0]!.actualTokenInputBaseUnits).toBe(
    buy.actualTokenOutputBaseUnits - buy.actualTokenOutputBaseUnits / 4n,
  );
  expect((await f.store.load()).revision).toBe((BigInt(before.revision) + 1n).toString());
  expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3', journals: '4' });
  const rows = await stepRows(f.account);
  expect(rows).toHaveLength(2);
  expect(rows[0]!.seal_hash).toBe(rows[1]!.seal_hash);
  expect(rows[0]!.revision).not.toBe(rows[1]!.revision);
  await f.store.recover();
  for (const fill of [...first.forcedSells, ...last.forcedSells])
    await replayPersistedFill(db, f.router, fill.fillId);
  expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  const stable = await counts(f.account);
  await f.settle();
  expect(await counts(f.account)).toEqual(stable);
}, 20000);
it('recovers from a committed partial with a new DB pool/runtime and never refetches cutoff liquidity', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const other = createDatabase(url);
  try {
    const store = new LinkedStateStore(other, f.account, f.round);
    await store.recover();
    const runtime = linkedCandidateRuntime(other, store, {
        ...f.options,
        interval: async () => {
          throw Error('NO_NEW_MARKET_STATE');
        },
        cutoffFrontier: async () => {
          throw Error('NO_RESEAL');
        },
      }),
      router = new ExecutionRouter([runtime.adapter]);
    const r = await f.settle(runtime.database, router);
    expect(r.state).toBe('FINALIZED');
    expect(r.failures).toEqual([]);
    expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3' });
    await store.recover();
  } finally {
    await other.close();
  }
}, 15000);
it('serializes concurrent continuations, retaining one fill, one journal and one liquidity successor', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const results = await Promise.all([f.settle(), f.settle()]);
  expect(results.every((x) => x.state === 'FINALIZED')).toBe(true);
  expect(results.reduce((n, x) => n + x.forcedSells.length, 0)).toBe(1);
  expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3', journals: '4' });
  expect(await stepRows(f.account)).toHaveLength(2);
  await f.store.recover();
}, 15000);
it('rolls back a failed continuation after native receipt, proof, journal and balance writes', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const before = await counts(f.account),
    hook = f.runtime.database.commitPersistedSettlementStep!,
    database = {
      ...f.runtime.database,
      async commitPersistedSettlementStep(...args: Parameters<typeof hook>) {
        await hook(...args);
        throw Error('TEST_AFTER_CONTINUATION_PROOF_BEFORE_COMMIT');
      },
    };
  const result = await f.settle(database);
  expect(result.forcedSells).toHaveLength(0);
  expect(await counts(f.account)).toEqual(before);
  expect(await stepRows(f.account)).toHaveLength(1);
  await f.store.recover();
  expect((await f.settle()).state).toBe('FINALIZED');
  expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3' });
}, 15000);
it('keeps a native zero-output dust residual open under REVIEW without fabricated proceeds or a write-off', async () => {
  const f = await fixture();
  await f.buy();
  const first = await partial(f, true);
  expect(first.forcedSells).toHaveLength(1);
  const row = (
    await db.pool.query(
      'select remaining_base_units::text, cost_basis_lamports::text from positions where competition_account_id=$1',
      [f.account],
    )
  ).rows[0];
  expect(row).toEqual({ remaining_base_units: '1', cost_basis_lamports: '1' });
  const before = await counts(f.account),
    next = await f.settle();
  expect(next.state).toBe('SETTLING');
  expect(next.forcedSells).toHaveLength(0);
  expect(next.failures.some((x) => x.code === 'SETTLEMENT_REVIEW')).toBe(true);
  expect(await counts(f.account)).toEqual(before);
  expect(
    (
      await db.pool.query('select reason from legacy_source_reviews where hourly_round_id=$1', [
        f.round,
      ])
    ).rows.length,
  ).toBeGreaterThan(0);
  await f.store.recover();
  await f.settle();
  expect(await counts(f.account)).toEqual(before);
  expect(
    (
      await db.pool.query(
        "select 1 from journal_transactions where competition_account_id=$1 and operation_type='FORCED_HOURLY_SETTLEMENT_WRITEOFF'",
        [f.account],
      )
    ).rows,
  ).toEqual([]);
  expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
}, 15000);
it('requires the SQL continuation proof and refuses edits to immutable committed steps', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const before = await counts(f.account),
    database = { ...f.runtime.database, commitPersistedSettlementStep: async () => undefined },
    r = await f.settle(database);
  expect(r.forcedSells).toHaveLength(0);
  expect(r.failures.length).toBeGreaterThan(0);
  expect(await counts(f.account)).toEqual(before);
  await expect(
    db.pool.query(
      'update linked_candidate.settlement_steps set net_proceeds=net_proceeds+1 where account_id=$1',
      [f.account],
    ),
  ).rejects.toThrow('LINKED_RECEIPT_IMMUTABLE');
  expect((await f.settle()).state).toBe('FINALIZED');
}, 15000);
it('recovers a killed continuation process after all writes but before COMMIT', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const before = await counts(f.account),
    child = fork(fileURLToPath(new URL('./partial-crash-child.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        LINKED_TEST_DB_URL: url,
        LINKED_TEST_ACCOUNT: f.account,
        LINKED_TEST_ROUND: f.round,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CHILD_STAGE_TIMEOUT')), 20000);
      child.once('message', (m) => {
        clearTimeout(timer);
        if ((m as { staged?: boolean }).staged) resolve();
        else reject(Error('BAD_STAGE'));
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('CHILD_EARLY_EXIT'));
      });
    });
    const stopped = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGKILL');
    await stopped;
    expect(await counts(f.account)).toEqual(before);
    expect(await stepRows(f.account)).toHaveLength(1);
    await f.store.recover();
    expect((await f.settle()).state).toBe('FINALIZED');
    expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3', journals: '4' });
    await f.store.recover();
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }
}, 30000);
it('ignores concurrent post-cutoff market refreshes and rejects late paper entry while continuing', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const seal = await f.store.cutoff();
  f.advance();
  f.options.interval = async () => {
    throw Error('POST_CUTOFF_POOL_MUTATION_MUST_NOT_BE_APPLIED');
  };
  f.options.cutoffFrontier = async () => {
    throw Error('MUST_NOT_RESEAL_NEW_POOL');
  };
  const r = await Promise.allSettled([f.settle(), f.buy()]);
  expect(r[0]!.status).toBe('fulfilled');
  expect(r[1]!.status).toBe('rejected');
  expect((await f.store.cutoff())!.hash).toBe(seal!.hash);
  expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3', journals: '4' });
  await f.store.recover();
}, 15000);

it('preserves the complete legacy forced-fill guard behind the qualified receipt branch', async () => {
  const definition = (
    await db.pool.query<{ definition: string }>(
      "select pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure) as definition",
    )
  ).rows[0]!.definition;
  expect(
    definition.replace(
      ' IF linked_candidate.assert_forced_fill(NEW.id) THEN RETURN NEW; END IF;\n',
      '',
    ),
  ).toBe(originalGuard);
});
it('rejects a partial plan prepared before another valid partial consumed the pool', async () => {
  const f = await fixture();
  await f.buy();
  await partial(f);
  const p = (
      await db.pool.query(
        'select id,remaining_base_units,cost_basis_lamports from positions where competition_account_id=$1',
        [f.account],
      )
    ).rows[0],
    request = {
      accountId: f.account,
      roundId: f.round,
      positionId: p.id,
      identity,
      quantity: BigInt(p.remaining_base_units),
      basis: BigInt(p.cost_basis_lamports),
    },
    stale = await f.runtime.planSettlementStep(request, request.quantity / 3n);
  await partial(f);
  const before = await counts(f.account),
    database = { ...f.runtime.database, preparePersistedSettlementStep: async () => stale },
    r = await f.settle(database);
  expect(r.forcedSells).toHaveLength(0);
  expect(r.failures.length).toBeGreaterThan(0);
  expect(await counts(f.account)).toEqual(before);
  expect((await f.settle()).state).toBe('FINALIZED');
  await f.store.recover();
}, 15000);
