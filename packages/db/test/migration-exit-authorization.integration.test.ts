import { AdvisoryValuations } from '../../../apps/api/src/advisory-valuations.js';
import { PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { identifier, utcInstant, tokenBaseUnits } from '@paperfund/core';
import { type MarketState } from '@paperfund/execution';
import {
  createProductionExecutionRouter,
  pumpBondingCurveAddress,
  decodePumpSwapPool,
} from '../../protocols/src/index.js';
import { pumpLink, orcaLink } from '../../protocols/src/composed-pump-orca.js';
import {
  withGenericActor,
  withGenericAccount,
} from '../../protocols/src/generic-access-context.js';
import type { Stage1Snapshot } from '../../protocols/src/experimental/non-sol-pump-swap.js';
import { createDatabase, type DatabaseService } from '../src/database.js';
import { GenericCapability } from '../src/generic-capability.js';
import {
  createUser,
  createAsset,
  createMarket,
  createHourlyRound,
  createDailyCompetition,
  initializeCompetitionAccount,
  executePaperBuy,
  executePaperSell,
  executePaperSellAll,
  settleHourlyRound,
  reconcileAccountLedger,
  replayPersistedFill,
} from '../src/financial-service.js';

dotenv({ path: resolve('.env'), quiet: true });
const op = 'user:' + 'c'.repeat(64),
  other = 'user:' + 'd'.repeat(64);
let db: DatabaseService, admin: Pool, name: string;
let beforeRpc: (() => Promise<void>) | undefined;
let s: Stage1Snapshot, original: MarketState, migrated: boolean, now: number;
let cap: GenericCapability, router: ReturnType<typeof createProductionExecutionRouter>;
let starts: Date, ends: Date;
const clock = 'SysvarC1ock11111111111111111111111111111111';
const record = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), 'utf8')) as T;

