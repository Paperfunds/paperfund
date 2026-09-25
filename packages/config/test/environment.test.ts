import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '../src/index.js';

describe('parseEnvironment', () => {
  it('parses a valid environment and applies safe local defaults', () => {
    const config = parseEnvironment({
      DATABASE_URL: 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
      REDIS_URL: 'redis://127.0.0.1:6379',
    });

    expect(config).toEqual({
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      DATABASE_URL: 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      LOG_LEVEL: 'info',
      SOLANA_RPC_TIMEOUT_MS: 10000,
      SOLANA_COMMITMENT: 'confirmed',
      AUTH_CHALLENGE_TTL_SECONDS: 300,
      AUTH_SESSION_TTL_SECONDS: 86400,
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'lax',
      ALLOWED_ORIGINS: 'http://127.0.0.1:3000,http://localhost:3000',
      API_RATE_LIMIT_WINDOW_SECONDS: 60,
      API_RATE_LIMIT_AUTH_MAX: 20,
      API_RATE_LIMIT_TRADE_MAX: 30,
      WORKER_TICK_INTERVAL_MS: 5000,
    });
  });

  it('rejects invalid and missing infrastructure configuration', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'production',
        API_PORT: '70000',
        DATABASE_URL: 'not-a-database-url',
        REDIS_URL: 'http://127.0.0.1:6379',
        SOLANA_RPC_URL: 'not-a-url',
      }),
    ).toThrow();
  });
});
