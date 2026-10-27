import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { ExecutionRouter } from '@paperfund/execution';
import { PumpFunProtocolAdapter } from '@paperfund/protocols';
import { recordedPumpState } from '../../protocols/test/fixtures/pump-real-chain.js';
import { createDatabase, type DatabaseService } from '../src/database.js';
import {
  createUser,
  createAsset,
  createMarket,
  createDailyCompetition,
  createHourlyRound,
  initializeCompetitionAccount,
  executePaperBuy,
  executePaperSellAll,
  settleHourlyRound,
} from '../src/financial-service.js';
import { currentQuoteHourlyProof, currentQuoteDailyProof } from '../src/current-quote-proof.js';
// Staged source remains separate from the installed financial guard.
import { withQuoteRewardHold } from '../../../apps/api/isolated/current-quotes/production-public/policy.mjs';
const name = 'distribution_proof_' + randomUUID().replaceAll('-', '');
const admin = new Pool({
  connectionString: 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta',
});
let db: DatabaseService;
const state = recordedPumpState('developed');
const router = new ExecutionRouter([
  new PumpFunProtocolAdapter({ loadMarketState: async () => structuredClone(state) }),
]);
const start = new Date('2045-01-01T00:00:00Z'),
  end = new Date(+start + 3600000);
beforeAll(async () => {
  await admin.query('create database "' + name + '"');
  db = createDatabase('postgresql://beta:disposable-beta-only@127.0.0.1:55462/' + name, {
    authorizePaperBuy: async () => true,
  });
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
  await createDailyCompetition(db, {
    id: 'day',
    utcDate: '2045-01-01',
    startsAt: start,
    endsAtExclusive: new Date(+start + 86400000),
  });
  await createHourlyRound(db, {
    id: 'hour',
    startsAt: start,
    endsAtExclusive: end,
    state: 'OPEN',
    rulesVersion: 'isolated-proof-test',
  });
  await createUser(db, { id: 'user', walletAddress: 'proof-test-wallet' });
  await createAsset(db, { id: 'asset', mintAddress: state.identity.tokenMint, decimals: 6 });
  await createAsset(db, {
    id: 'sol',
    mintAddress: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  });
  await createMarket(db, {
    id: state.identity.marketId,
    venue: state.identity.protocolId,
    providerMarketId: state.identity.marketId,
    baseAssetId: 'asset',
    quoteAssetId: 'sol',
  });
  await initializeCompetitionAccount(db, {
    accountId: 'account',
    userId: 'user',
    hourlyRoundId: 'hour',
    idempotencyKey: 'start',
  });
}, 30000);
afterAll(async () => {
  if (db) await db.close();
  await admin.query('drop database if exists "' + name + '" with(force)');
  await admin.end();
});
it('requires cutoff evidence for an open position and qualifies a genuine flat result without inventing an exit', async () => {
  await executePaperBuy(db, router, {
    competitionAccountId: 'account',
    marketId: state.identity.marketId,
    requestedPaperSolLamports: 1000000000n,
    idempotencyKey: 'buy',
    authoritativeTimestamp: new Date(+start + 60000),
  });
  const open = await currentQuoteHourlyProof(db, router, 'hour');
  expect(open.technicalReasons).toContain('RETAINED_CUTOFF_EXIT_EVIDENCE_REQUIRED');
  await executePaperSellAll(db, router, {
    competitionAccountId: 'account',
    marketId: state.identity.marketId,
    idempotencyKey: 'sell',
    authoritativeTimestamp: new Date(+start + 120000),
  });
  const flat = await currentQuoteHourlyProof(db, router, 'hour');
  expect(flat.accountingQualified).toBe(true);
  expect(flat.finalResultsQualified).toBe(false);
  expect(flat.payable).toBe(false);
  expect(
    (await settleHourlyRound(db, router, { hourlyRoundId: 'hour', authoritativeTimestamp: end }))
      .state,
  ).toBe('FINALIZED');
  const final = await currentQuoteHourlyProof(db, router, 'hour');
  expect(final.finalResultsQualified).toBe(true);
  expect(final.realFinancialAccepted).toBe(false);
  expect(final.payable).toBe(false);
});
it('retains the deployed blanket financial guard and makes retries produce one hourly/daily result', async () => {
  await expect(withQuoteRewardHold(db).prepareMarketSettlement('hour', end)).rejects.toThrow(
    'PUBLIC_PAPER_REWARD_QUALIFICATION_REQUIRED',
  );
  const before = (await db.pool.query('select count(*)::int n from daily_result_hourly_results'))
    .rows[0].n;
  await settleHourlyRound(db, router, { hourlyRoundId: 'hour', authoritativeTimestamp: end });
  expect(
    (await db.pool.query('select count(*)::int n from daily_result_hourly_results')).rows[0].n,
  ).toBe(before);
  expect((await db.pool.query('select count(*)::int n from hourly_results')).rows[0].n).toBe(1);
});
it('rejects materialized cash drift and retains historical REVIEW regardless of successful replay', async () => {
  await db.pool.query(
    'update competition_accounts set paper_sol_balance_lamports=paper_sol_balance_lamports+1 where id=$1',
    ['account'],
  );
  expect((await currentQuoteHourlyProof(db, router, 'hour')).accountingQualified).toBe(false);
  await db.pool.query(
    'update competition_accounts set paper_sol_balance_lamports=paper_sol_balance_lamports-1 where id=$1',
    ['account'],
  );
  const position = (await db.pool.query('select id from positions')).rows[0].id;
  await db.pool.query(
    "insert into legacy_source_reviews(id,hourly_round_id,position_id,reason) values('review','hour',$1,'ISOLATED_REVIEW_MUST_REMAIN')",
    [position],
  );
  expect((await currentQuoteHourlyProof(db, router, 'hour')).technicalReasons).toContain(
    'HISTORICAL_REVIEW_PRESERVED',
  );
  expect((await db.pool.query('select count(*)::int n from legacy_source_reviews')).rows[0].n).toBe(
    1,
  );
});
it('requires all 24 UTC hours and verifies daily cumulative contribution accounting', async () => {
  const proof = await currentQuoteDailyProof(db, router, 'day');
  expect(proof.reasons).toContain('UTC_24_HOUR_COVERAGE_REQUIRED');
  expect(proof.reasons).not.toContain('DAILY_CUMULATIVE_ACCOUNTING_MISMATCH');
  expect(proof.payable).toBe(false);
  await db.pool.query('update daily_results set cumulative_pnl_lamports=cumulative_pnl_lamports+1');
  expect((await currentQuoteDailyProof(db, router, 'day')).reasons).toContain(
    'DAILY_CUMULATIVE_ACCOUNTING_MISMATCH',
  );
});
