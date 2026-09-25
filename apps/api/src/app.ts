import { randomUUID } from 'node:crypto';

import fastify, { type FastifyRequest } from 'fastify';

import type { AppConfig } from '@paperfund/config';
import { FinancialServiceError, type DatabaseService } from '@paperfund/db';
import { ExecutionEngineError } from '@paperfund/execution';
import type { ServiceStatus } from '@paperfund/shared';

import { isSolanaPublicKey, type AuthenticatedUser, type AuthService } from './auth.js';
import type { CompetitionService } from './competition.js';
import type { RedisService } from './redis.js';

type ApiConfig = Pick<
  AppConfig,
  | 'LOG_LEVEL'
  | 'COOKIE_SECURE'
  | 'COOKIE_SAME_SITE'
  | 'AUTH_SESSION_TTL_SECONDS'
  | 'ALLOWED_ORIGINS'
  | 'API_RATE_LIMIT_WINDOW_SECONDS'
  | 'API_RATE_LIMIT_AUTH_MAX'
  | 'API_RATE_LIMIT_TRADE_MAX'
>;

export interface AppDependencies {
  config: ApiConfig | Pick<AppConfig, 'LOG_LEVEL'>;
  database: Pick<DatabaseService, 'healthCheck'>;
  redis: Pick<RedisService, 'healthCheck'> & Partial<RedisService>;
  auth?: AuthService;
  competition?: CompetitionService;
  logger?: boolean;
}

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function exactJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(exactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exactJson(item)]));
  }
  return value;
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function sessionToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return cookieValue(request, 'paperfund_session');
}

function stringField(body: unknown, key: string, maxLength: number): string {
  if (!body || typeof body !== 'object')
    throw new ApiError('INVALID_REQUEST', 'Request body must be an object.');
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ApiError('INVALID_REQUEST', `${key} is invalid.`, 400, { field: key });
  }
  return value;
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new ApiError(
      'INVALID_REQUEST',
      'Idempotency-Key header is required and must be at most 128 characters.',
    );
  }
  return value.trim();
}

function pagination(query: unknown) {
  const record = (query ?? {}) as Record<string, unknown>;
  const parsed = record['limit'] === undefined ? 25 : Number(record['limit']);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ApiError('INVALID_REQUEST', 'limit must be an integer from 1 to 100.');
  }
  const cursor = record['cursor'];
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512)) {
    throw new ApiError('INVALID_REQUEST', 'cursor is invalid.');
  }
  return { limit: parsed, ...(typeof cursor === 'string' ? { cursor } : {}) };
}

const statusByCode: Record<string, number> = {
  UNAUTHENTICATED: 401,
  INVALID_REQUEST: 400,
  INVALID_FINANCIAL_INPUT: 400,
  INVALID_SELL_QUANTITY: 400,
  ROUND_NOT_OPEN: 409,
  OUTSIDE_ROUND_WINDOW: 409,
  INSUFFICIENT_PAPER_SOL: 409,
  INSUFFICIENT_BALANCE: 409,
  INSUFFICIENT_TOKEN_BALANCE: 409,
  INSUFFICIENT_POSITION: 409,
  MAX_BUY_RATIO_EXCEEDED: 409,
  TOKEN_SLOT_LIMIT_REACHED: 409,
  MARKET_STATE_UNAVAILABLE: 503,
  MARKET_ACCOUNT_NOT_FOUND: 422,
  INVALID_MARKET_STATE: 422,
  INVALID_EXECUTION_RESULT: 503,
  RPC_TIMEOUT: 503,
  RPC_ERROR: 503,
  MARKET_MIGRATED: 409,
  MIGRATION_DESTINATION_UNAVAILABLE: 503,
  UNSUPPORTED_MIGRATED_PROTOCOL: 422,
  POSITION_EXECUTION_ROUTE_UNAVAILABLE: 503,
  UNSUPPORTED_PROTOCOL: 422,
  UNSUPPORTED_MARKET: 422,
  PROTOCOL_DISABLED: 503,
  IDEMPOTENCY_CONFLICT: 409,
  ENTITY_NOT_FOUND: 404,
  FINALIZATION_CONFLICT: 409,
};