beforeEach(async () => {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = '/postgres';
  admin = new Pool({ connectionString: u.toString() });
  name = 'paperfund_exit_auth_' + process.pid + '_' + Date.now();
  await admin.query('create database "' + name + '"');
  u.pathname = '/' + name;
  db = createDatabase(u.toString());
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
  s = record<{ snapshot: Stage1Snapshot }>(
    'packages/protocols/test/fixtures/generic-pumpswap-live/shunghla-warm.json',
  ).snapshot;
  now = Date.parse(s.observedAt);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  starts = new Date(Math.floor(now / 3600000) * 3600000);
  ends = new Date(starts.getTime() + 3600000);
  const day = new Date(starts.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  await createDailyCompetition(db, {
    id: 'day',
    utcDate: day.toISOString().slice(0, 10),
    startsAt: day,
    endsAtExclusive: new Date(+day + 86400000),
  });
  await createHourlyRound(db, {
    id: 'round',
    startsAt: starts,
    endsAtExclusive: ends,
    state: 'OPEN',
    rulesVersion: 'migration-exit-fixture',
  });
  await createUser(db, { id: op, walletAddress: 'owner-fixture' });
  await createUser(db, { id: other, walletAddress: 'other-fixture' });
  await createAsset(db, { id: 'token', mintAddress: s.mint, decimals: 6 });
  await createAsset(db, { id: 'sol', mintAddress: 'fixture-sol', decimals: 9 });

  // Synthetic active Pump stage on the same mint/quote/PDA; real recorded Orca bytes.
  // No claim this is a historical Shunghla BUY or an actual on-chain migration capture.
  const curve = await pumpBondingCurveAddress(s.mint);
  const accounts = structuredClone(s.accounts);
  const active = Buffer.from(accounts[curve]!.base64, 'base64');
  active.writeBigUInt64LE(1000000000000000n, 8);
  active.writeBigUInt64LE(30000000000n, 16);
  active.writeBigUInt64LE(800000000000000n, 24);
  active.writeBigUInt64LE(30000000000n, 32);
  active[48] = 0;
  accounts[curve] = { ...accounts[curve]!, base64: active.toString('base64') };
  const old = record<MarketState>('packages/protocols/test/fixtures/operator-pump-orca.json');
  const oldAccounts = old.normalizedState['accounts'] as Stage1Snapshot['accounts'];
  const pump = pumpLink(
    curve,
    accounts[curve]!,
    s.mint,
    accounts[s.mint]!.owner,
    accounts[s.quoteMint]!.owner,
  );
  accounts[pump.config!] = oldAccounts[pump.config!]!;
  accounts[pump.platform!] = oldAccounts[pump.platform!]!;
  const pool = decodePumpSwapPool(Buffer.from(s.accounts[s.targetPool]!.base64, 'base64'));
  for (const [address, template, mint, amount] of [
    [pump.vaultA, pool.baseVault, s.mint, 1000000000000000n],
    [pump.vaultB, pool.quoteVault, s.quoteMint, 30000000000n],
  ] as const) {
    const raw = Buffer.from(accounts[template]!.base64, 'base64');
    new PublicKey(mint).toBuffer().copy(raw, 0);
    new PublicKey(curve).toBuffer().copy(raw, 32);
    raw.writeBigUInt64LE(amount, 64);
    accounts[address] = { ...accounts[template]!, base64: raw.toString('base64') };
  }
  const bridge = orcaLink(s.bridgePool, accounts[s.bridgePool]!);
  const identity = {
    protocolId: identifier('SOLANA_ROUTE', 'ProtocolId'),
    marketId: identifier('solana-route:' + s.mint, 'MarketId'),
    tokenMint: identifier(s.mint, 'TokenMint'),
  };
  original = {
    identity,
    observedAt: utcInstant(s.observedAt),
    chainSlot: BigInt(s.slot),
    chainBlockId: null,
    adapterVersion: 'solana-composed-route-v1',
    normalizationVersion: 'solana-route-accounts-v1',
    normalizedState: {
      model: 'SOLANA_COMPOSED_ROUTE',
      tokenDecimals: '6',
      mintSupply: '1000000000000000',
      hops: [pump, bridge],
      candidateRoutes: [[pump, bridge]],
      accounts,
      absentAccounts: s.absentAccounts,
    },
  };
  await createMarket(db, {
    id: identity.marketId,
    baseAssetId: 'token',
    quoteAssetId: 'sol',
    venue: identity.protocolId,
    providerMarketId: identity.marketId,
  });
  migrated = false;
  beforeRpc = undefined;
  cap = new GenericCapability(
    db,
    { armed: true, entries: false, operatorIds: [], entrySeconds: 900, systemSettlement: true },
    () => now,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('dexscreener'))
        return new Response(
          JSON.stringify([
            {
              pairAddress: s.bridgePool,
              baseToken: { address: s.quoteMint },
              quoteToken: { address: 'So11111111111111111111111111111111111111112' },
            },
          ]),
        );
      await beforeRpc?.();
      const request = JSON.parse(String(init?.body)) as { params: [string[]] };
      const current = migrated ? s.accounts : accounts;
      return new Response(
        JSON.stringify({
          result: {
            context: { slot: s.slot },
            value: request.params[0].map((a) =>
              current[a]
                ? { owner: current[a]!.owner, data: [current[a]!.base64, 'base64'] }
                : null,
            ),
          },
        }),
      );
    }),
  );
  router = createProductionExecutionRouter({
    rpcUrl: 'https://fixture.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed',
    genericPumpSwapEnabled: true,
    genericPumpSwapBuysEnabled: true,
    genericAccessResolver: (mint, quote, settlement) => cap.resolve(mint, quote, settlement),
  });
  const adapter = router.resolveVersion(
    identifier('SOLANA_ROUTE', 'ProtocolId'),
    'solana-composed-route-v1',
  );
  adapter.loadMarketState = async () => structuredClone(original);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (db) await db.close();
  if (admin) {
    await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname=$1', [
      name,
    ]);
    await admin.query('drop database if exists "' + name + '"');
    await admin.end();
  }
});
async function buy(account = 'owned', user = op) {
  await initializeCompetitionAccount(db, {
    accountId: account,
    userId: user,
    hourlyRoundId: 'round',
    idempotencyKey: 'init:' + account,
  });
  const result = await executePaperBuy(db, router, {
    competitionAccountId: account,
    marketId: original.identity.marketId,
    requestedPaperSolLamports: 100000000n,
    idempotencyKey: 'buy:' + account,
    authoritativeTimestamp: new Date(now),
  });
  expect(result.protocolId).toBe('SOLANA_ROUTE');
  return result;
}
const owner = <T>(
  account: string,
  work: () => T,
  user = op,
  intent: 'SELL' | 'READ' | 'BUY' = 'SELL',
) => withGenericActor({ userId: user, intent }, () => withGenericAccount(account, work));
async function ledger(account = 'owned') {
  expect((await reconcileAccountLedger(db, account)).reconciled).toBe(true);
}
async function state(account = 'owned') {
  return (
    await db.pool.query(
      'select paper_sol_balance_lamports,realized_pnl_lamports from competition_accounts where id=$1',
      [account],
    )
  ).rows[0];
}
function sell(account: string, quantity: bigint, key: string, user = op) {
  return owner(
    account,
    () =>
      executePaperSell(db, router, {
        competitionAccountId: account,
        marketId: original.identity.marketId,
        requestedTokenQuantity: quantity,
        idempotencyKey: key,
        authoritativeTimestamp: new Date(now),
      }),
    user,
  );
}
function cutoff() {
  now = +ends;
  vi.setSystemTime(now);
  const bytes = Buffer.from(s.accounts[clock]!.base64, 'base64');
  bytes.writeBigInt64LE(BigInt(now / 1000), 32);
  s.accounts[clock] = { ...s.accounts[clock]!, base64: bytes.toString('base64') };
}

