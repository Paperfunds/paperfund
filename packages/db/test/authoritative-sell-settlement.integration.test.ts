import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { identifier, utcInstant } from '@paperfund/core';
import {
  ExecutionEngineError,
  ExecutionRouter,
  type MarketIdentity,
  type MarketState,
  type MarketStateSource,
} from '@paperfund/execution';
import {
  PumpFunProtocolAdapter,
  REFERENCE_PROTOCOL_ID,
  ReferenceProtocolAdapter,
  type ReferenceMarketFixture,
} from '@paperfund/protocols';

import { recordedPumpState } from '../../protocols/test/fixtures/pump-real-chain.js';

import type { DatabaseService } from '../src/database.js';
import { createDatabase } from '../src/database.js';
import {
  createAsset,
  createDailyCompetition,
  createHourlyRound,
  createMarket,
  createUser,
  executePaperBuy,
  executePaperSell,
  getAccountFinancialState,
  initializeCompetitionAccount,
  reconcileAccountLedger,
  replayPersistedFill,
  settleHourlyRound,
} from '../src/financial-service.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const migrationsFolder = resolve(process.cwd(), 'packages/db/migrations');
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p3c_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;
let hour = 0;
const dayStart = new Date(Date.UTC(2040, 0, 1));

interface Fixture {
  readonly prefix: string;
  readonly roundId: string;
  readonly accountId: string;
  readonly userId: string;
  readonly startsAt: Date;
  readonly marketId: string;
  readonly assetId: string;
  readonly identity: MarketIdentity;
}

function unique(label: string): string {
  return `${label}-${randomUUID()}`;
}

function urls(): { adminUrl: string; testUrl: string } {
  if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL tests.');
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = '/postgres';
  const test = new URL(sourceDatabaseUrl);
  test.pathname = `/${databaseName}`;
  return { adminUrl: admin.toString(), testUrl: test.toString() };
}

async function addReferenceMarket(prefix: string, suffix: string) {
  const assetId = `${prefix}:asset:${suffix}`;
  const quoteId = `${prefix}:quote:${suffix}`;
  const marketId = `${prefix}:market:${suffix}`;
  const mint = `${prefix}:mint:${suffix}`;
  await createAsset(database, { id: assetId, mintAddress: mint, decimals: 6 });
  await createAsset(database, { id: quoteId, mintAddress: `${prefix}:sol:${suffix}`, decimals: 9 });
  await createMarket(database, {
    id: marketId,
    baseAssetId: assetId,
    quoteAssetId: quoteId,
    venue: REFERENCE_PROTOCOL_ID,
    providerMarketId: `${prefix}:provider:${suffix}`,
  });
  return {
    assetId,
    marketId,
    identity: {
      protocolId: REFERENCE_PROTOCOL_ID,
      marketId: identifier(marketId, 'MarketId'),
      tokenMint: identifier(mint, 'TokenMint'),
    },
  };
}

async function fixture(label: string): Promise<Fixture> {
  const prefix = unique(label);
  const startsAt = new Date(dayStart.getTime() + hour++ * 3_600_000);
  const roundId = `${prefix}:round`;
  const userId = `${prefix}:user`;
  const accountId = `${prefix}:account`;
  await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
  await createHourlyRound(database, {
    id: roundId,
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 3_600_000),
    state: 'OPEN',
    rulesVersion: 'phase-3c-tests',
  });
  const market = await addReferenceMarket(prefix, 'one');
  await initializeCompetitionAccount(database, {
    accountId,
    userId,
    hourlyRoundId: roundId,
    idempotencyKey: `${prefix}:initialize`,
  });
  return { prefix, roundId, accountId, userId, startsAt, ...market };
}

function marketFixture(
  target: Pick<Fixture, 'identity' | 'startsAt'>,
  price = 20_000_000n,
  sellFeeBps = 100n,
): ReferenceMarketFixture {
  return {
    identity: target.identity,
    observedAt: new Date(target.startsAt.getTime() + 500).toISOString(),
    chainSlot: 100n,
    quoteLamportsPerTokenBaseUnit: price,
    buyFeeBps: 0n,
    sellFeeBps,
  };
}

