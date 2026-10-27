import { expect, it, vi } from 'vitest';
import { ExecutionRouter } from '@paperfund/execution';
import type { DatabaseService } from '@paperfund/db';
import type { AuthService } from '../src/auth.js';
import { CompetitionService } from '../src/competition.js';
import { buildApp } from '../src/app.js';
it('chart metadata never evaluates execution or writes/registers a market', async () => {
  const router = new ExecutionRouter();
  const metadata = { requestedContext: 'pool', mint: 'mint', tokenProgram: 'program', tokenDecimals: 6, tokenSupplyBaseUnits: '1', chainSlot: '123' };
  router.chartMetadataResolver = vi.fn(async () => metadata);
  router.mintResolver = vi.fn(async () => { throw Error('execution forbidden'); });
  const query = vi.fn(() => { throw Error('SQL forbidden'); });
  const service = new CompetitionService({ pool: { query } } as unknown as DatabaseService, router);
  expect(await service.chartMetadata('pool')).toEqual(metadata);
  expect(query).not.toHaveBeenCalled(); expect(router.mintResolver).not.toHaveBeenCalled();
});
it('metadata endpoint uses existing authentication and validates the context', async () => {
  const context = '2rM6Ep14wYYC9jNR9TtJj3pVggfj2qm7UXkfjd7tUJGK';
  const read = vi.fn(async () => ({ requestedContext: context, mint: '9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump', tokenDecimals: 6 }));
  const app = buildApp({ config: { LOG_LEVEL: 'silent' }, logger: false,
    database: { healthCheck: async () => true }, redis: { healthCheck: async () => true },
    auth: { authenticate: async (token: string) => token === 'fixture' ? { id: 'owner' } : null } as unknown as AuthService,
    competition: { chartMetadata: read } as unknown as CompetitionService });
  try {
    expect((await app.inject({ method:'GET',url:'/api/v1/chart-metadata/'+context })).statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect((await app.inject({ method:'GET',url:'/api/v1/chart-metadata/invalid',headers:{authorization:'Bearer fixture'} })).statusCode).toBe(400);
    const response = await app.inject({ method:'GET',url:'/api/v1/chart-metadata/'+context,headers:{authorization:'Bearer fixture'} });
    expect(response.statusCode).toBe(200); expect(response.json().mint).toBe('9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump');
  } finally { await app.close(); }
});