it('migrated partial and ALL exits use owned fresh state, block new BUYs and foreign accounts, and preserve immutable history', async () => {
  const bought = await buy();
  migrated = true;
  const before = (await db.pool.query('select * from fills where id=$1', [bought.fillId])).rows[0];
  const quantity = bought.actualTokenOutputBaseUnits / 2n;
  await expect(sell('owned', quantity, 'foreign', other)).rejects.toThrow('OWNER_MISMATCH');
  await expect(
    owner(
      'owned',
      () =>
        executePaperBuy(db, router, {
          competitionAccountId: 'owned',
          marketId: original.identity.marketId,
          requestedPaperSolLamports: 10000000n,
          idempotencyKey: 'denied-buy',
          authoritativeTimestamp: new Date(now),
        }),
      op,
      'BUY',
    ),
  ).rejects.toThrow('ENTRY_DISABLED');
  const partial = await sell('owned', quantity, 'partial');
  expect(partial.protocolId).toBe('GENERIC_PUMP_SWAP');
  expect(partial.costBasisLamportsRemoved).toBe(
    (bought.position.costBasisLamports * quantity) / bought.actualTokenOutputBaseUnits,
  );
  expect((await sell('owned', quantity, 'partial')).fillId).toBe(partial.fillId);
  const all = await owner('owned', () =>
    executePaperSellAll(db, router, {
      competitionAccountId: 'owned',
      marketId: original.identity.marketId,
      idempotencyKey: 'all',
      authoritativeTimestamp: new Date(now),
    }),
  );
  expect(all.position).toMatchObject({
    remainingBaseUnits: 0n,
    costBasisLamports: 0n,
    status: 'CLOSED',
  });
  await expect(owner('owned', () => router.loadPositionRoute(original.identity))).rejects.toThrow(
    'ENTITLEMENT_REQUIRED',
  );
  expect((await db.pool.query('select * from fills where id=$1', [bought.fillId])).rows[0]).toEqual(
    before,
  );
  await replayPersistedFill(db, router, partial.fillId);
  await replayPersistedFill(db, router, all.fillId);
  await ledger();
}, 15000);

