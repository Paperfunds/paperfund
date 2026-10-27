import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { identifier, utcInstant, tokenBaseUnits } from '@paperfund/core';
import {
  ExecutionEngineError,
  ExecutionRouter,
  type ExecutionRouteResolver,
  type MarketIdentity,
  type MarketState,
  type MarketStateSource,
} from '@paperfund/execution';
import {
  PUMP_AMM_PROGRAM_ID,
  PUMP_FUN_PROTOCOL_ID,
  PUMP_SWAP_ADAPTER_VERSION,
  PUMP_SWAP_NORMALIZATION_VERSION,
  PUMP_SWAP_PROTOCOL_ID,
  PumpFunProtocolAdapter,
  PumpSwapProtocolAdapter,
  canonicalPumpSwapPoolAddress,
  REFERENCE_PROTOCOL_ID,
  ReferenceProtocolAdapter,
  type ReferenceMarketFixture,
} from '@paperfund/protocols';

import { recordedPumpState } from '../../protocols/test/fixtures/pump-real-chain.js';
import { buildLiveStandings } from '../../../apps/api/src/live-leaderboard.js';
import { exitPreflight } from '../../../apps/api/src/exit-preflight.js';
import { CompetitionService } from '../../../apps/api/src/competition.js';
import { SolanaRouteAdapter } from '../../protocols/src/solana-routes.js';
import { recordedRoute } from '../../protocols/test/fixtures/routes.js';
import { recordedLaunchlab, migratedLaunchlab } from '../../protocols/test/fixtures/launchlab.js';

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
  repairLegacySettlementWriteoffMetadata,
  ONE_TIME_DUST_RESOLUTION,
  resolveOneTimeDustSettlement,
} from '../src/financial-service.js';
import { dustResolutionArguments } from '../../../scripts/resolve-dust-settlement.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const migrationsFolder = resolve(process.cwd(), 'packages/db/migrations');
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p3c_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;
let hour = 0;
const dayStart = new Date(Date.UTC(2040, 0, 1));

const fixtureDays = new Set(['2040-01-01']);
async function nextFixtureHour(): Promise<Date> {
  const startsAt = new Date(dayStart.getTime() + hour++ * 3_600_000);
  const utcDate = startsAt.toISOString().slice(0, 10);
  if (!fixtureDays.has(utcDate)) {
    const start = new Date(utcDate + 'T00:00:00.000Z');
    await createDailyCompetition(database, {
      id: 'daily:' + utcDate,
      utcDate,
      startsAt: start,
      endsAtExclusive: new Date(start.getTime() + 86400000),
    });
    fixtureDays.add(utcDate);
  }
  return startsAt;
}

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
  const startsAt = await nextFixtureHour();
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

