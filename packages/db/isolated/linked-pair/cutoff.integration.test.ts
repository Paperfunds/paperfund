import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { convertIdlToCamelCase } from '@coral-xyz/anchor/dist/cjs/idl.js';
import { createRequire } from 'node:module';
const { WHIRLPOOL_IDL } = createRequire(
  new URL('../../../protocols/isolated/linked-pair/native-transition.ts', import.meta.url),
)('@orca-so/whirlpools-sdk') as { WHIRLPOOL_IDL: Parameters<typeof convertIdlToCamelCase>[0] };
import { PublicKey } from '@solana/web3.js';
import { readOrcaSnapshot, orcaLink } from '../../../protocols/src/composed-pump-orca.js';
import { pumpSwapStateFromSnapshot } from '../../../protocols/src/non-sol-pump-swap.js';
import { Stage1NonSolPumpSwap } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
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
import {
  ExecutionRouter,
  canonicalExitPreflight,
  createMarketStateEvidence,
} from '@paperfund/execution';
import { identifier, tokenBaseUnits } from '@paperfund/core';
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
  settleHourlyRound,
  reconcileAccountLedger,
  replayPersistedFill,
} from '../../src/financial-service.js';
import { LinkedStateStore, linkedCandidateRuntime, installLinkedTestSchema } from './store.js';
import { reconcileCutoff, type CutoffFrontier } from './cutoff.js';
import {
  newLinkedBranch,
  digest,
  type ProviderInterval,
} from '../../../protocols/isolated/linked-pair/external-flow.js';
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
const name = 'paperfund_linked_test_cutoff_' + process.pid + '_' + Date.now();
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
it('settles an open position from its sealed carried bank, then recovers/replays without new provider reads', async () => {
  const f = await fixture();
  await f.buy();
  const expected = await canonicalExitPreflight(
    f.router,
    identity,
    BigInt(
      (
        await db.pool.query(
          'select remaining_base_units from positions where competition_account_id=$1',
          [f.account],
        )
      ).rows[0].remaining_base_units,
    ),
    100000000n,
  );
  const reads = f.reads();
  f.advance();
  const r = await f.settle();
  expect(r.failures).toEqual([]);
  expect(r.state).toBe('FINALIZED');
  expect(r.forcedSells).toHaveLength(1);
  expect(r.forcedSells[0]!.actualNetPaperSolOutputLamports).toBe(
    expected.maxExecutableOutputLamports,
  );
  expect(f.reads()).toBe(reads);
  expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  await f.store.recover();
  await replayPersistedFill(db, f.router, r.forcedSells[0]!.fillId);
  const before = await counts(f.account);
  expect((await f.settle()).forcedSells).toHaveLength(0);
  expect(await counts(f.account)).toEqual(before);
}, 15000);
it('consumes one persisted pool across two position origins and resumes after a committed first exit', async () => {
  const f = await fixture(),
    alias = identifier('origin:' + f.account, 'MarketId');
  await createMarket(db, {
    id: alias,
    baseAssetId: 'base',
    quoteAssetId: 'sol',
    venue: identity.protocolId,
    providerMarketId: alias,
  });
  f.router.canonicalResolver = async (origin) => ({
    originIdentity: origin,
    executionIdentity: identity,
    migrated: origin.marketId !== identity.marketId,
  });
  await f.buy();
  await f.buy(alias);
  let exits = 0;
  const bind = f.runtime.database.bindMarketSettlementEvidence!;
  const database = {
    ...f.runtime.database,
    async bindMarketSettlementEvidence(...args: Parameters<typeof bind>) {
      if (++exits === 2) throw Error('TEST_PROCESS_INTERRUPTION_AFTER_FIRST_COMMIT');
      await bind(...args);
    },
  };
  f.advance();
  const partial = await f.settle(database);
  expect(partial.forcedSells).toHaveLength(1);
  expect(partial.state).toBe('SETTLING');
  const seal = await f.store.cutoff();
  expect(seal).not.toBeNull();
  const other = createDatabase(url);
  try {
    const store = new LinkedStateStore(other, f.account, f.round);
    await store.recover();
    const runtime = linkedCandidateRuntime(other, store, {
        ...f.options,
        cutoffFrontier: async () => {
          throw Error('MUST_USE_DURABLE_SEAL');
        },
        interval: async () => {
          throw Error('MUST_NOT_REFRESH');
        },
      }),
      router = new ExecutionRouter([runtime.adapter]);
    router.canonicalResolver = f.router.canonicalResolver;
    const result = await f.settle(runtime.database, router);
    expect(result.failures).toEqual([]);
    expect(result.state).toBe('FINALIZED');
    expect(result.forcedSells).toHaveLength(1);
    expect(await counts(f.account)).toMatchObject({ fills: '4', receipts: '4' });
    const used = (
      await db.pool.query(
        `select e.state_fingerprint as fingerprint from market_state_evidence e join fills f on f.market_state_evidence_id=e.id join orders o on o.id=f.order_id where o.competition_account_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT'`,
        [f.account],
      )
    ).rows;
    expect(new Set(used.map((x) => x.fingerprint)).size).toBe(2);
    await store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await other.close();
  }
}, 20000);
it('keeps an ordinary partial exit and forces only its remaining quantity/basis at cutoff', async () => {
  const f = await fixture(),
    b = await f.buy();
  const p = await executePaperSell(f.runtime.database, f.router, {
    competitionAccountId: f.account,
    marketId: identity.marketId,
    requestedTokenQuantity: b.actualTokenOutputBaseUnits / 4n,
    idempotencyKey: 'partial:' + f.account,
    authoritativeTimestamp: new Date(f.s.observedAt),
  });
  f.advance();
  const r = await f.settle();
  expect(r.state).toBe('FINALIZED');
  expect(r.failures).toEqual([]);
  expect(r.forcedSells[0]!.actualTokenInputBaseUnits).toBe(p.position.remainingBaseUnits);
  await f.store.recover();
  expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
}, 15000);
it('rejects stale, future, missing and non-adjacent UTC frontiers without a seal or financial effects', async () => {
  for (const kind of ['stale', 'future', 'gap', 'missing']) {
    const f = await fixture();
    await f.buy();
    const before = await counts(f.account);
    if (kind === 'gap') f.frontier.next.parentSlot--;
    if (kind === 'future') f.frontier.last.blockTime = f.cutoff.getTime() / 1000;
    if (kind === 'stale') f.frontier.last.blockTime -= 100;
    if (kind === 'missing')
      f.options.cutoffFrontier = async () => {
        throw Error('MISSING_PROVIDER_BOUNDARY');
      };
    const r = await f.settle();
    expect(r.state).toBe('SETTLING');
    expect(r.forcedSells).toHaveLength(0);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(await f.store.cutoff()).toBeNull();
    expect(await counts(f.account)).toEqual(before);
  }
}, 15000);
it('retains real external proof and rejects using the retained non-cutoff interval as a fabricated hourly bank', async () => {
  const b = newLinkedBranch('account', 'round', retained.before);
  const frontier: CutoffFrontier = {
    schema: 'LINKED_UTC_FRONTIER_V1',
    commitment: 'finalized',
    interval: retained,
    last: {
      slot: retained.after.slot,
      blockTime: retained.blocks.at(-1)!.result.blockTime,
      blockhash: retained.blocks.at(-1)!.result.blockhash,
    },
    next: {
      slot: retained.after.slot + 1,
      parentSlot: retained.after.slot,
      previousBlockhash: retained.blocks.at(-1)!.result.blockhash,
      blockhash: 'test',
      blockTime: Date.parse('2026-10-21T02:00:00Z') / 1000,
    },
  };
  await expect(reconcileCutoff(b, frontier, '2026-10-21T02:00:00Z')).rejects.toThrow(
    'LINKED_CUTOFF_BANK_UNAVAILABLE',
  );
  expect(digest(b.real)).toBe(digest(retained.before));
});
it('rolls back forced liquidity and financial writes together and retries once', async () => {
  const f = await fixture();
  await f.buy();
  const before = await counts(f.account);
  const hook = f.runtime.database.commitMarketExecution!,
    database = {
      ...f.runtime.database,
      async commitMarketExecution(...args: Parameters<typeof hook>) {
        await hook(...args);
        throw Error('TEST_FORCED_FAILURE_BEFORE_COMMIT');
      },
    };
  const r = await f.settle(database);
  expect(r.forcedSells).toHaveLength(0);
  expect(await counts(f.account)).toEqual(before);
  expect(await f.store.cutoff()).not.toBeNull();
  await f.store.recover();
  expect((await f.settle()).state).toBe('FINALIZED');
  expect(await counts(f.account)).toMatchObject({ fills: '2', receipts: '2' });
}, 15000);
it('serializes cutoff workers and a late BUY without duplicate cash, fills or liquidity effects', async () => {
  const f = await fixture();
  await f.buy();
  f.advance();
  const results = await Promise.allSettled([f.settle(), f.settle(), f.buy()]);
  expect(results[0].status).toBe('fulfilled');
  expect(results[1].status).toBe('fulfilled');
  expect(results[2].status).toBe('rejected');
  expect(await counts(f.account)).toMatchObject({ fills: '2', receipts: '2' });
  await f.store.recover();
}, 15000);
it('does not accept a pinned quote from the pre-seal revision after another position consumed it', async () => {
  const f = await fixture();
  await f.buy();
  await db.pool.query("update hourly_rounds set state='CLOSING' where id=$1", [f.round]);
  await db.pool.query("update hourly_rounds set state='SETTLING' where id=$1", [f.round]);
  await f.runtime.database.prepareMarketSettlement!(f.round, f.cutoff);
  const loaded = await f.router.loadPositionRoute(identity),
    evidence = createMarketStateEvidence(loaded.state);
  await f.settle();
  await expect(
    f.runtime.database.bindMarketSettlementEvidence!(f.account, evidence),
  ).rejects.toThrow('LINKED_STALE_CUTOFF_EVIDENCE');
});

