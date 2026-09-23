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
      LOG_LEVEL: 'info',
    });
  });

  it('rejects invalid and missing infrastructure configuration', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'production',
        API_PORT: '70000',
        DATABASE_URL: 'not-a-database-url',
        REDIS_URL: 'http://127.0.0.1:6379',
      }),
    ).toThrow();
  });
});
