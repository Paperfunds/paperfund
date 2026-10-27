import bs58 from 'bs58';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as dotenv } from 'dotenv';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { ExecutionRouter } from '@paperfund/execution';
import { createDatabase, type DatabaseService } from '../../src/database.js';
import {
  createUser,
  createHourlyRound,
  createAsset,
  createMarket,
  initializeCompetitionAccount,
  executePaperBuy,
  executePaperSellAll,
  executePaperSell,
  reconcileAccountLedger,
  replayPersistedFill,
} from '../../src/financial-service.js';
import { genericPumpSwapIdentity } from '../../../protocols/src/generic-pump-swap.js';
import { LinkedStateStore, installLinkedTestSchema, linkedCandidateRuntime } from './store.js';
import {
  digest,
  reconcileLinkedInterval,
  newLinkedBranch,
  type ProviderInterval,
} from '../../../protocols/isolated/linked-pair/external-flow.js';
import { transitionLinkedSnapshot } from '../../../protocols/isolated/linked-pair/native-transition.js';
dotenv({ path: resolve('.env'), quiet: true });
const evidence = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261021/flow/provider-459438275-459438282.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
) as ProviderInterval;
const snapshot = evidence.before,
  identity = genericPumpSwapIdentity(snapshot.mint, snapshot.quoteMint, snapshot.bridgePool);
const name = 'paperfund_linked_test_' + process.pid + '_' + Date.now(),
  round = 'linked-test-round',
  start = new Date(Math.floor(Date.parse(snapshot.observedAt) / 3600000) * 3600000);
