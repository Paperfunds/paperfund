import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { genericActor } from '@paperfund/protocols';
import { GenericCapability } from '@paperfund/db';
import type { DatabaseService } from '@paperfund/db';
import type { AuthService } from '../src/auth.js';
import type { CompetitionService } from '../src/competition.js';
const op = 'user:' + 'a'.repeat(64),
  other = 'user:' + 'b'.repeat(64),
  mint = '2SESLWryE5mmgeLQJcNezZVMfZwpBtLbxUaVW2MZpump';
it('requires authenticated administrative authority; supplied wallet/user flags cannot change control', async () => {
  let record: string | undefined;
  const query = vi.fn(async (input: unknown, values?: unknown[]) => {
    const c = typeof input === 'string' ? { text: input, values } : (input as { text: string });
    if (c.text.startsWith('insert')) record = String(values?.[1]);
    return { rows: record ? [{ value: record }] : [] };
  });
  const capability = new GenericCapability({ pool: { query } } as unknown as DatabaseService, {
    armed: true,
    entries: true,
    normalUserAccess: true,
    operatorIds: [op],
    entrySeconds: 900,
  });
  const auth = {
    authenticate: async (token: string | undefined) =>
      token === 'operator'
        ? { id: op, walletAddress: 'signed-operator' }
        : token === 'ordinary'
          ? { id: other, walletAddress: 'signed-other' }
          : null,
  } as AuthService;
  const marketSupport = vi.fn(async () => ({
    mint,
    supported: false,
    scope: genericActor()?.userId ?? null,
  }));
  const app = buildApp({
    config: { LOG_LEVEL: 'silent' },
    database: { healthCheck: async () => true },
    redis: { healthCheck: async () => true },
    auth,
    competition: { marketSupport } as unknown as CompetitionService,
    genericCapability: capability,
    logger: false,
  });
  try {
    const path = '/api/v1/capabilities/generic-pumpswap/control';
    expect(
      (await app.inject({ method: 'POST', url: path, payload: { mode: 'ENTRY' } })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { authorization: 'Bearer ordinary' },
          payload: { mode: 'ENTRY' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { authorization: 'Bearer ordinary' },
          payload: { mode: 'ENTRY', userId: op },
        })
      ).statusCode,
    ).toBe(400);
    expect(record).toBeUndefined();
    const enabled = await app.inject({
      method: 'POST',
      url: path,
      headers: { authorization: 'Bearer operator' },
      payload: { mode: 'ENTRY' },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().entriesEnabled).toBe(true);
    const status = await app.inject({
      url: '/api/v1/capabilities/generic-pumpswap?userId=' + op,
      headers: { authorization: 'Bearer ordinary' },
    });
    expect(status.json()).toMatchObject({
      userId: other,
      entitled: true,
      entriesEnabled: true,
      canControl: false,
    });
    const publicMarket = await app.inject({ url: '/api/v1/markets/' + mint });
    expect(publicMarket.json().scope).toBeNull();
    const actorMarket = await app.inject({
      url: '/api/v1/markets/' + mint,
      headers: { authorization: 'Bearer operator' },
    });
    expect(actorMarket.json().scope).toBe(op);
  } finally {
    await app.close();
  }
});
it('keeps feature OFF without an entitlement/configuration and leaves all existing routes public', async () => {
  const capability = new GenericCapability(
    { pool: { query: vi.fn() } } as unknown as DatabaseService,
    { armed: false, entries: false, operatorIds: [], entrySeconds: 900 },
  );
  expect(await capability.status(op)).toMatchObject({
    armed: false,
    entitled: false,
    mode: 'HARD_STOP',
    entriesEnabled: false,
  });
  await expect(capability.control(op, 'ENTRY')).rejects.toThrow('ENTITLEMENT_REQUIRED');
});
