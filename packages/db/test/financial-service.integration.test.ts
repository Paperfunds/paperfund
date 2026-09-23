import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseService } from '../src/database.js';
import { createDatabase } from '../src/database.js';
import {
  applyFill,
  applyPaperTopUp,
  createAsset,
  createCompetitionSeason,
  createMarket,
  createOrder,
  createUser,
  FinancialServiceError,
  getAccountFinancialState,
  initializeSeasonAccount,
  INITIAL_SEASON_ALLOCATION_LAMPORTS,
  reconcileAccountLedger,
  runFinancialTransaction,
} from '../src/financial-service.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const migrationsFolder = resolve(process.cwd(), 'packages/db/migrations');
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p2_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;

interface Fixture {
  prefix: string;
  userId: string;
  seasonId: string;
  accountId: string;
  marketId: string;
  baseAssetId: string;
}

function testDatabaseUrls(): { adminUrl: string; testUrl: string } {
  if (!sourceDatabaseUrl)
    throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = '/postgres';
  const test = new URL(sourceDatabaseUrl);
  test.pathname = `/${databaseName}`;
  return { adminUrl: admin.toString(), testUrl: test.toString() };
}

function id(label: string): string {
  return `${label}-${randomUUID()}`;
}

async function fixture(
  label: string,
  startsAt = new Date('2026-09-01T00:00:00.000Z'),
): Promise<Fixture> {
  const prefix = id(label);
  const userId = `${prefix}:user`;
  const seasonId = `${prefix}:season`;
  const accountId = `${prefix}:account`;
  const baseAssetId = `${prefix}:base`;
  const quoteAssetId = `${prefix}:quote`;
  const marketId = `${prefix}:market`;
  const endsAt = new Date(startsAt.getTime());
  endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
  await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
  await createCompetitionSeason(database, {
    id: seasonId,
    startsAt,
    endsAt,
    rulesVersion: 'phase-2-v1',
    status: 'OPEN',
  });
  await createAsset(database, {
    id: baseAssetId,
    mintAddress: `${prefix}:mint`,
    decimals: 6,
    symbol: 'TEST',
  });
  await createAsset(database, {
    id: quoteAssetId,
    mintAddress: `${prefix}:sol-mint`,
    decimals: 9,
    symbol: 'SOL',
  });
  await createMarket(database, {
    id: marketId,
    baseAssetId,
    quoteAssetId,
    venue: 'TEST',
    providerMarketId: `${prefix}:provider-market`,
  });
  await initializeSeasonAccount(database, {
    accountId,
    userId,
    seasonId,
    idempotencyKey: `${prefix}:initialize`,
  });
  return { prefix, userId, seasonId, accountId, marketId, baseAssetId };
}

async function buyOrder(
  target: Fixture,
  suffix: string,
  requestedQuoteLamports: bigint,
): Promise<string> {
  const orderId = `${target.prefix}:buy:${suffix}`;
  await createOrder(database, {
    orderId,
    accountId: target.accountId,
    marketId: target.marketId,
    side: 'BUY',
    requestedQuoteLamports,
    requestedAt: new Date('2026-09-10T12:00:00.000Z'),
    idempotencyKey: `${orderId}:submit`,
  });
  return orderId;
}

async function sellOrder(
  target: Fixture,
  suffix: string,
  requestedBaseUnits: bigint,
): Promise<string> {
  const orderId = `${target.prefix}:sell:${suffix}`;
  await createOrder(database, {
    orderId,
    accountId: target.accountId,
    marketId: target.marketId,
    side: 'SELL',
    requestedBaseUnits,
    requestedAt: new Date('2026-09-10T12:30:00.000Z'),
    idempotencyKey: `${orderId}:submit`,
  });
  return orderId;
}

beforeAll(async () => {
  const { adminUrl, testUrl } = testDatabaseUrls();
  adminPool = new Pool({ connectionString: adminUrl });
  await adminPool.query(`create database "${databaseName}"`);
  database = createDatabase(testUrl);
  await migrate(database.client, { migrationsFolder });
  await migrate(database.client, { migrationsFolder });
}, 30_000);

afterAll(async () => {
  if (database) await database.close();
  if (adminPool) {
    await adminPool.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [databaseName],
    );
    await adminPool.query(`drop database if exists "${databaseName}"`);
    await adminPool.end();
  }
}, 30_000);

