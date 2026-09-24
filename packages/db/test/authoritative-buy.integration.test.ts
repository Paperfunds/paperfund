import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { identifier } from '@paperfund/core';
import { ExecutionRouter, type MarketIdentity } from '@paperfund/execution';
import {
  REFERENCE_PROTOCOL_ID,
  ReferenceProtocolAdapter,
  type ReferenceMarketFixture,
} from '@paperfund/protocols';

import type { DatabaseService } from '../src/database.js';
import { createDatabase } from '../src/database.js';
import {
  applyFill,
  createAsset,
  createHourlyRound,
  createMarket,
  createOrder,
  createUser,
  executePaperBuy,
  getAccountFinancialState,
  initializeCompetitionAccount,
  reconcileAccountLedger,
} from '../src/financial-service.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const migrationsFolder = resolve(process.cwd(), 'packages/db/migrations');
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p3a_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;
let hour = 0;

interface Fixture {
  readonly prefix: string;
  readonly accountId: string;
  readonly roundId: string;
  readonly startsAt: Date;
  readonly marketId: string;
  readonly assetId: string;
  readonly mint: string;
  readonly identity: MarketIdentity;
}

function urls(): { adminUrl: string; testUrl: string } {
  if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL tests.');
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = '/postgres';
  const test = new URL(sourceDatabaseUrl);
  test.pathname = `/${databaseName}`;
  return { adminUrl: admin.toString(), testUrl: test.toString() };
}

function unique(label: string): string {
  return `${label}-${randomUUID()}`;
}

async function addMarket(
  prefix: string,
  suffix: string,
): Promise<{
  marketId: string;
  assetId: string;
  mint: string;
  identity: MarketIdentity;
}> {
  const assetId = `${prefix}:asset:${suffix}`;
  const quoteId = `${prefix}:quote:${suffix}`;
  const marketId = `${prefix}:market:${suffix}`;
  const mint = `${prefix}:mint:${suffix}`;
  await createAsset(database, { id: assetId, mintAddress: mint, decimals: 6 });
  await createAsset(database, {
    id: quoteId,
    mintAddress: `${prefix}:paper-sol:${suffix}`,
    decimals: 9,
  });
  await createMarket(database, {
    id: marketId,
    baseAssetId: assetId,
    quoteAssetId: quoteId,
    venue: REFERENCE_PROTOCOL_ID,
    providerMarketId: `${prefix}:provider:${suffix}`,
  });
  return {
    marketId,
    assetId,
    mint,
    identity: {
      protocolId: REFERENCE_PROTOCOL_ID,
      marketId: identifier(marketId, 'MarketId'),
      tokenMint: identifier(mint, 'TokenMint'),
    },
  };
}

async function fixture(
  label: string,
  options: { state?: 'SCHEDULED' | 'OPEN'; maxUniqueTokens?: number; maxBuyRatioBps?: number } = {},
): Promise<Fixture> {
  const prefix = unique(label);
  const startsAt = new Date(Date.UTC(2030, 0, 1 + Math.floor(hour / 24), hour++ % 24));
  const userId = `${prefix}:user`;
  const roundId = `${prefix}:round`;
  const accountId = `${prefix}:account`;
  await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
  await createHourlyRound(database, {
    id: roundId,
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 3_600_000),
    state: options.state ?? 'OPEN',
    rulesVersion: 'phase-3a-tests',
    ...(options.maxUniqueTokens === undefined ? {} : { maxUniqueTokens: options.maxUniqueTokens }),
    ...(options.maxBuyRatioBps === undefined ? {} : { maxBuyRatioBps: options.maxBuyRatioBps }),
  });
  const market = await addMarket(prefix, 'target');
  await initializeCompetitionAccount(database, {
    accountId,
    userId,
    hourlyRoundId: roundId,
    idempotencyKey: `${prefix}:initialize`,
  });
  return { prefix, accountId, roundId, startsAt, ...market };
}

function marketFixture(
  target: Pick<Fixture, 'identity' | 'startsAt'>,
  overrides: Partial<ReferenceMarketFixture> = {},
): ReferenceMarketFixture {
  return {
    identity: target.identity,
    observedAt: new Date(target.startsAt.getTime() + 500).toISOString(),
    quoteLamportsPerTokenBaseUnit: 19_800_000n,
    buyFeeBps: 100n,
    sellFeeBps: 0n,
    ...overrides,
  };
}