it('entry-off forced settlement after migration remains idempotent across two workers and leaves the new round untouched', async () => {
  const bought = await buy();
  migrated = true;
  cutoff();
  await createHourlyRound(db, {
    id: 'next',
    startsAt: ends,
    endsAtExclusive: new Date(+ends + 3600000),
    state: 'OPEN',
    rulesVersion: 'fixture',
  });
  await initializeCompetitionAccount(db, {
    accountId: 'next-account',
    userId: op,
    hourlyRoundId: 'next',
    idempotencyKey: 'next-init',
  });
  await expect(sell('owned', bought.actualTokenOutputBaseUnits, 'late-normal')).rejects.toThrow();
  const command = { hourlyRoundId: 'round', authoritativeTimestamp: new Date(now) };
  const results = await Promise.all([
    settleHourlyRound(db, router, command),
    settleHourlyRound(db, router, command),
  ]);
  expect(results.every((r) => r.state === 'FINALIZED' && r.failures.length === 0)).toBe(true);
  expect(results.flatMap((r) => r.forcedSells)).toHaveLength(1);
  const counts = (
    await db.pool.query(
      "select (select count(*) from fills where side='SELL') sells,(select count(*) from hourly_results) hours,(select count(*) from daily_result_hourly_results) days",
    )
  ).rows[0];
  expect(counts).toEqual({ sells: '1', hours: '1', days: '1' });
  expect((await settleHourlyRound(db, router, command)).forcedSells).toHaveLength(0);
  expect((await state('next-account')).paper_sol_balance_lamports).toBe('10000000000');
  await ledger();
}, 15000);

it('hard stop preserves a migrated holding through normal and forced exits until safe exit-only recovery', async () => {
  const bought = await buy();
  migrated = true;
  cap = new GenericCapability(
    db,
    { armed: true, entries: false, operatorIds: [op], entrySeconds: 900, systemSettlement: true },
    () => now,
  );
  await cap.control(op, 'HARD_STOP');
  const before = await state();
  await expect(sell('owned', bought.actualTokenOutputBaseUnits, 'hard-stop')).rejects.toThrow(
    'HARD_STOP',
  );
  cutoff();
  const command = { hourlyRoundId: 'round', authoritativeTimestamp: new Date(now) };
  const blocked = await settleHourlyRound(db, router, command);
  expect(blocked.state).toBe('SETTLING');
  expect(blocked.forcedSells).toHaveLength(0);
  expect(blocked.failures[0]!.code).toBe('POSITION_EXECUTION_ROUTE_UNAVAILABLE');
  expect(await state()).toEqual(before);
  await cap.control(op, 'EXIT_ONLY');
  expect((await settleHourlyRound(db, router, command)).state).toBe('FINALIZED');
  await ledger();
}, 15000);

it.each(
  (['target-program', 'bridge-program', 'missing-state', 'stale-clock'] as const).flatMap(
    (failure) => [op, other].map((userId) => [failure, userId] as const),
  ),
)(
  'rejects migrated %s for identity %s without fake proceeds or write-off',
  async (failure, userId) => {
    const bought = await buy('owned', userId);
    migrated = true;
    const before = await state();
    if (failure === 'target-program')
      s.accounts[s.targetPool] = {
        ...s.accounts[s.targetPool]!,
        owner: '11111111111111111111111111111111',
      };
    if (failure === 'bridge-program')
      s.accounts[s.bridgePool] = {
        ...s.accounts[s.bridgePool]!,
        owner: '11111111111111111111111111111111',
      };
    if (failure === 'missing-state') delete s.accounts[s.bridgePool];
    if (failure === 'stale-clock') {
      const b = Buffer.from(s.accounts[clock]!.base64, 'base64');
      b.writeBigInt64LE(BigInt(Math.floor(now / 1000) - 10000), 32);
      s.accounts[clock] = { ...s.accounts[clock]!, base64: b.toString('base64') };
    }
    await expect(
      sell('owned', bought.actualTokenOutputBaseUnits, 'invalid', userId),
    ).rejects.toThrow();
    cutoff();
    if (failure === 'stale-clock') {
      const raw = Buffer.from(s.accounts[clock]!.base64, 'base64');
      raw.writeBigInt64LE(BigInt(Math.floor(now / 1000) - 10000), 32);
      s.accounts[clock] = { ...s.accounts[clock]!, base64: raw.toString('base64') };
    }
    const settlement = await settleHourlyRound(db, router, {
      hourlyRoundId: 'round',
      authoritativeTimestamp: new Date(now),
    });
    expect(settlement.state).toBe('SETTLING');
    expect(settlement.forcedSells).toHaveLength(0);
    expect(
      (
        await db.pool.query(
          "select count(*) from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
        )
      ).rows[0].count,
    ).toBe('0');
    expect(await state()).toEqual(before);
    await ledger();
  },
  15000,
);

