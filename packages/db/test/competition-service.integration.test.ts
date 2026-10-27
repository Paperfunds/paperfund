import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ExecutionRouter } from '@paperfund/execution';

import { enterCurrentRound, runHourlyLifecycleTick } from '../src/competition-service.js';
import { createDatabase, type DatabaseService } from '../src/database.js';
import { initializeCompetitionAccount } from '../src/financial-service.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p4a_${process.pid.toString()}_${Date.now().toString()}`;
let database: DatabaseService;
let adminPool: Pool;

describe('Phase 4A hourly lifecycle worker', () => {
  beforeAll(async () => {
    if (!sourceDatabaseUrl)
      throw new Error('DATABASE_URL is required for lifecycle integration tests.');
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

  it('creates exact windows, remains idempotent, and opens the next hour while finalizing the old one', async () => {
    const router = new ExecutionRouter();
    const firstHour = new Date('2026-09-25T12:15:00.000Z');
    const first = await runHourlyLifecycleTick(database, router, firstHour);
    expect(first.map(({ type }) => type)).toEqual([
      'ROUND_CREATED',
      'ROUND_CREATED',
      'ROUND_OPENED',
    ]);

    await runHourlyLifecycleTick(database, router, firstHour);
    const initialRows = await database.pool.query<{
      id: string;
      state: string;
      starts_at: Date;
      ends_at_exclusive: Date;
    }>('select id, state, starts_at, ends_at_exclusive from hourly_rounds order by starts_at');
    expect(initialRows.rows).toHaveLength(2);
    expect(initialRows.rows.map(({ state }) => state)).toEqual(['OPEN', 'SCHEDULED']);
    expect(
      initialRows.rows[0]!.ends_at_exclusive.getTime() - initialRows.rows[0]!.starts_at.getTime(),
    ).toBe(3_600_000);
    await database.pool.query(
      `insert into users (id, wallet_address) values ('worker-user', 'worker-wallet')`,
    );
    const firstEntry = await enterCurrentRound(database, { userId: 'worker-user', now: firstHour });
    const retriedEntry = await enterCurrentRound(database, {
      userId: 'worker-user',
      now: firstHour,
    });
    expect(retriedEntry).toEqual(firstEntry);
    expect(firstEntry.paperSolBalanceLamports).toBe(10_000_000_000n);

    const nextHour = new Date('2026-09-25T13:00:00.000Z');
    const transition = await runHourlyLifecycleTick(database, router, nextHour);
    expect(transition).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ROUND_OPENED' }),
        expect.objectContaining({ type: 'ROUND_FINALIZED' }),
      ]),
    );
    const states = await database.pool.query<{ state: string }>(
      'select state from hourly_rounds order by starts_at',
    );
    expect(states.rows.map(({ state }) => state)).toEqual(['FINALIZED', 'OPEN', 'SCHEDULED']);
    const nextEntry = await enterCurrentRound(database, { userId: 'worker-user', now: nextHour });
    expect(nextEntry.id).not.toBe(firstEntry.id);
    expect(nextEntry.paperSolBalanceLamports).toBe(10_000_000_000n);
    await database.pool.query(
      `insert into users (id, wallet_address) values ('late-user', 'late-wallet')`,
    );
    await expect(
      initializeCompetitionAccount(database, {
        accountId: 'late-account',
        userId: 'late-user',
        hourlyRoundId: initialRows.rows[0]!.id,
        idempotencyKey: 'late-entry',
        requireOpenAt: nextHour,
      }),
    ).rejects.toMatchObject({ code: 'ROUND_NOT_OPEN' });

    await runHourlyLifecycleTick(database, router, nextHour);
    const restartRows = await database.pool.query('select id from hourly_rounds');
    expect(restartRows.rows).toHaveLength(3);
  });

  describe('private beta daily completeness', () => {
    it('keeps a UTC day incomplete when canonical hourly dependencies are missing', async () => {
      const router = new ExecutionRouter();
      await runHourlyLifecycleTick(database, router, new Date('2026-09-26T00:00:00Z'));
      const rows = await database.pool.query(
        "select state from daily_competitions where utc_date='2026-09-25'",
      );
      expect(rows.rows[0].state).toBe('FINALIZING');
      const count = await database.pool.query(
        "select count(*)::int n from hourly_rounds where starts_at>='2026-09-25' and starts_at<'2026-09-26'",
      );
      expect(count.rows[0].n).toBeLessThan(24);
      for (let hour = 0; hour < 24; hour++)
        await runHourlyLifecycleTick(database, router, new Date(Date.UTC(2026, 8, 25, hour)));
      await runHourlyLifecycleTick(database, router, new Date('2026-09-26T00:00:00Z'));
      const complete = await database.pool.query(
        "select state from daily_competitions where utc_date='2026-09-25'",
      );
      expect(complete.rows[0].state).toBe('FINALIZED');
    });
  });
});