function router(fixtures: readonly ReferenceMarketFixture[]): ExecutionRouter {
  return new ExecutionRouter([new ReferenceProtocolAdapter(fixtures)]);
}

async function buy(
  target: Fixture,
  amount = 2_000_000_000n,
  key = `${target.prefix}:authoritative-buy`,
  executionRouter = router([marketFixture(target)]),
  at = new Date(target.startsAt.getTime() + 1_000),
) {
  return executePaperBuy(database, executionRouter, {
    competitionAccountId: target.accountId,
    marketId: target.marketId,
    requestedPaperSolLamports: amount,
    idempotencyKey: key,
    authoritativeTimestamp: at,
  });
}

async function seedPosition(
  target: Fixture,
  marketId: string,
  quantity: bigint,
  cost: bigint,
  suffix: string,
): Promise<void> {
  const orderId = `${target.prefix}:seed-order:${suffix}`;
  await createOrder(database, {
    orderId,
    accountId: target.accountId,
    marketId,
    side: 'BUY',
    requestedQuoteLamports: cost,
    requestedAt: new Date(target.startsAt.getTime() + 100),
    idempotencyKey: `${orderId}:key`,
  });
  await applyFill(database, {
    fillId: `${target.prefix}:seed-fill:${suffix}`,
    executionId: `${target.prefix}:seed-execution:${suffix}`,
    orderId,
    baseQuantity: quantity,
    quoteLamports: cost,
    executionPrice: '1.000000000000000000',
    feeLamports: 0n,
    executedAt: new Date(target.startsAt.getTime() + 200),
    idempotencyKey: `${orderId}:fill-key`,
  });
}

async function insertSlots(target: Fixture, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const market = await addMarket(target.prefix, `slot-${index.toString()}`);
    await database.pool.query(
      `insert into competition_token_slots
        (id, competition_account_id, asset_id, first_successful_buy_at)
       values ($1, $2, $3, $4)`,
      [
        `${target.prefix}:slot:${index.toString()}`,
        target.accountId,
        market.assetId,
        new Date(target.startsAt.getTime() + 100),
      ],
    );
  }
}

beforeAll(async () => {
  const { adminUrl, testUrl } = urls();
  adminPool = new Pool({ connectionString: adminUrl });
  await adminPool.query(`create database "${databaseName}"`);
  database = createDatabase(testUrl);
  await migrate(database.client, { migrationsFolder });
  await migrate(database.client, { migrationsFolder });
});

afterAll(async () => {
  if (database) await database.close();
  if (adminPool) {
    await adminPool.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1',
      [databaseName],
    );
    await adminPool.query(`drop database if exists "${databaseName}"`);
    await adminPool.end();
  }
});

