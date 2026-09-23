import fastify from 'fastify';

import type { AppConfig } from '@paperfund/config';
import type { DatabaseService } from '@paperfund/db';
import type { ServiceStatus } from '@paperfund/shared';

import type { RedisService } from './redis.js';

export interface AppDependencies {
  config: Pick<AppConfig, 'LOG_LEVEL'>;
  database: Pick<DatabaseService, 'healthCheck'>;
  redis: Pick<RedisService, 'healthCheck'>;
  logger?: boolean;
}

export function buildApp(dependencies: AppDependencies) {
  const app = fastify({
    logger: dependencies.logger ?? { level: dependencies.config.LOG_LEVEL },
  });

  app.get('/health', async () => ({
    status: 'ok' as const,
    application: 'paperfund-api',
  }));

  app.get('/ready', async (_request, reply) => {
    const [databaseReady, redisReady] = await Promise.all([
      dependencies.database.healthCheck(),
      dependencies.redis.healthCheck(),
    ]);
    const services: { database: ServiceStatus; redis: ServiceStatus } = {
      database: databaseReady ? 'ok' : 'unavailable',
      redis: redisReady ? 'ok' : 'unavailable',
    };
    const ready = databaseReady && redisReady;

    if (!ready) {
      app.log.warn({ services }, 'Infrastructure readiness check failed');
    }

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'unavailable',
      services,
    });
  });

  return app;
}
