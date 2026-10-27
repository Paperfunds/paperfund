import { parseApplicationEnvironment } from '@paperfund/config';
import { createDatabase, GenericCapability, genericCapabilityOptions } from '@paperfund/db';
import {
  createProductionExecutionRouter,
  advisoryReadContext,
  rpcProviderIdentity,
} from '@paperfund/protocols';

import { buildApp } from './app.js';
import { AuthService } from './auth.js';
import { CompetitionService } from './competition.js';
import { createRedis } from './redis.js';

const config = parseApplicationEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const genericCapability = new GenericCapability(database, genericCapabilityOptions(config));
const router = createProductionExecutionRouter({
  genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
  genericPumpSwapBuysEnabled: config.GENERIC_PUMPSWAP_BUYS_ENABLED,
  genericAccessResolver: (mint, quote, settlement) =>
    genericCapability.resolve(mint, quote, settlement),
  nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
  nonSolPumpSwapRoutes: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES,
  rpcUrl: config.SOLANA_RPC_URL,
  rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  commitment: config.SOLANA_COMMITMENT,
  log: (event, metadata) => {
    if (advisoryReadContext() && !config.VALUATION_DIAGNOSTICS_ENABLED) return;
    if (
      !event.startsWith('LAUNCHLAB_') &&
      ![
        'BUY_ROUTE',
        'SELL_ROUTE',
        'EXECUTABLE_VALUATION',
        'EXECUTION_VALUATION_ANOMALY',
        'IMMEDIATE_VALUATION_UNAVAILABLE',
        'ROUTE_UNAVAILABLE',
        ...(config.VALUATION_DIAGNOSTICS_ENABLED ? ['RPC_READ_RETRY'] : []),
      ].includes(event)
    )
      return;
    const failed = /FAILED|UNAVAILABLE|MIGRATING/.test(event);
    app.log[failed ? 'warn' : 'info']({ event, ...metadata });
  },
});
const auth = new AuthService(
  database,
  redis,
  config.AUTH_CHALLENGE_TTL_SECONDS,
  config.AUTH_SESSION_TTL_SECONDS,
);
const competition = new CompetitionService(
  database,
  router,
  () => new Date(),
  {
    allocationMode: config.REWARD_ALLOCATION_MODE,
    baselineWindow: config.REWARD_BASELINE_WINDOW,
    lambdaBps: BigInt(config.REWARD_LAMBDA_BPS),
    configurationVersion: 'phase-5a-v1',
  },
  undefined,
  {
    maxConcurrent: config.ADVISORY_MAX_CONCURRENT,
    backgroundConcurrent: config.ADVISORY_BACKGROUND_CONCURRENT,
  },
  config.GENERIC_PUMPSWAP_ENABLED,
);
const app = buildApp({ config, database, redis, auth, competition, genericCapability });

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
  app.log.info(
    {
      host: config.API_HOST,
      port: config.API_PORT,
      rpcProvider: rpcProviderIdentity(config.SOLANA_RPC_URL),
      commitment: config.SOLANA_COMMITMENT,
      websocketConfigured: Boolean(config.SOLANA_WS_URL),
      nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
      nonSolPumpSwapAllowedMints: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES.map((r) => r.mint),
    },
    'API listening',
  );
} catch (error) {
  app.log.fatal({ error }, 'API startup failed');
  await shutdown('SIGTERM');
  process.exitCode = 1;
}
