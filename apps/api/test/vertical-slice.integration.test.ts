import { generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runHourlyLifecycleTick, type DatabaseService } from '@paperfund/db';
import { ExecutionRouter, type MarketState, type MarketStateSource } from '@paperfund/execution';
import { PumpFunProtocolAdapter } from '@paperfund/protocols';

import {
  RECORDED_PUMP_FIXTURES,
  recordedPumpState,
} from '../../../packages/protocols/test/fixtures/pump-real-chain.js';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth.js';
import { CompetitionService } from '../src/competition.js';
import type { RedisService } from '../src/redis.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p4a_vertical_${process.pid.toString()}_${Date.now().toString()}`;
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let database: DatabaseService;
let adminPool: Pool;

function base58(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

class MemoryRedis implements RedisService {
  readonly values = new Map<string, string>();
  readonly counters = new Map<string, number>();
  async healthCheck() {
    return true;
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setExpiring(key: string, value: string) {
    this.values.set(key, value);
  }
  async take(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async incrementWindow(key: string) {
    const value = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, value);
    return value;
  }
  async close() {}
}

class RecordedPumpSource implements MarketStateSource {
  readonly states = new Map<string, MarketState>([
    [RECORDED_PUMP_FIXTURES.early.mint, recordedPumpState('early')],
    [RECORDED_PUMP_FIXTURES.developed.mint, recordedPumpState('developed')],
  ]);
  async loadMarketState(identity: MarketState['identity']): Promise<MarketState> {
    const state = this.states.get(identity.tokenMint);
    if (!state) throw new Error('Fixture not found.');
    return state;
  }
}

describe('Phase 4A complete backend vertical slice', () => {
  beforeAll(async () => {
    if (!sourceDatabaseUrl)
      throw new Error('DATABASE_URL is required for vertical integration tests.');
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

  it('authenticates, trades, force-settles, ranks, and resets into the next hour', async () => {
    let now = new Date('2026-09-25T12:15:00.000Z');
    const redis = new MemoryRedis();
    const router = new ExecutionRouter([new PumpFunProtocolAdapter(new RecordedPumpSource())]);
    await runHourlyLifecycleTick(database, router, now);
    const auth = new AuthService(database, redis, 300, 3600, () => now);
    const competition = new CompetitionService(database, router, () => now);
    const app = buildApp({
      config: {
        LOG_LEVEL: 'silent',
        COOKIE_SECURE: false,
        COOKIE_SAME_SITE: 'lax',
        AUTH_SESSION_TTL_SECONDS: 3600,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        API_RATE_LIMIT_WINDOW_SECONDS: 60,
        API_RATE_LIMIT_AUTH_MAX: 20,
        API_RATE_LIMIT_TRADE_MAX: 30,
      },
      database,
      redis,
      auth,
      competition,
      logger: false,
    });
    const keys = generateKeyPairSync('ed25519');
    const walletAddress = base58(
      keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
    );
    const challenge = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/challenge',
        payload: { walletAddress },
      })
    ).json();
    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: {
        walletAddress,
        challengeId: challenge.challengeId,
        message: challenge.message,
        signature: base58(sign(null, Buffer.from(challenge.message), keys.privateKey)),
      },
    });
    expect(verified.statusCode).toBe(200);
    const cookie = verified.headers['set-cookie']!.split(';')[0]!;
    const headers = { cookie };

    const current = (await app.inject({ method: 'GET', url: '/api/v1/rounds/current' })).json();
    expect(current.round.state).toBe('OPEN');
    const entered = (
      await app.inject({ method: 'POST', url: '/api/v1/rounds/current/enter', headers })
    ).json();
    expect(entered.paperSolBalanceLamports).toBe('10000000000');

    const buyOne = await app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { ...headers, 'idempotency-key': 'vertical-buy-one' },
      payload: { mint: RECORDED_PUMP_FIXTURES.developed.mint, paperSol: '2' },
    });
    expect(buyOne.statusCode).toBe(200);
    const firstQuantity = BigInt(buyOne.json().tokenQuantityReceivedBaseUnits);
    const buyTwo = await app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { ...headers, 'idempotency-key': 'vertical-buy-two' },
      payload: { mint: RECORDED_PUMP_FIXTURES.early.mint, paperSol: '0.000001' },
    });
    expect(buyTwo.statusCode, buyTwo.body).toBe(200);
    const account = (
      await app.inject({ method: 'GET', url: '/api/v1/rounds/current/account', headers })
    ).json();
    expect(account.positions).toHaveLength(2);

    const partial = await app.inject({
      method: 'POST',
      url: '/api/v1/trades/sell',
      headers: { ...headers, 'idempotency-key': 'vertical-partial-sell' },
      payload: {
        mint: RECORDED_PUMP_FIXTURES.developed.mint,
        quantity: (firstQuantity / 2n).toString(),
      },
    });
    expect(partial.statusCode).toBe(200);
    expect(BigInt(partial.json().remainingQuantityBaseUnits)).toBeGreaterThan(0n);

    now = new Date('2026-09-25T13:00:00.000Z');
    const lifecycle = await runHourlyLifecycleTick(database, router, now);
    expect(lifecycle).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'ROUND_FINALIZED' })]),
    );
    const history = (await app.inject({ method: 'GET', url: '/api/v1/trades', headers })).json();
    expect(
      history.items.some(
        (item: { execution_context: string }) =>
          item.execution_context === 'FORCED_HOURLY_SETTLEMENT',
      ),
    ).toBe(true);
    const results = (
      await app.inject({ method: 'GET', url: '/api/v1/results/hourly', headers })
    ).json();
    expect(results.items).toHaveLength(1);
    const hourly = (await app.inject({ method: 'GET', url: '/api/v1/leaderboards/hourly' })).json();
    expect(hourly.entries[0]).toMatchObject({ rank: 1, tied: false });
    const daily = (await app.inject({ method: 'GET', url: '/api/v1/leaderboards/daily' })).json();
    expect(daily.entries[0]).toMatchObject({ rank: 1, completed_hourly_round_count: 1 });

    const nextEntry = (
      await app.inject({ method: 'POST', url: '/api/v1/rounds/current/enter', headers })
    ).json();
    expect(nextEntry.id).not.toBe(entered.id);
    expect(nextEntry.paperSolBalanceLamports).toBe('10000000000');
    await app.close();
  }, 30_000);
});