let db: DatabaseService, admin: Pool, url: string;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL required');
  const a = new URL(process.env.DATABASE_URL);
  a.pathname = '/postgres';
  admin = new Pool({ connectionString: a.toString() });
  await admin.query('create database "' + name + '"');
  a.pathname = '/' + name;
  url = a.toString();
  db = createDatabase(url);
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
  await installLinkedTestSchema(db.pool);
  await createHourlyRound(db, {
    id: round,
    startsAt: start,
    endsAtExclusive: new Date(start.getTime() + 3600000),
    state: 'OPEN',
    rulesVersion: 'linked-atomic-tests',
  });
  await createAsset(db, { id: 'linked-base', mintAddress: snapshot.mint, decimals: 6 });
  await createAsset(db, {
    id: 'linked-sol',
    mintAddress: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  });
  await createMarket(db, {
    id: identity.marketId,
    baseAssetId: 'linked-base',
    quoteAssetId: 'linked-sol',
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
async function fixture() {
  const id = randomUUID(),
    account = 'account:' + id,
    user = 'user:' + id;
  await createUser(db, { id: user, walletAddress: 'wallet:' + id });
  await initializeCompetitionAccount(db, {
    accountId: account,
    userId: user,
    hourlyRoundId: round,
    idempotencyKey: 'init:' + id,
  });
  const store = new LinkedStateStore(db, account, round);
  await store.initialize(snapshot);
  let now = Date.parse(snapshot.observedAt),
    interval: ProviderInterval | null = null;
  const options = {
    now: () => now,
    interval: async () => interval,
    permission: async () => ({ discover: true, buy: true, authorizeLive: async () => undefined }),
  };
  const runtime = linkedCandidateRuntime(db, store, options),
    router = new ExecutionRouter([runtime.adapter]);
  const buy = (key = 'buy:' + randomUUID(), amount = 100000000n) =>
    executePaperBuy(runtime.database, router, {
      competitionAccountId: account,
      marketId: identity.marketId,
      requestedPaperSolLamports: amount,
      idempotencyKey: key,
      authoritativeTimestamp: new Date(now),
    });
  const sell = (quantity: bigint | 'ALL', key = 'sell:' + randomUUID()) =>
    quantity === 'ALL'
      ? executePaperSellAll(runtime.database, router, {
          competitionAccountId: account,
          marketId: identity.marketId,
          idempotencyKey: key,
          authoritativeTimestamp: new Date(now),
        })
      : executePaperSell(runtime.database, router, {
          competitionAccountId: account,
          marketId: identity.marketId,
          requestedTokenQuantity: quantity,
          idempotencyKey: key,
          authoritativeTimestamp: new Date(now),
        });
  return {
    account,
    store,
    runtime,
    router,
    options,
    buy,
    sell,
    advance: () => {
      now = Date.parse(evidence.after.observedAt);
      interval = evidence;
    },
    now: () => now,
  };
}
async function counts(account: string) {
  return (
    await db.pool.query(
      `select (select count(*) from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1)::text fills,(select count(*) from linked_candidate.receipts where account_id=$1)::text receipts,(select paper_sol_balance_lamports::text from competition_accounts where id=$1) cash,(select revision::text from linked_candidate.branches where account_id=$1) revision`,
      [account],
    )
  ).rows[0];
}
describe('retained genuine external activity', () => {
  it('reconciles an actual Orca swap and preserves preceding paper impact', async () => {
    const b = newLinkedBranch('scope', 'hour', snapshot),
      p = await transitionLinkedSnapshot(b.simulated, 100000000n, true, {
        nowMs: Date.parse(snapshot.observedAt),
        maxAgeMs: 10000,
      });
    b.simulated = p.next;
    const before = digest(b),
      r = await reconcileLinkedInterval(b, evidence, Date.parse(evidence.after.observedAt), 10000);
    expect(r.events).toBe(1);
    expect(r.failedTransactions).toBeGreaterThan(0);
    expect(digest(r.branch.real)).toBe(digest(evidence.after));
    expect(digest(r.branch.simulated)).not.toBe(digest(r.branch.real));
    expect(digest(b)).toBe(before);
    expect(
      (
        await reconcileLinkedInterval(
          r.branch,
          evidence,
          Date.parse(evidence.after.observedAt),
          10000,
        )
      ).branch,
    ).toEqual(r.branch);
  });
  it('rejects gaps, missing/stale/tampered state and unsupported effects without advancing', async () => {
    const b = newLinkedBranch('scope', 'hour', snapshot);
    for (const kind of ['gap', 'checkpoint', 'time', 'metadata']) {
      const e = structuredClone(evidence);
      if (kind === 'gap') e.blocks.splice(0, 1);
      if (kind === 'checkpoint')
        e.after.accounts[snapshot.targetPool] = {
          ...e.after.accounts[snapshot.targetPool]!,
          base64: 'AA==',
        };
      if (kind === 'metadata') e.blocks[0]!.result.previousBlockhash = 'wrong';
      await expect(
        reconcileLinkedInterval(
          b,
          e,
          Date.parse(e.after.observedAt) + (kind === 'time' ? 10001 : 0),
          10000,
        ),
        kind,
      ).rejects.toThrow();
    }
    expect(b.real).toEqual(snapshot);
  }, 15000);
});
describe('external evidence constraints', () => {
  it('rejects changed routes, vanished pools, epoch changes and invalid freshness policy', async () => {
    const b = newLinkedBranch('scope', 'hour', snapshot),
      now = Date.parse(evidence.after.observedAt);
    for (const kind of ['route', 'pool', 'epoch']) {
      const e = structuredClone(evidence);
      if (kind === 'route') e.after.bridgePool = 'other';
      if (kind === 'pool') delete e.after.accounts[e.after.bridgePool];
      if (kind === 'epoch') {
        const clock = 'SysvarC1ock11111111111111111111111111111111',
          a = e.after.accounts[clock]!,
          raw = Buffer.from(a.base64, 'base64');
        raw.writeBigUInt64LE(raw.readBigUInt64LE(16) + 1n, 16);
        e.after.accounts[clock] = { ...a, base64: raw.toString('base64') };
      }
      await expect(reconcileLinkedInterval(b, e, now, 10000)).rejects.toThrow();
    }
    await expect(reconcileLinkedInterval(b, evidence, now, NaN)).rejects.toThrow(
      'INVALID_FRESHNESS_POLICY',
    );
  }, 15000);
  it('requires the actual signed minimum and successful transfer receipts', async () => {
    const b = newLinkedBranch('scope', 'hour', snapshot),
      signature =
        '31cU5EKTJw1NmA7Euk9XTiW9K6uUqXPJdTXPDhFac5Theds3gNTweoxpMv9TE5CyRqgxrmdhmKFbKvyGKQH8XL7S';
    for (const kind of ['minimum', 'missing-transfer', 'failed']) {
      const e = structuredClone(evidence),
        tx = e.blocks
          .flatMap((x) => x.result.transactions)
          .find((t) => t.transaction.signatures[0] === signature)!;
      if (kind === 'failed') tx.meta.err = { InstructionError: [0, 'test'] };
      else {
        const group = tx.meta.innerInstructions.find((g) =>
          g.instructions.some((i) =>
            Buffer.from(bs58.decode(i.data))
              .subarray(0, 8)
              .equals(Buffer.from([43, 4, 237, 11, 26, 201, 30, 98])),
          ),
        )!;
        const index = group.instructions.findIndex((i) =>
          Buffer.from(bs58.decode(i.data))
            .subarray(0, 8)
            .equals(Buffer.from([43, 4, 237, 11, 26, 201, 30, 98])),
        );
        if (kind === 'minimum') {
          const ix = group.instructions[index]!,
            raw = Buffer.from(bs58.decode(ix.data));
          raw.writeBigUInt64LE((1n << 64n) - 1n, 16);
          ix.data = bs58.encode(raw);
        } else group.instructions.splice(index + 1, 1);
      }
      await expect(
        reconcileLinkedInterval(b, e, Date.parse(e.after.observedAt), 10000),
        kind,
      ).rejects.toThrow();
    }
    expect(b.simulated).toEqual(snapshot);
  }, 20000);
});
describe('same-transaction canonical fills and branch state', () => {
  it('commits consecutive buys, external replay, partial/full sells, journals and immutable fill replay', async () => {
    const f = await fixture(),
      a = await f.buy();
    f.advance();
    const b = await f.buy();
    expect(b.actualTokenOutputBaseUnits).toBeLessThan(a.actualTokenOutputBaseUnits);
    await f.sell((a.actualTokenOutputBaseUnits + b.actualTokenOutputBaseUnits) / 4n);
    await f.sell('ALL');
    expect(await counts(f.account)).toMatchObject({ fills: '4', receipts: '4', revision: '4' });
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    await f.store.recover();
    await replayPersistedFill(db, f.router, a.fillId);
  }, 60000);
  it('retains the exact 20% cap and writes neither state nor a fill on denial', async () => {
    const f = await fixture(),
      before = await counts(f.account);
    await expect(f.buy('over-cap', 2000000001n)).rejects.toMatchObject({
      code: 'MAX_BUY_RATIO_EXCEEDED',
    });
    expect(await counts(f.account)).toEqual(before);
  });
  it('rolls back the branch, fill, cash, journal and idempotency when the participant fails', async () => {
    const f = await fixture(),
      before = await counts(f.account),
      database = {
        ...f.runtime.database,
        async commitMarketExecution(
          c: Parameters<NonNullable<DatabaseService['commitMarketExecution']>>[0],
          i: Parameters<NonNullable<DatabaseService['commitMarketExecution']>>[1],
        ) {
          await f.runtime.database.commitMarketExecution!(c, i);
          throw Error('TEST_AFTER_STATE_BEFORE_COMMIT');
        },
      };
    await expect(
      executePaperBuy(database, f.router, {
        competitionAccountId: f.account,
        marketId: identity.marketId,
        requestedPaperSolLamports: 100000000n,
        idempotencyKey: 'rollback:' + f.account,
        authoritativeTimestamp: new Date(f.now()),
      }),
    ).rejects.toThrow('TEST_AFTER_STATE');
    expect(await counts(f.account)).toEqual(before);
    await f.buy('rollback:' + f.account);
    expect((await counts(f.account)).fills).toBe('1');
  });
  it('deduplicates concurrent retries and serializes distinct buys without losing depletion', async () => {
    const f = await fixture(),
      key = 'duplicate:' + f.account,
      r = await Promise.all([f.buy(key), f.buy(key)]);
    expect(r[0].fillId).toBe(r[1].fillId);
    expect((await counts(f.account)).revision).toBe('1');
    await Promise.all([f.buy(), f.buy()]);
    expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3', revision: '3' });
    await f.store.recover();
  }, 15000);
  it('recovers from a new DB pool/runtime and returns committed idempotency without a second effect', async () => {
    const f = await fixture(),
      key = 'restart:' + f.account,
      a = await f.buy(key),
      other = createDatabase(url);
    try {
      const store = new LinkedStateStore(other, f.account, round),
        state = await store.recover();
      expect(state.simulated).toEqual((await f.store.load()).document.simulated);
      const runtime = linkedCandidateRuntime(other, store, f.options),
        router = new ExecutionRouter([runtime.adapter]);
      const b = await executePaperBuy(runtime.database, router, {
        competitionAccountId: f.account,
        marketId: identity.marketId,
        requestedPaperSolLamports: 100000000n,
        idempotencyKey: key,
        authoritativeTimestamp: new Date(f.now()),
      });
      expect(b.fillId).toBe(a.fillId);
      expect((await counts(f.account)).fills).toBe('1');
      await executePaperSellAll(runtime.database, router, {
        competitionAccountId: f.account,
        marketId: identity.marketId,
        idempotencyKey: 'exit-after-restart:' + f.account,
        authoritativeTimestamp: new Date(f.now()),
      });
      await store.recover();
    } finally {
      await other.close();
    }
  }, 15000);
  it('rolls back when the retained checkpoint expires before financial commit', async () => {
    const f = await fixture(),
      before = await counts(f.account),
      database = {
        ...f.runtime.database,
        async commitMarketExecution(
          c: Parameters<NonNullable<DatabaseService['commitMarketExecution']>>[0],
          i: Parameters<NonNullable<DatabaseService['commitMarketExecution']>>[1],
        ) {
          f.options.now = () => f.now() + 10001;
          await f.runtime.database.commitMarketExecution!(c, i);
        },
      };
    await expect(
      executePaperBuy(database, f.router, {
        competitionAccountId: f.account,
        marketId: identity.marketId,
        requestedPaperSolLamports: 100000000n,
        idempotencyKey: 'expires:' + f.account,
        authoritativeTimestamp: new Date(f.now()),
      }),
    ).rejects.toThrow('LINKED_COMMIT_CHECKPOINT_STALE');
    expect(await counts(f.account)).toEqual(before);
  });
  it('rejects a stale prepared SELL rather than overwriting a newer committed BUY', async () => {
    const f = await fixture(),
      a = await f.buy(),
      stale = await f.router.loadPositionRoute(identity);
    await f.buy();
    const before = await counts(f.account),
      load = f.router.loadPositionRoute.bind(f.router);
    f.router.loadPositionRoute = async () => stale;
    try {
      await expect(f.sell(a.actualTokenOutputBaseUnits)).rejects.toThrow(
        'LINKED_PREDECESSOR_CHANGED_RETRY',
      );
    } finally {
      f.router.loadPositionRoute = load;
    }
    expect(await counts(f.account)).toEqual(before);
    await f.sell('ALL');
    await f.store.recover();
  });
  it('recovers after abrupt process death between writing state/fill and COMMIT, then retries once', async () => {
    const f = await fixture(),
      key = 'process-crash:' + f.account,
      before = await counts(f.account);
    const child = fork(fileURLToPath(new URL('./crash-child.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        LINKED_TEST_DB_URL: url,
        LINKED_TEST_ACCOUNT: f.account,
        LINKED_TEST_ROUND: round,
        LINKED_TEST_KEY: key,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('CHILD_STAGE_TIMEOUT')), 20000);
        child.once('message', (m) => {
          clearTimeout(timer);
          if ((m as { staged?: boolean }).staged) resolve();
          else reject(Error('CHILD_BAD_STAGE'));
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(Error('CHILD_EXITED_BEFORE_STAGE'));
        });
      });
      const stopped = new Promise<void>((r) => child.once('exit', () => r()));
      child.kill('SIGKILL');
      await stopped;
      expect(await counts(f.account)).toEqual(before);
      await f.store.recover();
      const result = await f.buy(key);
      expect(result.actualTokenOutputBaseUnits).toBeGreaterThan(0n);
      expect(await counts(f.account)).toMatchObject({ fills: '1', receipts: '1', revision: '1' });
      await f.store.recover();
    } finally {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    }
  }, 30000);
  it('keeps receipts/provider evidence immutable and refuses a missing state instead of resetting', async () => {
    const f = await fixture();
    await f.buy();
    await expect(
      db.pool.query(
        "update linked_candidate.receipts set after_hash='tampered' where account_id=$1",
        [f.account],
      ),
    ).rejects.toThrow('LINKED_RECEIPT_IMMUTABLE');
    await expect(new LinkedStateStore(db, 'missing', round).load()).rejects.toThrow(
      'LINKED_STATE_MISSING_NO_RESET',
    );
    await expect(
      db.pool.query(
        "update linked_candidate.branches set initial_hash='tampered' where account_id=$1",
        [f.account],
      ),
    ).rejects.toThrow('LINKED_BRANCH_IDENTITY_OR_REVISION');
  });
});
