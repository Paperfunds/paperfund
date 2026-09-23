import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

const secretDatabaseUrl = 'postgresql://secret-user:secret-password@database/private';
const secretRedisUrl = 'redis://:secret-password@redis:6379';

describe('API health endpoints', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('returns basic process health without checking infrastructure', async () => {
    const app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database: { healthCheck: async () => false },
      redis: { healthCheck: async () => false },
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', application: 'paperfund-api' });
  });

  it('reports readiness and never exposes configured secrets', async () => {
    const app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database: { healthCheck: async () => true },
      redis: { healthCheck: async () => true },
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/ready' });
    const payload = response.body;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      services: { database: 'ok', redis: 'ok' },
    });
    expect(payload).not.toContain(secretDatabaseUrl);
    expect(payload).not.toContain(secretRedisUrl);
    expect(payload).not.toContain('secret-password');
  });

  it('returns 503 when required infrastructure is unavailable', async () => {
    const app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database: { healthCheck: async () => false },
      redis: { healthCheck: async () => true },
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      services: { database: 'unavailable', redis: 'ok' },
    });
  });
});