describe('authoritative paper BUY', () => {
  it('atomically persists exact input/output, evidence, slot, position, and balanced journal', async () => {
    const target = await fixture('success');
    const result = await buy(target);
    expect(result).toMatchObject({
      requestedPaperSolLamports: 2_000_000_000n,
      actualPaperSolInputLamports: 2_000_000_000n,
      actualTokenOutputBaseUnits: 100n,
      feeLamports: 20_000_000n,
      paperSolBalanceLamports: 8_000_000_000n,
    });
    expect(result.position).toMatchObject({
      remainingBaseUnits: 100n,
      costBasisLamports: 2_000_000_000n,
    });
    const counts = await database.pool.query<{
      orders: string;
      fills: string;
      evidence: string;
      slots: string;
    }>(
      `select (select count(*) from orders where competition_account_id = $1)::text as orders,
              (select count(*) from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1)::text as fills,
              (select count(*) from market_state_evidence)::text as evidence,
              (select count(*) from competition_token_slots where competition_account_id=$1)::text as slots`,
      [target.accountId],
    );
    expect(counts.rows[0]).toEqual({ orders: '1', fills: '1', evidence: '1', slots: '1' });
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });

  it('enforces the exact 20% boundary without committing rejected rows', async () => {
    const exact = await fixture('ratio-exact');
    await expect(buy(exact)).resolves.toBeDefined();
    const over = await fixture('ratio-over');
    await expect(buy(over, 2_000_000_001n)).rejects.toMatchObject({
      code: 'MAX_BUY_RATIO_EXCEEDED',
    });
    const mutationCount = await database.pool.query<{ count: string }>(
      `select ((select count(*) from orders where competition_account_id=$1) +
               (select count(*) from competition_token_slots where competition_account_id=$1))::text as count`,
      [over.accountId],
    );
    expect(mutationCount.rows[0]?.count).toBe('0');
  });

  it('uses full executable exit value, not cost basis or display mark, for equity', async () => {
    const target = await fixture('marked-equity');
    await seedPosition(target, target.marketId, 100n, 6_000_000_000n, 'existing');
    const executionRouter = router([
      marketFixture(target, {
        quoteLamportsPerTokenBaseUnit: 60_000_000n,
        buyFeeBps: 0n,
        sellFeeBps: 0n,
        markValueLamportsPerTokenBaseUnit: 80_000_000n,
      }),
    ]);
    await expect(
      buy(target, 2_000_000_000n, `${target.prefix}:add`, executionRouter),
    ).resolves.toBeDefined();
    expect(
      (await getAccountFinancialState(database, target.accountId)).paperSolBalanceLamports,
    ).toBe(2_000_000_000n);
  });

  it('rejects insufficient cash even when position value makes the ratio large enough', async () => {
    const target = await fixture('cash');
    await seedPosition(target, target.marketId, 100n, 9_000_000_000n, 'large');
    await expect(
      buy(
        target,
        2_000_000_000n,
        `${target.prefix}:cash-buy`,
        router([
          marketFixture(target, {
            quoteLamportsPerTokenBaseUnit: 90_000_000n,
            buyFeeBps: 0n,
            sellFeeBps: 0n,
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PAPER_SOL' });
  });

  it('returns the original result on retry and rejects a conflicting request fingerprint', async () => {
    const target = await fixture('idempotency');
    const key = `${target.prefix}:same-key`;
    const first = await buy(target, 2_000_000_000n, key);
    const replay = await buy(target, 2_000_000_000n, key);
    expect(replay).toEqual(first);
    await expect(buy(target, 1_000_000_000n, key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(
      (await getAccountFinancialState(database, target.accountId)).paperSolBalanceLamports,
    ).toBe(8_000_000_000n);
  });

  it('enforces round state and the inclusive-start/exclusive-end server window', async () => {
    const scheduled = await fixture('scheduled', { state: 'SCHEDULED' });
    await expect(buy(scheduled)).rejects.toMatchObject({ code: 'ROUND_NOT_OPEN' });
    const start = await fixture('start');
    await expect(
      buy(start, 2_000_000_000n, `${start.prefix}:at-start`, undefined, start.startsAt),
    ).resolves.toBeDefined();
    const end = await fixture('end');
    await expect(
      buy(
        end,
        2_000_000_000n,
        `${end.prefix}:at-end`,
        undefined,
        new Date(end.startsAt.getTime() + 3_600_000),
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_ROUND_WINDOW' });
    for (const state of ['CLOSING', 'SETTLING'] as const) {
      const target = await fixture(state.toLowerCase());
      await database.pool.query('update hourly_rounds set state=$2 where id=$1', [
        target.roundId,
        state,
      ]);
      await expect(buy(target)).rejects.toMatchObject({ code: 'ROUND_NOT_OPEN' });
    }
  });

  it('rolls back all rows and remains retryable when position valuation fails', async () => {
    const target = await fixture('valuation-failure');
    await seedPosition(target, target.marketId, 100n, 1_000_000_000n, 'existing');
    const key = `${target.prefix}:retryable`;
    await expect(buy(target, 1_000_000_000n, key, new ExecutionRouter())).rejects.toMatchObject({
      code: 'POSITION_VALUATION_FAILED',
    });
    const before = await getAccountFinancialState(database, target.accountId);
    expect(before.paperSolBalanceLamports).toBe(9_000_000_000n);
    await expect(
      buy(
        target,
        1_000_000_000n,
        key,
        router([marketFixture(target, { quoteLamportsPerTokenBaseUnit: 10_000_000n })]),
      ),
    ).resolves.toBeDefined();
  });

  it('does not consume a slot or persist an order for a zero-output execution', async () => {
    const target = await fixture('zero-output');
    await expect(
      buy(
        target,
        1n,
        `${target.prefix}:zero`,
        router([marketFixture(target, { quoteLamportsPerTokenBaseUnit: 100n, buyFeeBps: 0n })]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_RESULT' });
    const count = await database.pool.query<{ count: string }>(
      `select ((select count(*) from orders where competition_account_id=$1) +
               (select count(*) from competition_token_slots where competition_account_id=$1))::text as count`,
      [target.accountId],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('enforces new-token slots, permits an existing token, and honors a snapshotted limit of 10', async () => {
    const full = await fixture('slots-full', { maxUniqueTokens: 5 });
    await insertSlots(full, 5);
    await expect(buy(full, 1_000_000_000n)).rejects.toMatchObject({
      code: 'TOKEN_SLOT_LIMIT_REACHED',
    });
    const existing = await fixture('slots-existing', { maxUniqueTokens: 5 });
    await insertSlots(existing, 4);
    await database.pool.query(
      `insert into competition_token_slots
        (id, competition_account_id, asset_id, first_successful_buy_at)
       values ($1, $2, $3, $4)`,
      [`${existing.prefix}:target-slot`, existing.accountId, existing.assetId, existing.startsAt],
    );
    await expect(buy(existing, 1_000_000_000n)).resolves.toBeDefined();
    const ten = await fixture('slots-ten', { maxUniqueTokens: 10 });
    await insertSlots(ten, 9);
    await expect(buy(ten, 1_000_000_000n)).resolves.toBeDefined();
  });

  it('serializes two first buys competing for the final slot', async () => {
    const target = await fixture('slot-race', { maxUniqueTokens: 5 });
    await insertSlots(target, 4);
    const second = await addMarket(target.prefix, 'race-two');
    const fixtures = [marketFixture(target), marketFixture({ ...target, ...second })];
    const executionRouter = router(fixtures);
    const requests = [
      executePaperBuy(database, executionRouter, {
        competitionAccountId: target.accountId,
        marketId: target.marketId,
        requestedPaperSolLamports: 1_000_000_000n,
        idempotencyKey: `${target.prefix}:race-one`,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
      }),
      executePaperBuy(database, executionRouter, {
        competitionAccountId: target.accountId,
        marketId: second.marketId,
        requestedPaperSolLamports: 1_000_000_000n,
        idempotencyKey: `${target.prefix}:race-two`,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
      }),
    ];
    const settled = await Promise.allSettled(requests);
    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const slots = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from competition_token_slots where competition_account_id=$1',
      [target.accountId],
    );
    expect(slots.rows[0]?.count).toBe('5');
  });

  it('recalculates equity under the account lock during concurrent spend', async () => {
    const target = await fixture('spend-race');
    const second = await addMarket(target.prefix, 'spend-two');
    const executionRouter = router([
      marketFixture(target),
      marketFixture({ ...target, ...second }),
    ]);
    const execute = (marketId: string, key: string) =>
      executePaperBuy(database, executionRouter, {
        competitionAccountId: target.accountId,
        marketId,
        requestedPaperSolLamports: 2_000_000_000n,
        idempotencyKey: key,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
      });
    const settled = await Promise.allSettled([
      execute(target.marketId, `${target.prefix}:spend-one`),
      execute(second.marketId, `${target.prefix}:spend-two`),
    ]);
    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      (await getAccountFinancialState(database, target.accountId)).paperSolBalanceLamports,
    ).toBe(8_000_000_000n);
  });

  it('links the fill and every valuation decision to immutable evidence', async () => {
    const target = await fixture('evidence-link');
    await seedPosition(target, target.marketId, 10n, 1_000_000_000n, 'existing');
    const result = await buy(
      target,
      1_000_000_000n,
      `${target.prefix}:evidence`,
      router([marketFixture(target, { quoteLamportsPerTokenBaseUnit: 100_000_000n })]),
    );
    const links = await database.pool.query<{ purpose: string }>(
      'select purpose from order_market_state_evidence where order_id=$1 order by purpose',
      [result.orderId],
    );
    expect(links.rows.map(({ purpose }) => purpose)).toEqual([
      'BUY_EXECUTION',
      'POSITION_EXIT_VALUATION',
    ]);
    await expect(
      database.pool.query('update market_state_evidence set adapter_version=$2 where id=$1', [
        result.marketStateEvidenceId,
        'tampered',
      ]),
    ).rejects.toThrow(/immutable/);
  });
});
