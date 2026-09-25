import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { createDatabase, runHourlyLifecycleTick } from '@paperfund/db';
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
const sourceDatabaseUrl = process.env['DATABASE_URL'];
if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required for the browser smoke test.');

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

const databaseName = `paperfund_e2e_${process.pid.toString()}_${Date.now().toString()}`;
const admin = new URL(sourceDatabaseUrl);
admin.pathname = '/postgres';
const test = new URL(sourceDatabaseUrl);
test.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: admin.toString() });
await adminPool.query(`create database "${databaseName}"`);
const database = createDatabase(test.toString());
await migrate(database.client, {
  migrationsFolder: resolve(process.cwd(), 'packages/db/migrations'),
});

const redis = new MemoryRedis();
const router = new ExecutionRouter([new PumpFunProtocolAdapter(new RecordedPumpSource())]);
await runHourlyLifecycleTick(database, router, new Date());
const lifecycleTimer = setInterval(() => {
  void runHourlyLifecycleTick(database, router, new Date());
}, 5_000);
const auth = new AuthService(database, redis, 300, 3600);
const competition = new CompetitionService(database, router);
const app = buildApp({
  config: {
    LOG_LEVEL: 'silent',
    COOKIE_SECURE: false,
    COOKIE_SAME_SITE: 'lax',
    AUTH_SESSION_TTL_SECONDS: 3600,
    ALLOWED_ORIGINS: 'http://127.0.0.1:5174',
    API_RATE_LIMIT_WINDOW_SECONDS: 60,
    API_RATE_LIMIT_AUTH_MAX: 100,
    API_RATE_LIMIT_TRADE_MAX: 100,
  },
  database,
  redis,
  auth,
  competition,
  logger: false,
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(lifecycleTimer);
  await app.close();
  await database.close();
  await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
  await adminPool.end();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
process.once('exit', () => {
  if (!closing) void close();
});

await app.listen({ host: '127.0.0.1', port: 3000 });
