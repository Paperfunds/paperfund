import { CAPTURED_FX_VERSION } from '../src/chart-fx-live.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '@paperfund/db';
import {
  historicalFillFx,
  saveCapturedFillFx,
  CHART_FX_VERSION,
  SOL_USD_FEED,
} from '../src/chart-fx.js';
config({ quiet: true });
describe('immutable display FX persistence migration', () => {
  it('persists/restores separate versioned evidence, rejects mismatched fill time and prohibits rewrites', async () => {
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const client = await pool.connect();
    const namespace = 'chart_fx_test_' + randomUUID().replaceAll('-', '');
    try {
      await client.query('begin');
      await client.query(`create schema ${namespace}`);
      await client.query(`set local search_path to ${namespace}`);
      await client.query(
        'create table fills(id text primary key,executed_at timestamptz not null)',
      );
      await client.query(
        `create function reject_financial_history_mutation() returns trigger language plpgsql as $$ begin raise exception 'immutable'; end; $$`,
      );
      const migration = readFileSync(
        'packages/db/migrations/0010_chart_fill_fx_evidence.sql',
        'utf8',
      );
      await client.query(migration.replaceAll('--> statement-breakpoint', ''));
      await client.query(
        readFileSync('packages/db/migrations/0011_captured_chart_fx.sql', 'utf8').replaceAll(
          '--> statement-breakpoint',
          '',
        ),
      );
      const time = new Date('2026-10-08T12:00:00.123Z');
      await client.query('insert into fills values ($1,$2)', ['test-fill', time]);
      const evidence = {
        status: 'AVAILABLE' as const,
        version: CHART_FX_VERSION,
        source: 'PYTH_HERMES_TIMESTAMP',
        feedId: SOL_USD_FEED,
        requestedAt: '2026-10-08T12:00:00.000Z',
        fxAt: '2026-10-08T12:00:01.000Z',
        rate: '150',
        rawPrice: '15000000000',
        exponent: -8,
        confidence: '1',
        retrievedAt: '2026-10-08T12:01:00.000Z',
        responseHash: 'test-hash',
      };
      const database = { pool: { query: client.query.bind(client) } } as unknown as DatabaseService;
      const first = await historicalFillFx(database, 'test-fill', time, {
        lookup: async () => evidence,
      });
      expect(first).toMatchObject({ ...evidence, fillTimestamp: time.toISOString() });
      const restored = await historicalFillFx(database, 'test-fill', time, {
        lookup: async () => {
          throw new Error('must not fetch');
        },
      });
      expect(restored).toEqual(first);
      await client.query('savepoint immutable_check');
      await expect(client.query('update chart_fill_fx_evidence set rate=151')).rejects.toThrow(
        'immutable',
      );
      await client.query('rollback to savepoint immutable_check');
      await client.query('insert into fills values ($1,$2)', ['different-time', time]);
      expect(
        await historicalFillFx(database, 'different-time', new Date(time.getTime() + 1000), {
          lookup: async () => evidence,
        }),
      ).toMatchObject({ status: 'UNAVAILABLE', reason: 'HISTORICAL_FX_PERSISTENCE_UNAVAILABLE' });
      await client.query('insert into fills values ($1,$2)', ['new-fill', time]);
      const captured = {
        ...evidence,
        version: CAPTURED_FX_VERSION,
        source: 'COINBASE_SOL_USD_LAST_TRADE',
        fxAt: new Date(time.getTime() - 2000).toISOString(),
      };
      expect(
        await saveCapturedFillFx(database, 'new-fill', time, Promise.resolve(captured)),
      ).toMatchObject({ status: 'AVAILABLE', version: CAPTURED_FX_VERSION });
      await client.query('insert into fills values ($1,$2)', ['no-price', time]);
      expect(
        await saveCapturedFillFx(
          database,
          'no-price',
          time,
          Promise.resolve({ status: 'UNAVAILABLE', reason: 'STALE_CAPTURED_FX' }),
        ),
      ).toMatchObject({ status: 'UNAVAILABLE', reason: 'STALE_CAPTURED_FX' });
      expect(
        (await client.query('select count(*)::int as count from chart_fill_fx_evidence')).rows[0]
          .count,
      ).toBe(2);
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  });
});