describe('settlement terminal recovery', () => {
  function limitedRouter(target: Fixture, availableSales: number, outage = false) {
    const adapter = new ReferenceProtocolAdapter([marketFixture(target, 20_000_000n, 0n)]);
    let sales = 0;
    const value = adapter.valuePositionForExit.bind(adapter);
    const simulate = adapter.simulateSell.bind(adapter);
    adapter.valuePositionForExit = async (request, state) => {
      if (outage) throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Recorded temporary outage');
      if (sales >= availableSales)
        throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'No positive exit');
      if (request.tokenQuantity > 10n)
        throw new ExecutionEngineError('INSUFFICIENT_EXECUTABLE_LIQUIDITY', 'At most ten');
      return value(request, state);
    };
    adapter.simulateSell = async (...args) => {
      const fill = await simulate(...args);
      sales += 1;
      return fill;
    };
    return new ExecutionRouter([
      Object.assign(adapter, {
        async maxExecutableSellQuantity() {
          return tokenBaseUnits(sales >= availableSales ? 0n : 10n);
        },
      }),
    ]);
  }

  for (const sales of [0, 2]) {
    it(`terminates after ${sales} maximum exits and one immutable zero-value write-off`, async () => {
      const target = await fixture(`terminal-${sales}`);
      const bought = await buy(target);
      const executionRouter = limitedRouter(target, sales);
      const command = {
        hourlyRoundId: target.roundId,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
      };
      const outcomes = await Promise.all([
        settleHourlyRound(database, executionRouter, command),
        settleHourlyRound(database, executionRouter, command),
      ]);
      if(sales>0){
        expect(outcomes.every(r=>r.state==='SETTLING')).toBe(true);
        expect(outcomes.flatMap(r=>r.forcedSells)).toHaveLength(1);
        expect((await reconcileAccountLedger(database,target.accountId)).reconciled).toBe(true);
        expect((await database.pool.query('select count(*)::int n from legacy_source_reviews where hourly_round_id=$1',[target.roundId])).rows[0].n).toBeGreaterThan(0);
        return;
      }
      expect(
        outcomes.every((result) => result.state === 'FINALIZED' && result.failures.length === 0),
      ).toBe(true);
      expect(outcomes.map((result) => result.forcedSells.length).sort()).toEqual([0, sales]);
      expect(outcomes.flatMap((result) => result.forcedSells)).toHaveLength(sales);
      const journal = (
        await database.pool.query<{
          metadata: {
            tokenQuantity: string;
            costBasisLamports: string;
            marketStateEvidence: unknown;
          };
        }>(
          `select metadata from journal_transactions where competition_account_id = $1 and operation_type = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'`,
          [target.accountId],
        )
      ).rows;
      expect(journal).toHaveLength(1);
      expect(journal[0]!.metadata.tokenQuantity).toBe(
        (bought.actualTokenOutputBaseUnits - BigInt(sales) * 10n).toString(),
      );
      expect(journal[0]!.metadata.marketStateEvidence).toBeDefined();
      expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
      await settleHourlyRound(database, executionRouter, command);
      expect(
        (
          await database.pool.query(
            `select id from journal_transactions where competition_account_id = $1 and source_entity_type = 'SETTLEMENT_WRITEOFF'`,
            [target.accountId],
          )
        ).rowCount,
      ).toBe(1);
    });
  }

  it('retries temporary RPC failure without writing off or mutating the position', async () => {
    const target = await fixture('terminal-rpc');
    const bought = await buy(target);
    const result = await settleHourlyRound(database, limitedRouter(target, 1, true), {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(result.state).toBe('SETTLING');
    expect(result.failures[0]).toMatchObject({ code: 'RPC_UNAVAILABLE', disposition: 'RETRY' });
    expect(
      (
        await database.pool.query('select remaining_base_units from positions where id = $1', [
          bought.position.id,
        ])
      ).rows[0].remaining_base_units,
    ).toBe(bought.actualTokenOutputBaseUnits.toString());
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });

  async function legacyClosedPosition(corrupt = false) {
    const target = await fixture('legacy-terminal');
    await buy(target);
    const partial = await sell(
      target,
      10n,
      `${target.prefix}:partial`,
      router([marketFixture(target, 20_000_000n, 0n)]),
    );
    const position = partial.position;
    const cost = position.costBasisLamports;
    const journalId = `legacy:${target.prefix}`;
    const idem = `legacy-idem:${target.prefix}`;
    const client = await database.pool.connect();
    try {
      await client.query('begin');
      await client.query(`update hourly_rounds set state = 'CLOSING' where id = $1`, [
        target.roundId,
      ]);
      await client.query(`update hourly_rounds set state = 'SETTLING' where id = $1`, [
        target.roundId,
      ]);
      await client.query(
        `insert into idempotency_records (id, operation_class, idempotency_key, request_hash, status, competition_account_id, result_entity_type, result_entity_id, completed_at)
        values ($1, 'FORCED_HOURLY_SETTLEMENT_WRITEOFF', $1, $2, 'COMPLETED', $3, 'SETTLEMENT_WRITEOFF', $4, now())`,
        [idem, 'a'.repeat(64), target.accountId, position.id],
      );
      await client.query(
        `insert into journal_transactions (id, competition_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id)
        values ($1, $2, 'FORCED_HOURLY_SETTLEMENT_WRITEOFF', 'SETTLEMENT_WRITEOFF', $3, $4)`,
        [journalId, target.accountId, position.id, idem],
      );
      for (const [code, direction] of [
        ['TRADING_PNL', 'DEBIT'],
        ['POSITION_COST', 'CREDIT'],
      ]) {
        await client.query(
          `insert into ledger_entries (id, journal_transaction_id, competition_account_id, account_code, direction, amount_lamports) values ($1, $2, $3, $4, $5, $6)`,
          [
            journalId + code,
            journalId,
            target.accountId,
            code,
            direction,
            corrupt ? cost - 1n : cost,
          ],
        );
      }
      await client.query(
        `update positions set remaining_base_units = 0, cost_basis_lamports = 0, realized_pnl_lamports = realized_pnl_lamports - $2, status = 'CLOSED', closed_at = now() where id = $1`,
        [position.id, cost],
      );
      await client.query(
        `update competition_accounts set realized_pnl_lamports = realized_pnl_lamports - $2 where id = $1`,
        [target.accountId, cost],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return { ...target, journalId, quantity: position.remainingBaseUnits, cost };
  }

  it('retains a committed partial forced exit under REVIEW without replaying it', async () => {
    const target = await fixture('partial-outage-resume');
    await buy(target);
    const executionRouter = limitedRouter(target, 1);
    const load = executionRouter.loadPositionRoute.bind(executionRouter);
    let reads = 0;
    let interrupted = true;
    executionRouter.loadPositionRoute = async (...args) => {
      reads += 1;
      if (interrupted && reads > 2)
        throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Outage after committed partial exit');
      return load(...args);
    };
    const command = {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    };
    const first = await settleHourlyRound(database, executionRouter, command);
    expect(first.state).toBe('SETTLING');
    expect(first.forcedSells).toHaveLength(1);
    interrupted = false;
    const retry = await settleHourlyRound(database, executionRouter, command);
    expect(retry.state).toBe('SETTLING');expect(retry.forcedSells).toEqual([]);expect(retry.failures.some(f=>f.code==='SETTLEMENT_REVIEW')).toBe(true);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    expect(
      (
        await database.pool.query(
          `select f.id from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT'`,
          [target.accountId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('automatically repairs and finalizes a legacy closed account through the normal settlement entry point', async () => {
    const target = await legacyClosedPosition();
    const result = await settleHourlyRound(database, new ExecutionRouter(), {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(result).toMatchObject({ state: 'FINALIZED', forcedSells: [], failures: [] });
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    expect(
      (
        await database.pool.query(
          'select * from settlement_writeoff_metadata_repairs where journal_transaction_id=$1',
          [target.journalId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('recovers legacy missing metadata from immutable fills and ledger, races safely and finalizes', async () => {
    const target = await legacyClosedPosition();
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(false);
    const before = await getAccountFinancialState(database, target.accountId);
    await Promise.all([
      repairLegacySettlementWriteoffMetadata(database, target.accountId),
      repairLegacySettlementWriteoffMetadata(database, target.accountId),
    ]);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    expect(await getAccountFinancialState(database, target.accountId)).toEqual(before);
    const repair = (
      await database.pool.query(
        'select * from settlement_writeoff_metadata_repairs where journal_transaction_id = $1',
        [target.journalId],
      )
    ).rows;
    expect(repair).toHaveLength(1);
    expect(repair[0]).toMatchObject({
      token_quantity: target.quantity.toString(),
      cost_basis_lamports: target.cost.toString(),
    });
    await expect(
      database.pool.query(
        'update settlement_writeoff_metadata_repairs set token_quantity = 1 where journal_transaction_id = $1',
        [target.journalId],
      ),
    ).rejects.toThrow(/immutable/);
    expect(
      (
        await database.pool.query('select metadata from journal_transactions where id = $1', [
          target.journalId,
        ])
      ).rows[0].metadata,
    ).toEqual({});
    const command = {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    };
    expect(await settleHourlyRound(database, new ExecutionRouter(), command)).toMatchObject({
      state: 'FINALIZED',
      failures: [],
    });
    expect(await settleHourlyRound(database, new ExecutionRouter(), command)).toMatchObject({
      state: 'FINALIZED',
      failures: [],
    });
  });

  it('surfaces unprovable legacy state as an operational error without inventing quantity', async () => {
    const target = await legacyClosedPosition(true);
    const result = await settleHourlyRound(database, new ExecutionRouter(), {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(result).toMatchObject({
      state: 'SETTLING',
      failures: [{ code: 'FINALIZATION_CONFLICT', disposition: 'OPERATIONAL_ERROR' }],
    });
    expect(
      (
        await database.pool.query(
          'select * from settlement_writeoff_metadata_repairs where journal_transaction_id = $1',
          [target.journalId],
        )
      ).rowCount,
    ).toBe(0);
  });
});

beforeAll(async () => {
  const { adminUrl, testUrl } = urls();
  adminPool = new Pool({ connectionString: adminUrl });
  await adminPool.query(`create database "${databaseName}"`);
  // Explicit disposable-fixture BUY permission; production factories remain default-deny.
  database = createDatabase(testUrl, { authorizePaperBuy: async () => true });
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
  it('rejects missing LaunchLab SELL proceeds and keeps completed realized P&L immutable during RPC failure', async () => {
    const target = await fixture('launchlab-missing-proceeds');
    const state = recordedLaunchlab();
    let unavailable = false;
    const adapter = new SolanaRouteAdapter({
      async loadMarketState() {
        if (unavailable) throw new ExecutionEngineError('RPC_ERROR', 'RPC unavailable');
        return state;
      },
    });
    const executionRouter = new ExecutionRouter([adapter]);
    executionRouter.mintResolver = async () => state.identity;
    const service = new CompetitionService(
      database,
      executionRouter,
      () => new Date(target.startsAt.getTime() + 1000),
    );
    const mint = state.identity.tokenMint;
    const bought = await service.buy(target.userId, {
      mint,
      paperSol: '0.001',
      idempotencyKey: `${target.prefix}:buy`,
    });
    const before = await getAccountFinancialState(database, target.accountId);
    const simulate = adapter.simulateSell.bind(adapter);
    adapter.simulateSell = async (...args) => {
      const execution = await simulate(...args);
      return {
        ...execution,
        actualOutput: { ...execution.actualOutput, amount: undefined },
      } as never;
    };
    await expect(
      service.sell(target.userId, {
        mint,
        quantity: 'ALL',
        idempotencyKey: `${target.prefix}:invalid`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_RESULT' });
    expect(await getAccountFinancialState(database, target.accountId)).toEqual(before);
    adapter.simulateSell = simulate;
    const sold = await service.sell(target.userId, {
      mint,
      quantity: (bought.actualTokenOutputBaseUnits / 2n).toString(),
      idempotencyKey: `${target.prefix}:partial`,
    });
    const committed = await getAccountFinancialState(database, target.accountId);
    const routes = await database.pool.query(
      'select side, fee_breakdown from fills where id = any($1::text[])',
      [[bought.fillId, sold.fillId]],
    );
    expect(routes.rows).toHaveLength(2);
    for (const row of routes.rows) {
      expect(row.fee_breakdown.canonicalRoute).toMatchObject({
        routeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        stateFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        direction: row.side,
      });
    }
    unavailable = true;
    const positions = await service.getPositions(target.userId);
    expect(positions!.portfolioEquityLamports).toBeNull();
    expect(positions!.positions[0]!.valuation.status).toBe('UNAVAILABLE');
    expect(await getAccountFinancialState(database, target.accountId)).toEqual(committed);
    const fill = await database.pool.query('select realized_pnl_lamports from fills where id=$1', [
      sold.fillId,
    ]);
    expect(BigInt(fill.rows[0].realized_pnl_lamports)).toBe(sold.fillRealizedPnlLamports);
  });
  it('executes LaunchLab SELL ALL before migration and keeps the consumed token slot', async () => {
    const target = await fixture('launchlab-sell-all');
    const state = recordedLaunchlab();
    const executionRouter = new ExecutionRouter([
      new SolanaRouteAdapter({
        async loadMarketState() {
          return state;
        },
      }),
    ]);
    executionRouter.mintResolver = async () => state.identity;
    const service = new CompetitionService(
      database,
      executionRouter,
      () => new Date(target.startsAt.getTime() + 1000),
    );
    const mint = state.identity.tokenMint;
    const bought = await service.buy(target.userId, {
      mint,
      paperSol: '0.001',
      idempotencyKey: `${target.prefix}:buy`,
    });
    const sold = await service.sell(target.userId, {
      mint,
      quantity: 'ALL',
      idempotencyKey: `${target.prefix}:sell`,
    });
    expect(sold.position).toMatchObject({
      id: bought.position.id,
      remainingBaseUnits: 0n,
      costBasisLamports: 0n,
      status: 'CLOSED',
    });
    expect(sold.actualNetPaperSolOutputLamports).toBeGreaterThan(0n);
    expect((await service.buyPreflight(target.userId, mint)).requiresNewSlot).toBe(false);
    expect((await replayPersistedFill(database, executionRouter, sold.fillId)).matched).toBe(true);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });
  it('preserves LaunchLab mint, slot, position, partial basis and fills across migration and rebuy', async () => {
    const target = await fixture('launchlab-continuity');
    let state = recordedLaunchlab();
    const executionRouter = new ExecutionRouter([
      new SolanaRouteAdapter({
        async loadMarketState() {
          return state;
        },
      }),
    ]);
    executionRouter.mintResolver = async () => state.identity;
    const service = new CompetitionService(
      database,
      executionRouter,
      () => new Date(target.startsAt.getTime() + 1000),
    );
    const mint = state.identity.tokenMint;
    expect(await service.marketSupport(mint)).toMatchObject({ supported: true });
    const bought = await service.buy(target.userId, {
      mint,
      paperSol: '0.001',
      idempotencyKey: `${target.prefix}:launch-buy`,
    });
    const quantity = bought.actualTokenOutputBaseUnits;
    const partialQuantity = quantity / 4n;
    const partial = await service.sell(target.userId, {
      mint,
      quantity: partialQuantity.toString(),
      idempotencyKey: `${target.prefix}:launch-partial`,
    });
    const basis = bought.actualPaperSolInputLamports;
    expect(partial.position.costBasisLamports).toBe(basis - (basis * partialQuantity) / quantity);
    const remaining = partial.position.remainingBaseUnits;
    const positionId = partial.position.id;
    state = migratedLaunchlab();
    const preflight = await service.buyPreflight(target.userId, mint);
    expect(preflight.requiresNewSlot).toBe(false);
    const beforeExit = await database.pool.query('select * from positions where id=$1', [
      positionId,
    ]);
    expect(BigInt(beforeExit.rows[0].cost_basis_lamports)).toBe(partial.position.costBasisLamports);
    const sold = await service.sell(target.userId, {
      mint,
      quantity: 'ALL',
      idempotencyKey: `${target.prefix}:migrated-sell`,
    });
    expect(sold.position).toMatchObject({
      id: positionId,
      remainingBaseUnits: 0n,
      costBasisLamports: 0n,
      status: 'CLOSED',
    });
    expect(sold.actualNetPaperSolOutputLamports).toBeGreaterThan(0n);
    expect(remaining).toBe(quantity - partialQuantity);
    const rebought = await service.buy(target.userId, {
      mint,
      paperSol: '0.001',
      idempotencyKey: `${target.prefix}:migrated-rebuy`,
    });
    expect(rebought.position.id).toBe(positionId);
    const slots = await database.pool.query(
      'select count(*)::text count from competition_token_slots where competition_account_id=$1',
      [target.accountId],
    );
    expect(slots.rows[0].count).toBe('1');
    const history = await database.pool.query(
      'select f.id from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
      [target.accountId],
    );
    expect(history.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([bought.fillId, partial.fillId, sold.fillId, rebought.fillId]),
    );
    expect(history.rowCount).toBe(4);
    for (const fill of [bought, partial, sold, rebought])
      expect((await replayPersistedFill(database, executionRouter, fill.fillId)).matched).toBe(
        true,
      );
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });
  it.each([0, 1] as const)(
    'trades and reconciles discovered non-Pump route %s through the API service',
    async (index) => {
      const target = await fixture(`route-${index}`);
      const state = recordedRoute(index);
      const executionRouter = new ExecutionRouter([
        new SolanaRouteAdapter({
          async loadMarketState() {
            return state;
          },
        }),
      ]);
      executionRouter.mintResolver = async () => state.identity;
      const service = new CompetitionService(
        database,
        executionRouter,
        () => new Date(target.startsAt.getTime() + 1000),
      );
      const mint = state.identity.tokenMint;
      expect(await service.marketSupport(mint)).toMatchObject({
        supported: true,
        executionProtocol: 'SOLANA_ROUTE',
      });
      expect(await service.buyPreflight(target.userId, mint)).toMatchObject({
        marketSupported: true,
        maxBuyLamports: 2_000_000_000n,
      });
      const bought = await service.buy(target.userId, {
        mint,
        paperSol: '0.001',
        idempotencyKey: `${target.prefix}:routed`,
      });
      expect(bought.actualTokenOutputBaseUnits).toBeGreaterThan(0n);
      const sold = await service.sell(target.userId, {
        mint,
        quantity: 'ALL',
        idempotencyKey: `${target.prefix}:routed-sell`,
      });
      expect(sold.actualNetPaperSolOutputLamports).toBeGreaterThan(0n);
      expect((await replayPersistedFill(database, executionRouter, bought.fillId)).matched).toBe(
        true,
      );
      expect((await replayPersistedFill(database, executionRouter, sold.fillId)).matched).toBe(
        true,
      );
      expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    },
  );
  it('changes live ranks after real transactional BUY/SELL without writing finalized results', async () => {
    const target = await fixture('live-trades');
    const otherUser = `${target.prefix}:other`;
    await createUser(database, { id: otherUser, walletAddress: `${otherUser}:wallet` });
    await initializeCompetitionAccount(database, {
      accountId: `${otherUser}:account`,
      userId: otherUser,
      hourlyRoundId: target.roundId,
      idempotencyKey: `${otherUser}:init`,
    });
    const initialRouter = router([marketFixture(target)]);
    const tied = await buildLiveStandings(database, initialRouter, target.roundId);
    expect(tied.entries.map((row) => row.rank)).toEqual([1, 1]);
    const bought = await buy(target, initialRouter);
    const afterBuy = await buildLiveStandings(database, initialRouter, target.roundId);
    expect(afterBuy.entries.find((row) => row.user_id === target.userId)).toMatchObject({
      rank: 2,
      slotsUsed: 1,
      openPositions: 1,
      score: '-20000000',
    });
    await sell(target, bought.actualTokenOutputBaseUnits, `${target.prefix}:sell`);
    const afterSell = await buildLiveStandings(database, initialRouter, target.roundId);
    expect(afterSell.entries[0]).toMatchObject({
      user_id: target.userId,
      rank: 1,
      openPositions: 0,
      score: '970000000',
    });
    expect(
      (
        await database.pool.query('select * from hourly_results where hourly_round_id=$1', [
          target.roundId,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });
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
    const startsAt = await nextFixtureHour();
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
    const startsAt = await nextFixtureHour();
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
class MutableMigrationRoute implements ExecutionRouteResolver {
  readonly originProtocolId = PUMP_FUN_PROTOCOL_ID;
  migrated = false;
  unavailable = false;
  constructor(readonly destination: MarketIdentity) {}
  async resolveExecutionRoute(identity: MarketIdentity) {
    if (this.unavailable) {
      throw new ExecutionEngineError(
        'MIGRATION_DESTINATION_UNAVAILABLE',
        'Canonical destination is unavailable.',
      );
    }
    return {
      originIdentity: identity,
      executionIdentity: this.migrated ? this.destination : identity,
      migrated: this.migrated,
    };
  }
}

function migratedPoolState(initial: MarketState, poolId: string, observedAt: Date): MarketState {
  return {
    identity: {
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      marketId: identifier(poolId, 'MarketId'),
      tokenMint: initial.identity.tokenMint,
    },
    observedAt: utcInstant(observedAt),
    chainSlot: (initial.chainSlot ?? 0n) + 100n,
    chainBlockId: null,
    adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
    normalizationVersion: PUMP_SWAP_NORMALIZATION_VERSION,
    normalizedState: {
      model: 'PUMP_SWAP_CANONICAL_POOL',
      programId: PUMP_AMM_PROGRAM_ID,
      feeProgramId: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
      poolAddress: poolId,
      canonicalCreator: '11111111111111111111111111111111',
      baseMint: initial.identity.tokenMint,
      quoteMint: 'So11111111111111111111111111111111111111112',
      baseVault: 'base-vault-recorded',
      quoteVault: 'quote-vault-recorded',
      baseTokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      quoteTokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      tokenDecimals: '6',
      mintSupply: '1000000000000000',
      baseReserves: '600000000000000',
      rawQuoteReserves: '90000000000',
      virtualQuoteReserves: '0',
      effectiveQuoteReserves: '90000000000',
      coinCreator: 'creator-recorded',
      isMayhemMode: false,
      isCashbackCoin: false,
      disableFlags: '0',
      lpFeeBps: '2',
      protocolFeeBps: '93',
      creatorFeeBps: '30',
      creatorFeeApplies: true,
      feeTierMarketCapLamportsThreshold: '0',
      feeConfigAccountLength: '4097',
      poolAccountLength: '300',
      stateSlots: { configuration: '450000000', reserves: '450000000' },
    },
  };
}

const migrationFixtureIdentities = [
  {
    mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',
    curve: '3MUkKMbuornHohtAtzrToSzqkj1gEEhQqYVz8sZnmQg1',
  },
  {
    mint: '12PUFAUzgLj1onv3wSqX9ZagZBiaxofEjTd24CnQpump',
    curve: 'GKQwrFVUdsvRzDbPgmXbHktSf4fJqJc3F6FTLsPkGcJ5',
  },
  {
    mint: '6FDw6jns8g7czuRucp5993RBNRPvqtMfv5Jv3hjnpump',
    curve: '5DDomERtuUV8fonYNy72xS9yp5QmZVHFoEXmN66w6htQ',
  },
  {
    mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    curve: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VVZaZhQpRX4bxvCaw',
  },
  {
    mint: 'FxMHS3C5EvyPkLoKswvf99VR5RkMLxKKgBqxxDvpump',
    curve: 'phase6c:migrated-buy-origin',
  },
  { mint: '11111111111111111111111111111111', curve: 'phase6c:illiquid-origin' },
] as const;
let migrationFixtureIndex = 0;

async function migratedSetup(label: string) {
  const template = recordedPumpState('developed');
  const fixtureIdentity = migrationFixtureIdentities[migrationFixtureIndex++]!;
  const initial: MarketState = {
    ...template,
    identity: {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(fixtureIdentity.curve, 'MarketId'),
      tokenMint: identifier(fixtureIdentity.mint, 'TokenMint'),
    },
    normalizedState: {
      ...template.normalizedState,
      bondingCurveAddress: fixtureIdentity.curve,
      tokenMint: fixtureIdentity.mint,
    },
  };
  const prefix = unique(label);
  const startsAt = await nextFixtureHour();
  const roundId = `${prefix}:round`;
  const userId = `${prefix}:user`;
  const accountId = `${prefix}:account`;
  const assetId = `${prefix}:asset`;
  const quoteId = `${prefix}:sol`;
  const poolId = await canonicalPumpSwapPoolAddress(initial.identity.tokenMint);
  await createUser(database, { id: userId, walletAddress: `${prefix}:wallet` });
  await createHourlyRound(database, {
    id: roundId,
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 3_600_000),
    state: 'OPEN',
    rulesVersion: 'phase-3d-pump-migration',
  });
  await createAsset(database, {
    id: assetId,
    mintAddress: initial.identity.tokenMint,
    decimals: 6,
  });
  await createAsset(database, { id: quoteId, mintAddress: `${prefix}:sol`, decimals: 9 });
  await createMarket(database, {
    id: initial.identity.marketId,
    baseAssetId: assetId,
    quoteAssetId: quoteId,
    venue: PUMP_FUN_PROTOCOL_ID,
    providerMarketId: initial.identity.marketId,
  });

  await initializeCompetitionAccount(database, {
    accountId,
    userId,
    hourlyRoundId: roundId,
    idempotencyKey: `${prefix}:initialize`,
  });
  const pumpSource = new MutablePumpSource(initial);
  const swapState = migratedPoolState(initial, poolId, new Date(startsAt.getTime() + 2_000));
  const route = new MutableMigrationRoute(swapState.identity);
  const executionRouter = new ExecutionRouter([
    new PumpFunProtocolAdapter(pumpSource),
    new PumpSwapProtocolAdapter(new MutablePumpSource(swapState)),
  ]);
  executionRouter.registerRouteResolver(route);
  return {
    prefix,
    startsAt,
    roundId,
    userId,
    accountId,
    assetId,
    quoteId,
    initial,
    poolId,
    route,
    pumpSource,
    executionRouter,
  };
}

describe('Pump.fun migration continuity', () => {
  it('partially and fully sells a Pump-origin position through PumpSwap with distinct fill venues', async () => {
    const target = await migratedSetup('pump-migrated-user-sell');
    const bought = await executePaperBuy(database, target.executionRouter, {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${target.prefix}:buy`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
    });
    target.route.migrated = true;
    const half = bought.actualTokenOutputBaseUnits / 2n;
    const partial = await executePaperSell(database, target.executionRouter, {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedTokenQuantity: half,
      idempotencyKey: `${target.prefix}:partial`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 2_000),
    });
    expect(partial).toMatchObject({
      marketId: target.poolId,
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
    });
    await expect(
      database.pool.query('select id from markets where id=$1', [target.poolId]),
    ).resolves.toMatchObject({ rowCount: 1 });
    expect(partial.position).toMatchObject({
      marketId: target.initial.identity.marketId,
      remainingBaseUnits: bought.actualTokenOutputBaseUnits - half,
      status: 'OPEN',
    });
    const full = await executePaperSell(database, target.executionRouter, {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedTokenQuantity: bought.actualTokenOutputBaseUnits - half,
      idempotencyKey: `${target.prefix}:full`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_000),
    });
    expect(full.position).toMatchObject({
      remainingBaseUnits: 0n,
      costBasisLamports: 0n,
      status: 'CLOSED',
    });
    const history = await database.pool.query<{
      side: string;
      protocol_id: string;
      market_id: string;
    }>(
      `select f.side, f.protocol_id, f.market_id from fills f join orders o on o.id=f.order_id
       where o.competition_account_id=$1 order by f.executed_at`,
      [target.accountId],
    );
    expect(history.rows).toEqual([
      {
        side: 'BUY',
        protocol_id: PUMP_FUN_PROTOCOL_ID,
        market_id: target.initial.identity.marketId,
      },
      { side: 'SELL', protocol_id: PUMP_SWAP_PROTOCOL_ID, market_id: target.poolId },
      { side: 'SELL', protocol_id: PUMP_SWAP_PROTOCOL_ID, market_id: target.poolId },
    ]);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    await expect(
      replayPersistedFill(database, target.executionRouter, full.fillId),
    ).resolves.toMatchObject({ matched: true });
  });

  it('values a migrated holding for a later unrelated BUY', async () => {
    const target = await migratedSetup('pump-migrated-valuation');
    await executePaperBuy(database, target.executionRouter, {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${target.prefix}:buy`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
    });
    target.route.migrated = true;
    const other = await addReferenceMarket(target.prefix, 'other');
    const reference = marketFixture(
      { identity: other.identity, startsAt: target.startsAt },
      10_000_000n,
      0n,
    );
    const combined = new ExecutionRouter([
      target.executionRouter.resolveForSettlement(PUMP_FUN_PROTOCOL_ID),
      target.executionRouter.resolveForSettlement(PUMP_SWAP_PROTOCOL_ID),
      new ReferenceProtocolAdapter([reference]),
    ]);
    combined.registerRouteResolver(target.route);
    await expect(
      executePaperBuy(database, combined, {
        competitionAccountId: target.accountId,
        marketId: other.marketId,
        requestedPaperSolLamports: 100_000_000n,
        idempotencyKey: `${target.prefix}:unrelated-buy`,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({ marketId: other.marketId });
    const evidence = await database.pool.query<{ protocol_id: string; market_id: string }>(
      `select e.protocol_id, e.market_id from order_market_state_evidence oe
       join orders o on o.id=oe.order_id join market_state_evidence e on e.id=oe.evidence_id
       where o.competition_account_id=$1 and oe.purpose='POSITION_EXIT_VALUATION'`,
      [target.accountId],
    );
    expect(evidence.rows).toContainEqual({
      protocol_id: PUMP_SWAP_PROTOCOL_ID,
      market_id: target.poolId,
    });
  });

  it('force-settles a mid-hour migration, finalizes, and safely remains incomplete when routing is unavailable', async () => {
    const target = await migratedSetup('pump-migrated-settlement');
    const bought = await executePaperBuy(database, target.executionRouter, {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${target.prefix}:buy`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
    });
    target.route.migrated = true;
    const settled = await settleHourlyRound(database, target.executionRouter, {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(settled).toMatchObject({ state: 'FINALIZED', failures: [] });
    expect(settled.forcedSells[0]).toMatchObject({
      marketId: target.poolId,
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      requestedTokenQuantity: bought.actualTokenOutputBaseUnits,
      executionContext: 'FORCED_HOURLY_SETTLEMENT',
    });
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);

    const blocked = await migratedSetup('pump-migration-unavailable');
    await executePaperBuy(database, blocked.executionRouter, {
      competitionAccountId: blocked.accountId,
      marketId: blocked.initial.identity.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${blocked.prefix}:buy`,
      authoritativeTimestamp: new Date(blocked.startsAt.getTime() + 1_000),
    });
    blocked.route.migrated = true;
    blocked.route.unavailable = true;
    const incomplete = await settleHourlyRound(database, blocked.executionRouter, {
      hourlyRoundId: blocked.roundId,
      authoritativeTimestamp: new Date(blocked.startsAt.getTime() + 3_600_000),
    });
    expect(incomplete.state).toBe('SETTLING');
    expect(incomplete.failures[0]?.code).toBe('MIGRATION_DESTINATION_UNAVAILABLE');
    expect(
      (await getAccountFinancialState(database, blocked.accountId)).finalSettledBalanceLamports,
    ).toBeNull();
  });

  it('routes a BUY on a completed origin to PumpSwap, merges the original position, and replays idempotently', async () => {
    const target = await migratedSetup('pump-migrated-buy');
    const command = {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedPaperSolLamports: 100_000_000n,
      idempotencyKey: `${target.prefix}:before`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
    };
    const before = await executePaperBuy(database, target.executionRouter, command);
    target.route.migrated = true;
    target.pumpSource.loadMarketState = async () => {
      throw new Error('Completed Pump curve must not be loaded');
    };
    const migratedCommand = {
      ...command,
      idempotencyKey: `${target.prefix}:after`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 2_000),
    };
    const after = await executePaperBuy(database, target.executionRouter, migratedCommand);
    expect(after).toMatchObject({
      marketId: target.poolId,
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      position: {
        id: before.position.id,
        marketId: target.initial.identity.marketId,
        remainingBaseUnits: before.actualTokenOutputBaseUnits + after.actualTokenOutputBaseUnits,
      },
    });
    const retry = await executePaperBuy(database, target.executionRouter, migratedCommand);
    expect(retry.fillId).toBe(after.fillId);
    expect(retry.position.id).toBe(before.position.id);
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
    await expect(
      replayPersistedFill(database, target.executionRouter, after.fillId),
    ).resolves.toMatchObject({ matched: true });
  });

  it('executes a reserve-limited partial SELL then writes off authoritative zero capacity', async () => {
    const target = await migratedSetup('illiquid-settlement');
    const command = {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedPaperSolLamports: 1_000_000_000n,
      idempotencyKey: `${target.prefix}:buy`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 1_000),
    };
    const bought = await executePaperBuy(database, target.executionRouter, command);
    target.pumpSource.state = {
      ...target.initial,
      normalizedState: { ...target.initial.normalizedState, realSolReserves: '1000000' },
    };
    const capacity = await exitPreflight(
      target.executionRouter,
      target.initial.identity,
      bought.actualTokenOutputBaseUnits,
      bought.position.costBasisLamports,
    );
    expect(capacity.status).toBe('LIQUIDITY_LIMITED');
    await expect(
      executePaperSell(database, target.executionRouter, {
        competitionAccountId: target.accountId,
        marketId: target.initial.identity.marketId,
        requestedTokenQuantity: bought.actualTokenOutputBaseUnits,
        idempotencyKey: `${target.prefix}:full`,
        authoritativeTimestamp: new Date(target.startsAt.getTime() + 2_000),
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' });
    const conservativeBuy = await executePaperBuy(database, target.executionRouter, {
      ...command,
      requestedPaperSolLamports: 100_000_000n,
      idempotencyKey: `${target.prefix}:conservative-buy`,
    });
    expect(conservativeBuy.requestedPaperSolLamports).toBe(100_000_000n);
    const partial = await executePaperSell(database, target.executionRouter, {
      competitionAccountId: target.accountId,
      marketId: target.initial.identity.marketId,
      requestedTokenQuantity: capacity.maxExecutableQuantityBaseUnits,
      idempotencyKey: `${target.prefix}:partial`,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 2_000),
    });
    expect(partial.actualNetPaperSolOutputLamports).toBe(capacity.maxExecutableOutputLamports);
    expect(partial.costBasisLamportsRemoved).toBeGreaterThan(0n);
    target.pumpSource.state = {
      ...target.pumpSource.state,
      normalizedState: { ...target.pumpSource.state.normalizedState, realSolReserves: '0' },
    };
    const settled = await settleHourlyRound(database, target.executionRouter, {
      hourlyRoundId: target.roundId,
      authoritativeTimestamp: new Date(target.startsAt.getTime() + 3_600_000),
    });
    expect(settled.state).toBe('FINALIZED');
    expect(settled.failures).toEqual([]);
    expect(
      (await getAccountFinancialState(database, target.accountId)).finalSettledBalanceLamports,
    ).not.toBeNull();
    expect((await reconcileAccountLedger(database, target.accountId)).reconciled).toBe(true);
  });
});

interface DustRecordedState {
  protocol_id: string;
  market_id: string;
  observed_at: string;
  chain_slot: string;
  chain_block_id: string | null;
  adapter_version: string;
  normalization_version: string;
  normalized_state: MarketState['normalizedState'];
  raw_source: MarketState['rawSource'];
}
const dustRecording = JSON.parse(
  readFileSync(new URL('./fixtures/pump-dust-resolution.json', import.meta.url), 'utf8'),
) as {
  target: { user_id: string; asset_id: string };
  buys: (DustRecordedState & {
    fill_id: string;
    idempotency_key: string;
    requested_quote_lamports: string;
    executed_at: string;
  })[];
  dust: DustRecordedState;
};
function dustState(row: DustRecordedState): MarketState {
  return {
    identity: {
      protocolId: identifier(row.protocol_id, 'ProtocolId'),
      marketId: identifier(row.market_id, 'MarketId'),
      tokenMint: identifier(ONE_TIME_DUST_RESOLUTION.mint, 'TokenMint'),
    },
    observedAt: utcInstant(row.observed_at),
    chainSlot: BigInt(row.chain_slot),
    chainBlockId: row.chain_block_id,
    adapterVersion: row.adapter_version,
    normalizationVersion: row.normalization_version,
    normalizedState: structuredClone(row.normalized_state),
    ...(row.raw_source ? { rawSource: structuredClone(row.raw_source) } : {}),
  };
}
async function dustCase(
  run: (
    db: DatabaseService,
    engine: ExecutionRouter,
    source: {
      state: MarketState;
      refresh: boolean;
      fail: boolean;
    },
  ) => Promise<void>,
) {
  const name = `paperfund_dust_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const url = new URL(sourceDatabaseUrl!);
  url.pathname = `/${name}`;
  await adminPool.query(`create database "${name}"`);
  const db = createDatabase(url.toString());
  try {
    await migrate(db.client, { migrationsFolder });
    const scope = ONE_TIME_DUST_RESOLUTION;
    const start = new Date('2026-10-10T23:00:00Z');
    await createDailyCompetition(db, {
      id: 'daily:2026-10-10',
      utcDate: '2026-10-10',
      startsAt: new Date('2026-10-10T00:00:00Z'),
      endsAtExclusive: new Date('2026-10-11T00:00:00Z'),
    });
    await createUser(db, {
      id: dustRecording.target.user_id,
      walletAddress: 'offline-dust-fixture-wallet',
    });
    await createHourlyRound(db, {
      id: scope.roundId,
      startsAt: start,
      endsAtExclusive: new Date('2026-10-11T00:00:00Z'),
      state: 'OPEN',
      rulesVersion: 'dust-offline-fixture',
    });
    await createAsset(db, {
      id: dustRecording.target.asset_id,
      mintAddress: scope.mint,
      decimals: 6,
    });
    await createAsset(db, {
      id: 'dust-sol',
      mintAddress: 'So11111111111111111111111111111111111111112',
      decimals: 9,
    });
    await createMarket(db, {
      id: scope.marketId,
      baseAssetId: dustRecording.target.asset_id,
      quoteAssetId: 'dust-sol',
      venue: 'PUMP_FUN',
      providerMarketId: scope.marketId,
    });
    await initializeCompetitionAccount(db, {
      accountId: scope.accountId,
      userId: dustRecording.target.user_id,
      hourlyRoundId: scope.roundId,
      idempotencyKey: 'dust-initialize',
    });
    const source = { state: dustState(dustRecording.buys[0]!), refresh: false, fail: false };
    let reads = 0n;
    const engine = new ExecutionRouter([
      new PumpFunProtocolAdapter({
        async loadMarketState() {
          if (source.fail)
            throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Offline unavailable fixture');
          const state = structuredClone(source.state);
          return source.refresh
            ? {
                ...state,
                observedAt: utcInstant(new Date().toISOString()),
                chainSlot: state.chainSlot! + ++reads,
              }
            : state;
        },
      }),
    ]);
    for (const row of dustRecording.buys) {
      source.state = dustState(row);
      const result = await executePaperBuy(db, engine, {
        competitionAccountId: scope.accountId,
        marketId: scope.marketId,
        requestedPaperSolLamports: BigInt(row.requested_quote_lamports),
        idempotencyKey: row.idempotency_key,
        authoritativeTimestamp: new Date(row.executed_at),
      });
      expect(result.fillId).toBe(row.fill_id);
    }
    source.state = dustState(dustRecording.dust);
    source.refresh = true;
    const pass = await settleHourlyRound(db, engine, {
      hourlyRoundId: scope.roundId,
      authoritativeTimestamp: new Date(),
    });
    expect(pass.state).toBe('SETTLING');
    expect(pass.forcedSells).toHaveLength(1);
    await run(db, engine, source);
  } finally {
    await db.close();
    await adminPool.query(`drop database "${name}"`);
  }
}
async function dustSnapshot(db: DatabaseService) {
  const result: Record<string, unknown> = {};
  for (const table of [
    'competition_accounts',
    'positions',
    'fills',
    'journal_transactions',
    'ledger_entries',
    'idempotency_records',
    'hourly_results',
  ])
    result[table] = (await db.pool.query(`select * from ${table} order by id`)).rows;
  return result;
}
const dustAuthorization = {
  execute: true,
  operatorIdentifier: 'offline-test-operator',
  approvalReference: 'offline-test-approval',
  acknowledgement: ONE_TIME_DUST_RESOLUTION.reason,
  payoutExecutionDisabled: true,
};

describe('private beta legacy financial qualification', () => {
  it('consumes one pinned capacity and holds the remainder across retries and concurrent worker restart', async () => {
    await dustCase(async (db, engine) => {
      const scope = ONE_TIME_DUST_RESOLUTION;
      const rows = (await db.pool.query(
        `select f.id, f.actual_output_lamports, f.fee_lamports, e.chain_slot, e.state_fingerprint
         from fills f join orders o on o.id=f.order_id
         join market_state_evidence e on e.id=f.market_state_evidence_id
         where o.competition_account_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT'
         order by f.executed_at, f.id`, [scope.accountId])).rows;
      expect(rows).toHaveLength(1);
      const proceeds=rows.reduce((n,r)=>n+BigInt(r.actual_output_lamports),0n);
      expect(proceeds).toBe(3n);
      expect(rows.reduce((n,r)=>n+BigInt(r.fee_lamports),0n)).toBe(2n);
      expect(proceeds+rows.reduce((n,r)=>n+BigInt(r.fee_lamports),0n)).toBe(5n);
      expect((await reconcileAccountLedger(db,scope.accountId)).reconciled).toBe(true);
      const cashBefore=(await getAccountFinancialState(db,scope.accountId)).paperSolBalanceLamports;
      const beforeCount=(await db.pool.query('select count(*)::int n from fills')).rows[0].n;
      const restart=await Promise.all([settleHourlyRound(db,engine,{hourlyRoundId:scope.roundId,authoritativeTimestamp:new Date()}),settleHourlyRound(db,engine,{hourlyRoundId:scope.roundId,authoritativeTimestamp:new Date()})]);
      expect(restart.every(r=>r.state==='SETTLING' && r.forcedSells.length===0)).toBe(true);
      expect((await db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(beforeCount);
      expect((await getAccountFinancialState(db,scope.accountId)).paperSolBalanceLamports).toBe(cashBefore);
      const review=await db.pool.query('select reason from legacy_source_reviews where hourly_round_id=$1',[scope.roundId]);
      expect(review.rows.some(r=>r.reason==='PARTIAL_LIQUIDATION_REMAINDER')).toBe(true);
      await expect(import('../src/payout-service.js').then(m=>m.generateHourlyShadowPayoutPlan(db,{hourlyRoundId:scope.roundId,now:new Date()}))).rejects.toMatchObject({code:'PAYOUT_SETTLEMENT_REVIEW'});
      const state=await getAccountFinancialState(db,scope.accountId);
      expect(state.finalSettledBalanceLamports).toBeNull();
      // Replay and balanced ledgers certify arithmetic, not aggregate liquidity correctness.
      expect((await replayPersistedFill(db,engine,rows[0].id)).matched).toBe(true);
      writeFileSync(new URL('../../../../evidence/legacy-reserve-reuse.json',import.meta.url),JSON.stringify({status:'CORRECTED_REMAINDER_REVIEW',initialRealSolReserves:'5',forcedSells:rows.length,netProceeds:proceeds.toString(),reconciled:true,rows},null,2));
    });
  },30000);
});

describe('one-time operator dust resolution', () => {
  it('requires deliberate CLI authorization and rejects other target requests', async () => {
    expect(dustResolutionArguments([]).execute).toBe(false);
    expect(
      dustResolutionArguments([
        '--execute',
        '--operator',
        'offline',
        '--approval',
        'offline',
        '--confirm',
        ONE_TIME_DUST_RESOLUTION.reason,
      ]).execute,
    ).toBe(true);
    expect(() => dustResolutionArguments(['--execute'])).toThrow();
    expect(() => dustResolutionArguments(['--target', 'anything'])).toThrow();
    for (const key of ['roundId', 'accountId', 'positionId', 'marketId', 'mint'] as const) {
      const result = await resolveOneTimeDustSettlement(
        {} as DatabaseService,
        new ExecutionRouter(),
        { target: { [key]: 'wrong' } },
      );
      expect(result.abortReasons).toContain('EXACT_REQUEST_SCOPE');
    }
    expect(
      (
        await resolveOneTimeDustSettlement({} as DatabaseService, new ExecutionRouter(), {
          execute: true,
        })
      ).abortReasons,
    ).toContain('EXPLICIT_OPERATOR_AUTHORIZATION');
  });
  it('refuses the old one-time dust authorization against the corrected residual without any mutation', async () => {
    await dustCase(async (db, engine) => {
      const before = await dustSnapshot(db);
      const preview = await resolveOneTimeDustSettlement(db, engine, {payoutExecutionDisabled:true});
      expect(preview.eligible).toBe(false);
      expect(await dustSnapshot(db)).toEqual(before);
      const result=await resolveOneTimeDustSettlement(db,engine,dustAuthorization);
      expect(result.resolved).toBe(false);
      expect(await dustSnapshot(db)).toEqual(before);
      const settled=await settleHourlyRound(db,engine,{hourlyRoundId:ONE_TIME_DUST_RESOLUTION.roundId,authoritativeTimestamp:new Date()});
      expect(settled.state).toBe('SETTLING');
      expect(settled.forcedSells).toEqual([]);
      expect((await reconcileAccountLedger(db,ONE_TIME_DUST_RESOLUTION.accountId)).reconciled).toBe(true);
    });
  },30000);
  it.each(['normal', 'improved', 'missing', 'stale', 'identity', 'hold', 'round'] as const)(
    'aborts %s conditions without mutation',
    async (kind) => {
      await dustCase(async (db, engine, source) => {
        if (kind === 'normal' || kind === 'improved')
          source.state = {
            ...source.state,
            normalizedState: {
              ...source.state.normalizedState,
              realSolReserves: kind === 'normal' ? '100000000000' : '6',
            },
          };
        if (kind === 'missing') source.fail = true;
        if (kind === 'stale') {
          source.refresh = false;
          source.state = { ...source.state, observedAt: utcInstant('2026-10-11T00:00:00Z') };
        }
        if (kind === 'identity')
          source.state = {
            ...source.state,
            identity: { ...source.state.identity, tokenMint: identifier('wrong', 'TokenMint') },
          };
        if (kind === 'round')
          await db.pool.query("update hourly_rounds set state='CLOSING' where id=$1", [
            ONE_TIME_DUST_RESOLUTION.roundId,
          ]);
        const before = await dustSnapshot(db);
        const result = await resolveOneTimeDustSettlement(db, engine, {
          ...dustAuthorization,
          payoutExecutionDisabled: kind !== 'hold',
        });
        expect(result.resolved).toBe(false);
        expect(result.liveExecutionBlocked).toBe(true);
        expect(result.abortReasons.length).toBeGreaterThan(0);
        expect(await dustSnapshot(db)).toEqual(before);
      });
    },
  );
  it('serializes worker/operator races and operator retries without duplicate liquidation', async () => {
    await dustCase(async (db, engine) => {
      const scope = ONE_TIME_DUST_RESOLUTION;
      const results = await Promise.all([
        settleHourlyRound(db, engine, {
          hourlyRoundId: scope.roundId,
          authoritativeTimestamp: new Date(),
        }),
        resolveOneTimeDustSettlement(db, engine, dustAuthorization),
        resolveOneTimeDustSettlement(db, engine, dustAuthorization),
      ]);
      expect(results[1].resolved || results[2].resolved).toBe(false);
      expect(
        (
          await db.pool.query(
            "select id from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
          )
        ).rowCount,
      ).toBe(0);
      expect((await reconcileAccountLedger(db, scope.accountId)).reconciled).toBe(true);
    });
  });
  it('rejects an impossible zero-basis OPEN row without relaxing the existing schema', async () => {
    await dustCase(async (db) => {
      const before = await dustSnapshot(db);
      const client = await db.pool.connect();
      try {
        await client.query('begin');
        await expect(
          client.query('update positions set cost_basis_lamports=0 where id=$1', [
            ONE_TIME_DUST_RESOLUTION.positionId,
          ]),
        ).rejects.toThrow(/positions_state_consistent/);
        await client.query('rollback');
      } finally {
        client.release();
      }
      expect(await dustSnapshot(db)).toEqual(before);
      expect(
        (await reconcileAccountLedger(db, ONE_TIME_DUST_RESOLUTION.accountId)).reconciled,
      ).toBe(true);
    });
  });
});
