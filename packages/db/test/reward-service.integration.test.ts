import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FixtureCreatorFeeSource,
  createDatabase,
  finalizeHourlyRewardPool,
  getProvisionalHourlyRewardPool,
  ingestCreatorFeeEvents,
  reconcileHourlyRewardPool,
  type DatabaseService,
  type VerifiedCreatorFeeEvent,
} from '../src/index.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p5a_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;

function fee(
  signature: string,
  eventTime: string,
  creatorFeeLamports = 10_000n,
  observedAt = eventTime,
): VerifiedCreatorFeeEvent {
  return {
    transactionSignature: signature,
    eventIndex: 0,
    slot: 123n,
    eventTime: new Date(eventTime),
    creatorFeeLamports,
    sourceProgram: 'FIXTURE_PROGRAM',
    tokenProjectIdentity: 'fixture-token',
    observedAt: new Date(observedAt),
    normalizedMetadata: { fixture: true },
    verificationStatus: 'VERIFIED',
  };
}

async function round(start: string, grace = 60) {
  const startsAt = new Date(start);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const day = startsAt.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  await database.pool.query(
    `insert into daily_competitions (id,utc_date,starts_at,ends_at_exclusive,state)
     values ($1,$2,$3,$4,'OPEN') on conflict (utc_date) do nothing`,
    [`daily:${day}`, day, dayStart, new Date(dayStart.getTime() + 86_400_000)],
  );
  const id = `hourly:${startsAt.toISOString()}`;
  await database.pool.query(
    `insert into hourly_rounds
      (id,starts_at,ends_at_exclusive,state,starting_paper_sol_lamports,max_unique_tokens,
       max_buy_ratio_bps,reward_finalization_grace_period_seconds,rules_version)
     values ($1,$2,$3,'FINALIZED',10000000000,5,2000,$4,'test')`,
    [id, startsAt, endsAt, grace],
  );
  return { id, startsAt, endsAt };
}

