import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, it, expect } from 'vitest';
import {
  ExecutionRouter,
  createMarketStateEvidence,
  type MarketState,
  type MarketStateEvidence,
} from '@paperfund/execution';
import { utcInstant } from '@paperfund/core';
import { PumpFunProtocolAdapter } from '../../protocols/src/pump-fun.js';
import {
  cutoffHash,
  CUTOFF_CLOCK,
  verifyCutoffCapture,
  verifyDurableQuoteCutoff,
  type CurrentCutoffCapture,
  type CutoffHeader,
} from '../../protocols/src/cutoff-capture.js';
import { createDatabase, type DatabaseService } from '../src/database.js';
import { CurrentQuoteSettlement } from '../src/current-quote-settlement.js';
import {
  createUser,
  createAsset,
  createMarket,
  createDailyCompetition,
  createHourlyRound,
  initializeCompetitionAccount,
  executePaperBuy,
  executePaperSell,
  settleHourlyRound,
  reconcileAccountLedger,
} from '../src/financial-service.js';
import { currentQuoteHourlyProof, currentQuoteDailyProof } from '../src/current-quote-proof.js';
import { runHourlyLifecycleTick } from '../src/competition-service.js';
import { withQuoteRewardHold } from '../../../apps/api/isolated/current-quotes/production-public/policy.mjs';
const directory = 'docs/reward-distribution-20261026/integration';
const retained = JSON.parse(
  readFileSync(
    resolve(
      directory,
      readdirSync(directory)
        .filter((n) => n.startsWith('bank-'))
        .sort()[0]!,
    ),
    'utf8',
  ),
) as CurrentCutoffCapture;
const seed = { ...retained.evidence, chainSlot: BigInt(retained.evidence.chainSlot!) };
const name = 'current_cutoff_' + randomUUID().replaceAll('-', '');
const admin = new Pool({
  connectionString: 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta',
});
let db: DatabaseService,
  current: MarketState = structuredClone(seed),
  counter = 0,
  defaultHour = 0;
