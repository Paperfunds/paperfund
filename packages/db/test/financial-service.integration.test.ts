import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseService } from '../src/database.js';
import { createDatabase } from '../src/database.js';
import * as financialService from '../src/financial-service.js';
import {
  applyFill,
  contributeHourlyResultToDailyCompetition,
  createAsset,
  createDailyCompetition,
  createHourlyRound,
  createMarket,
  createOrder,
  createUser,
  DEFAULT_STARTING_PAPER_SOL_LAMPORTS,
  finalizeHourlyResult,
  getAccountFinancialState,
  initializeCompetitionAccount,
  reconcileAccountLedger,
  runFinancialTransaction,
} from '../src/financial-service.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const migrationsFolder = resolve(process.cwd(), 'packages/db/migrations');
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p2_fix_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;
let hourCounter = 0;

interface Fixture {
  prefix: string;
  userId: string;
  roundId: string;
  accountId: string;
  marketId: string;
  baseAssetId: string;
  startsAt: Date;
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

async function createRound(prefix: string, startsAt: Date, maxUniqueTokens = 5): Promise<string> {
  const roundId = `${prefix}:round`;
  await createHourlyRound(database, {
    id: roundId,
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 3_600_000),
    maxUniqueTokens,
    rulesVersion: 'hourly-v2',
    state: 'OPEN',
  });
  return roundId;
}

async function fixture(
  label: string,
  options: { userId?: string; startsAt?: Date; maxUniqueTokens?: number } = {},
): Promise<Fixture> {
  const prefix = id(label);
  const startsAt = options.startsAt ?? new Date(Date.UTC(2027, 0, 2, hourCounter++ % 24, 0, 0, 0));
  const userId = options.userId ?? `${prefix}:user`;
  if (!options.userId) {
    await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
  }
  const roundId = await createRound(prefix, startsAt, options.maxUniqueTokens);
  const baseAssetId = `${prefix}:base`;
  const quoteAssetId = `${prefix}:quote`;
  const marketId = `${prefix}:market`;
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
  const accountId = `${prefix}:account`;
  await initializeCompetitionAccount(database, {
    accountId,
    userId,
    hourlyRoundId: roundId,
    idempotencyKey: `${prefix}:initialize`,
  });
  return { prefix, userId, roundId, accountId, marketId, baseAssetId, startsAt };
}

async function buyOrder(target: Fixture, suffix: string, quote: bigint): Promise<string> {
  const orderId = `${target.prefix}:buy:${suffix}`;
  await createOrder(database, {
    orderId,
    accountId: target.accountId,
    marketId: target.marketId,
    side: 'BUY',
    requestedQuoteLamports: quote,
    requestedAt: new Date(target.startsAt.getTime() + 1_000),
    idempotencyKey: `${orderId}:submit`,
  });
  return orderId;
}

async function sellOrder(target: Fixture, suffix: string, quantity: bigint): Promise<string> {
  const orderId = `${target.prefix}:sell:${suffix}`;
  await createOrder(database, {
    orderId,
    accountId: target.accountId,
    marketId: target.marketId,
    side: 'SELL',
    requestedBaseUnits: quantity,
    requestedAt: new Date(target.startsAt.getTime() + 2_000),
    idempotencyKey: `${orderId}:submit`,
  });
  return orderId;
}

async function fill(
  target: Fixture,
  orderId: string,
  suffix: string,
  baseQuantity: bigint,
  quoteLamports: bigint,
  feeLamports = 0n,
) {
  return applyFill(database, {
    fillId: `${target.prefix}:fill:${suffix}`,
    executionId: `${target.prefix}:execution:${suffix}`,
    orderId,
    baseQuantity,
    quoteLamports,
    executionPrice: '1.000000000000000000',
    feeLamports,
    executedAt: new Date(target.startsAt.getTime() + 3_000),
    idempotencyKey: `${target.prefix}:fill-key:${suffix}`,
  });
}