describe('Phase 5A authoritative reward accounting', () => {
  beforeAll(async () => {
    if (!sourceDatabaseUrl)
      throw new Error('DATABASE_URL is required for reward integration tests.');
    const admin = new URL(sourceDatabaseUrl);
    admin.pathname = '/postgres';
    const test = new URL(sourceDatabaseUrl);
    test.pathname = `/${databaseName}`;
    adminPool = new Pool({ connectionString: admin.toString() });
    await adminPool.query(`create database "${databaseName}"`);
    database = createDatabase(test.toString());
    await migrate(database.client, {
      migrationsFolder: resolve(process.cwd(), 'packages/db/migrations'),
    });
  }, 30_000);

  afterAll(async () => {
    if (database) await database.close();
    if (adminPool) {
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.end();
    }
  });

  it('attributes by event time, exposes provisional exact values, and deduplicates retries', async () => {
    const target = await round('2026-09-25T15:00:00.000Z');
    const event = fee(
      'signature-dedupe',
      '2026-09-25T15:59:58.000Z',
      101n,
      '2026-09-25T16:00:10.000Z',
    );
    expect(
      await ingestCreatorFeeEvents(database, new FixtureCreatorFeeSource([event, event])),
    ).toEqual({
      inserted: 1,
      duplicates: 1,
      lateAfterFreeze: 0,
    });
    const provisional = await getProvisionalHourlyRewardPool(database, target.id);
    expect(provisional).toMatchObject({
      status: 'PROVISIONAL',
      verifiedCreatorFeeLamports: 101n,
      provisionalNaturalHourlyLamports: 64n,
      provisionalDailyAllocationLamports: 27n,
      dynamicSmoothingFinal: false,
    });
    const stored = await database.pool.query(
      'select hourly_round_id,event_time,observed_at from creator_fee_events',
    );
    expect(stored.rows[0].hourly_round_id).toBe(target.id);
    expect(stored.rows[0].event_time.toISOString()).toBe('2026-09-25T15:59:58.000Z');
    await expect(
      ingestCreatorFeeEvents(
        database,
        new FixtureCreatorFeeSource([{ ...event, creatorFeeLamports: 102n }]),
      ),
    ).rejects.toMatchObject({ code: 'CREATOR_FEE_IDENTITY_CONFLICT' });
  });

  it('freezes one exact result under concurrency and persists daily/platform/buffer audit state', async () => {
    const target = await round('2026-09-25T16:00:00.000Z');
    await ingestCreatorFeeEvents(
      database,
      new FixtureCreatorFeeSource([
        fee('signature-finalize-a', '2026-09-25T16:10:00.000Z', 10_001n),
        fee('signature-finalize-b', '2026-09-25T16:20:00.000Z', 9_999n),
      ]),
    );
    const now = new Date('2026-09-25T17:01:01.000Z');
    const [left, right] = await Promise.all([
      finalizeHourlyRewardPool(database, { hourlyRoundId: target.id, now }),
      finalizeHourlyRewardPool(database, { hourlyRoundId: target.id, now }),
    ]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({
      creatorFeeLamports: 20_000n,
      naturalHourlyLamports: 12_600n,
      dailyAllocationLamports: 5_400n,
      platformAllocationLamports: 2_000n,
      finalHourlyPrizeLamports: 12_600n,
      startingBufferLamports: 0n,
      endingBufferLamports: 0n,
      status: 'FROZEN',
    });
    const counts = await database.pool.query(
      `select
        (select count(*)::int from hourly_reward_pools where hourly_round_id=$1) pools,
        (select count(*)::int from daily_reward_contributions c join hourly_reward_pools p on p.id=c.hourly_reward_pool_id where p.hourly_round_id=$1) contributions`,
      [target.id],
    );
    expect(counts.rows[0]).toEqual({ pools: 1, contributions: 1 });
    const audit = await reconcileHourlyRewardPool(database, target.id);
    expect(audit).toMatchObject({
      conservation: { leftLamports: 20_000n, rightLamports: 20_000n, holds: true },
    });
    expect(audit && 'verifiedFeeEvents' in audit ? audit.verifiedFeeEvents : []).toHaveLength(2);
  });

  it('rejects finalization during grace and routes later verified events to reconciliation', async () => {
    const target = await round('2026-09-25T18:00:00.000Z', 60);
    await expect(
      finalizeHourlyRewardPool(database, {
        hourlyRoundId: target.id,
        now: new Date('2026-09-25T19:00:59.999Z'),
      }),
    ).rejects.toMatchObject({ code: 'REWARD_GRACE_ACTIVE' });
    await ingestCreatorFeeEvents(
      database,
      new FixtureCreatorFeeSource([
        fee('signature-in-grace', '2026-09-25T18:59:59.000Z', 1_000n, '2026-09-25T19:00:30.000Z'),
      ]),
    );
    const frozen = await finalizeHourlyRewardPool(database, {
      hourlyRoundId: target.id,
      now: new Date('2026-09-25T19:01:00.000Z'),
    });
    expect(frozen.creatorFeeLamports).toBe(1_000n);
    const late = await ingestCreatorFeeEvents(
      database,
      new FixtureCreatorFeeSource([
        fee('signature-late', '2026-09-25T18:30:00.000Z', 777n, '2026-09-25T19:02:00.000Z'),
      ]),
    );
    expect(late).toEqual({ inserted: 1, duplicates: 0, lateAfterFreeze: 1 });
    expect(
      (
        await finalizeHourlyRewardPool(database, {
          hourlyRoundId: target.id,
          now: new Date('2026-09-25T19:03:00.000Z'),
        })
      ).creatorFeeLamports,
    ).toBe(1_000n);
    const reconciliation = await database.pool.query(
      `select r.reason,e.accounting_status from late_fee_reconciliations r
       join creator_fee_events e on e.id=r.creator_fee_event_id where e.transaction_signature='signature-late'`,
    );
    expect(reconciliation.rows[0]).toEqual({
      reason: 'LATE_AFTER_FREEZE',
      accounting_status: 'LATE_AFTER_FREEZE',
    });
  });

  it('rolls back a partial finalization and retries to one clean result', async () => {
    const target = await round('2026-09-26T08:00:00.000Z', 0);
    await database.pool.query("delete from daily_competitions where utc_date = '2026-09-26'");
    await ingestCreatorFeeEvents(
      database,
      new FixtureCreatorFeeSource([fee('rollback-retry', '2026-09-26T08:10:00.000Z', 10_000n)]),
    );
    await expect(
      finalizeHourlyRewardPool(database, {
        hourlyRoundId: target.id,
        now: new Date(target.endsAt.getTime() + 1),
      }),
    ).rejects.toMatchObject({ code: 'DAILY_POOL_NOT_FOUND' });
    const rolledBack = await database.pool.query(
      'select count(*)::int count from hourly_reward_pools where hourly_round_id = $1',
      [target.id],
    );
    expect(rolledBack.rows[0].count).toBe(0);
    const dayStart = new Date('2026-09-26T00:00:00.000Z');
    await database.pool.query(
      `insert into daily_competitions (id,utc_date,starts_at,ends_at_exclusive,state)
       values ('daily:2026-09-26','2026-09-26',$1,$2,'OPEN')`,
      [dayStart, new Date(dayStart.getTime() + 86_400_000)],
    );
    const retried = await finalizeHourlyRewardPool(database, {
      hourlyRoundId: target.id,
      now: new Date(target.endsAt.getTime() + 2),
    });
    expect(retried.creatorFeeLamports).toBe(10_000n);
    expect(
      (
        await database.pool.query(
          'select count(*)::int count from hourly_reward_pools where hourly_round_id = $1',
          [target.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('snapshots accumulation mode and applies explicit buffer contribution before smoothing', async () => {
    for (let hour = 0; hour < 12; hour += 1) {
      const prior = await round(`2026-09-24T${hour.toString().padStart(2, '0')}:00:00.000Z`, 0);
      await ingestCreatorFeeEvents(
        database,
        new FixtureCreatorFeeSource([
          fee(
            `baseline-${hour.toString()}`,
            `2026-09-24T${hour.toString().padStart(2, '0')}:10:00.000Z`,
            10_000n,
          ),
        ]),
      );
      await finalizeHourlyRewardPool(database, {
        hourlyRoundId: prior.id,
        now: new Date(prior.endsAt.getTime() + 1),
      });
    }
    const target = await round('2026-09-24T12:00:00.000Z', 0);
    await ingestCreatorFeeEvents(
      database,
      new FixtureCreatorFeeSource([fee('buffer-mode', '2026-09-24T12:10:00.000Z', 1_000n)]),
    );
    const result = await finalizeHourlyRewardPool(database, {
      hourlyRoundId: target.id,
      now: new Date(target.endsAt.getTime() + 1),
      config: {
        allocationMode: 'BUFFER_ACCUMULATION',
        baselineWindow: 12,
        lambdaBps: 6_000n,
        configurationVersion: 'buffer-test-v1',
      },
    });
    expect(result.allocationMode).toBe('BUFFER_ACCUMULATION');
    expect(result.explicitBufferContributionLamports).toBe(50n);
    expect(result.baselineInputRoundIds).toHaveLength(12);
    expect(result.endingBufferLamports).toBeGreaterThanOrEqual(0n);
    expect(result.creatorFeeLamports + result.startingBufferLamports).toBe(
      result.finalHourlyPrizeLamports +
        result.dailyAllocationLamports +
        result.platformAllocationLamports +
        result.endingBufferLamports,
    );
  });
});
