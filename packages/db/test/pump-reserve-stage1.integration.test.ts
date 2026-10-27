/** Disposable isolated DB only; no live financial service or ledger is invoked. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { identifier, utcInstant } from '@paperfund/core';
import { type MarketState } from '@paperfund/execution';
import {
  PUMP_FUN_PROTOCOL_ID,
  PUMP_FUN_ADAPTER_VERSION,
  PUMP_FUN_NORMALIZATION_VERSION,
} from '../../protocols/src/pump-fun.js';
import {
  createStage1Model,
  prepareStage1Transition,
  stage1Hash,
  type Stage1Model,
  type Stage1Request,
  type Stage1Scope,
} from '../../protocols/src/experimental/pump-reserve-stage1.js';
import {
  IsolatedPumpStage1Store,
  writeStage1ExecutionReceipt,
} from '../src/experimental/pump-reserve-stage1-store.js';
dotenv({ path: resolve('.env'), quiet: true });
const name = `paperfund_pump_stage1_${process.pid}_${Date.now()}`;
const url = new URL(process.env['DATABASE_URL']!);
const admin = new Pool({ connectionString: url.toString() });
let pool: Pool,
  store: IsolatedPumpStage1Store,
  initial: Stage1Model,
  created = false;
let isolatedConnection: string;
const fixture = JSON.parse(
  readFileSync(resolve('packages/protocols/test/fixtures/pump-stage1-anchor.json'), 'utf8'),
);
const scope: Stage1Scope = {
  userId: 'test-user-a',
  accountId: 'test-account-a',
  roundId: 'test-round-a',
  startsAt: '2026-10-10T23:00:00.000Z',
  endsAtExclusive: '2026-10-11T00:00:00.000Z',
  mint: fixture.normalizedState.tokenMint,
  curve: fixture.normalizedState.bondingCurveAddress,
};
const snapshot = (): MarketState => ({
  identity: {
    protocolId: PUMP_FUN_PROTOCOL_ID,
    marketId: identifier(scope.curve, 'MarketId'),
    tokenMint: identifier(scope.mint, 'TokenMint'),
  },
  observedAt: utcInstant(fixture.observedAt),
  chainSlot: BigInt(fixture.slot),
  chainBlockId: null,
  adapterVersion: PUMP_FUN_ADAPTER_VERSION,
  normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
  normalizedState: structuredClone(fixture.normalizedState),
  rawSource: structuredClone(fixture.rawSource),
});
const request = (m = initial, key = `request-${m.revision}`): Stage1Request => ({
  key,
  executionId: key,
  side: 'BUY',
  amount: '1700000000',
  expectedRevision: m.revision,
  predecessorHash: m.hash,
  at: '2026-10-10T23:55:00.000Z',
  phase: 'OPEN',
  continuity: 'ISOLATED_FIXED_SNAPSHOT',
});
const counts = async () => {
  const r = await pool.query<{ models: number; transitions: number; receipts: number }>(
    'select (select count(*)::int from pump_stage1.models) models,(select count(*)::int from pump_stage1.transitions) transitions,(select count(*)::int from pump_stage1.execution_receipts) receipts',
  );
  return r.rows[0]!;
};
beforeAll(async () => {
  try {
    if (!/^paperfund_pump_stage1_\d+_\d+$/.test(name)) throw Error();
    await admin.query(`create database "${name}"`);
    created = true;
    const isolated = new URL(url);
    isolated.pathname = `/${name}`;
    isolatedConnection = isolated.toString();
    pool = new Pool({ connectionString: isolatedConnection, max: 4 });
    await pool.query(
      'create table hourly_rounds(id text primary key,state text not null,starts_at timestamptz not null,ends_at_exclusive timestamptz not null); create table competition_accounts(id text primary key,user_id text not null,hourly_round_id text not null references hourly_rounds(id));',
    );
    await pool.query(readFileSync(resolve('docs/sql/pump-reserve-stage1-isolated.sql'), 'utf8'));
    await pool.query('insert into hourly_rounds values($1,$2,$3,$4)', [
      scope.roundId,
      'OPEN',
      scope.startsAt,
      scope.endsAtExclusive,
    ]);
    await pool.query('insert into competition_accounts values($1,$2,$3),($4,$5,$3)', [
      scope.accountId,
      scope.userId,
      scope.roundId,
      'test-account-b',
      'test-user-b',
    ]);
    store = new IsolatedPumpStage1Store(pool, name);
  } catch {
    throw new Error('ISOLATED_STAGE1_DATABASE_SETUP_FAILED');
  }
}, 15000);
beforeEach(async () => {
  await pool.query(
    'truncate pump_stage1.transitions,pump_stage1.execution_receipts,pump_stage1.models',
  );
  await pool.query("update hourly_rounds set state='OPEN'");
  initial = await createStage1Model(scope, snapshot());
  await store.initialize(scope.userId, initial);
});
afterAll(async () => {
  if (pool) await pool.end();
  if (created && /^paperfund_pump_stage1_\d+_\d+$/.test(name))
    await admin.query(`drop database "${name}" with (force)`);
  await admin.end();
});

it('atomically persists a BUY and full SELL then reconstructs identical state after a new store instance', async () => {
  const buy = await store.execute(scope.userId, scope, request(), writeStage1ExecutionReceipt);
  const sell = await store.execute(
    scope.userId,
    scope,
    { ...request(buy.model), side: 'SELL', amount: buy.model.heldUnits },
    writeStage1ExecutionReceipt,
  );
  expect(sell.transition.outputLamports).toBe('1658024687');
  const reconnected = new Pool({ connectionString: isolatedConnection, max: 1 });
  try {
    expect(
      (await new IsolatedPumpStage1Store(reconnected, name).recover(scope.userId, scope)).hash,
    ).toBe(sell.model.hash);
  } finally {
    await reconnected.end();
  }
  expect(await counts()).toEqual({ models: 1, transitions: 2, receipts: 2 });
});
it('coalesces duplicate concurrent transition requests without a second receipt or reserve mutation', async () => {
  const results = await Promise.all([
    store.execute(scope.userId, scope, request(), writeStage1ExecutionReceipt),
    store.execute(scope.userId, scope, request(), writeStage1ExecutionReceipt),
  ]);
  expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
  expect(results[0]!.model.hash).toBe(results[1]!.model.hash);
  expect(await counts()).toEqual({ models: 1, transitions: 1, receipts: 1 });
  await expect(
    store.execute(
      scope.userId,
      scope,
      { ...request(), amount: '100000000' },
      writeStage1ExecutionReceipt,
    ),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
});
it('serializes conflicting revisions from two writers; exactly one execution commits', async () => {
  const results = await Promise.allSettled([
    store.execute(scope.userId, scope, request(initial, 'writer-a'), writeStage1ExecutionReceipt),
    store.execute(scope.userId, scope, request(initial, 'writer-b'), writeStage1ExecutionReceipt),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe(
    'STALE_PREDECESSOR',
  );
  expect(await counts()).toEqual({ models: 1, transitions: 1, receipts: 1 });
});
it('rolls back receipt and reserve transition together when the execution writer fails', async () => {
  await expect(
    store.execute(scope.userId, scope, request(), async (client, transition) => {
      await writeStage1ExecutionReceipt(client, transition);
      throw Error('SYNTHETIC_EXECUTION_FAILURE');
    }),
  ).rejects.toThrow('SYNTHETIC_EXECUTION_FAILURE');
  expect(await counts()).toEqual({ models: 1, transitions: 0, receipts: 0 });
  expect((await store.recover(scope.userId, scope)).hash).toBe(initial.hash);
});
it('cannot commit reserves when no associated successful execution exists', async () => {
  await expect(store.execute(scope.userId, scope, request(), async () => {})).rejects.toMatchObject(
    { code: 'SUCCESSFUL_SAME_TRANSACTION_EXECUTION_REQUIRED' },
  );
  expect(await counts()).toEqual({ models: 1, transitions: 0, receipts: 0 });
});
it('refuses an execution receipt committed independently in an earlier transaction', async () => {
  const prepared = await prepareStage1Transition(initial, scope, request());
  const client = await pool.connect();
  try {
    await writeStage1ExecutionReceipt(client, prepared.transition);
  } finally {
    client.release();
  }
  await expect(store.execute(scope.userId, scope, request(), async () => {})).rejects.toMatchObject(
    { code: 'SUCCESSFUL_SAME_TRANSACTION_EXECUTION_REQUIRED' },
  );
  expect((await store.recover(scope.userId, scope)).revision).toBe(0);
});
it('enforces server account ownership and prevents one account altering another reserve stream', async () => {
  await expect(
    store.execute('test-user-b', scope, request(), writeStage1ExecutionReceipt),
  ).rejects.toMatchObject({ code: 'SERVER_ACCOUNT_ROUND_OWNER_MISMATCH' });
  const second = await createStage1Model(
    { ...scope, userId: 'test-user-b', accountId: 'test-account-b' },
    snapshot(),
  );
  await store.initialize('test-user-b', second);
  await store.execute(scope.userId, scope, request(), writeStage1ExecutionReceipt);
  expect((await store.recover('test-user-b', second.scope)).hash).toBe(second.hash);
  await expect(
    store.recover(scope.userId, { ...scope, roundId: 'other-round' }),
  ).rejects.toMatchObject({ code: 'SERVER_ACCOUNT_ROUND_OWNER_MISMATCH' });
});
it('keeps history immutable and detects a corrupt durable head on recovery', async () => {
  await store.execute(scope.userId, scope, request(), writeStage1ExecutionReceipt);
  await expect(pool.query('delete from pump_stage1.transitions')).rejects.toThrow(
    'STAGE1_HISTORY_IMMUTABLE',
  );
  await expect(
    pool.query('update pump_stage1.execution_receipts set result_hash=$1', ['corrupt']),
  ).rejects.toThrow('STAGE1_HISTORY_IMMUTABLE');
  await pool.query('update pump_stage1.models set state_hash=$1 where scope_hash=$2', [
    'corrupt',
    stage1Hash(scope),
  ]);
  await expect(store.recover(scope.userId, scope)).rejects.toMatchObject({
    code: 'DURABLE_REPLAY_HASH_MISMATCH',
  });
});
it('supports old-round isolated settlement without permitting a BUY after cutoff', async () => {
  const buy = await store.execute(scope.userId, scope, request(), writeStage1ExecutionReceipt);
  await pool.query("update hourly_rounds set state='SETTLING'");
  await expect(
    store.execute(
      scope.userId,
      scope,
      { ...request(buy.model), phase: 'SETTLEMENT', at: scope.endsAtExclusive },
      writeStage1ExecutionReceipt,
    ),
  ).rejects.toMatchObject({ code: 'UTC_ROUND_BOUNDARY' });
  const sold = await store.execute(
    scope.userId,
    scope,
    {
      ...request(buy.model),
      side: 'SELL',
      amount: buy.model.heldUnits,
      phase: 'SETTLEMENT',
      at: scope.endsAtExclusive,
    },
    writeStage1ExecutionReceipt,
  );
  expect(sold.model.heldUnits).toBe('0');
});
it('refuses the production database name even for read/recovery operations', async () => {
  const fake = {
    connect: async () => ({
      query: async (sql: string) =>
        sql === 'select current_database() name' ? { rows: [{ name: 'paperfund' }] } : {},
      release() {},
    }),
  } as unknown as Pool;
  await expect(
    new IsolatedPumpStage1Store(fake, name).recover(scope.userId, scope),
  ).rejects.toMatchObject({ code: 'ISOLATED_DATABASE_REQUIRED' });
});

it('rolls back execution receipt, transition and updated head when a deferred constraint fails at COMMIT', async () => {
  await pool.query(
    'alter table pump_stage1.execution_receipts add constraint test_commit_failure unique(created_xid) deferrable initially deferred',
  );
  try {
    await expect(
      store.execute(scope.userId, scope, request(), async (client, transition) => {
        await writeStage1ExecutionReceipt(client, transition);
        await client.query(
          'insert into pump_stage1.execution_receipts(execution_id,scope_hash,request_hash,result_hash) values($1,$2,$3,$4)',
          [
            'test-extra-receipt',
            transition.scopeHash,
            transition.requestHash,
            transition.resultHash,
          ],
        );
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_EXECUTION' });
    expect(await counts()).toEqual({ models: 1, transitions: 0, receipts: 0 });
    expect((await store.recover(scope.userId, scope)).hash).toBe(initial.hash);
  } finally {
    await pool.query(
      'alter table pump_stage1.execution_receipts drop constraint test_commit_failure',
    );
  }
});