it('waits for an already admitted BUY before sealing its resulting liquidity revision', async () => {
  const f = await fixture();
  await f.buy();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (entered = r));
  f.options.interval = async () => {
    entered();
    await gate;
    return null;
  };
  const buy = f.buy();
  await ready;
  const settlement = f.settle();
  release();
  await buy;
  const result = await settlement;
  expect(result.state).toBe('FINALIZED');
  expect(result.failures).toEqual([]);
  expect(await counts(f.account)).toMatchObject({ fills: '3', receipts: '3' });
  expect((await f.store.cutoff())!.document.revision).toBe('2');
  await f.store.recover();
}, 15000);
it('recovers after killing a settlement process with uncommitted fill, journal and successor writes', async () => {
  const f = await fixture();
  await f.buy();
  await db.pool.query("update hourly_rounds set state='CLOSING' where id=$1", [f.round]);
  await db.pool.query("update hourly_rounds set state='SETTLING' where id=$1", [f.round]);
  await f.runtime.database.prepareMarketSettlement!(f.round, f.cutoff);
  const before = await counts(f.account);
  const child = fork(fileURLToPath(new URL('./cutoff-crash-child.ts', import.meta.url)), [], {
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
    await f.store.recover();
    const r = await f.settle();
    expect(r.state).toBe('FINALIZED');
    expect(r.failures).toEqual([]);
    expect(await counts(f.account)).toMatchObject({ fills: '2', receipts: '2' });
    await f.store.recover();
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }
}, 30000);
it('finalizes a clean account without requesting irrelevant cutoff liquidity', async () => {
  const f = await fixture();
  f.options.cutoffFrontier = async () => {
    throw Error('NO_POSITION_NEEDS_NO_QUOTE');
  };
  const r = await f.settle();
  expect(r.state).toBe('FINALIZED');
  expect(r.failures).toEqual([]);
  expect(r.forcedSells).toHaveLength(0);
  expect(await f.store.cutoff()).toBeNull();
});

it('values initialized reward state without mutating accounting', async () => {
  const f = await fixture(),
    buy = await f.buy(),
    head = await f.store.load(),
    s = structuredClone(head.document.simulated),
    link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!),
    decoded = readOrcaSnapshot(link, s.accounts, true, s.absentAccounts);
  // Fault injection into reward metadata only. No price/reserve is invented.
  decoded.data.rewardInfos[0]!.mint = new PublicKey(s.mint);
  const codec = new BorshAccountsCoder(convertIdlToCamelCase(WHIRLPOOL_IDL)),
    raw = Buffer.from(s.accounts[s.bridgePool]!.base64, 'base64'),
    encoded = await codec.encode('whirlpool', decoded.data);
  encoded.copy(raw);
  s.accounts[s.bridgePool] = { ...s.accounts[s.bridgePool]!, base64: raw.toString('base64') };
  const native = new Stage1NonSolPumpSwap({
      purpose: 'READ_ONLY_STAGE1_VALIDATION',
      bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool },
    }),
    state = await pumpSwapStateFromSnapshot(
      identity,
      s,
      native,
      'linked-native-atomic-v1',
      'linked-native-atomic-state-v1',
    ),
    before = await counts(f.account);
  const valuation = await f.runtime.adapter.valuePositionForExit(
    { identity, tokenQuantity: tokenBaseUnits(buy.actualTokenOutputBaseUnits) },
    state,
  );
  expect(valuation.paperSolValue).toBeGreaterThan(0n);
  expect(await counts(f.account)).toEqual(before);
});
it('rejects a missing tick dependency without a zero write-off or financial mutation', async () => {
  const f = await fixture(),
    buy = await f.buy(),
    loaded = await f.router.loadPositionRoute(identity),
    head = await f.store.load(),
    s = structuredClone(head.document.simulated),
    link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!),
    ticks = readOrcaSnapshot(link, s.accounts, true, s.absentAccounts).ticks,
    required = ticks.find((t) => t.data !== null)?.address.toBase58();
  expect(required).toBeDefined();
  delete s.accounts[required!];
  const state = {
      ...loaded.state,
      normalizedState: {
        ...loaded.state.normalizedState,
        stage1Snapshot: JSON.parse(JSON.stringify(s)),
      },
    },
    before = await counts(f.account);
  await expect(
    f.runtime.adapter.valuePositionForExit(
      { identity, tokenQuantity: tokenBaseUnits(buy.actualTokenOutputBaseUnits) },
      state,
    ),
  ).rejects.toThrow();
  expect(await counts(f.account)).toEqual(before);
});
