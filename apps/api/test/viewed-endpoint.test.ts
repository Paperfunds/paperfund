import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthService } from '../src/auth.js';
import type { CompetitionService } from '../src/competition.js';
const mint = '3n51PDRJaKKJQyFA2zeqHNKvMavTsbd8RyoAJcHPpump';
it('uses the authenticated owner, ignores caller-selected owners and serializes exact integers', async () => {
  const viewedPosition = vi.fn(async () => ({
    userId: 'owner',
    status: 'AVAILABLE',
    position: { tokenQuantityBaseUnits: 9007199254740993n },
    chainSlot: 123n,
  }));
  const auth = {
    authenticate: vi.fn(async (token: string) =>
      token === 'valid' ? { id: 'owner', walletAddress: 'public' } : null,
    ),
  } as unknown as AuthService;
  const app = buildApp({
    config: { LOG_LEVEL: 'silent' },
    database: { healthCheck: async () => true },
    redis: { healthCheck: async () => true },
    auth,
    competition: { viewedPosition } as unknown as CompetitionService,
    logger: false,
  });
  try {
    const denied = await app.inject({ url: '/api/v1/positions/viewed?mint=' + mint });
    expect(denied.statusCode).toBe(401);
    expect(viewedPosition).not.toHaveBeenCalled();
    const allowed = await app.inject({
      url: '/api/v1/positions/viewed?mint=' + mint + '&userId=foreign',
      headers: { authorization: 'Bearer valid' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().position.tokenQuantityBaseUnits).toBe('9007199254740993');
    expect(allowed.json().chainSlot).toBe('123');
    expect(viewedPosition).toHaveBeenCalledWith('owner', mint, expect.any(AbortSignal));
    expect(allowed.headers['cache-control']).toBe('no-store');
  } finally {
    await app.close();
  }
});
it('enforces an advisory read limit without altering trade limits', async () => {
  const viewedPosition = vi.fn();
  const app = buildApp({
    config: { LOG_LEVEL: 'silent' },
    database: { healthCheck: async () => true },
    redis: { healthCheck: async () => true, incrementWindow: async () => 241 },
    auth: {
      authenticate: async () => ({ id: 'owner', walletAddress: 'public' }),
    } as unknown as AuthService,
    competition: { viewedPosition } as unknown as CompetitionService,
    logger: false,
  });
  try {
    const response = await app.inject({
      url: '/api/v1/positions/viewed?mint=' + mint,
      headers: { authorization: 'Bearer valid' },
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(viewedPosition).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