const router = new ExecutionRouter([
  new PumpFunProtocolAdapter({ loadMarketState: async () => structuredClone(current) }),
]);
beforeAll(async () => {
  await admin.query('create database "' + name + '"');
  db = createDatabase('postgresql://beta:disposable-beta-only@127.0.0.1:55462/' + name, {
    authorizePaperBuy: async () => true,
  });
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
  await db.pool.query(readFileSync('packages/db/isolated/current-quotes/settlement.sql', 'utf8'));
  // Isolated test clock ONLY. The production SQL retains clock_timestamp() with no override.
  await db.pool.query(
    "create table test_quote_clock(at_time timestamptz not null);insert into test_quote_clock values(clock_timestamp());create function test_quote_now() returns timestamptz language sql volatile as 'select at_time from test_quote_clock';",
  );
  await db.pool.query(
    readFileSync('packages/db/isolated/current-quotes/durable.sql', 'utf8').replaceAll(
      'clock_timestamp()',
      'test_quote_now()',
    ),
  );
  await db.pool.query(
    'alter table current_quote_cutoff_captures alter recorded_at set default test_quote_now()',
  );
  await db.pool.query(
    "insert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,provider_id) values('quote-policy','2046-01-03T00:00:00Z','2046-01-07T00:00:00Z','DURABLE_QUOTE_V2','ISOLATED_PROVIDER')",
  );
  await db.pool.query(
    "insert into current_quote_settlement_policies(id,effective_from,ends_before) values('policy','2046-01-01T00:00:00Z','2046-01-08T00:00:00Z')",
  );
  await createAsset(db, {
    id: 'token',
    mintAddress: seed.identity.tokenMint,
    decimals: Number(seed.normalizedState['tokenDecimals']),
  });
  await createAsset(db, {
    id: 'sol',
    mintAddress: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  });
  await createMarket(db, {
    id: seed.identity.marketId,
    venue: seed.identity.protocolId,
    baseAssetId: 'token',
    quoteAssetId: 'sol',
    providerMarketId: seed.identity.marketId,
  });
  await createDailyCompetition(db, {
    id: 'day',
    utcDate: '2046-01-01',
    startsAt: new Date('2046-01-01T00:00:00Z'),
    endsAtExclusive: new Date('2046-01-02T00:00:00Z'),
  });
  await createDailyCompetition(db, {
    id: 'quote-first-day',
    utcDate: '2046-01-03',
    startsAt: new Date('2046-01-03T00:00:00Z'),
    endsAtExclusive: new Date('2046-01-04T00:00:00Z'),
  });
}, 30000);
afterAll(async () => {
  if (db) await db.close();
  await admin.query('drop database if exists "' + name + '" with(force)');
  await admin.end();
});
async function quoteClock(at: Date) {
  await db.pool.query('update test_quote_clock set at_time=$1', [at]);
}
it('holds financial source acceptance for an ambiguous last-100ms user fill even when the account is flat and reconciled',async()=>{
 const r=await round(1,new Date('2046-01-03T03:00:00Z')),s=quoteStore(capture(r.end));
 const quantity=BigInt((await db.pool.query('select remaining_base_units from positions where competition_account_id=$1',[r.accounts[0]])).rows[0].remaining_base_units);
 await executePaperSell(db,router,{competitionAccountId:r.accounts[0]!,marketId:seed.identity.marketId,requestedTokenQuantity:quantity,idempotencyKey:'ambiguous-sell',authoritativeTimestamp:new Date(+r.end-50)});
 expect((await settleHourlyRound(s.database(),router,{hourlyRoundId:r.id,authoritativeTimestamp:r.end})).state).toBe('FINALIZED');
 expect((await reconcileAccountLedger(db,r.accounts[0]!)).reconciled).toBe(true);
 expect((await db.pool.query('select current_quote_source_scope($1,$2) proof',[r.id,'quote-policy'])).rows[0].proof.qualified).toBe(false);
});
function quoteStore(f: ReturnType<typeof capture>) {
  return new CurrentQuoteSettlement(db, router, 'quote-policy', {
    capture: async () => structuredClone(f.c),
    frontier: async () => {
      throw Error('EXACT_BOUNDARY_MUST_NOT_BE_REQUIRED');
    },
    finality: async () => f.last,
  });
}
it('qualifies a fresh durable quote without the exact last bank; restart reuses immutable evidence and separate committed WAL proof', async () => {
  const r = await round(2, new Date('2046-01-03T00:00:00Z')),
    f = capture(r.end),
    s = quoteStore(f);
  await quoteClock(new Date(+r.end - 500));
  expect((await s.captureDue(new Date(+r.end - 500))).failures).toEqual([]);
  await quoteClock(new Date(+r.end + 1000));
  const settled = await settleHourlyRound(s.database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(settled.state).toBe('FINALIZED');
  const scope = (
    await db.pool.query('select current_quote_source_scope($1,$2) proof', [r.id, 'quote-policy'])
  ).rows[0].proof;
  expect(scope.qualified).toBe(true);
  expect(
    (
      await db.pool.query('select document from current_quote_cutoff_seals where round_id=$1', [
        r.id,
      ])
    ).rows[0].document.next,
  ).toBe(null);
  const before = (await db.pool.query('select count(*)::int n from current_quote_settlement_steps'))
    .rows[0].n;
  await settleHourlyRound(quoteStore(f).database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(
    (await db.pool.query('select count(*)::int n from current_quote_settlement_steps')).rows[0].n,
  ).toBe(before);
  expect((await currentQuoteHourlyProof(s.database(), router, r.id)).payable).toBe(false);
});
it('cannot certify a late capture using a backdated caller time and never substitutes an after-cutoff quote', async () => {
  const r = await round(1, new Date('2046-01-03T01:00:00Z')),
    s = quoteStore(capture(r.end));
  await quoteClock(new Date(+r.end + 1));
  expect((await s.captureDue(new Date(+r.end - 500))).failures.length).toBeGreaterThan(0);
  const held = await settleHourlyRound(s.database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(held.state).toBe('SETTLING');
  expect(held.forcedSells).toHaveLength(0);
});
it('requires separately committed visibility before a WAL certificate and preserves UTC/finality bounds', async () => {
  const r = await round(1, new Date('2046-01-03T02:00:00Z')),
    f = capture(r.end);
  await quoteClock(new Date(+r.end - 500));
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    const id = 'same-transaction:' + r.id;
    const pos = (
      await client.query('select id from positions where competition_account_id=$1', [
        r.accounts[0],
      ])
    ).rows[0].id;
    await client.query(
      "insert into current_quote_cutoff_captures(id,position_id,round_id,policy_id,slot,bank_time,document,writer_xid) values($1,$2,$3,$4,$5,$6,$7::jsonb,'1'::xid8)",
      [
        id,
        pos,
        r.id,
        'quote-policy',
        f.c.evidence.chainSlot,
        f.c.bankTime,
        JSON.stringify(f.c, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      ],
    );
    await expect(client.query('select certify_current_quote_capture($1)', [id])).rejects.toThrow(
      'SEPARATELY_COMMITTED_CAPTURE_REQUIRED',
    );
  } finally {
    await client.query('rollback');
    client.release();
  }
  const proof = {
    receivedAt: new Date(+r.end - 500),
    certifiedAt: new Date(+r.end - 400),
    finalizedAt: new Date(+r.end + 1000),
    maxAgeMs: 10000,
    uncertaintyMs: 100,
  };
  expect(verifyDurableQuoteCutoff(f.c, f.last, r.end, proof)).toBe(true);
  for (const changed of [
    { certifiedAt: new Date(+r.end - 50) },
    { receivedAt: new Date(+r.end + 1) },
    { finalizedAt: new Date(+r.end + 60000) },
    { maxAgeMs: 999 },
    { uncertaintyMs: 0 },
  ])
    expect(() => verifyDurableQuoteCutoff(f.c, f.last, r.end, { ...proof, ...changed })).toThrow();
});
it('settles 24 traded durable-quote hours and their daily scores with immutable original-slot finality', async () => {
  const start = new Date('2046-01-04T00:00:00Z'),
    end = new Date(+start + 86400000);
  await createDailyCompetition(db, {
    id: 'quote-day',
    utcDate: '2046-01-04',
    startsAt: start,
    endsAtExclusive: end,
  });
  const users = ['quote-daily-a', 'quote-daily-b'];
  for (const id of users) await createUser(db, { id, walletAddress: id });
  let s: CurrentQuoteSettlement | undefined;
  for (let h = 0; h < 24; h++) {
    const r = await round(2, new Date(+start + h * 3600000), users);
    s = quoteStore(capture(r.end));
    await quoteClock(new Date(+r.end - 500));
    expect((await s.captureDue(new Date(+r.end - 500))).failures).toEqual([]);
    await quoteClock(new Date(+r.end + 1000));
    expect(
      (
        await settleHourlyRound(s.database(), router, {
          hourlyRoundId: r.id,
          authoritativeTimestamp: r.end,
        })
      ).state,
    ).toBe('FINALIZED');
  }
  await runHourlyLifecycleTick(s!.database(), router, end);
  const proof = await currentQuoteDailyProof(s!.database(), router, 'quote-day');
  expect(proof.finalResultsQualified).toBe(true);
  expect(proof.payable).toBe(false);
  expect(proof.hours.reduce((n, h) => n + h.fillCount, 0)).toBe(96);
  expect(
    (
      await db.pool.query(
        'select completed_hourly_round_count from daily_results where daily_competition_id=$1',
        ['quote-day'],
      )
    ).rows.map((r) => r.completed_hourly_round_count),
  ).toEqual([24, 24]);
});
async function round(users = 1, when?: Date, repeatedUsers?: string[]) {
  current = structuredClone(seed);
  const i = counter++,
    id = 'round-' + i,
    start = when ?? new Date(Date.UTC(2046, 0, 1, defaultHour++)),
    end = new Date(+start + 3600000),
    accounts: string[] = [];
  await createHourlyRound(db, {
    id,
    startsAt: start,
    endsAtExclusive: end,
    state: 'OPEN',
    rulesVersion: 'current-quote-isolated',
  });
  for (let n = 0; n < users; n++) {
    const account = id + '-user-' + n;
    accounts.push(account);
    const userId = repeatedUsers?.[n] ?? account;
    if (!repeatedUsers) await createUser(db, { id: userId, walletAddress: userId });
    await initializeCompetitionAccount(db, {
      accountId: account,
      userId,
      hourlyRoundId: id,
      idempotencyKey: account,
    });
    await executePaperBuy(db, router, {
      competitionAccountId: account,
      marketId: seed.identity.marketId,
      requestedPaperSolLamports: 100n,
      idempotencyKey: 'buy-' + account,
      authoritativeTimestamp: new Date(+start + 60000),
    });
  }
  return { id, start, end, accounts };
}
function capture(end: Date, mode: 'full' | 'partial' | 'zero' = 'full') {
  const c = structuredClone(retained),
    slot = Number(seed.chainSlot!) + 100,
    at = new Date(+end - 1000).toISOString();
  const e: MarketStateEvidence = createMarketStateEvidence({
    ...seed,
    observedAt: utcInstant(at),
    chainSlot: BigInt(slot),
    normalizedState: {
      ...seed.normalizedState,
      ...(mode === 'full' ? {} : { realSolReserves: mode === 'zero' ? '0' : '5' }),
    },
  });
  const rawSource = structuredClone(e.rawSource!) as {
    addresses: string[];
    accountDataBase64: string[];
    source: string;
  };
  if (mode !== 'full') {
    const curve = Buffer.from(rawSource.accountDataBase64[0]!, 'base64');
    curve.writeBigUInt64LE(mode === 'zero' ? 0n : 5n, 32);
    rawSource.accountDataBase64[0] = curve.toString('base64');
  }
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(BigInt(slot), 0);
  clock.writeBigInt64LE(BigInt((+end - 1000) / 1000), 32);
  const previous = c.batches.at(-1)!;
  const map = new Map(previous.addresses.map((a, i) => [a, previous.result.value[i]]));
  const addresses = [...rawSource.addresses, CUTOFF_CLOCK];
  c.batches = [
    {
      addresses,
      result: {
        context: { slot },
        value: addresses.map((a, i) =>
          a === CUTOFF_CLOCK
            ? {
                owner: 'Sysvar1111111111111111111111111111111111111',
                data: [clock.toString('base64'), 'base64'],
              }
            : { ...map.get(a)!, data: [rawSource.accountDataBase64[i]!, 'base64'] },
        ),
      },
    },
  ];
  c.evidence = createMarketStateEvidence({ ...e, rawSource });
  c.bankTime = at;
  c.hash = cutoffHash({ evidence: c.evidence, batches: c.batches, bankTime: c.bankTime });
  const last: CutoffHeader = {
    slot,
    blockTime: (+end - 1000) / 1000,
    blockhash: 'synthetic-pre',
    previousBlockhash: 'synthetic-parent',
    parentSlot: slot - 1,
  };
  const next: CutoffHeader = {
    slot: slot + 1,
    blockTime: +end / 1000,
    blockhash: 'synthetic-post',
    previousBlockhash: last.blockhash,
    parentSlot: slot,
  };
  verifyCutoffCapture(c, last, next, end);
  return { c, last, next };
}
function store(f: ReturnType<typeof capture>, failure = false) {
  return new CurrentQuoteSettlement(db, router, 'policy', {
    capture: async () => {
      if (failure) throw Error('SIMULATED_RPC_OUTAGE');
      return structuredClone(f.c);
    },
    frontier: async () => ({ last: f.last, next: f.next }),
  });
}
it('pins real captured native math, settles two users through the ordinary engine and prevents duplicate fills after restart', async () => {
  const r = await round(2),
    s = store(capture(r.end));
  expect((await s.captureDue(new Date(+r.end - 1000))).failures).toEqual([]);
  const q = withQuoteRewardHold(s.database());
  const settled = await settleHourlyRound(q, router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(settled.failures.map((f) => f.message)).toEqual([]);
  expect(settled.state).toBe('FINALIZED');
  const counts = () => db.pool.query('select count(*)::int n from current_quote_settlement_steps');
  const before = (await counts()).rows[0].n;
  const restarted = store(capture(r.end));
  await settleHourlyRound(restarted.database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect((await counts()).rows[0].n).toBe(before);
  const proof = await currentQuoteHourlyProof(restarted.database(), router, r.id);
  expect(proof.finalResultsQualified).toBe(true);
  expect(proof.payable).toBe(false);
  for (const a of r.accounts) expect((await reconcileAccountLedger(db, a)).reconciled).toBe(true);
});
it('does not replace missing cutoff evidence with a live quote or forgive historical REVIEW', async () => {
  const r = await round(),
    s = store(capture(r.end), true);
  expect((await s.captureDue(new Date(+r.end - 1000))).failures.length).toBeGreaterThan(0);
  const held = await settleHourlyRound(s.database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(held.state).toBe('SETTLING');
  expect(held.hourlyResults).toHaveLength(0);
  const p = (
    await db.pool.query('select id from positions where competition_account_id=$1', [r.accounts[0]])
  ).rows[0].id;
  await db.pool.query(
    'insert into legacy_source_reviews(id,hourly_round_id,position_id,reason) values($1,$2,$3,$4)',
    ['hold-' + r.id, r.id, p, 'ISOLATED_HISTORICAL_REVIEW'],
  );
  await expect(s.prepareRound(r.id, r.end)).rejects.toThrow('HISTORICAL_REVIEW_PRESERVED');
});
it('consumes native partial capacity once then proves zero remainder with a durable write-off, including restart', async () => {
  const r = await round(),
    f = capture(r.end, 'partial'),
    s = store(f);
  await s.captureDue(new Date(+r.end - 1000));
  const first = await settleHourlyRound(s.database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(first.forcedSells).toHaveLength(1);
  expect(first.state).toBe('SETTLING');
  const restart = store(f);
  const child = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      'packages/db/test/fixtures/current-cutoff-child.ts',
      name,
      'policy',
      r.id,
      r.end.toISOString(),
    ],
    { cwd: process.cwd(), timeout: 30000 },
  );
  const second = JSON.parse(child.stdout);
  expect(second.state).toBe('FINALIZED');
  expect(second.forcedSells).toBe(0);
  expect((await reconcileAccountLedger(db, r.accounts[0]!)).reconciled).toBe(true);
  const proof = await currentQuoteHourlyProof(restart.database(), router, r.id);
  expect(proof.finalResultsQualified).toBe(true);
  expect(proof.payable).toBe(false);
});
it('writes zero capacity off without inventing a SELL or proceeds', async () => {
  const r = await round(),
    s = store(capture(r.end, 'zero'));
  await s.captureDue(new Date(+r.end - 1000));
  const result = await settleHourlyRound(s.database(), router, {
    hourlyRoundId: r.id,
    authoritativeTimestamp: r.end,
  });
  expect(result.state).toBe('FINALIZED');
  expect(result.forcedSells).toHaveLength(0);
  expect((await reconcileAccountLedger(db, r.accounts[0]!)).reconciled).toBe(true);
});
it('finalizes a traded 24-hour UTC day through the normal worker and verifies every daily score and link', async () => {
  const start = new Date('2046-01-02T00:00:00Z'),
    end = new Date(+start + 86400000);
  await createDailyCompetition(db, {
    id: 'empty-day',
    utcDate: '2046-01-02',
    startsAt: start,
    endsAtExclusive: end,
  });
  let s: CurrentQuoteSettlement | undefined;
  for (let hour = 0; hour < 24; hour++) {
    const st = new Date(+start + hour * 3600000),
      r = await round(2, st);
    s = store(capture(r.end));
    await s.captureDue(new Date(+r.end - 1000));
    const result = await settleHourlyRound(s.database(), router, {
      hourlyRoundId: r.id,
      authoritativeTimestamp: r.end,
    });
    expect(result.state).toBe('FINALIZED');
    const scope = (
      await db.pool.query('select current_quote_source_scope($1,$2) proof', [r.id, 'policy'])
    ).rows[0].proof;
    expect(scope.qualified).toBe(true);
    expect(scope.settlementKind).toBe('PINNED_CUTOFF_EXITS');
    expect(scope.routeCount).toBe(1);
  }
  await runHourlyLifecycleTick(s!.database(), router, end);
  const proof = await currentQuoteDailyProof(s!.database(), router, 'empty-day');
  expect(proof.finalResultsQualified).toBe(true);
  expect(proof.payable).toBe(false);
  expect(proof.hours.reduce((n, h) => n + h.accountCount, 0)).toBe(48);
  expect(
    (
      await db.pool.query(
        'select count(*)::int n from daily_results where daily_competition_id=$1',
        ['empty-day'],
      )
    ).rows[0].n,
  ).toBe(48);
});
it('rejects altered raw bytes, nonadjacent banks and retroactive policy enrollment', async () => {
  const end = new Date('2046-01-03T01:00:00Z'),
    f = capture(end),
    bad = structuredClone(f.c);
  const batch = bad.batches[0]!;
  bad.batches[0] = {
    ...batch,
    result: {
      ...batch.result,
      value: batch.result.value.map((a, i) =>
        i === 0 && a ? { ...a, data: ['AA==', 'base64'] as const } : a,
      ),
    },
  };
  expect(() => verifyCutoffCapture(bad, f.last, f.next, end)).toThrow();
  expect(() =>
    verifyCutoffCapture(f.c, f.last, { ...f.next, parentSlot: f.last.slot - 1 }, end),
  ).toThrow();
  await expect(
    db.pool.query(
      "insert into current_quote_settlement_policies(id,effective_from,ends_before) values('retroactive','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
    ),
  ).rejects.toThrow();
  await expect(
    db.pool.query(
      "update current_quote_settlement_policies set ends_before='2046-01-07T00:00:00Z' where id='policy'",
    ),
  ).rejects.toThrow();
});