it('rechecks held quantity after a prepared exit and rejects a stale closed-position SELL', async () => {
  const bought = await buy();
  migrated = true;
  const loaded = await owner('owned', () => router.loadPositionRoute(original.identity));
  await sell('owned', bought.actualTokenOutputBaseUnits, 'close');
  await expect(
    loaded.adapter.simulateSell(
      {
        identity: loaded.route.executionIdentity,
        orderId: identifier('stale', 'OrderId'),
        executionId: identifier('stale', 'ExecutionId'),
        requestedTokenQuantity: tokenBaseUnits(bought.actualTokenOutputBaseUnits),
        executedAt: utcInstant(new Date(now).toISOString()),
      },
      loaded.state,
    ),
  ).rejects.toThrow('OWNED_EXIT_EVIDENCE_REQUIRED');
  await ledger();
}, 15000);

it('does not reuse another-round ownership or trusted-system discovery without a held asset', async () => {
  await buy();
  migrated = true;
  await createHourlyRound(db, {
    id: 'next',
    startsAt: ends,
    endsAtExclusive: new Date(+ends + 3600000),
    state: 'OPEN',
    rulesVersion: 'fixture',
  });
  await initializeCompetitionAccount(db, {
    accountId: 'next-account',
    userId: op,
    hourlyRoundId: 'next',
    idempotencyKey: 'next-init',
  });
  await expect(
    owner('next-account', () => router.loadPositionRoute(original.identity)),
  ).rejects.toThrow();
  await expect(
    withGenericAccount('next-account', () => router.loadPositionRoute(original.identity, true)),
  ).rejects.toThrow();
  const permission = await owner(
    'owned',
    () => cap.resolve(s.mint, s.quoteMint, false),
    op,
    'READ',
  );
  expect(permission.buy).toBe(false);
  await expect(permission.authorizeLive!('SELL')).rejects.toThrow('READ_SCOPE');
  await ledger();
}, 15000);

it('preserves a generic position after operator removal, partial exit and genuine zero-capacity forced write-off', async () => {
  migrated = true;
  cap = new GenericCapability(
    db,
    {
      armed: true,
      entries: true,
      normalUserAccess: true,
      operatorIds: [op],
      entrySeconds: 900,
      systemSettlement: true,
    },
    () => now,
  );
  await cap.control(op, 'ENTRY');
  await initializeCompetitionAccount(db, {
    accountId: 'owned',
    userId: op,
    hourlyRoundId: 'round',
    idempotencyKey: 'generic-init',
  });
  const bought = await withGenericActor({ userId: op, intent: 'BUY' }, () =>
    executePaperBuy(db, router, {
      competitionAccountId: 'owned',
      marketId: original.identity.marketId,
      requestedPaperSolLamports: 100000000n,
      idempotencyKey: 'generic-buy',
      authoritativeTimestamp: new Date(now),
    }),
  );
  expect(bought.protocolId).toBe('GENERIC_PUMP_SWAP');
  cap = new GenericCapability(
    db,
    { armed: true, entries: false, operatorIds: [], entrySeconds: 900, systemSettlement: true },
    () => now,
  );
  await sell('owned', bought.actualTokenOutputBaseUnits / 2n, 'revoked-partial');
  const pool = decodePumpSwapPool(Buffer.from(s.accounts[s.targetPool]!.base64, 'base64'));
  const raw = Buffer.from(s.accounts[s.targetPool]!.base64, 'base64');
  raw.writeBigUInt64LE(0n, 271);
  raw.writeBigUInt64LE(0n, 279);
  s.accounts[s.targetPool] = { ...s.accounts[s.targetPool]!, base64: raw.toString('base64') };
  const vault = Buffer.from(s.accounts[pool.quoteVault]!.base64, 'base64');
  vault.writeBigUInt64LE(0n, 64);
  s.accounts[pool.quoteVault] = {
    ...s.accounts[pool.quoteVault]!,
    base64: vault.toString('base64'),
  };
  const before = await state();
  cutoff();
  const result = await settleHourlyRound(db, router, {
    hourlyRoundId: 'round',
    authoritativeTimestamp: new Date(now),
  });
  expect(result.state).toBe('FINALIZED');
  expect(result.forcedSells).toHaveLength(0);
  expect((await state()).paper_sol_balance_lamports).toBe(before.paper_sol_balance_lamports);
  expect(
    (
      await db.pool.query(
        "select count(*) from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
      )
    ).rows[0].count,
  ).toBe('1');
  await ledger();
}, 15000);

