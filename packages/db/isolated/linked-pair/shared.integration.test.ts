import BN from 'bn.js';
import { tokenBaseUnits } from '@paperfund/core';
import { encodePool } from '../../../protocols/isolated/linked-pair/remaining-fixtures.js';
import {
  compositeInterval,
  crossingFixture,
} from '../../../protocols/isolated/linked-pair/remaining-fixtures.js';
import { linkedBindings } from '../../../protocols/isolated/linked-pair/shared-bridge.js';
import { readOrcaSnapshot, orcaLink } from '../../../protocols/src/composed-pump-orca.js';
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
  executePaperSell,
  executePaperSellAll,
  settleHourlyRound,
  reconcileAccountLedger,
  replayPersistedFill,
} from '../../src/financial-service.js';
import { LinkedStateStore, linkedCandidateRuntime, installLinkedTestSchema } from './store.js';
import type { CutoffFrontier } from './cutoff.js';
import { genericPumpSwapIdentity } from '../../../protocols/src/generic-pump-swap.js';
config({ path: resolve('.env'), quiet: true });
const retained = compositeInterval();
const identity = genericPumpSwapIdentity(
  retained.before.mint,
  retained.before.quoteMint,
  retained.before.bridgePool,
);
const name = 'paperfund_linked_test_shared_' + process.pid + '_' + Date.now();
let db: DatabaseService,
  admin: Pool,
  url: string,
  counter = 0;