async function closeAtLoss(target: Fixture): Promise<void> {
  const buy = await buyOrder(target, 'loss', 1_000_000_000n);
  await fill(target, buy, 'loss-buy', 100n, 1_000_000_000n);
  const sell = await sellOrder(target, 'loss', 100n);
  await fill(target, sell, 'loss-sell', 100n, 800_000_000n);
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

describe('corrected hourly/daily PostgreSQL financial foundation', () => {
  it('migrates the canonical baseline through the Phase 3C forward migration twice', async () => {
    const rows = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    const names = rows.rows.map(({ table_name }) => table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'app_meta',
        'assets',
        'competition_accounts',
        'competition_token_slots',
        'daily_competitions',
        'daily_result_hourly_results',
        'daily_results',
        'fills',
        'hourly_results',
        'hourly_rounds',
        'idempotency_records',
        'journal_transactions',
        'ledger_entries',
        'market_state_evidence',
        'markets',
        'order_market_state_evidence',
        'orders',
        'positions',
        'users',
      ]),
    );
    expect(names).not.toContain('competition_seasons');
    expect(names).not.toContain('season_accounts');
    const migrations = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(migrations.rows[0]?.count).toBe('5');
  });

  it('enforces exact non-overlapping hourly rounds and exact UTC daily windows', async () => {
    const prefix = id('windows');
    const startsAt = new Date('2027-02-01T10:00:00.000Z');
    await createHourlyRound(database, {
      id: `${prefix}:round`,
      startsAt,
      endsAtExclusive: new Date('2027-02-01T11:00:00.000Z'),
      rulesVersion: 'v2',
    });
    await expect(
      createHourlyRound(database, {
        id: `${prefix}:overlap`,
        startsAt,
        endsAtExclusive: new Date('2027-02-01T11:00:00.000Z'),
        rulesVersion: 'v2',
      }),
    ).rejects.toThrow();
    await createDailyCompetition(database, {
      id: `${prefix}:daily`,
      utcDate: '2027-02-01',
      startsAt: new Date('2027-02-01T00:00:00.000Z'),
      endsAtExclusive: new Date('2027-02-02T00:00:00.000Z'),
    });
    await expect(
      createDailyCompetition(database, {
        id: `${prefix}:invalid-daily`,
        utcDate: '2027-02-01',
        startsAt: new Date('2027-02-01T01:00:00.000Z'),
        endsAtExclusive: new Date('2027-02-02T01:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FINANCIAL_INPUT' });
  });

  it('creates independent 10 SOL accounts for the same user in consecutive hours', async () => {
    const userId = id('hourly-user');
    await createUser(database, { id: userId, walletAddress: `${userId}:wallet` });
    const hourOne = await fixture('hour-one', {
      userId,
      startsAt: new Date('2027-03-01T08:00:00.000Z'),
    });
    await closeAtLoss(hourOne);
    expect(
      (await getAccountFinancialState(database, hourOne.accountId)).paperSolBalanceLamports,
    ).toBe(9_800_000_000n);
    const hourTwo = await fixture('hour-two', {
      userId,
      startsAt: new Date('2027-03-01T09:00:00.000Z'),
    });
    const second = await getAccountFinancialState(database, hourTwo.accountId);
    expect(second.paperSolBalanceLamports).toBe(DEFAULT_STARTING_PAPER_SOL_LAMPORTS);
    expect(second.id).not.toBe(hourOne.accountId);
  });

  it('initializes one account per user/hour under concurrent requests', async () => {
    const prefix = id('initialization-race');
    const userId = `${prefix}:user`;
    await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
    const roundId = await createRound(prefix, new Date('2027-03-02T10:00:00.000Z'));
    const results = await Promise.all([
      initializeCompetitionAccount(database, {
        accountId: `${prefix}:a`,
        userId,
        hourlyRoundId: roundId,
        idempotencyKey: `${prefix}:key-a`,
      }),
      initializeCompetitionAccount(database, {
        accountId: `${prefix}:b`,
        userId,
        hourlyRoundId: roundId,
        idempotencyKey: `${prefix}:key-b`,
      }),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results[0]?.paperSolBalanceLamports).toBe(10_000_000_000n);
    const count = await database.pool.query<{ count: string }>(
      `select count(*)::text as count from competition_accounts
       where user_id = $1 and hourly_round_id = $2`,
      [userId, roundId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('has no Paper SOL top-up operation or top-up ledger account', async () => {
    expect('applyPaperTopUp' in financialService).toBe(false);
    const constraint = await database.pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition
       from pg_constraint where conname = 'ledger_entries_account_code_valid'`,
    );
    expect(constraint.rows[0]?.definition).not.toContain('TOP_UP');
  });

  it('persists one immutable token slot per hourly account/token', async () => {
    const target = await fixture('slot-unique');
    const firstOrder = await buyOrder(target, 'a', 1_000_000_000n);
    const secondOrder = await buyOrder(target, 'b', 1_000_000_000n);
    await Promise.all([
      fill(target, firstOrder, 'a', 10n, 1_000_000_000n),
      fill(target, secondOrder, 'b', 10n, 1_000_000_000n),
    ]);
    const slots = await database.pool.query<{ count: string }>(
      `select count(*)::text as count from competition_token_slots
       where competition_account_id = $1 and asset_id = $2`,
      [target.accountId, target.baseAssetId],
    );
    expect(slots.rows[0]?.count).toBe('1');
    await expect(
      database.pool.query('delete from competition_token_slots where competition_account_id = $1', [
        target.accountId,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('serializes a first-entry token-limit race', async () => {
    const target = await fixture('slot-limit', { maxUniqueTokens: 1 });
    const secondAssetId = `${target.prefix}:base-two`;
    const secondMarketId = `${target.prefix}:market-two`;
    await createAsset(database, {
      id: secondAssetId,
      mintAddress: `${target.prefix}:mint-two`,
      decimals: 6,
    });
    const quote = firstRowForTest(
      await database.pool.query<{ quote_asset_id: string }>(
        'select quote_asset_id from markets where id = $1',
        [target.marketId],
      ),
    );
    await createMarket(database, {
      id: secondMarketId,
      baseAssetId: secondAssetId,
      quoteAssetId: quote.quote_asset_id,
      venue: 'TEST',
      providerMarketId: `${target.prefix}:provider-two`,
    });
    const firstOrder = await buyOrder(target, 'first-token', 1_000_000_000n);
    const secondOrderId = `${target.prefix}:buy:second-token`;
    await createOrder(database, {
      orderId: secondOrderId,
      accountId: target.accountId,
      marketId: secondMarketId,
      side: 'BUY',
      requestedQuoteLamports: 1_000_000_000n,
      requestedAt: new Date(target.startsAt.getTime() + 1_000),
      idempotencyKey: `${secondOrderId}:submit`,
    });
    const attempts = await Promise.allSettled([
      fill(target, firstOrder, 'first-token', 10n, 1_000_000_000n),
      applyFill(database, {
        fillId: `${target.prefix}:fill:second-token`,
        executionId: `${target.prefix}:execution:second-token`,
        orderId: secondOrderId,
        baseQuantity: 10n,
        quoteLamports: 1_000_000_000n,
        executionPrice: '1',
        feeLamports: 0n,
        executedAt: new Date(target.startsAt.getTime() + 3_000),
        idempotencyKey: `${target.prefix}:fill-key:second-token`,
      }),
    ]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(({ status }) => status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'TOKEN_LIMIT_EXCEEDED' }),
    });
  });

  it('keeps orders, fills, and positions scoped to the hourly account and reconciled', async () => {
    const target = await fixture('trading');
    const buyA = await buyOrder(target, 'a', 2_000_000_000n);
    await fill(target, buyA, 'buy-a', 100n, 2_000_000_000n, 100_000_000n);
    const buyB = await buyOrder(target, 'b', 1_000_000_000n);
    await fill(target, buyB, 'buy-b', 100n, 1_000_000_000n, 50_000_000n);
    const sellA = await sellOrder(target, 'a', 50n);
    const partial = await fill(target, sellA, 'sell-a', 50n, 1_200_000_000n, 20_000_000n);
    expect(partial.costBasisLamportsRemoved).toBe(787_500_000n);
    const sellB = await sellOrder(target, 'b', 150n);
    const closed = await fill(target, sellB, 'sell-b', 150n, 3_000_000_000n, 30_000_000n);
    expect(closed.position).toMatchObject({ status: 'CLOSED', remainingBaseUnits: 0n });
    expect(closed.paperSolBalanceLamports).toBe(11_000_000_000n);
    const reconciliation = await reconcileAccountLedger(database, target.accountId);
    expect(reconciliation).toMatchObject({
      startingCapitalLamports: 10_000_000_000n,
      materializedCashLamports: 11_000_000_000n,
      realizedPnlLamports: 1_000_000_000n,
      reconciled: true,
    });
    const ownership = await database.pool.query<{
      order_account: string;
      position_account: string;
    }>(
      `select o.competition_account_id as order_account,
              p.competition_account_id as position_account
       from orders o join positions p on p.competition_account_id = o.competition_account_id
       where o.id = $1`,
      [buyA],
    );
    expect(ownership.rows[0]).toEqual({
      order_account: target.accountId,
      position_account: target.accountId,
    });
  });

  it('prevents concurrent overspending and preserves a balanced ledger', async () => {
    const target = await fixture('debit-race');
    const orderA = await buyOrder(target, 'a', 6_000_000_000n);
    const orderB = await buyOrder(target, 'b', 6_000_000_000n);
    const results = await Promise.allSettled([
      fill(target, orderA, 'a', 10n, 6_000_000_000n),
      fill(target, orderB, 'b', 10n, 6_000_000_000n),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    });
    expect(
      (await getAccountFinancialState(database, target.accountId)).paperSolBalanceLamports,
    ).toBe(4_000_000_000n);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });

  it('deduplicates concurrent orders and fills and serializes distinct position fills', async () => {
    const target = await fixture('idempotency-race');
    const orderInput = {
      orderId: `${target.prefix}:order`,
      accountId: target.accountId,
      marketId: target.marketId,
      side: 'BUY' as const,
      requestedQuoteLamports: 2_000_000_000n,
      requestedAt: new Date(target.startsAt.getTime() + 1_000),
      idempotencyKey: `${target.prefix}:order-key`,
    };
    expect(
      await Promise.all([createOrder(database, orderInput), createOrder(database, orderInput)]),
    ).toEqual([orderInput.orderId, orderInput.orderId]);
    const firstFill = {
      fillId: `${target.prefix}:fill:first`,
      executionId: `${target.prefix}:execution:first`,
      orderId: orderInput.orderId,
      baseQuantity: 10n,
      quoteLamports: 1_000_000_000n,
      executionPrice: '1',
      feeLamports: 0n,
      executedAt: new Date(target.startsAt.getTime() + 2_000),
      idempotencyKey: `${target.prefix}:fill-key:first`,
      completeOrder: false,
    };
    const duplicates = await Promise.all([
      applyFill(database, firstFill),
      applyFill(database, firstFill),
    ]);
    expect(duplicates[0]?.fillId).toBe(duplicates[1]?.fillId);
    const secondOrder = await buyOrder(target, 'second', 1_000_000_000n);
    await Promise.all([
      applyFill(database, {
        ...firstFill,
        fillId: `${target.prefix}:fill:final`,
        executionId: `${target.prefix}:execution:final`,
        quoteLamports: 1_000_000_000n,
        idempotencyKey: `${target.prefix}:fill-key:final`,
      }),
      fill(target, secondOrder, 'second', 10n, 1_000_000_000n),
    ]);
    const position = await database.pool.query<{
      remaining_base_units: string;
      cost_basis_lamports: string;
    }>(
      `select remaining_base_units::text, cost_basis_lamports::text from positions
       where competition_account_id = $1 and market_id = $2`,
      [target.accountId, target.marketId],
    );
    expect(position.rows[0]).toEqual({
      remaining_base_units: '30',
      cost_basis_lamports: '3000000000',
    });
  });

  it('rolls back forced partial mutations', async () => {
    const target = await fixture('rollback');
    await expect(
      runFinancialTransaction(database, async (client) => {
        await client.query(
          `update competition_accounts
           set paper_sol_balance_lamports = paper_sol_balance_lamports - 999 where id = $1`,
          [target.accountId],
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(
      (await getAccountFinancialState(database, target.accountId)).paperSolBalanceLamports,
    ).toBe(10_000_000_000n);
  });

  it('rejects unbalanced journals and preserves immutable history', async () => {
    const target = await fixture('journal');
    const client = await database.pool.connect();
    try {
      await client.query('begin');
      const key = `${target.prefix}:malformed`;
      await client.query(
        `insert into idempotency_records
          (id, operation_class, idempotency_key, request_hash, competition_account_id)
         values ($1, 'TEST', $1, $1, $2)`,
        [key, target.accountId],
      );
      await client.query(
        `insert into journal_transactions
          (id, competition_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id)
         values ($1, $2, 'TEST', 'TEST', $1, $1)`,
        [key, target.accountId],
      );
      await client.query(
        `insert into ledger_entries
          (id, journal_transaction_id, competition_account_id, account_code, direction, amount_lamports)
         values ($1, $2, $3, 'CASH', 'DEBIT', 1)`,
        [`${key}:entry`, key, target.accountId],
      );
      await expect(client.query('commit')).rejects.toThrow(/not balanced/);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
    await expect(
      database.pool.query(
        `update ledger_entries set amount_lamports = amount_lamports + 1
         where competition_account_id = $1`,
        [target.accountId],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('persists exact hourly results and aggregates each result into its UTC day once', async () => {
    const userId = id('daily-user');
    await createUser(database, { id: userId, walletAddress: `${userId}:wallet` });
    const day = id('daily');
    await createDailyCompetition(database, {
      id: day,
      utcDate: '2027-04-01',
      startsAt: new Date('2027-04-01T00:00:00.000Z'),
      endsAtExclusive: new Date('2027-04-02T00:00:00.000Z'),
    });
    const first = await fixture('daily-loss', {
      userId,
      startsAt: new Date('2027-04-01T22:00:00.000Z'),
    });
    await closeAtLoss(first);
    const firstResult = await finalizeHourlyResult(database, {
      resultId: `${first.prefix}:result`,
      accountId: first.accountId,
      finalSettledBalanceLamports: 9_800_000_000n,
      finalizedAt: new Date('2027-04-01T23:00:05.000Z'),
      idempotencyKey: `${first.prefix}:finalize`,
    });
    expect(firstResult.hourlyPnlLamports).toBe(-200_000_000n);
    const second = await fixture('daily-zero', {
      userId,
      startsAt: new Date('2027-04-01T23:00:00.000Z'),
    });
    const secondResult = await finalizeHourlyResult(database, {
      resultId: `${second.prefix}:result`,
      accountId: second.accountId,
      finalSettledBalanceLamports: 10_000_000_000n,
      finalizedAt: new Date('2027-04-02T00:00:05.000Z'),
      idempotencyKey: `${second.prefix}:finalize`,
    });
    const firstDaily = await contributeHourlyResultToDailyCompetition(database, {
      dailyResultId: `${day}:result`,
      contributionId: `${day}:contribution:first`,
      dailyCompetitionId: day,
      hourlyResultId: firstResult.id,
      idempotencyKey: `${day}:key:first`,
    });
    expect(firstDaily).toMatchObject({
      cumulativePnlLamports: -200_000_000n,
      completedHourlyRoundCount: 1,
    });
    const secondDaily = await contributeHourlyResultToDailyCompetition(database, {
      dailyResultId: `${day}:ignored-result-id`,
      contributionId: `${day}:contribution:second`,
      dailyCompetitionId: day,
      hourlyResultId: secondResult.id,
      idempotencyKey: `${day}:key:second`,
    });
    expect(secondDaily).toMatchObject({
      cumulativePnlLamports: -200_000_000n,
      completedHourlyRoundCount: 2,
    });
    const duplicate = await contributeHourlyResultToDailyCompetition(database, {
      dailyResultId: `${day}:another-ignored-id`,
      contributionId: `${day}:duplicate-link`,
      dailyCompetitionId: day,
      hourlyResultId: secondResult.id,
      idempotencyKey: `${day}:duplicate-key`,
    });
    expect(duplicate.completedHourlyRoundCount).toBe(2);
    expect(duplicate.cumulativePnlLamports).toBe(-200_000_000n);
  });

  it('attributes 23:00-00:00 by start time and rejects the following UTC day', async () => {
    const target = await fixture('midnight-attribution', {
      startsAt: new Date('2027-05-01T23:00:00.000Z'),
    });
    const result = await finalizeHourlyResult(database, {
      resultId: `${target.prefix}:result`,
      accountId: target.accountId,
      finalSettledBalanceLamports: 10_000_000_000n,
      finalizedAt: new Date('2027-05-02T00:00:30.000Z'),
      idempotencyKey: `${target.prefix}:finalize`,
    });
    const mayFirst = `${target.prefix}:may-first`;
    const maySecond = `${target.prefix}:may-second`;
    await createDailyCompetition(database, {
      id: mayFirst,
      utcDate: '2027-05-01',
      startsAt: new Date('2027-05-01T00:00:00.000Z'),
      endsAtExclusive: new Date('2027-05-02T00:00:00.000Z'),
    });
    await createDailyCompetition(database, {
      id: maySecond,
      utcDate: '2027-05-02',
      startsAt: new Date('2027-05-02T00:00:00.000Z'),
      endsAtExclusive: new Date('2027-05-03T00:00:00.000Z'),
    });
    const attributed = await contributeHourlyResultToDailyCompetition(database, {
      dailyResultId: `${target.prefix}:daily-result`,
      contributionId: `${target.prefix}:may-first-link`,
      dailyCompetitionId: mayFirst,
      hourlyResultId: result.id,
      idempotencyKey: `${target.prefix}:may-first-key`,
    });
    expect(attributed.dailyCompetitionId).toBe(mayFirst);
    await expect(
      contributeHourlyResultToDailyCompetition(database, {
        dailyResultId: `${target.prefix}:wrong-result`,
        contributionId: `${target.prefix}:wrong-link`,
        dailyCompetitionId: maySecond,
        hourlyResultId: result.id,
        idempotencyKey: `${target.prefix}:wrong-key`,
      }),
    ).rejects.toMatchObject({ code: 'DAILY_ATTRIBUTION_MISMATCH' });
  });
});

function firstRowForTest<Row>(result: { rows: Row[] }): Row {
  const row = result.rows[0];
  if (!row) throw new Error('Expected a test row.');
  return row;
}
