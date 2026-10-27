import { afterEach, expect, it, vi } from 'vitest';
import pino from 'pino';
import { buildApp } from '../src/app.js';
import { safeApiLoggerOptions } from '../src/safe-diagnostics.js';
import { workerDiagnosticJson, safeWorkerErrorMessage } from '../../worker/src/safe-diagnostics.js';
import { opsDiagnosticJson, safeOpsErrorMessage } from '../../../scripts/safe-diagnostics.js';
import { ExecutionEngineError } from '@paperfund/execution';
import type { AuthService } from '../src/auth.js';
import type { CompetitionService } from '../src/competition.js';
const key = 'SyntheticRpcCredential_52058d7ef7854456a8cf3c051dd02107';
const bearer = 'SyntheticBearer_c06a8f6210784f009fa47241ea4d55ee5';
const url = 'https://mainnet.helius-rpc.com/?api-key=' + key;
const noLeak = (text: string) => {
  expect(text.includes(key)).toBe(false);
  expect(text.includes(bearer)).toBe(false);
  expect(text.includes(url)).toBe(false);
};
afterEach(() => vi.unstubAllEnvs());
const setup = () => vi.stubEnv('SOLANA_RPC_URL', url);
const failure = () =>
  Object.assign(new ExecutionEngineError('RPC_UNAVAILABLE', 'HTTP 401 ' + url + ' ' + key), {
    cause: Object.assign(new Error('Bearer ' + bearer), {
      headers: { authorization: 'Bearer ' + bearer },
      config: { url },
    }),
  });
it('protects actual Pino formatting, nested causes, structured fields and serializer output', () => {
  setup();
  let output = '';
  const logger = pino(safeApiLoggerOptions('info'), {
    write(chunk: string) {
      output += chunk;
    },
  });
  logger.error(
    {
      err: failure(),
      request: { headers: { Authorization: 'Bearer ' + bearer } },
      endpoint: url,
      httpStatus: 401,
      retry: 2,
      elapsedMs: 17,
    },
    'RPC failed ' + url,
  );
  logger.error({ headers: { Authorization: 'Bearer ' + bearer } }, 'Transport token ' + bearer);
  noLeak(output);
  expect(output.includes('401')).toBe(true);
  expect(output.includes('RPC_UNAVAILABLE')).toBe(true);
});
it('protects worker log and heartbeat JSON including nested HTTP errors and retains diagnostics', () => {
  setup();
  const error = failure();
  const log = workerDiagnosticJson({
    event: 'round_lifecycle_tick_failed',
    error,
    message: safeWorkerErrorMessage(error),
    httpStatus: 401,
    retries: 3,
  });
  const heartbeat = workerDiagnosticJson({
    lastError: {
      scope: 'round_lifecycle',
      message: safeWorkerErrorMessage(error),
      cause: error.cause,
    },
  });
  noLeak(log);
  noLeak(heartbeat);
  expect(log.includes('round_lifecycle_tick_failed')).toBe(true);
});
it('protects ops report messages and nested details without dumping endpoint or authorization', () => {
  setup();
  const text = opsDiagnosticJson({
    status: 'FAIL',
    results: [
      {
        check: 'solanaRpc',
        status: 'FAIL',
        detail: safeOpsErrorMessage(failure()),
        nested: failure(),
      },
    ],
  });
  noLeak(text);
  expect(text.includes('solanaRpc')).toBe(true);
  expect(text.includes('FAIL')).toBe(true);
});
it.each([true, false])(
  'protects extension-facing API domain errors and unavailable market diagnostics',
  async (thrown) => {
    setup();
    const auth = { authenticate: async () => null } as unknown as AuthService;
    const app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database: { healthCheck: async () => true },
      redis: { healthCheck: async () => true },
      auth,
      competition: {
        marketSupport: async () => {
          if (thrown) throw failure();
          return {
            mint: '2SESLWryE5mmgeLQJcNezZVMfZwpBtLbxUaVW2MZpump',
            supported: false,
            reason: 'RPC_UNAVAILABLE',
            diagnostics: { message: url, cause: failure() },
          };
        },
      } as unknown as CompetitionService,
      logger: false,
    });
    try {
      const response = await app.inject(
        '/api/v1/markets/2SESLWryE5mmgeLQJcNezZVMfZwpBtLbxUaVW2MZpump',
      );
      noLeak(response.body);
      expect(response.statusCode).toBe(thrown ? 503 : 200);
      expect(response.body.includes('RPC_UNAVAILABLE')).toBe(true);
    } finally {
      await app.close();
    }
  },
);

it('preserves the successful authentication token response', async () => {
  setup();
  const intendedToken = 'SyntheticSessionForSuccessfulLogin_18432';
  const auth = {
    verifyChallenge: async () => ({
      token: intendedToken,
      user: { id: 'user:' + 'a'.repeat(64), walletAddress: 'fixture' },
      expiresAt: new Date(Date.now() + 60000),
    }),
  } as unknown as AuthService;
  const app = buildApp({
    config: { LOG_LEVEL: 'silent' },
    database: { healthCheck: async () => true },
    redis: { healthCheck: async () => true },
    auth,
    competition: {} as CompetitionService,
    logger: true,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: {
        walletAddress: '11111111111111111111111111111111',
        challengeId: 'fixture',
        message: 'fixture',
        signature: 'fixture',
        transport: 'extension',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessionToken === intendedToken).toBe(true);
  } finally {
    await app.close();
  }
});