export function buildApp(dependencies: AppDependencies) {
  const app = fastify({
    logger: dependencies.logger ?? { level: dependencies.config.LOG_LEVEL },
    genReqId: () => randomUUID(),
  });
  const fullConfig = dependencies.config as Partial<ApiConfig>;
  const allowedOrigins = new Set(
    (fullConfig.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      reply.header('access-control-allow-headers', 'Content-Type,Authorization,Idempotency-Key');
      return reply.code(204).send();
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const domainError =
      error instanceof ApiError ||
      error instanceof FinancialServiceError ||
      error instanceof ExecutionEngineError;
    const frameworkStatus =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
    const invalidFrameworkRequest =
      frameworkStatus !== undefined && frameworkStatus >= 400 && frameworkStatus < 500;
    const code = domainError
      ? error.code
      : invalidFrameworkRequest
        ? 'INVALID_REQUEST'
        : 'INTERNAL_ERROR';
    const status =
      error instanceof ApiError
        ? error.statusCode
        : invalidFrameworkRequest
          ? frameworkStatus
          : (statusByCode[code] ?? 500);
    if (status >= 500) request.log.error({ err: error, code }, 'API request failed');
    else request.log.warn({ code }, 'API request rejected');
    return reply.code(status).send({
      error: {
        code,
        message: domainError
          ? error.message
          : invalidFrameworkRequest
            ? 'Request is invalid.'
            : 'An internal error occurred.',
        ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
        requestId: request.id,
      },
    });
  });

  app.get('/health', async () => ({ status: 'ok' as const, application: 'paperfund-api' }));
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
    if (!ready) app.log.warn({ services }, 'Infrastructure readiness check failed');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable', services });
  });

  if (!dependencies.auth || !dependencies.competition) return app;
  const auth = dependencies.auth;
  const competition = dependencies.competition;

  async function user(request: FastifyRequest): Promise<AuthenticatedUser> {
    const authenticated = await auth.authenticate(sessionToken(request));
    if (!authenticated) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.', 401);
    return authenticated;
  }

  function rateLimit(scope: 'auth' | 'trade') {
    return async (request: FastifyRequest) => {
      if (!dependencies.redis.incrementWindow) return;
      const max =
        scope === 'auth'
          ? (fullConfig.API_RATE_LIMIT_AUTH_MAX ?? 20)
          : (fullConfig.API_RATE_LIMIT_TRADE_MAX ?? 30);
      const subject = request.ip;
      const count = await dependencies.redis.incrementWindow(
        `rate:${scope}:${subject}`,
        fullConfig.API_RATE_LIMIT_WINDOW_SECONDS ?? 60,
      );
      if (count > max) throw new ApiError('RATE_LIMITED', 'Too many requests.', 429);
    };
  }

  app.post('/api/v1/auth/challenge', { preHandler: rateLimit('auth') }, async (request, reply) => {
    const walletAddress = stringField(request.body, 'walletAddress', 64);
    if (!isSolanaPublicKey(walletAddress))
      throw new ApiError('INVALID_REQUEST', 'walletAddress is not a Solana public key.');
    return reply.send(exactJson(await auth.createChallenge(walletAddress)));
  });

  app.post('/api/v1/auth/verify', { preHandler: rateLimit('auth') }, async (request, reply) => {
    try {
      const transport =
        request.body && typeof request.body === 'object'
          ? (request.body as Record<string, unknown>)['transport']
          : undefined;
      if (transport !== undefined && transport !== 'extension') {
        throw new ApiError('INVALID_REQUEST', 'transport is invalid.');
      }
      const result = await auth.verifyChallenge({
        walletAddress: stringField(request.body, 'walletAddress', 64),
        challengeId: stringField(request.body, 'challengeId', 64),
        message: stringField(request.body, 'message', 2_048),
        signature: stringField(request.body, 'signature', 128),
      });
      if (transport !== 'extension') {
        const sameSite = fullConfig.COOKIE_SAME_SITE ?? 'lax';
        const secure = fullConfig.COOKIE_SECURE === true;
        reply.header(
          'set-cookie',
          `paperfund_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; Max-Age=${fullConfig.AUTH_SESSION_TTL_SECONDS ?? 86_400}; SameSite=${sameSite}${secure ? '; Secure' : ''}`,
        );
      }
      return reply.send(
        exactJson({
          user: result.user,
          expiresAt: result.expiresAt,
          ...(transport === 'extension' ? { sessionToken: result.token } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Authentication failed.',
      );
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    await auth.logout(sessionToken(request));
    reply.header('set-cookie', 'paperfund_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    return reply.code(204).send();
  });
  app.get('/api/v1/auth/me', async (request) => ({ user: await user(request) }));

  app.get('/api/v1/rounds/current', async () => {
    const now = new Date();
    return exactJson({ round: await competition.getCurrentRound(), serverTime: now });
  });
  app.post('/api/v1/rounds/current/enter', async (request) =>
    exactJson(await competition.enterRound((await user(request)).id)),
  );
  app.get('/api/v1/rounds/current/account', async (request) => {
    const account = await competition.getCurrentAccount((await user(request)).id);
    if (!account)
      throw new ApiError(
        'ROUND_ACCOUNT_NOT_FOUND',
        'The authenticated wallet has not entered the current round.',
        404,
      );
    return exactJson({
      accountId: account.id,
      roundId: account.hourly_round_id,
      paperSolLamports: account.paper_sol_balance_lamports,
      startingPaperSolLamports: account.starting_paper_sol_lamports,
      realizedPnlLamports: account.realized_pnl_lamports,
      slotsUsed: account.slots_used,
      slotLimit: account.max_unique_tokens,
      roundState: account.state,
      positions: account.positions.map((position) => ({
        id: position.id,
        mint: position.mint_address,
        originMarketId: position.market_id,
        originProtocol: position.venue,
        tokenDecimals: position.decimals,
        tokenQuantityBaseUnits: position.remaining_base_units,
        costBasisPaperSolLamports: position.cost_basis_lamports,
        realizedPnlLamports: position.realized_pnl_lamports,
        valuation: {
          status: 'UNAVAILABLE',
          reason: 'VALUATION_NOT_REQUESTED',
          valuedAt: new Date(),
        },
      })),
    });
  });

  app.post('/api/v1/trades/buy', { preHandler: rateLimit('trade') }, async (request) => {
    const authenticated = await user(request);
    const mint = stringField(request.body, 'mint', 64);
    if (!isSolanaPublicKey(mint)) throw new ApiError('INVALID_REQUEST', 'mint is invalid.');
    const result = await competition.buy(authenticated.id, {
      mint,
      paperSol: stringField(request.body, 'paperSol', 32),
      idempotencyKey: idempotencyKey(request),
    });
    request.log.info(
      {
        userId: authenticated.id,
        roundAccountId: result.competitionAccountId,
        orderId: result.orderId,
        mint,
        protocol: result.protocolId,
        executionId: result.executionId,
      },
      'Paper BUY completed',
    );
    return exactJson({
      orderId: result.orderId,
      fillId: result.fillId,
      executionId: result.executionId,
      tokenMint: mint,
      executionProtocol: result.protocolId,
      requestedPaperSolLamports: result.requestedPaperSolLamports,
      actualPaperSolSpentLamports: result.actualPaperSolInputLamports,
      tokenQuantityReceivedBaseUnits: result.actualTokenOutputBaseUnits,
      feeLamports: result.feeLamports,
      evidenceFingerprint: result.marketStateFingerprint,
      newCashBalanceLamports: result.paperSolBalanceLamports,
      newPositionQuantityBaseUnits: result.position.remainingBaseUnits,
      costBasisPaperSolLamports: result.position.costBasisLamports,
      executedAt: result.executedAt,
    });
  });

  app.get('/api/v1/trades/buy-preflight', async (request) => {
    const mint = (request.query as { mint?: unknown }).mint;
    if (typeof mint !== 'string' || !isSolanaPublicKey(mint)) {
      throw new ApiError('INVALID_REQUEST', 'mint is invalid.');
    }
    return exactJson(await competition.buyPreflight((await user(request)).id, mint));
  });

  app.post('/api/v1/trades/sell', { preHandler: rateLimit('trade') }, async (request) => {
    const authenticated = await user(request);
    const mint = stringField(request.body, 'mint', 64);
    if (!isSolanaPublicKey(mint)) throw new ApiError('INVALID_REQUEST', 'mint is invalid.');
    const quantity = stringField(request.body, 'quantity', 80);
    if (quantity !== 'ALL' && !/^[1-9][0-9]*$/.test(quantity))
      throw new ApiError('INVALID_REQUEST', 'quantity must be positive base units or ALL.');
    const result = await competition.sell(authenticated.id, {
      mint,
      quantity,
      idempotencyKey: idempotencyKey(request),
    });
    request.log.info(
      {
        userId: authenticated.id,
        roundAccountId: result.competitionAccountId,
        orderId: result.orderId,
        mint,
        protocol: result.protocolId,
        executionId: result.executionId,
      },
      'Paper SELL completed',
    );
    return exactJson({
      orderId: result.orderId,
      fillId: result.fillId,
      executionId: result.executionId,
      tokenMint: mint,
      executionProtocol: result.protocolId,
      tokenAmountSoldBaseUnits: result.actualTokenInputBaseUnits,
      grossPaperSolLamports: result.actualNetPaperSolOutputLamports + result.feeLamports,
      feeLamports: result.feeLamports,
      paperSolCreditedLamports: result.actualNetPaperSolOutputLamports,
      costBasisRemovedLamports: result.costBasisLamportsRemoved,
      realizedPnlLamports: result.fillRealizedPnlLamports,
      remainingQuantityBaseUnits: result.position.remainingBaseUnits,
      remainingCostBasisLamports: result.position.costBasisLamports,
      newCashBalanceLamports: result.paperSolBalanceLamports,
      evidenceFingerprint: result.marketStateFingerprint,
      executedAt: result.executedAt,
    });
  });

  app.get('/api/v1/trades', async (request) =>
    exactJson(await competition.trades((await user(request)).id, pagination(request.query))),
  );
  app.get('/api/v1/positions', async (request) => {
    const result = await competition.getPositions((await user(request)).id);
    if (!result)
      throw new ApiError(
        'ROUND_ACCOUNT_NOT_FOUND',
        'The authenticated wallet has not entered the current round.',
        404,
      );
    return exactJson({
      accountId: result.accountId,
      roundId: result.roundId,
      cashLamports: result.cashLamports,
      startingPaperSolLamports: result.startingPaperSolLamports,
      valuationStatus: result.valuationStatus,
      executablePositionsLamports: result.executablePositionsLamports,
      portfolioEquityLamports: result.portfolioEquityLamports,
      livePnlLamports: result.livePnlLamports,
      valuedAt: result.valuedAt,
      positions: result.positions.map((position) => ({
        id: position.id,
        mint: position.mint_address,
        originMarketId: position.market_id,
        originProtocol: position.venue,
        tokenDecimals: position.decimals,
        tokenQuantityBaseUnits: position.remaining_base_units,
        costBasisPaperSolLamports: position.cost_basis_lamports,
        realizedPnlLamports: position.realized_pnl_lamports,
        valuation: position.valuation,
      })),
    });
  });
  app.get('/api/v1/results/hourly', async (request) =>
    exactJson(await competition.hourlyResults((await user(request)).id, pagination(request.query))),
  );
  app.get('/api/v1/leaderboards/daily', async () =>
    exactJson(await competition.dailyLeaderboard()),
  );
  app.get('/api/v1/leaderboards/hourly', async (request) => {
    const roundId = (request.query as { roundId?: unknown }).roundId;
    if (roundId !== undefined && (typeof roundId !== 'string' || roundId.length > 128))
      throw new ApiError('INVALID_REQUEST', 'roundId is invalid.');
    return exactJson(
      await competition.hourlyLeaderboard(typeof roundId === 'string' ? roundId : undefined),
    );
  });
  app.get('/api/v1/competitions/daily/current', async () =>
    exactJson({ competition: await competition.currentDailyCompetition(), serverTime: new Date() }),
  );
  app.get('/api/v1/markets/:mint', async (request) => {
    const mint = (request.params as { mint: string }).mint;
    if (!isSolanaPublicKey(mint)) throw new ApiError('INVALID_REQUEST', 'mint is invalid.');
    return exactJson(await competition.marketSupport(mint));
  });

  return app;
}
