import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { parseEnvironment } from '@paperfund/config';
import { createDatabase } from '@paperfund/db';

import { buildApp } from './app.js';
import { createRedis } from './redis.js';

loadDotenv({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

const config = parseEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const app = buildApp({ config, database, redis });

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  app.log.info({ signal }, 'Graceful shutdown started');

  try {
    await app.close();
    await database.close();
    await redis.close();
    app.log.info('Graceful shutdown completed');
  } catch (error) {
    app.log.error({ error }, 'Graceful shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info({ host: config.API_HOST, port: config.API_PORT }, 'API listening');
} catch (error) {
  app.log.fatal({ error }, 'API startup failed');
  await shutdown('SIGTERM');
  process.exitCode = 1;
}