function router(fixtures: readonly ReferenceMarketFixture[]): ExecutionRouter {
  return new ExecutionRouter([new ReferenceProtocolAdapter(fixtures)]);
}

async function buy(
  target: Fixture,
  executionRouter = router([marketFixture(target)]),
  amount = 2_000_000_000n,
) {
  return executePaperBuy(database, executionRouter, {
    competitionAccountId: target.accountId,
    marketId: target.marketId,
    requestedPaperSolLamports: amount,
    idempotencyKey: `${target.prefix}:buy:${amount.toString()}`,
    authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
  });
}

async function sell(
  target: Fixture,
  quantity: bigint,
  key: string,
  executionRouter = router([marketFixture(target, 30_000_000n)]),
  at = new Date(target.startsAt.getTime() + 2_000),
) {
  return executePaperSell(database, executionRouter, {
    competitionAccountId: target.accountId,
    marketId: target.marketId,
    requestedTokenQuantity: quantity,
    idempotencyKey: key,
    authoritativeTimestamp: at,
  });
}

beforeAll(async () => {
  const { adminUrl, testUrl } = urls();
  adminPool = new Pool({ connectionString: adminUrl });
  await adminPool.query(`create database "${databaseName}"`);
  database = createDatabase(testUrl);
  await migrate(database.client, { migrationsFolder });
  await migrate(database.client, { migrationsFolder });
  await createDailyCompetition(database, {
    id: 'daily:2040-01-01',
    utcDate: '2040-01-01',
    startsAt: dayStart,
    endsAtExclusive: new Date(dayStart.getTime() + 86_400_000),
  });
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

describe('authoritative paper SELL', () => {
  it('applies exact partial and final cost basis, fees, realized P&L, and immutable evidence', async () => {
    const target = await fixture('partial-final');
    await buy(target);
    const first = await sell(target, 40n, `${target.prefix}:sell-one`);
    expect(first).toMatchObject({
      actualTokenInputBaseUnits: 40n,
      actualNetPaperSolOutputLamports: 1_188_000_000n,
      feeLamports: 12_000_000n,
      costBasisLamportsRemoved: 800_000_000n,
      fillRealizedPnlLamports: 388_000_000n,
    });
    expect(first.position).toMatchObject({
      remainingBaseUnits: 60n,
      costBasisLamports: 1_200_000_000n,
      status: 'OPEN',
    });
    const second = await sell(target, 10n, `${target.prefix}:sell-two`);
    expect(second.position).toMatchObject({
      remainingBaseUnits: 50n,
      costBasisLamports: 1_000_000_000n,
    });
    const final = await sell(target, 50n, `${target.prefix}:sell-three`);
    expect(final.position).toMatchObject({
      remainingBaseUnits: 0n,
      costBasisLamports: 0n,
      status: 'CLOSED',
    });
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    await expect(
      replayPersistedFill(database, router([marketFixture(target, 30_000_000n)]), final.fillId),
    ).resolves.toMatchObject({ matched: true });
  });

  it('rejects zero, oversize, non-open, and exact-cutoff user sells', async () => {
    const target = await fixture('sell-guards');
    await buy(target);
    await expect(sell(target, 0n, `${target.prefix}:zero`)).rejects.toMatchObject({
      code: 'INVALID_SELL_QUANTITY',
    });
    await expect(sell(target, 101n, `${target.prefix}:oversize`)).rejects.toMatchObject({
      code: 'INSUFFICIENT_TOKEN_BALANCE',
    });
    await expect(
      sell(
        target,
        1n,
        `${target.prefix}:cutoff`,
        undefined,
        new Date(target.startsAt.getTime() + 3_600_000),
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_ROUND_WINDOW' });
    await database.pool.query(`update hourly_rounds set state = 'CLOSING' where id = $1`, [
      target.roundId,
    ]);
    await expect(sell(target, 1n, `${target.prefix}:closed`)).rejects.toMatchObject({
      code: 'ROUND_NOT_OPEN',
    });
  });

  it('is idempotent, detects conflicts, and serializes an oversell race', async () => {
    const target = await fixture('sell-race');
    await buy(target);
    const key = `${target.prefix}:same`;
    const replayRouter = router([marketFixture(target, 30_000_000n)]);
    const first = await sell(target, 10n, key, replayRouter);
    replayRouter.setEnabled(REFERENCE_PROTOCOL_ID, false);
    expect(await sell(target, 10n, key, replayRouter)).toEqual(first);
    await expect(sell(target, 11n, key, replayRouter)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const outcomes = await Promise.allSettled([
      sell(target, 75n, `${target.prefix}:race-a`),
      sell(target, 75n, `${target.prefix}:race-b`),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const position = await database.pool.query<{ remaining_base_units: string }>(
      'select remaining_base_units from positions where competition_account_id = $1',
      [target.accountId],
    );
    expect(position.rows[0]?.remaining_base_units).toBe('15');
  });

  it('keeps the token slot consumed after close and permits only a same-token rebuy', async () => {
    const target = await fixture('slot-persistence');
    await buy(target);
    for (let index = 0; index < 4; index += 1) {
      const extra = await addReferenceMarket(target.prefix, `used-${index.toString()}`);
      await database.pool.query(
        `insert into competition_token_slots
          (id, competition_account_id, asset_id, first_successful_buy_at)
         values ($1, $2, $3, $4)`,
        [
          `${target.prefix}:used:${index.toString()}`,
          target.accountId,
          extra.assetId,
          target.startsAt,
        ],
      );
    }
    await sell(target, 100n, `${target.prefix}:close`);
    const count = await database.pool.query<{ count: string }>(
      'select count(*)::text count from competition_token_slots where competition_account_id=$1',
      [target.accountId],
    );
    expect(count.rows[0]?.count).toBe('5');
    await expect(
      executePaperBuy(database, router([marketFixture(target)]), {
        competitionAccountId: target.accountId,
        marketId: target.marketId,
        requestedPaperSolLamports: 1_000_000_000n,
        idempotencyKey: `${target.prefix}:rebuy`,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({ actualTokenOutputBaseUnits: 50n });
    expect(
      (
        await database.pool.query<{ count: string }>(
          'select count(*)::text count from competition_token_slots where competition_account_id=$1',
          [target.accountId],
        )
      ).rows[0]?.count,
    ).toBe('5');
    const newMarket = await addReferenceMarket(target.prefix, 'sixth');
    await expect(
      executePaperBuy(
        database,
        router([marketFixture(target), marketFixture({ ...target, ...newMarket })]),
        {
          competitionAccountId: target.accountId,
          marketId: newMarket.marketId,
          requestedPaperSolLamports: 100_000_000n,
          idempotencyKey: `${target.prefix}:sixth-buy`,
          authoritativeTimestamp: new Date(target.startsAt.getTime() + 4_000),
        },
      ),
    ).rejects.toMatchObject({ code: 'TOKEN_SLOT_LIMIT_REACHED' });
  });

  it('blocks disabled user trading while preserving forced liquidation capability', async () => {
    const target = await fixture('disabled');
    const executionRouter = router([marketFixture(target)]);
    await buy(target, executionRouter);
    executionRouter.setEnabled(REFERENCE_PROTOCOL_ID, false);
    await expect(
      sell(target, 1n, `${target.prefix}:blocked`, executionRouter),
    ).rejects.toMatchObject({
      code: 'PROTOCOL_DISABLED',
    });
    const settled = await settleHourlyRound(database, executionRouter, {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(settled.state).toBe('FINALIZED');
  });
});

describe('hourly forced settlement', () => {
  it('finalizes an empty round deterministically', async () => {
    const prefix = unique('empty-round');
    const startsAt = new Date(dayStart.getTime() + hour++ * 3_600_000);
    await createHourlyRound(database, {
      id: `${prefix}:round`,
      startsAt,
      endsAtExclusive: new Date(startsAt.getTime() + 3_600_000),
      state: 'OPEN',
      rulesVersion: 'phase-3c-tests',
    });
    const result = await settleHourlyRound(database, new ExecutionRouter(), {
      hourlyRoundId: `${prefix}:round`,
      authoritativeTimestamp: new Date(startsAt.getTime() + 3_600_000),
    });
    expect(result).toMatchObject({ state: 'FINALIZED', hourlyResults: [], failures: [] });
  });

  it('settles multiple positions in canonical order, creates exact hourly/daily results, and retries', async () => {
    const target = await fixture('multi-position');
    const second = await addReferenceMarket(target.prefix, 'two');
    const fixtures = [
      marketFixture(target, 20_000_000n, 0n),
      marketFixture({ ...target, ...second }, 10_000_000n, 0n),
    ];
    const executionRouter = router(fixtures);
    await buy(target, executionRouter, 1_000_000_000n);
    await executePaperBuy(database, executionRouter, {
      competitionAccountId: target.accountId,
      marketId: second.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${target.prefix}:buy-second`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 2_000),
    });
    const result = await settleHourlyRound(database, executionRouter, {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(result.state).toBe('FINALIZED');
    expect(result.forcedSells.map(({ marketId }) => marketId)).toEqual(
      [...result.forcedSells.map(({ marketId }) => marketId)].sort(),
    );
    expect(result.hourlyResults[0]).toMatchObject({
      finalSettledBalanceLamports: 10_000_000_000n,
      hourlyPnlLamports: 0n,
    });
    const daily = await database.pool.query<{
      cumulative_pnl_lamports: string;
      completed_hourly_round_count: number;
    }>(
      'select cumulative_pnl_lamports, completed_hourly_round_count from daily_results where user_id=$1',
      [target.userId],
    );
    expect(daily.rows[0]).toEqual({
      cumulative_pnl_lamports: '0',
      completed_hourly_round_count: 1,
    });
    const retry = await settleHourlyRound(database, executionRouter, {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_100),
    });
    expect(retry.state).toBe('FINALIZED');
    expect(
      (
        await database.pool.query<{ count: string }>(
          `select count(*)::text count from daily_result_hourly_results drh
           join hourly_results h on h.id=drh.hourly_result_id where h.hourly_round_id=$1`,
          [target.roundId],
        )
      ).rows[0]?.count,
    ).toBe('1');
  });

  it('finalizes no-trade accounts with zero P&L and handles multiple users independently', async () => {
    const target = await fixture('multi-user');
    const secondUser = `${target.prefix}:user-two`;
    const secondAccount = `${target.prefix}:account-two`;
    await createUser(database, { id: secondUser, walletAddress: `${target.prefix}:wallet-two` });
    await initializeCompetitionAccount(database, {
      accountId: secondAccount,
      userId: secondUser,
      hourlyRoundId: target.roundId,
      idempotencyKey: `${target.prefix}:initialize-two`,
    });
    await buy(target, router([marketFixture(target, 20_000_000n, 0n)]));
    const lossRouter = router([marketFixture(target, 10_000_000n, 0n)]);
    const result = await settleHourlyRound(database, lossRouter, {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(result.state).toBe('FINALIZED');
    const pnl = result.hourlyResults.map(({ hourlyPnlLamports }) => hourlyPnlLamports).sort();
    expect(pnl).toEqual([-1_000_000_000n, 0n]);
  });

  it('allows two workers to race without duplicate fills or results', async () => {
    const target = await fixture('settlement-race');
    const executionRouter = router([marketFixture(target, 25_000_000n, 0n)]);
    await buy(target, router([marketFixture(target, 20_000_000n, 0n)]));
    const at = new Date(target.startsAt.getTime() + 3_600_000);
    const outcomes = await Promise.all([
      settleHourlyRound(database, executionRouter, {
        hourlyRoundId: target.roundId,
        authoritativeTimestamp: at,
      }),
      settleHourlyRound(database, executionRouter, {
        hourlyRoundId: target.roundId,
        authoritativeTimestamp: at,
      }),
    ]);
    expect(outcomes.every(({ state }) => state === 'FINALIZED')).toBe(true);
    const counts = await database.pool.query<{ fills: string; results: string }>(
      `select
         (select count(*) from fills f join orders o on o.id=f.order_id
           where o.competition_account_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT')::text fills,
         (select count(*) from hourly_results where competition_account_id=$1)::text results`,
      [target.accountId],
    );
    expect(counts.rows[0]).toEqual({ fills: '1', results: '1' });
  });

  it('leaves the round retryable when an authoritative market is migrated', async () => {
    const target = await fixture('migrated');
    await buy(target);
    class MigratedReferenceAdapter extends ReferenceProtocolAdapter {
      override async loadMarketState(): Promise<MarketState> {
        throw new ExecutionEngineError('MARKET_MIGRATED', 'Curve is complete.');
      }
    }
    const result = await settleHourlyRound(
      database,
      new ExecutionRouter([new MigratedReferenceAdapter([marketFixture(target)])]),
      {
        hourlyRoundId: target.roundId,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
      },
    );
    expect(result.state).toBe('SETTLING');
    expect(result.failures[0]?.code).toBe('MARKET_MIGRATED');
    expect(
      (await getAccountFinancialState(database, target.accountId)).finalSettledBalanceLamports,
    ).toBeNull();
  });
});

class MutablePumpSource implements MarketStateSource {
  constructor(public state: MarketState) {}
  async loadMarketState(): Promise<MarketState> {
    return this.state;
  }
}

describe('Pump.fun BUY to SELL integration', () => {
  it('uses a newer supplied Pump state and replays both evidence-bound fills', async () => {
    const initial = recordedPumpState('developed');
    const prefix = unique('pump-lifecycle');
    const startsAt = new Date(dayStart.getTime() + hour++ * 3_600_000);
    const userId = `${prefix}:user`;
    const roundId = `${prefix}:round`;
    const accountId = `${prefix}:account`;
    await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
    await createHourlyRound(database, {
      id: roundId,
      startsAt,
      endsAtExclusive: new Date(startsAt.getTime() + 3_600_000),
      state: 'OPEN',
      rulesVersion: 'phase-3c-pump',
    });
    await createAsset(database, {
      id: `${prefix}:asset`,
      mintAddress: initial.identity.tokenMint,
      decimals: 6,
    });
    await createAsset(database, {
      id: `${prefix}:sol`,
      mintAddress: `${prefix}:sol-mint`,
      decimals: 9,
    });
    await createMarket(database, {
      id: initial.identity.marketId,
      baseAssetId: `${prefix}:asset`,
      quoteAssetId: `${prefix}:sol`,
      venue: initial.identity.protocolId,
      providerMarketId: initial.identity.marketId,
    });
    await initializeCompetitionAccount(database, {
      accountId,
      userId,
      hourlyRoundId: roundId,
      idempotencyKey: `${prefix}:initialize`,
    });
    const source = new MutablePumpSource(initial);
    const executionRouter = new ExecutionRouter([new PumpFunProtocolAdapter(source)]);
    const bought = await executePaperBuy(database, executionRouter, {
      competitionAccountId: accountId,
      marketId: initial.identity.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${prefix}:buy`,
      authoritativeTimestamp: new Date(startsAt.getTime() + 1_000),
    });
    source.state = {
      ...initial,
      observedAt: utcInstant(new Date(startsAt.getTime() + 2_000)),
      chainSlot: (initial.chainSlot ?? 0n) + 1n,
    } as MarketState;
    const sold = await executePaperSell(database, executionRouter, {
      competitionAccountId: accountId,
      marketId: initial.identity.marketId,
      requestedTokenQuantity: bought.actualTokenOutputBaseUnits,
      idempotencyKey: `${prefix}:sell`,
      authoritativeTimestamp: new Date(startsAt.getTime() + 2_000),
    });
    expect(sold.position.status).toBe('CLOSED');
    expect((await reconcileAccountLedger(database, accountId)).reconciled).toBe(true);
    await expect(
      replayPersistedFill(database, executionRouter, bought.fillId),
    ).resolves.toMatchObject({ matched: true });
    await expect(
      replayPersistedFill(database, executionRouter, sold.fillId),
    ).resolves.toMatchObject({ matched: true });
  });
});
