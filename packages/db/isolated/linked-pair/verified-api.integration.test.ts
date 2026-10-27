import {
  controlledAutomaticRoutes,
  controlledOrcaMovement,
} from '../../../protocols/isolated/linked-pair/route-movement-fixtures.js';
import {
  curvePayoutSpec,
  controlledCurvePayoutInterval,
} from '../../../protocols/isolated/linked-pair/curve-payout-fixtures.js';
import {
  controlledMixedInterval,
  mixedBank,
} from '../../../protocols/isolated/linked-pair/mixed-fixtures.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pumpBank } from '../../../protocols/isolated/linked-pair/pump-fixtures.js';
import { linkedBindings } from '../../../protocols/isolated/linked-pair/shared-bridge.js';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { verifiedRouteRuntime } from '../../../../apps/api/isolated/verified-routes/runtime.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import type { AuthService } from '../../../../apps/api/src/auth.js';
import type { ProviderInterval } from '../../../protocols/isolated/linked-pair/external-flow.js';
import { compositeInterval } from '../../../protocols/isolated/linked-pair/remaining-fixtures.js';
import { createDatabase, type DatabaseService } from '../../src/database.js';
import {
  createUser,
  createHourlyRound,
  createDailyCompetition,
  createAsset,
  createMarket,
  initializeCompetitionAccount,
  executePaperBuy,
  settleHourlyRound,
  reconcileAccountLedger,
} from '../../src/financial-service.js';
import { LinkedStateStore, installLinkedTestSchema } from './store.js';
import type { CutoffFrontier } from './cutoff.js';
import { genericPumpSwapIdentity } from '../../../protocols/src/generic-pump-swap.js';
config({ path: resolve('.env'), quiet: true });
const retained = { before: pumpBank() };
const identity = genericPumpSwapIdentity(
  retained.before.mint,
  retained.before.quoteMint,
  retained.before.bridgePool,
);
const name = 'paperfund_linked_test_api_' + process.pid + '_' + Date.now();
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
  db = createDatabase(url, { authorizePaperBuy: async () => true });
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
async function fixture(
  source = retained.before,
  retainedTime = false,
  preference?: (
    mint: string,
    root: typeof retained.before,
  ) => Promise<ReturnType<typeof genericPumpSwapIdentity>>,
) {
  const id = randomUUID(),
    round = 'round:' + id,
    account = 'account:' + id,
    user = 'user:' + id;
  let cutoff = retainedTime
    ? new Date((Math.floor(Date.parse(source.observedAt) / 3600000) + 1) * 3600000)
    : new Date(Date.UTC(2026, 9, 21, 3 + counter++));
  while (
    !retainedTime &&
    (
      await db.pool.query('select 1 from hourly_rounds where starts_at=$1', [
        new Date(cutoff.getTime() - 3600000),
      ])
    ).rowCount
  ) {
    cutoff = new Date(cutoff.getTime() + 3600000);
    counter++;
  }
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
  const s = structuredClone(source);

  const clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(s.accounts[clock]!.base64, 'base64');
  if (!retainedTime) {
    raw.writeBigUInt64LE(BigInt(s.slot), 0);
    raw.writeBigInt64LE(BigInt(cutoff.getTime() / 1000 - 1), 32);
    s.accounts[clock] = { ...s.accounts[clock]!, base64: raw.toString('base64') };
    s.observedAt = new Date(cutoff.getTime() - 500).toISOString();
  }

  let published: ProviderInterval | null = null;
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
  // Register each admitted fixture venue against its existing asset, independently of test order.
  for (const r of linkedBindings(s)) {
    const id = genericPumpSwapIdentity(r.mint, r.quoteMint, r.bridgePool);
    await db.pool.query(
      'insert into markets(id,base_asset_id,quote_asset_id,venue,provider_market_id) select $1,a.id,sol.id,$2,$1 from assets a cross join assets sol where a.mint_address=$3 and sol.mint_address=$4 on conflict(id) do nothing',
      [id.marketId, id.protocolId, r.mint, 'So11111111111111111111111111111111111111112'],
    );
  }
  const store = new LinkedStateStore(db, account, round);
  await store.initialize(s);
  const options = {
    now: () => now,
    interval: async () => {
      providerReads++;
      return published;
    },
    permission: async () => ({ discover: true, buy: true, authorizeLive: async () => undefined }),
    cutoffFrontier: async () => frontier,
    ...(preference ? { selectRoute: preference } : {}),
  };
  const runtime = await verifiedRouteRuntime(store, options),
    router = runtime.router;
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
    user,
    publish: (e: ProviderInterval) => {
      published = e;
    },
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
    setNow: (value: number) => {
      now = value;
    },
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

const SOL = 'So11111111111111111111111111111111111111112';
function withDirect(source: typeof retained.before) {
  const s = structuredClone(source);
  return {
    ...s,
    linkedRoutes: [
      ...linkedBindings(s),
      { mint: s.quoteMint, quoteMint: SOL, targetPool: s.bridgePool, bridgePool: s.bridgePool },
    ],
  };
}
/** Only synthetic receipts may be rebased to a disposable round's controlled Clock. */
function fitControlledInterval(e: ProviderInterval, source: typeof retained.before) {
  if (
    e.blocks.some((b) =>
      b.result.transactions.some((t) => !t.transaction.signatures[0]?.startsWith('CONTROLLED-')),
    )
  )
    throw Error('GENUINE_EVIDENCE_RETIMING_FORBIDDEN');
  e.before = structuredClone(source);
  const clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(source.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(e.after.slot), 0);
  e.after.accounts[clock] = { ...source.accounts[clock]!, base64: raw.toString('base64') };
  e.after.observedAt = source.observedAt;
  e.acquiredAt = source.observedAt;
  for (const b of e.blocks) b.result.blockTime = Number(raw.readBigInt64LE(32));
}
function api(f: Awaited<ReturnType<typeof fixture>>, runtime = f.runtime, build = buildApp) {
  const app = build({
    config: { LOG_LEVEL: 'silent', BETA_INVITE_ONLY: false },
    database: runtime.database,
    redis: { healthCheck: async () => true },
    auth: {
      authenticate: async (token: string) =>
        token === f.user ? { id: f.user, walletAddress: 'wallet:' + f.user } : null,
    } as unknown as AuthService,
    competition: runtime.competition,
    logger: false,
  });
  const request = async (
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, string>,
    key: string = randomUUID(),
  ) => {
    const response = await app.inject({
      method,
      url: '/api/v1/' + path,
      headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': key },
      ...(payload ? { payload } : {}),
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  return { app, request };
}
it('actual RC1 API/router buys linked targets and their direct-SOL bridge, values one shadow revision, partially/full sells and restarts without duplicate effects', async () => {
  const f = await fixture(withDirect(retained.before), true),
    a = api(f);
  try {
    const mints = [...new Set(linkedBindings(f.s).map((r) => r.mint))];
    const bought = await Promise.all(
      mints.map((mint) =>
        a.request('POST', 'trades/buy', { mint, paperSol: '0.01' }, 'buy:' + mint),
      ),
    );
    const checkpoint = await counts(f.account);
    expect(checkpoint.fills).toBe('3');
    expect(checkpoint.receipts).toBe('3');
    await a.request('POST', 'trades/buy', { mint: mints[0]!, paperSol: '0.01' }, 'buy:' + mints[0]);
    expect(await counts(f.account)).toEqual(checkpoint);
    const portfolio = await a.request('GET', 'positions');
    expect(portfolio.valuationStatus).toBe('AVAILABLE');
    expect(portfolio.positions).toHaveLength(3);
    const account = await f.runtime.competition.getCurrentAccount(f.user);
    const values = await f.runtime.database.valueMarketPortfolio!(
      account!.positions.map((p) => ({
        positionId: p.id,
        identity: genericPumpSwapIdentity(
          p.mint_address,
          linkedBindings(f.s).find((r) => r.mint === p.mint_address)!.quoteMint,
          linkedBindings(f.s).find((r) => r.mint === p.mint_address)!.bridgePool,
        ),
        quantity: BigInt(p.remaining_base_units),
      })),
    );
    expect(BigInt(portfolio.executablePositionsLamports)).toBe(
      values.reduce((n, p) => n + p.value, 0n),
    );
    for (let i = 0; i < mints.length; i++)
      await a.request('POST', 'trades/sell', {
        mint: mints[i]!,
        quantity: (BigInt(bought[i].tokenQuantityReceivedBaseUnits) / 3n).toString(),
      });
    await f.store.recover();
    const runtime = await verifiedRouteRuntime(f.store, f.options),
      b = api(f, runtime);
    try {
      for (const mint of mints) await b.request('POST', 'trades/sell', { mint, quantity: 'ALL' });
      expect((await b.request('GET', 'positions')).positions).toHaveLength(0);
      const account = await b.request('GET', 'rounds/current/account'),
        cash = (await counts(f.account)).cash;
      const expected = (
        await db.pool.query(
          "select (10000000000+sum(case f.side when 'BUY' then -f.actual_input_lamports else f.actual_output_lamports end))::text cash from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1",
          [f.account],
        )
      ).rows[0].cash;
      expect(account.paperSolLamports).toBe(cash);
      expect(cash).toBe(expected);
      expect(BigInt(cash)).toBeLessThan(10000000000n);
      expect(account.realizedPnlLamports).toBe((BigInt(cash) - 10000000000n).toString());
      expect(account.slotsUsed).toBe(3);
      expect(account.positions).toHaveLength(0);
      expect((await b.request('GET', 'trades')).items).toHaveLength(9);
      writeFileSync(
        'docs/linked-pair-20261021/verified-route-integration/router-results.json',
        JSON.stringify(
          {
            scope: 'ISOLATED_RETAINED_BANK_REPLAY_NOT_LIVE_BROWSER',
            initialCashLamports: '10000000000',
            paperSolPerBuy: '0.01',
            mints,
            buyTokenOutputs: bought.map((v) => v.tokenQuantityReceivedBaseUnits),
            finalCashLamports: cash,
            realizedPnlLamports: account.realizedPnlLamports,
            openPositions: 0,
            slotsUsed: 3,
            fills: 9,
            liquidityReceipts: 9,
            apiHistoryItems: 9,
            restart: true,
            duplicateRequestNoEffect: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await b.app.close();
    }
    expect((await counts(f.account)).fills).toBe('9');
    expect((await counts(f.account)).receipts).toBe('9');
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    await f.store.recover();
  } finally {
    await a.app.close();
  }
}, 120000);
it('actual API/router uses genuine complete pool-only mainnet chronology with prior paper impact and persists its replay once', async () => {
  const read = (name: string) =>
    JSON.parse(
      gunzipSync(
        readFileSync('docs/linked-pair-20261021/external-flow-completion/' + name),
      ).toString(),
    ) as ProviderInterval;
  const first = read('provider-459758217-459758224.json.gz'),
    last = read('provider-459758224-459758238.json.gz');
  const e = {
    ...first,
    after: last.after,
    slots: [...first.slots, ...last.slots],
    blocks: [...first.blocks, ...last.blocks],
  };
  const f = await fixture(e.before, true),
    a = api(f);
  try {
    const bought = await a.request('POST', 'trades/buy', { mint: e.before.mint, paperSol: '0.01' });
    f.publish(e);
    f.setNow(Date.parse(e.after.observedAt));
    await a.request('POST', 'trades/sell', {
      mint: e.before.mint,
      quantity: (BigInt(bought.tokenQuantityReceivedBaseUnits) / 3n).toString(),
    });
    await a.request('POST', 'trades/sell', { mint: e.before.mint, quantity: 'ALL' }, 'full');
    const count = await counts(f.account);
    await a.request('POST', 'trades/sell', { mint: e.before.mint, quantity: 'ALL' }, 'full');
    expect(await counts(f.account)).toEqual(count);
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);
it('actual API/router preserves supported Orca BUY, partial/full SELL and native successor recovery', async () => {
  const source = compositeInterval().before,
    f = await fixture(source),
    a = api(f);
  try {
    const b = await a.request('POST', 'trades/buy', { mint: source.mint, paperSol: '0.01' });
    await a.request('POST', 'trades/sell', {
      mint: source.mint,
      quantity: (BigInt(b.tokenQuantityReceivedBaseUnits) / 2n).toString(),
    });
    await a.request('POST', 'trades/sell', { mint: source.mint, quantity: 'ALL' });
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 60000);
it('actual API entries sharing linked/direct liquidity settle through the persisted UTC seal exactly once', async () => {
  const f = await fixture(withDirect(retained.before)),
    a = api(f);
  try {
    for (const mint of [...new Set(linkedBindings(f.s).map((r) => r.mint))])
      await a.request('POST', 'trades/buy', { mint, paperSol: '0.01' });
    f.advance();
    const settled = await f.settle();
    expect(settled.state).toBe('FINALIZED');
    expect(settled.failures).toEqual([]);
    const before = await counts(f.account);
    await f.settle();
    expect(await counts(f.account)).toEqual(before);
    expect(
      (
        await db.pool.query('select status from positions where competition_account_id=$1', [
          f.account,
        ])
      ).rows.every((r) => r.status === 'CLOSED'),
    ).toBe(true);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    await f.store.recover();
  } finally {
    await a.app.close();
  }
}, 120000);
it('strict Clock/context mismatch rejects initialization without a branch or financial effects', async () => {
  const f = await fixture(),
    before = await counts(f.account),
    s = structuredClone(f.s),
    clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(s.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(s.slot + 1), 0);
  s.accounts[clock] = { ...s.accounts[clock]!, base64: raw.toString('base64') };
  await expect(f.store.initialize(s)).rejects.toThrow('STAGE1_CLOCK_INCONSISTENT');
  expect(await counts(f.account)).toEqual(before);
  f.setNow(Date.parse(f.s.observedAt) + 10000);
  await expect(f.runtime.adapter.loadMarketState(identity)).rejects.toThrow('STAGE1_STALE_BANK');
  expect(await counts(f.account)).toEqual(before);
});

it('actual API/router changes a held token from native PumpSwap bridge to supported Orca without resetting either pool or its economic position (controlled composite)', async () => {
  const root = compositeInterval().before,
    pump = pumpBank();
  for (const [address, account] of Object.entries(pump.accounts))
    if (!root.accounts[address]) root.accounts[address] = structuredClone(account);
  const original = linkedBindings(root),
    extra = original.map((r) => ({ ...r, bridgePool: pump.bridgePool }));
  const combined = { ...root, linkedRoutes: [...original, ...extra] };
  let preferred = pump.bridgePool;
  const f = await fixture(combined, false, async (mint, s) => {
      const r = linkedBindings(s).find((r) => r.mint === mint && r.bridgePool === preferred)!;
      return genericPumpSwapIdentity(r.mint, r.quoteMint, r.bridgePool);
    }),
    a = api(f);
  try {
    const b = await a.request('POST', 'trades/buy', { mint: root.mint, paperSol: '0.01' });
    const initial = await f.store.load();
    preferred = root.bridgePool;
    await a.request('POST', 'trades/sell', {
      mint: root.mint,
      quantity: (BigInt(b.tokenQuantityReceivedBaseUnits) / 2n).toString(),
    });
    await a.request('POST', 'trades/sell', { mint: root.mint, quantity: 'ALL' });
    const final = await f.store.load();
    expect(final.document.simulated.accounts[pump.bridgePool]).toEqual(
      initial.document.simulated.accounts[pump.bridgePool],
    );
    expect(final.document.simulated.accounts[root.bridgePool]).not.toEqual(
      initial.document.simulated.accounts[root.bridgePool],
    );
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from positions where competition_account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from competition_token_slots where competition_account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(1);
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);
it('unreconcilable genuine multi-hop evidence durably quarantines its shared group and preserves prior paper impact across restart', async () => {
  const e = JSON.parse(
    gunzipSync(
      readFileSync('docs/linked-pair-20261021/pump-bridge/provider-459703404-459703413.json.gz'),
    ).toString(),
  ) as ProviderInterval;
  // Retained historical packet has missing auxiliary dependencies; it must reject, never skip.
  const f = await fixture(e.before),
    a = api(f);
  e.before = structuredClone(f.s);
  // Bank timing is controlled only to fit the disposable round; unsupported native dependency is unchanged.
  const clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(f.s.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(e.after.slot), 0);
  e.after.accounts[clock] = { ...f.s.accounts[clock]!, base64: raw.toString('base64') };
  e.after.observedAt = f.s.observedAt;
  for (const b of e.blocks) b.result.blockTime = Number(raw.readBigInt64LE(32));
  try {
    await a.request('POST', 'trades/buy', { mint: e.before.mint, paperSol: '0.01' });
    const head = await f.store.load(),
      count = await counts(f.account);
    f.publish(e);
    const response = await a.app.inject({
      method: 'POST',
      url: '/api/v1/trades/sell',
      headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': 'unsupported' },
      payload: { mint: e.before.mint, quantity: 'ALL' },
    });
    expect(response.statusCode).not.toBe(200);
    expect(await counts(f.account)).toEqual(count);
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
    const audit = (
      await db.pool.query(
        'select reason from linked_candidate.route_quarantine where account_id=$1',
        [f.account],
      )
    ).rows[0];
    expect(audit.reason).toContain('MULTI_HOP_');
    const restarted = await verifiedRouteRuntime(f.store, f.options);
    await expect(restarted.router.mintResolver!(e.before.mint)).rejects.toThrow(
      'LINKED_ROUTE_QUARANTINED',
    );
    await expect(
      db.pool.query(
        'update linked_candidate.route_status set quarantined=false where account_id=$1',
        [f.account],
      ),
    ).rejects.toThrow('LINKED_QUARANTINE_NO_RESET');
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);

it('kills the actual API process after both ledger and native writes, recovers the original branch and retries the same HTTP intent once', async () => {
  const f = await fixture(),
    before = await counts(f.account),
    head = await f.store.load(),
    key = 'api-crash';
  const child = fork(fileURLToPath(new URL('./verified-api-crash-child.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: resolve('apps/api/isolated/verified-routes/tsconfig.json'),
      LINKED_TEST_DB_URL: url,
      LINKED_TEST_ACCOUNT: f.account,
      LINKED_TEST_ROUND: f.round,
      LINKED_TEST_USER: f.user,
      LINKED_TEST_KEY: key,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stderr?.on('data', (d) => {
    errors += d.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CHILD_TIMEOUT:' + errors)), 20000);
      child.once('message', (m) => {
        clearTimeout(timer);
        if ((m as { staged?: boolean }).staged) resolve();
        else reject(Error('BAD_CHILD'));
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('CHILD_EXIT:' + errors));
      });
    });
    const stopped = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGKILL');
    await stopped;
    expect(await counts(f.account)).toEqual(before);
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
    await f.store.recover();
    const a = api(f);
    try {
      await a.request('POST', 'trades/buy', { mint: f.s.mint, paperSol: '0.01' }, key);
      const committed = await counts(f.account);
      await a.request('POST', 'trades/buy', { mint: f.s.mint, paperSol: '0.01' }, key);
      expect(await counts(f.account)).toEqual(committed);
      expect(committed).toMatchObject({ fills: '1', receipts: '1' });
    } finally {
      await a.app.close();
    }
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }
}, 60000);

it('actual API enforces the 20% cap and existing EXIT_ONLY permission without a fill or native receipt', async () => {
  const f = await fixture(),
    before = await counts(f.account),
    a = api(f);
  try {
    const response = await a.app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': 'cap' },
      payload: { mint: f.s.mint, paperSol: '2.000000001' },
    });
    expect(response.statusCode).not.toBe(200);
    expect(await counts(f.account)).toEqual(before);
    const restricted = await verifiedRouteRuntime(f.store, {
        ...f.options,
        permission: async () => ({
          discover: true,
          buy: false,
          authorizeLive: async (side) => {
            if (side === 'BUY') throw Error('EXIT_ONLY');
          },
        }),
      }),
      b = api(f, restricted);
    try {
      const preflight = await b.request('GET', 'trades/buy-preflight?mint=' + f.s.mint);
      expect(preflight.blockingReason).toBe('GENERIC_OPERATOR_ENTRY_DISABLED');
      const denied = await b.app.inject({
        method: 'POST',
        url: '/api/v1/trades/buy',
        headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': 'denied' },
        payload: { mint: f.s.mint, paperSol: '0.01' },
      });
      expect(denied.statusCode).not.toBe(200);
      expect(await counts(f.account)).toEqual(before);
    } finally {
      await b.app.close();
    }
  } finally {
    await a.app.close();
  }
}, 60000);

it('a quarantine arriving after API simulation rejects the pending commit and rolls back cash, fill, journal and liquidity together', async () => {
  const f = await fixture(),
    a = api(f),
    before = await counts(f.account),
    head = await f.store.load(),
    commit = f.runtime.database.commitMarketExecution!;
  Object.assign(f.runtime.database, {
    commitMarketExecution: async (...args: Parameters<typeof commit>) => {
      await f.store.quarantine(compositeInterval(), Error('UNSUPPORTED_DEPENDENCY_ARRIVED'));
      await commit(...args);
    },
  });
  try {
    const response = await a.app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': 'raced-quarantine' },
      payload: { mint: f.s.mint, paperSol: '0.01' },
    });
    expect(response.statusCode).not.toBe(200);
    expect(await counts(f.account)).toEqual(before);
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
    await expect(f.store.assertAvailable()).rejects.toThrow('LINKED_ROUTE_QUARANTINED');
    await f.store.recover();
  } finally {
    await a.app.close();
  }
}, 60000);

it('the private deployment-disabled API bundle includes authoritative source hooks and the real API error contract', async () => {
  const path = resolve('docs/linked-pair-20261021/verified-route-integration/verified-routes.mjs');
  const bundled = (await import(pathToFileURL(path).href)) as {
    verifiedRouteRuntime: typeof verifiedRouteRuntime;
    buildApp: typeof buildApp;
  };
  const f = await fixture(),
    runtime = await bundled.verifiedRouteRuntime(f.store, f.options),
    a = api(f, runtime, bundled.buildApp);
  try {
    expect(runtime.deploymentEnabled).toBe(false);
    const denied = await a.app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': 'bundle-cap' },
      payload: { mint: f.s.mint, paperSol: '2.000000001' },
    });
    expect(denied.json().error.code).toBe('MAX_BUY_RATIO_EXCEEDED');
    await a.request('POST', 'trades/buy', { mint: f.s.mint, paperSol: '0.01' });
    expect(await counts(f.account)).toMatchObject({ fills: '1', receipts: '1' });
    await a.request('POST', 'trades/sell', { mint: f.s.mint, quantity: 'ALL' });
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 60000);

it('actual API/router retains prior paper fills through controlled mixed pool/curve flow, shared positions, portfolio valuation and restart without duplicate effects', async () => {
  const e = await controlledMixedInterval(mixedBank()),
    f = await fixture(e.before),
    a = api(f);
  fitControlledInterval(e, f.s);
  try {
    const mints = [...new Set(linkedBindings(f.s).map((r) => r.mint))],
      quantities = new Map<string, bigint>();
    for (const mint of mints) {
      const b = await a.request('POST', 'trades/buy', { mint, paperSol: '0.01' });
      quantities.set(mint, BigInt(b.tokenQuantityReceivedBaseUnits));
    }
    f.publish(e);
    f.setNow(Date.parse(e.after.observedAt));
    for (const mint of mints)
      await a.request('POST', 'trades/sell', {
        mint,
        quantity: (quantities.get(mint)! / 3n).toString(),
      });
    const p = await a.request('GET', 'positions');
    expect(p.valuationStatus).toBe('AVAILABLE');
    expect(p.positions).toHaveLength(2);
    await f.store.recover();
    for (const mint of mints)
      await a.request('POST', 'trades/sell', { mint, quantity: 'ALL' }, 'mixed-full:' + mint);
    const count = await counts(f.account);
    expect(count.fills).toBe('6');
    expect(count.receipts).toBe('6');
    for (const mint of mints)
      await a.request('POST', 'trades/sell', { mint, quantity: 'ALL' }, 'mixed-full:' + mint);
    expect(await counts(f.account)).toEqual(count);
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);
it('actual API/router settles shared positions after controlled mixed external flow using the same sealed liquidity revision once', async () => {
  const f = await fixture(mixedBank()),
    a = api(f);
  try {
    for (const mint of [...new Set(linkedBindings(f.s).map((r) => r.mint))])
      await a.request('POST', 'trades/buy', { mint, paperSol: '0.01' });
    const e = await controlledMixedInterval(f.s),
      time = f.cutoff.getTime() / 1000 - 1,
      clock = 'SysvarC1ock11111111111111111111111111111111',
      raw = Buffer.from(e.after.accounts[clock]!.base64, 'base64');
    raw.writeBigInt64LE(BigInt(time), 32);
    e.after.accounts[clock] = { ...e.after.accounts[clock]!, base64: raw.toString('base64') };
    e.after.observedAt = f.s.observedAt;
    e.acquiredAt = f.s.observedAt;
    e.blocks[0]!.result.blockTime = time;
    f.publish(e);
    await a.request('GET', 'positions');
    f.frontier.last = {
      slot: e.after.slot,
      blockTime: time,
      blockhash: e.blocks[0]!.result.blockhash,
    };
    f.frontier.next = {
      slot: e.after.slot + 1,
      parentSlot: e.after.slot,
      previousBlockhash: f.frontier.last.blockhash,
      blockhash: 'controlled-cutoff-next',
      blockTime: time + 1,
    };
    f.frontier.interval = e;
    f.advance();
    const settled = await f.settle();
    expect(settled.state).toBe('FINALIZED');
    expect(settled.failures).toEqual([]);
    const before = await counts(f.account);
    await f.store.recover();
    await f.settle();
    expect(await counts(f.account)).toEqual(before);
    expect(before.fills).toBe('4');
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);

it('actual API quarantines an incoherent curve CPI before any financial or liquidity commit and preserves recoverable history', async () => {
  const e = await controlledMixedInterval(mixedBank()),
    f = await fixture(e.before),
    a = api(f);
  fitControlledInterval(e, f.s);
  try {
    await a.request('POST', 'trades/buy', { mint: f.s.mint, paperSol: '0.01' });
    const before = await counts(f.account),
      head = await f.store.load();
    e.blocks[0]!.result.transactions[0]!.meta.innerInstructions[0]!.instructions =
      e.blocks[0]!.result.transactions[0]!.meta.innerInstructions[0]!.instructions.filter(
        (i) =>
          i.programIdIndex !==
          e.blocks[0]!.result.transactions[0]!.transaction.message.accountKeys.indexOf(
            '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
          ),
      );
    f.publish(e);
    f.setNow(Date.parse(e.after.observedAt));
    const response = await a.app.inject({
      method: 'POST',
      url: '/api/v1/trades/sell',
      headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': 'bad-mixed' },
      payload: { mint: f.s.mint, quantity: 'ALL' },
    });
    expect(response.statusCode).not.toBe(200);
    expect(await counts(f.account)).toEqual(before);
    expect(JSON.stringify((await f.store.load()).document)).toEqual(JSON.stringify(head.document));
    await expect(f.store.assertAvailable()).rejects.toThrow();
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);

it('actual API can BUY through PumpSwap, reconcile mixed external curve flow and partially/full SELL through supported Orca without another position or liquidity reset', async () => {
  const root = compositeInterval().before,
    pump = mixedBank();
  for (const [address, account] of Object.entries(pump.accounts))
    if (!root.accounts[address]) root.accounts[address] = structuredClone(account);
  const original = linkedBindings(root),
    combined = {
      ...root,
      linkedRoutes: [...original, ...original.map((r) => ({ ...r, bridgePool: pump.bridgePool }))],
    };
  let preferred = pump.bridgePool;
  const f = await fixture(combined, false, async (mint, s) => {
      const r = linkedBindings(s).find((r) => r.mint === mint && r.bridgePool === preferred)!;
      return genericPumpSwapIdentity(r.mint, r.quoteMint, r.bridgePool);
    }),
    a = api(f);
  try {
    const bought = await a.request('POST', 'trades/buy', { mint: root.mint, paperSol: '0.01' }),
      e = await controlledMixedInterval({ ...f.s, bridgePool: pump.bridgePool });
    e.before.bridgePool = f.s.bridgePool;
    e.after.bridgePool = f.s.bridgePool;
    const time = f.cutoff.getTime() / 1000 - 1,
      clock = 'SysvarC1ock11111111111111111111111111111111',
      raw = Buffer.from(e.after.accounts[clock]!.base64, 'base64');
    raw.writeBigInt64LE(BigInt(time), 32);
    e.after.accounts[clock] = { ...e.after.accounts[clock]!, base64: raw.toString('base64') };
    e.after.observedAt = f.s.observedAt;
    e.acquiredAt = f.s.observedAt;
    e.blocks[0]!.result.blockTime = time;
    f.publish(e);
    preferred = f.s.bridgePool;
    await a.request('POST', 'trades/sell', {
      mint: root.mint,
      quantity: (BigInt(bought.tokenQuantityReceivedBaseUnits) / 2n).toString(),
    });
    await a.request('POST', 'trades/sell', { mint: root.mint, quantity: 'ALL' });
    await f.store.recover();
    expect((await counts(f.account)).fills).toBe('3');
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);

it('actual API automatically switches from Orca to PumpSwap after executable external movement, without a preference override or another position', async () => {
  const root = controlledAutomaticRoutes(),
    f = await fixture(root),
    a = api(f);
  try {
    const before = await f.router.mintResolver!(root.mint);
    expect(before.marketId).toBe(
      genericPumpSwapIdentity(root.mint, root.quoteMint, root.bridgePool).marketId,
    );
    const bought = await a.request('POST', 'trades/buy', { mint: root.mint, paperSol: '0.01' }),
      e = await controlledOrcaMovement(f.s);
    f.publish(e);
    const selected = await f.router.mintResolver!(root.mint);
    expect(selected.marketId).not.toBe(before.marketId);
    await a.request('POST', 'trades/sell', {
      mint: root.mint,
      quantity: (BigInt(bought.tokenQuantityReceivedBaseUnits) / 2n).toString(),
    });
    await a.request('POST', 'trades/sell', { mint: root.mint, quantity: 'ALL' });
    await f.store.recover();
    expect((await counts(f.account)).fills).toBe('3');
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);
it('actual API retains authoritative balances, valuations and exits after mixed flow followed by V2 holder-fee payouts', async () => {
  const f = await fixture(mixedBank()),
    a = api(f);
  try {
    const bought = await a.request('POST', 'trades/buy', { mint: f.s.mint, paperSol: '0.01' }),
      first = await controlledMixedInterval(f.s);
    fitControlledInterval(first, f.s);
    f.publish(first);
    await a.request('POST', 'trades/sell', {
      mint: f.s.mint,
      quantity: (BigInt(bought.tokenQuantityReceivedBaseUnits) / 4n).toString(),
    });
    const head = await f.store.load(),
      spec = await curvePayoutSpec(head.document.real, true, 10000000n),
      e = await controlledCurvePayoutInterval(head.document.real, spec);
    fitControlledInterval(e, head.document.real);
    f.publish(e);
    expect((await a.request('GET', 'positions')).valuationStatus).toBe('AVAILABLE');
    await a.request('POST', 'trades/sell', { mint: f.s.mint, quantity: 'ALL' }, 'v2-full');
    const c = await counts(f.account);
    await a.request('POST', 'trades/sell', { mint: f.s.mint, quantity: 'ALL' }, 'v2-full');
    expect(await counts(f.account)).toEqual(c);
    await f.store.recover();
    expect(c.fills).toBe('3');
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await a.app.close();
  }
}, 120000);