describe('authoritative PostgreSQL financial foundation', () => {
  it('migrates a fresh database twice and installs all authoritative tables', async () => {
    const rows = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    const names = rows.rows.map(({ table_name }) => table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'app_meta',
        'assets',
        'competition_seasons',
        'fills',
        'idempotency_records',
        'journal_transactions',
        'ledger_entries',
        'markets',
        'orders',
        'positions',
        'season_accounts',
        'users',
      ]),
    );
    const migrations = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(migrations.rows[0]?.count).toBe('2');
  });

  it('enforces exact UTC monthly seasons and preserves timezone instants', async () => {
    const prefix = id('season');
    await createCompetitionSeason(database, {
      id: `${prefix}:valid`,
      startsAt: new Date('2026-10-01T02:00:00+02:00'),
      endsAt: new Date('2026-11-01T01:00:00+01:00'),
      rulesVersion: 'v1',
    });
    const stored = await database.pool.query<{ starts_at: Date; ends_at: Date }>(
      'select starts_at, ends_at from competition_seasons where id = $1',
      [`${prefix}:valid`],
    );
    expect(stored.rows[0]?.starts_at.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(stored.rows[0]?.ends_at.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    await expect(
      createCompetitionSeason(database, {
        id: `${prefix}:invalid`,
        startsAt: new Date('2026-10-01T00:00:01.000Z'),
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
        rulesVersion: 'v1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FINANCIAL_INPUT' });
  });

  it('initializes exactly 10 SOL once under simultaneous requests', async () => {
    const target = await fixture('initialization');
    const replay = await initializeSeasonAccount(database, {
      accountId: `${target.prefix}:ignored-account-id`,
      userId: target.userId,
      seasonId: target.seasonId,
      idempotencyKey: `${target.prefix}:second-initialize`,
    });
    expect(replay.id).toBe(target.accountId);
    expect(replay.initialAllocationLamports).toBe(INITIAL_SEASON_ALLOCATION_LAMPORTS);
    expect(replay.cashBalanceLamports).toBe(10_000_000_000n);

    const concurrentPrefix = id('simultaneous-initialization');
    const userId = `${concurrentPrefix}:user`;
    const seasonId = `${concurrentPrefix}:season`;
    await createUser(database, { id: userId, walletAddress: `${concurrentPrefix}:wallet` });
    await createCompetitionSeason(database, {
      id: seasonId,
      startsAt: new Date('2026-11-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-01T00:00:00.000Z'),
      rulesVersion: 'v1',
    });
    const results = await Promise.all([
      initializeSeasonAccount(database, {
        accountId: `${concurrentPrefix}:account-a`,
        userId,
        seasonId,
        idempotencyKey: `${concurrentPrefix}:key-a`,
      }),
      initializeSeasonAccount(database, {
        accountId: `${concurrentPrefix}:account-b`,
        userId,
        seasonId,
        idempotencyKey: `${concurrentPrefix}:key-b`,
      }),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    const accounts = await database.pool.query<{ count: string; cash: string }>(
      `select count(*)::text as count, sum(cash_balance_lamports)::text as cash
       from season_accounts where user_id = $1 and season_id = $2`,
      [userId, seasonId],
    );
    expect(accounts.rows[0]).toMatchObject({ count: '1', cash: '10000000000' });
  });

  it('applies top-ups once, detects conflicts, and serializes concurrent credits', async () => {
    const target = await fixture('topup');
    const request = {
      accountId: target.accountId,
      amountLamports: 2_000_000_000n,
      idempotencyKey: `${target.prefix}:same-topup`,
    };
    const duplicate = await Promise.all([
      applyPaperTopUp(database, request),
      applyPaperTopUp(database, request),
    ]);
    expect(duplicate[0]?.cashBalanceLamports).toBe(12_000_000_000n);
    expect(duplicate[1]?.cashBalanceLamports).toBe(12_000_000_000n);
    await expect(
      applyPaperTopUp(database, { ...request, amountLamports: 3_000_000_000n }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await Promise.all([
      applyPaperTopUp(database, {
        accountId: target.accountId,
        amountLamports: 100n,
        idempotencyKey: `${target.prefix}:credit-a`,
      }),
      applyPaperTopUp(database, {
        accountId: target.accountId,
        amountLamports: 200n,
        idempotencyKey: `${target.prefix}:credit-b`,
      }),
    ]);
    const state = await getAccountFinancialState(database, target.accountId);
    expect(state.cashBalanceLamports).toBe(12_000_000_300n);
    expect(state.cumulativeTopUpLamports).toBe(2_000_000_300n);
  });

  it('protects immutable history and rejects an unbalanced journal at commit', async () => {
    const target = await fixture('ledger-constraints');
    await expect(
      database.pool.query(
        `update ledger_entries set amount_lamports = amount_lamports + 1
         where season_account_id = $1`,
        [target.accountId],
      ),
    ).rejects.toThrow(/immutable/);

    const client = await database.pool.connect();
    try {
      await client.query('begin');
      const key = `${target.prefix}:malformed`;
      await client.query(
        `insert into idempotency_records
          (id, operation_class, idempotency_key, request_hash, season_account_id)
         values ($1, 'TEST_MALFORMED', $1, $1, $2)`,
        [key, target.accountId],
      );
      await client.query(
        `insert into journal_transactions
          (id, season_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id)
         values ($1, $2, 'TEST', 'TEST', $1, $1)`,
        [key, target.accountId],
      );
      await client.query(
        `insert into ledger_entries
          (id, journal_transaction_id, season_account_id, account_code, direction, amount_lamports)
         values ($1, $2, $3, 'CASH', 'DEBIT', 1)`,
        [`${key}:entry`, key, target.accountId],
      );
      await expect(client.query('commit')).rejects.toThrow(/not balanced/);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('separates order intent from multiple fills and rejects overfills', async () => {
    const target = await fixture('partial-fills');
    const orderId = await buyOrder(target, 'one', 2_000_000_000n);
    const first = await applyFill(database, {
      fillId: `${target.prefix}:fill-a`,
      executionId: `${target.prefix}:execution-a`,
      orderId,
      baseQuantity: 50_000_000n,
      quoteLamports: 1_000_000_000n,
      executionPrice: '20.000000000000000000',
      feeLamports: 10_000_000n,
      executedAt: new Date('2026-09-10T12:00:01.000Z'),
      idempotencyKey: `${target.prefix}:fill-key-a`,
      completeOrder: false,
    });
    expect(first.position.remainingBaseUnits).toBe(50_000_000n);
    const secondInput = {
      fillId: `${target.prefix}:fill-b`,
      executionId: `${target.prefix}:execution-b`,
      orderId,
      baseQuantity: 50_000_000n,
      quoteLamports: 1_000_000_000n,
      executionPrice: '20',
      feeLamports: 10_000_000n,
      executedAt: new Date('2026-09-10T12:00:02.000Z'),
      idempotencyKey: `${target.prefix}:fill-key-b`,
    } as const;
    const second = await applyFill(database, secondInput);
    expect(second.position.remainingBaseUnits).toBe(100_000_000n);
    expect(second.position.costBasisLamports).toBe(2_020_000_000n);
    const replay = await applyFill(database, secondInput);
    expect(replay.fillId).toBe(second.fillId);
    await expect(
      applyFill(database, {
        ...secondInput,
        fillId: `${target.prefix}:fill-c`,
        executionId: `${target.prefix}:execution-c`,
        idempotencyKey: `${target.prefix}:fill-key-c`,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_MISMATCH' });
    const count = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from fills where order_id = $1',
      [orderId],
    );
    expect(count.rows[0]?.count).toBe('2');
  });

  it('serializes simultaneous debits so only one can spend the balance', async () => {
    const target = await fixture('debit-race');
    const orderA = await buyOrder(target, 'a', 6_000_000_000n);
    const orderB = await buyOrder(target, 'b', 6_000_000_000n);
    const makeFill = (orderId: string, suffix: string) =>
      applyFill(database, {
        fillId: `${target.prefix}:race-fill-${suffix}`,
        executionId: `${target.prefix}:race-execution-${suffix}`,
        orderId,
        baseQuantity: 1_000_000n,
        quoteLamports: 6_000_000_000n,
        executionPrice: '6000',
        feeLamports: 0n,
        executedAt: new Date('2026-09-10T13:00:00.000Z'),
        idempotencyKey: `${target.prefix}:race-key-${suffix}`,
      });
    const results = await Promise.allSettled([makeFill(orderA, 'a'), makeFill(orderB, 'b')]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    });
    const state = await getAccountFinancialState(database, target.accountId);
    expect(state.cashBalanceLamports).toBe(4_000_000_000n);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });

  it('serializes two different valid fills into the same position without lost updates', async () => {
    const target = await fixture('position-race');
    const orderA = await buyOrder(target, 'a', 1_000_000_000n);
    const orderB = await buyOrder(target, 'b', 1_000_000_000n);
    const makeFill = (orderId: string, suffix: string) =>
      applyFill(database, {
        fillId: `${target.prefix}:position-fill-${suffix}`,
        executionId: `${target.prefix}:position-execution-${suffix}`,
        orderId,
        baseQuantity: 10n,
        quoteLamports: 1_000_000_000n,
        executionPrice: '100000000',
        feeLamports: 0n,
        executedAt: new Date('2026-09-10T13:30:00.000Z'),
        idempotencyKey: `${target.prefix}:position-key-${suffix}`,
      });
    const results = await Promise.all([makeFill(orderA, 'a'), makeFill(orderB, 'b')]);
    expect(results.map(({ fillId }) => fillId).sort()).toEqual(
      [`${target.prefix}:position-fill-a`, `${target.prefix}:position-fill-b`].sort(),
    );
    const position = await database.pool.query<{
      remaining_base_units: string;
      cost_basis_lamports: string;
    }>(
      `select remaining_base_units::text, cost_basis_lamports::text
       from positions where season_account_id = $1 and market_id = $2`,
      [target.accountId, target.marketId],
    );
    expect(position.rows[0]).toEqual({
      remaining_base_units: '20',
      cost_basis_lamports: '2000000000',
    });
    expect((await getAccountFinancialState(database, target.accountId)).cashBalanceLamports).toBe(
      8_000_000_000n,
    );
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });

  it('deduplicates concurrent order and fill requests at PostgreSQL boundaries', async () => {
    const target = await fixture('idempotency-race');
    const orderInput = {
      orderId: `${target.prefix}:order`,
      accountId: target.accountId,
      marketId: target.marketId,
      side: 'BUY' as const,
      requestedQuoteLamports: 1_000_000_000n,
      requestedAt: new Date('2026-09-10T14:00:00.000Z'),
      idempotencyKey: `${target.prefix}:order-key`,
    };
    expect(
      await Promise.all([createOrder(database, orderInput), createOrder(database, orderInput)]),
    ).toEqual([orderInput.orderId, orderInput.orderId]);
    const fillInput = {
      fillId: `${target.prefix}:fill`,
      executionId: `${target.prefix}:execution`,
      orderId: orderInput.orderId,
      baseQuantity: 10_000_000n,
      quoteLamports: 1_000_000_000n,
      executionPrice: '100',
      feeLamports: 0n,
      executedAt: new Date('2026-09-10T14:00:01.000Z'),
      idempotencyKey: `${target.prefix}:fill-key`,
    };
    const results = await Promise.all([
      applyFill(database, fillInput),
      applyFill(database, fillInput),
    ]);
    expect(results[0]?.fillId).toBe(results[1]?.fillId);
    const counts = await database.pool.query<{ orders: string; fills: string }>(
      `select
         (select count(*) from orders where id = $1)::text as orders,
         (select count(*) from fills where id = $2)::text as fills`,
      [orderInput.orderId, fillInput.fillId],
    );
    expect(counts.rows[0]).toEqual({ orders: '1', fills: '1' });
  });

  it('rolls back every partial mutation after a forced exception', async () => {
    const target = await fixture('rollback');
    await expect(
      runFinancialTransaction(database, async (client) => {
        await client.query(
          'update season_accounts set cash_balance_lamports = cash_balance_lamports + 999 where id = $1',
          [target.accountId],
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect((await getAccountFinancialState(database, target.accountId)).cashBalanceLamports).toBe(
      10_000_000_000n,
    );
  });

  it('reconciles buys, fees, weighted-average partial sells, a top-up, and final close', async () => {
    const target = await fixture('reconciliation');
    const buyA = await buyOrder(target, 'a', 2_000_000_000n);
    await applyFill(database, {
      fillId: `${target.prefix}:buy-fill-a`,
      executionId: `${target.prefix}:buy-execution-a`,
      orderId: buyA,
      baseQuantity: 100n,
      quoteLamports: 2_000_000_000n,
      executionPrice: '20000000',
      feeLamports: 100_000_000n,
      executedAt: new Date('2026-09-11T10:00:00.000Z'),
      idempotencyKey: `${target.prefix}:buy-fill-key-a`,
    });
    const buyB = await buyOrder(target, 'b', 1_000_000_000n);
    await applyFill(database, {
      fillId: `${target.prefix}:buy-fill-b`,
      executionId: `${target.prefix}:buy-execution-b`,
      orderId: buyB,
      baseQuantity: 100n,
      quoteLamports: 1_000_000_000n,
      executionPrice: '10000000',
      feeLamports: 50_000_000n,
      executedAt: new Date('2026-09-11T10:01:00.000Z'),
      idempotencyKey: `${target.prefix}:buy-fill-key-b`,
    });
    const sellA = await sellOrder(target, 'a', 50n);
    const partial = await applyFill(database, {
      fillId: `${target.prefix}:sell-fill-a`,
      executionId: `${target.prefix}:sell-execution-a`,
      orderId: sellA,
      baseQuantity: 50n,
      quoteLamports: 1_200_000_000n,
      executionPrice: '24000000',
      feeLamports: 20_000_000n,
      executedAt: new Date('2026-09-11T10:02:00.000Z'),
      idempotencyKey: `${target.prefix}:sell-fill-key-a`,
    });
    expect(partial.costBasisLamportsRemoved).toBe(787_500_000n);
    expect(partial.fillRealizedPnlLamports).toBe(392_500_000n);
    await applyPaperTopUp(database, {
      accountId: target.accountId,
      amountLamports: 3_000_000_000n,
      idempotencyKey: `${target.prefix}:topup`,
    });
    const sellB = await sellOrder(target, 'b', 150n);
    const closed = await applyFill(database, {
      fillId: `${target.prefix}:sell-fill-b`,
      executionId: `${target.prefix}:sell-execution-b`,
      orderId: sellB,
      baseQuantity: 150n,
      quoteLamports: 3_000_000_000n,
      executionPrice: '20000000',
      feeLamports: 30_000_000n,
      executedAt: new Date('2026-09-11T10:03:00.000Z'),
      idempotencyKey: `${target.prefix}:sell-fill-key-b`,
    });
    expect(closed.position).toMatchObject({
      remainingBaseUnits: 0n,
      costBasisLamports: 0n,
      status: 'CLOSED',
    });
    expect(closed.cashBalanceLamports).toBe(14_000_000_000n);
    expect(closed.realizedPnlLamports).toBe(1_000_000_000n);
    const reconciliation = await reconcileAccountLedger(database, target.accountId);
    expect(reconciliation).toMatchObject({
      materializedCashLamports: 14_000_000_000n,
      materializedPositionCostLamports: 0n,
      materializedQuantity: 0n,
      startingCapitalLamports: 10_000_000_000n,
      topUpCapitalLamports: 3_000_000_000n,
      grossTradingPnlLamports: 1_050_000_000n,
      tradingFeesLamports: 50_000_000n,
      realizedPnlLamports: 1_000_000_000n,
      reconciled: true,
    });
  });

  it('keeps seasons isolated, preserves history, and restricts parent deletion', async () => {
    const first = await fixture('season-isolation-a', new Date('2026-09-01T00:00:00.000Z'));
    const secondSeasonId = `${first.prefix}:season-two`;
    await createCompetitionSeason(database, {
      id: secondSeasonId,
      startsAt: new Date('2026-10-01T00:00:00.000Z'),
      endsAt: new Date('2026-11-01T00:00:00.000Z'),
      rulesVersion: 'phase-2-v1',
    });
    const second = await initializeSeasonAccount(database, {
      accountId: `${first.prefix}:account-two`,
      userId: first.userId,
      seasonId: secondSeasonId,
      idempotencyKey: `${first.prefix}:initialize-two`,
    });
    await applyPaperTopUp(database, {
      accountId: first.accountId,
      amountLamports: 500n,
      idempotencyKey: `${first.prefix}:history-topup`,
    });
    expect(second.cashBalanceLamports).toBe(10_000_000_000n);
    expect((await getAccountFinancialState(database, first.accountId)).cashBalanceLamports).toBe(
      10_000_000_500n,
    );
    await expect(
      database.pool.query('delete from users where id = $1', [first.userId]),
    ).rejects.toThrow();
    expect(
      (await database.pool.query('select count(*) from users where id = $1', [first.userId]))
        .rowCount,
    ).toBe(1);
  });
});

it('exposes stable domain error types', () => {
  expect(new FinancialServiceError('ENTITY_NOT_FOUND', 'missing')).toMatchObject({
    code: 'ENTITY_NOT_FOUND',
  });
});