it('uses the migrated canonical venue when migration happens during a pending advisory read', async () => {
  await buy();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  let first = true;
  beforeRpc = async () => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
  };
  const broker = new AdvisoryValuations(router);
  const pending = owner('owned', () => broker.capture(original.identity, 'viewed'), op, 'READ');
  await started;
  migrated = true;
  release();
  const captured = await pending;
  expect(captured.route.route.executionIdentity.protocolId).toBe('GENERIC_PUMP_SWAP');
  expect((await db.pool.query("select count(*) from fills where side='SELL'")).rows[0].count).toBe(
    '0',
  );
  await ledger();
}, 15000);

it('serializes a pending interactive exit against hourly settlement without duplicate credit', async () => {
  const bought = await buy();
  migrated = true;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let first = true;
  beforeRpc = async () => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
  };
  const interactive = sell('owned', bought.actualTokenOutputBaseUnits, 'pending-normal');
  const outcome = interactive.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );
  await started;
  cutoff();
  const forced = await settleHourlyRound(db, router, {
    hourlyRoundId: 'round',
    authoritativeTimestamp: new Date(now),
  });
  release();
  const rejected = await outcome;
  expect(rejected.ok).toBe(false);
  expect(forced.state).toBe('FINALIZED');
  expect((await db.pool.query("select count(*) from fills where side='SELL'")).rows[0].count).toBe(
    '1',
  );
  await ledger();
}, 15000);
it('gives ordinary and control identities identical persisted generic fills, 20% admission and five-slot enforcement', async () => {
  migrated = true;
  cap = new GenericCapability(
    db,
    {
      armed: true,
      entries: true,
      normalUserAccess: true,
      operatorIds: [op],
      entrySeconds: 900,
      systemSettlement: true,
    },
    () => now,
  );
  await cap.control(op, 'ENTRY');
  const outputs = [];
  for (const [userId, accountId] of [
    [op, 'controller-account'],
    [other, 'ordinary-account'],
  ]) {
    await initializeCompetitionAccount(db, {
      accountId: accountId!,
      userId: userId!,
      hourlyRoundId: 'round',
      idempotencyKey: 'init-parity:' + accountId,
    });
    const request = (amount: bigint, key: string) =>
      owner(
        accountId!,
        () =>
          executePaperBuy(db, router, {
            competitionAccountId: accountId!,
            marketId: original.identity.marketId,
            requestedPaperSolLamports: amount,
            idempotencyKey: key,
            authoritativeTimestamp: new Date(now),
          }),
        userId!,
        'BUY',
      );
    await expect(request(2000000001n, 'parity-over:' + accountId)).rejects.toMatchObject({
      code: 'MAX_BUY_RATIO_EXCEEDED',
    });
    const result = await request(2000000000n, 'parity-exact:' + accountId);
    expect(result.actualPaperSolInputLamports).toBe(2000000000n);
    outputs.push({
      quantity: result.actualTokenOutputBaseUnits,
      input: result.actualPaperSolInputLamports,
      protocol: result.protocolId,
      state: await state(accountId),
    });
    await ledger(accountId);
    const counts = await db.pool.query(
      'select count(*)::int count from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
      [accountId],
    );
    expect(counts.rows[0].count).toBe(1);
  }
  expect(outputs[0]).toEqual(outputs[1]);
  // Slot admission is tested independently with the existing reference adapter. The same
  // snapshotted five-token rule runs before any fill; neither controller nor ordinary bypasses it.
  const { ReferenceProtocolAdapter, REFERENCE_PROTOCOL_ID } = await import('@paperfund/protocols');
  const { ExecutionRouter } = await import('@paperfund/execution');
  for (const [userId, accountId] of [
    [op, 'controller-account'],
    [other, 'ordinary-account'],
  ]) {
    for (let index = 0; index < 4; index++) {
      const assetId = accountId + ':slot:' + index;
      await createAsset(db, { id: assetId, mintAddress: assetId, decimals: 6 });
      await db.pool.query(
        'insert into competition_token_slots(id,competition_account_id,asset_id,first_successful_buy_at) values($1,$2,$3,$4)',
        [assetId, accountId, assetId, new Date(now)],
      );
    }
    const assetId = accountId + ':sixth',
      marketId = assetId + ':market';
    await createAsset(db, { id: assetId, mintAddress: assetId, decimals: 6 });
    await createMarket(db, {
      id: marketId,
      baseAssetId: assetId,
      quoteAssetId: 'sol',
      venue: REFERENCE_PROTOCOL_ID,
      providerMarketId: marketId,
    });
    const identity = {
      protocolId: REFERENCE_PROTOCOL_ID,
      marketId: identifier(marketId, 'MarketId'),
      tokenMint: identifier(assetId, 'TokenMint'),
    };
    const reference = new ExecutionRouter([
      new ReferenceProtocolAdapter([
        {
          identity,
          observedAt: new Date(now).toISOString(),
          quoteLamportsPerTokenBaseUnit: 1000n,
          buyFeeBps: 0n,
          sellFeeBps: 0n,
        },
      ]),
    ]);
    // Equity first values the existing generic position using its real recorded adapter.
    const loadReference = reference.loadPositionRoute.bind(reference);
    reference.loadPositionRoute = (identity, settlement) =>
      identity.protocolId === REFERENCE_PROTOCOL_ID
        ? loadReference(identity, settlement)
        : router.loadPositionRoute(identity, settlement);
    const before = await state(accountId);
    await expect(
      owner(
        accountId!,
        () =>
          executePaperBuy(db, reference, {
            competitionAccountId: accountId!,
            marketId,
            requestedPaperSolLamports: 1000000n,
            idempotencyKey: accountId + ':sixth-buy',
            authoritativeTimestamp: new Date(now),
          }),
        userId!,
        'BUY',
      ),
    ).rejects.toMatchObject({ code: 'TOKEN_SLOT_LIMIT_REACHED' });
    expect(await state(accountId)).toEqual(before);
    expect(
      (
        await db.pool.query(
          'select count(*)::int count from competition_token_slots where competition_account_id=$1',
          [accountId],
        )
      ).rows[0].count,
    ).toBe(5);
    await ledger(accountId);
  }
  const closed = [];
  for (const [userId, accountId] of [
    [op, 'controller-account'],
    [other, 'ordinary-account'],
  ]) {
    const result = await owner(
      accountId!,
      () =>
        executePaperSellAll(db, router, {
          competitionAccountId: accountId!,
          marketId: original.identity.marketId,
          idempotencyKey: 'parity-all:' + accountId,
          authoritativeTimestamp: new Date(now),
        }),
      userId!,
    );
    expect(result.actualNetPaperSolOutputLamports).toBeGreaterThan(0n);
    expect(result.position.status).toBe('CLOSED');
    closed.push({
      proceeds: result.actualNetPaperSolOutputLamports,
      quantity: result.actualTokenInputBaseUnits,
      state: await state(accountId),
    });
    await ledger(accountId);
  }
  expect(closed[0]).toEqual(closed[1]);
}, 20000);
