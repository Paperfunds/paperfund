import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthService } from '../src/auth.js';
import type { CompetitionService } from '../src/competition.js';
const invited = '11111111111111111111111111111111';
const outsider = 'So11111111111111111111111111111111111111112';
function fixture(wallet = invited, allowlist: string[] = [invited]) {
  const createChallenge = vi.fn(async () => ({ message: 'challenge' }));
  const verifyChallenge = vi.fn(async () => ({
    token: 'opaque',
    user: { id: 'one', walletAddress: wallet },
    expiresAt: new Date('2099-01-01'),
  }));
  const app = buildApp({
    config: {
      LOG_LEVEL: 'silent',
      BETA_INVITE_ONLY: true,
      BETA_WALLET_ALLOWLIST: allowlist,
      ALLOWED_ORIGINS: 'https://app.paperfund.app',
    },
    auth: {
      createChallenge,
      verifyChallenge,
      authenticate: async () => ({ id: 'one', walletAddress: wallet }),
    } as unknown as AuthService,
    competition: {} as CompetitionService,
    database: { healthCheck: async () => true },
    redis: { healthCheck: async () => true },
    logger: false,
  });
  return { app, createChallenge, verifyChallenge };
}
describe('private beta access', () => {
  it('denies uninvited challenge and verify before identity/session writes', async () => {
    const f = fixture(outsider);
    try {
      for (const route of ['challenge', 'verify']) {
        const r = await f.app.inject({
          method: 'POST',
          url: '/api/v1/auth/' + route,
          payload: { walletAddress: outsider },
        });
        expect(r.statusCode).toBe(403);
        expect(r.json().error.code).toBe('BETA_INVITE_REQUIRED');
      }
      expect(f.createChallenge).not.toHaveBeenCalled();
      expect(f.verifyChallenge).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it('rejects existing outsider sessions on authenticated reads and mutations', async () => {
    const { app } = fixture(outsider);
    try {
      for (const [method, url] of [
        ['GET', '/api/v1/auth/me'],
        ['POST', '/api/v1/rounds/current/enter'],
        ['POST', '/api/v1/trades/buy'],
        ['POST', '/api/v1/trades/sell'],
      ] as const)
        expect((await app.inject({ method, url })).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('empty invitations deny all wallets while public health remains reachable', async () => {
    const { app } = fixture(invited, []);
    try {
      expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/v1/auth/me' })).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('accepts invited sessions and origin-less extension bearer transport', async () => {
    const { app } = fixture();
    try {
      const r = await app.inject({
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer opaque' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
  it('blocks foreign-origin mutations and cross-site cookie requests before handlers', async () => {
    const f = fixture();
    try {
      for (const headers of [
        { origin: 'https://attacker.example' },
        { 'sec-fetch-site': 'cross-site', cookie: 'paperfund_session=opaque' },
      ])
        expect(
          (
            await f.app.inject({
              method: 'POST',
              url: '/api/v1/auth/challenge',
              headers,
              payload: { walletAddress: invited },
            })
          ).statusCode,
        ).toBe(403);
      expect(f.createChallenge).not.toHaveBeenCalled();
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/v1/auth/challenge',
            headers: { origin: 'https://app.paperfund.app' },
            payload: { walletAddress: invited },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await f.app.close();
    }
  });
  it('returns a controlled 400 for malformed session cookies', async () => {
    const { app } = fixture();
    try {
      expect(
        (
          await app.inject({
            url: '/api/v1/auth/me',
            headers: { cookie: 'paperfund_session=%ZZ' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

it('trusts forwarded rate-limit identity only from the loopback tunnel', async () => {
  const keys: string[] = [];
  const app = buildApp({
    config: { LOG_LEVEL: 'silent' },
    database: { healthCheck: async () => true },
    redis: {
      healthCheck: async () => true,
      incrementWindow: async (key: string) => {
        keys.push(key);
        return 1;
      },
    },
    auth: {
      createChallenge: async () => ({ message: 'test' }),
    } as unknown as AuthService,
    competition: {} as CompetitionService,
    logger: false,
  });
  try {
    const payload = { walletAddress: invited };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/challenge',
          remoteAddress: '127.0.0.1',
          headers: { 'x-forwarded-for': '203.0.113.11' },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/challenge',
          remoteAddress: '198.51.100.12',
          headers: { 'x-forwarded-for': '203.0.113.11' },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(keys).toEqual(['rate:auth:203.0.113.11', 'rate:auth:198.51.100.12']);
  } finally {
    await app.close();
  }
});