beforeAll(async () => {
  const a = new URL(process.env.DATABASE_URL!);
  a.pathname = '/postgres';
  admin = new Pool({ connectionString: a.toString() });
  await admin.query('create database "' + name + '"');
  a.pathname = '/' + name;
  url = a.toString();
  db = createDatabase(url);
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
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
  const second = linkedBindings(retained.before).find((r) => r.mint !== identity.tokenMint)!;
  await createAsset(db, { id: 'second-base', mintAddress: second.mint, decimals: 6 });
  const secondIdentity = genericPumpSwapIdentity(second.mint, second.quoteMint, second.bridgePool);
  await createMarket(db, {
    id: secondIdentity.marketId,
    baseAssetId: 'second-base',
    quoteAssetId: 'sol',
    venue: secondIdentity.protocolId,
    providerMarketId: secondIdentity.marketId,
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
async function fixture(rewards = false) {
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
  const s = structuredClone(retained.before);
  if (rewards) {
    const crossing = await crossingFixture(true);
    for (const [k, a] of Object.entries(crossing.accounts)) s.accounts[k] = a;
  }
  const clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(s.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(s.slot), 0);
  raw.writeBigInt64LE(BigInt(cutoff.getTime() / 1000 - 1), 32);
  s.accounts[clock] = { ...s.accounts[clock]!, base64: raw.toString('base64') };
  s.observedAt = new Date(cutoff.getTime() - 500).toISOString();
  if (rewards) {
    const d = readOrcaSnapshot(
      orcaLink(s.bridgePool, s.accounts[s.bridgePool]!),
      s.accounts,
      true,
      s.absentAccounts,
    );
    d.data.rewardLastUpdatedTimestamp = new BN(String(cutoff.getTime() / 1000 - 6));
    await encodePool(s, d.data);
  }
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

const second = linkedBindings(retained.before).find((r) => r.mint !== identity.tokenMint)!;
const secondIdentity = genericPumpSwapIdentity(second.mint, second.quoteMint, second.bridgePool);
it('persists one revision across two targets, concurrent buys, partial/full sells and runtime restart', async () => {
  const f = await fixture(true);
  const buys = await Promise.all([f.buy(), f.buy(secondIdentity.marketId)]);
  expect(buys).toHaveLength(2);
  expect((await f.store.load()).revision).toBe('2');
  const secondFill = buys[1]!;
  const part = await executePaperSell(f.runtime.database, f.router, {
    competitionAccountId: f.account,
    marketId: secondIdentity.marketId,
    requestedTokenQuantity: secondFill.actualTokenOutputBaseUnits / 3n,
    idempotencyKey: 'partial:' + f.account,
    authoritativeTimestamp: new Date(f.s.observedAt),
  });
  expect(part.actualNetPaperSolOutputLamports).toBeGreaterThan(0n);
  await f.store.recover();
  const restarted = linkedCandidateRuntime(
      db,
      new LinkedStateStore(db, f.account, f.round),
      f.options,
    ),
    router = new ExecutionRouter([restarted.adapter]);
  for (const marketId of [identity.marketId, secondIdentity.marketId])
    await executePaperSellAll(restarted.database, router, {
      competitionAccountId: f.account,
      marketId,
      idempotencyKey: 'all:' + marketId + f.account,
      authoritativeTimestamp: new Date(f.s.observedAt),
    });
  expect(await counts(f.account)).toMatchObject({ fills: '5', receipts: '5' });
  expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  await f.store.recover();
  for (const row of (
    await db.pool.query(
      'select f.id from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
      [f.account],
    )
  ).rows)
    await replayPersistedFill(db, router, row.id);
});
it('seals one bridge across distinct targets and resumes cutoff after the first committed exit', async () => {
  const f = await fixture(true);
  await f.buy();
  await f.buy(secondIdentity.marketId);
  let exits = 0;
  const bind = f.runtime.database.bindMarketSettlementEvidence!;
  const database = {
    ...f.runtime.database,
    async bindMarketSettlementEvidence(...args: Parameters<typeof bind>) {
      if (++exits === 2) throw Error('TEST_INTERRUPTION');
      await bind(...args);
    },
  };
  f.advance();
  const first = await f.settle(database);
  expect(first.forcedSells).toHaveLength(1);
  const other = createDatabase(url);
  try {
    const store = new LinkedStateStore(other, f.account, f.round);
    await store.recover();
    const runtime = linkedCandidateRuntime(other, store, {
        ...f.options,
        cutoffFrontier: async () => {
          throw Error('NO_NEW_FRONTIER');
        },
        interval: async () => {
          throw Error('NO_POOL_RESET');
        },
      }),
      router = new ExecutionRouter([runtime.adapter]);
    const result = await f.settle(runtime.database, router);
    expect(result.state).toBe('FINALIZED');
    expect(result.failures).toEqual([]);
    expect(result.forcedSells).toHaveLength(1);
    await store.recover();
    const count = await counts(f.account);
    expect(count).toMatchObject({ fills: '4', receipts: '4' });
    expect((await f.settle(runtime.database, router)).forcedSells).toHaveLength(0);
    expect(await counts(f.account)).toEqual(count);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await other.close();
  }
});
it('rolls back both financial and shared bridge state after a failed second-target transaction', async () => {
  const f = await fixture();
  await f.buy();
  const before = await counts(f.account),
    head = await f.store.load(),
    commit = f.runtime.database.commitMarketExecution!;
  const failing = {
    ...f.runtime.database,
    async commitMarketExecution(...args: Parameters<typeof commit>) {
      await commit(...args);
      throw Error('TEST_AFTER_ALL_WRITES');
    },
  };
  await expect(
    executePaperBuy(failing, f.router, {
      competitionAccountId: f.account,
      marketId: secondIdentity.marketId,
      requestedPaperSolLamports: 100000000n,
      idempotencyKey: 'failed:' + f.account,
      authoritativeTimestamp: new Date(f.s.observedAt),
    }),
  ).rejects.toThrow('TEST_AFTER_ALL_WRITES');
  expect(await counts(f.account)).toEqual(before);
  expect((await f.store.load()).state_hash).toBe(head.state_hash);
  await f.store.recover();
  await f.buy(secondIdentity.marketId);
  expect((await f.store.load()).revision).toBe('2');
});

it('continues two partial forced exits from the same bridge seal after restart without duplicate effects', async () => {
  const f = await fixture(true);
  await f.buy();
  await f.buy(secondIdentity.marketId);
  f.advance();
  const partial = {
    ...f.runtime.database,
    preparePersistedSettlementStep: (
      input: Parameters<NonNullable<DatabaseService['preparePersistedSettlementStep']>>[0],
    ) => f.runtime.planSettlementStep(input, input.quantity / 4n),
  };
  const first = await f.settle(partial);
  expect(first.state).toBe('SETTLING');
  expect(first.forcedSells).toHaveLength(2);
  const other = createDatabase(url);
  try {
    const store = new LinkedStateStore(other, f.account, f.round);
    await store.recover();
    const runtime = linkedCandidateRuntime(other, store, f.options),
      router = new ExecutionRouter([runtime.adapter]);
    const final = await f.settle(runtime.database, router);
    expect(final.state).toBe('FINALIZED');
    expect(final.forcedSells).toHaveLength(2);
    expect(final.failures).toEqual([]);
    const rows = (
      await db.pool.query(
        'select seal_hash,revision from linked_candidate.settlement_steps where account_id=$1',
        [f.account],
      )
    ).rows;
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.seal_hash)).size).toBe(1);
    expect(new Set(rows.map((r) => r.revision)).size).toBe(4);
    await store.recover();
    expect(await counts(f.account)).toMatchObject({ fills: '6', receipts: '6', journals: '7' });
    const stable = await counts(f.account);
    await f.settle(runtime.database, router);
    expect(await counts(f.account)).toEqual(stable);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await other.close();
  }
});

it('values both targets through one ephemeral bridge and enforces the exact 20% cap without persisting valuation impact', async () => {
  const f = await fixture();
  await f.buy();
  await f.buy(secondIdentity.marketId);
  const rows = (
    await db.pool.query(
      'select p.id,p.remaining_base_units::text,a.mint_address,m.id market_id,m.venue from positions p join assets a on a.id=p.asset_id join markets m on m.id=p.market_id where p.competition_account_id=$1 order by p.id',
      [f.account],
    )
  ).rows;
  const inputs = rows.map((p) => ({
    positionId: p.id,
    identity: genericPumpSwapIdentity(
      p.mint_address,
      retained.before.quoteMint,
      retained.before.bridgePool,
    ),
    quantity: BigInt(p.remaining_base_units),
  }));
  const head = await f.store.load(),
    before = await counts(f.account),
    values = await f.runtime.database.valueMarketPortfolio!(inputs);
  let independent = 0n;
  for (const p of inputs) {
    const loaded = await f.router.loadPositionRoute(p.identity);
    independent += (
      await loaded.adapter.valuePositionForExit(
        { identity: p.identity, tokenQuantity: tokenBaseUnits(p.quantity) },
        loaded.state,
      )
    ).paperSolValue;
  }
  const sum = values.reduce((a, v) => a + v.value, 0n);
  expect(sum).toBeLessThan(independent);
  expect(values[0]!.evidence.fingerprint).not.toBe(values[1]!.evidence.fingerprint);
  expect((await f.store.load()).state_hash).toBe(head.state_hash);
  expect(await counts(f.account)).toEqual(before);
  const maximum = (BigInt(before.cash) + sum) / 5n;
  await expect(
    executePaperBuy(f.runtime.database, f.router, {
      competitionAccountId: f.account,
      marketId: identity.marketId,
      requestedPaperSolLamports: maximum + 1n,
      idempotencyKey: 'over-cap:' + f.account,
      authoritativeTimestamp: new Date(f.s.observedAt),
    }),
  ).rejects.toThrow('maximum-buy ratio');
  expect(await counts(f.account)).toEqual(before);
  await executePaperBuy(f.runtime.database, f.router, {
    competitionAccountId: f.account,
    marketId: identity.marketId,
    requestedPaperSolLamports: maximum,
    idempotencyKey: 'at-cap:' + f.account,
    authoritativeTimestamp: new Date(f.s.observedAt),
  });
  expect((await f.store.load()).revision).toBe('3');
  await f.store.recover();
});
