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
      API_PUBLIC_ORIGIN: '',
      APP_PUBLIC_ORIGIN: '',
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
      ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
      API_RATE_LIMIT_WINDOW_SECONDS: 60,
      API_RATE_LIMIT_AUTH_MAX: 20,
      API_RATE_LIMIT_TRADE_MAX: 30,
      WORKER_TICK_INTERVAL_MS: 5000,
      WORKER_HEARTBEAT_FILE: 'logs/worker-heartbeat.json',
      REWARD_ALLOCATION_MODE: 'NORMAL',
      REWARD_BASELINE_WINDOW: 12,
      REWARD_LAMBDA_BPS: 6000,
      REWARD_FINALIZATION_GRACE_SECONDS: 60,
      CREATOR_FEE_INGESTION_ENABLED: false,
      CREATOR_FEE_SHADOW_MODE: true,
      CREATOR_FEE_NETWORK: 'mainnet-beta',
      PAPERFUND_TOKEN_MINT: '',
      PAPERFUND_CREATOR_WALLET: '',
      CREATOR_FEE_PAGE_SIZE: 50,
      CREATOR_FEE_RPC_MAX_ATTEMPTS: 4,
      CREATOR_FEE_RPC_MIN_INTERVAL_MS: 75,
      PAYOUT_EXECUTION_ENABLED: false,
      PAYOUT_NETWORK: 'localnet',
      PAYOUT_MAINNET_CONFIRM: false,
      PAYOUT_TREASURY_PUBLIC_KEY: '',
      PAYOUT_SIGNER_TYPE: 'DISABLED',
      PAYOUT_SIGNER_SECRET_KEY: '',
      PAYOUT_MAX_RECIPIENTS_PER_BATCH: 8,
      PAYOUT_MAINNET_MAX_PLAN_LAMPORTS: '100000000',
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

  it('fails closed on unsafe production launch configuration', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
        REDIS_URL: 'redis://127.0.0.1:6379',
        API_PUBLIC_ORIGIN: 'http://localhost:3000',
        APP_PUBLIC_ORIGIN: 'https://app.example.com',
        ALLOWED_ORIGINS: '*',
      }),
    ).toThrow();
  });

  it('rejects production origins with paths and non-exact extension origins', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
        REDIS_URL: 'redis://127.0.0.1:6379',
        API_PUBLIC_ORIGIN: 'https://api.paperfund.example/path',
        APP_PUBLIC_ORIGIN: 'https://app.paperfund.example',
        COOKIE_SECURE: 'true',
        ALLOWED_ORIGINS:
          'https://app.paperfund.example,chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln/path',
      }),
    ).toThrow();
  });

  it('accepts the exact canonical Paperfund production origins and CORS transports', () => {
    const config = parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
      REDIS_URL: 'redis://127.0.0.1:6379',
      API_PUBLIC_ORIGIN: 'https://api.paperfund.app',
      APP_PUBLIC_ORIGIN: 'https://app.paperfund.app',
      COOKIE_SECURE: 'true',
      ALLOWED_ORIGINS:
        'https://app.paperfund.app,chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln',
    });

    expect(config.API_PUBLIC_ORIGIN).toBe('https://api.paperfund.app');
    expect(config.APP_PUBLIC_ORIGIN).toBe('https://app.paperfund.app');
  });

  it('requires complete identities and explicit payout network when enabled', () => {
    const base = {
      DATABASE_URL: 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
      REDIS_URL: 'redis://127.0.0.1:6379',
    };
    expect(() => parseEnvironment({ ...base, CREATOR_FEE_INGESTION_ENABLED: 'true' })).toThrow();
    expect(() =>
      parseEnvironment({
        ...base,
        PAYOUT_EXECUTION_ENABLED: 'true',
        PAYOUT_TREASURY_PUBLIC_KEY: '11111111111111111111111111111111',
        PAYOUT_SIGNER_TYPE: 'LOCAL_KEYPAIR',
        PAYOUT_SIGNER_SECRET_KEY: '[redacted]',
      }),
    ).toThrow('PAYOUT_NETWORK');
  });
});
