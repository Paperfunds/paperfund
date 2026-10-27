/** Disposable API crash test only. Runs with the isolated source-resolution tsconfig. */
import { createDatabase } from '../../src/database.js';
import { LinkedStateStore } from './store.js';
import { verifiedRouteRuntime } from '../../../../apps/api/isolated/verified-routes/runtime.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import type { AuthService } from '../../../../apps/api/src/auth.js';
const db = createDatabase(process.env.LINKED_TEST_DB_URL!, { authorizePaperBuy: async () => true }),
  store = new LinkedStateStore(
    db,
    process.env.LINKED_TEST_ACCOUNT!,
    process.env.LINKED_TEST_ROUND!,
  ),
  s = (await store.load()).document.simulated;
const runtime = await verifiedRouteRuntime(store, {
  now: () => Date.parse(s.observedAt),
  interval: async () => null,
  permission: async () => ({ discover: true, buy: true, authorizeLive: async () => undefined }),
});
const commit = runtime.database.commitMarketExecution!;
Object.assign(runtime.database, {
  commitMarketExecution: async (...args: Parameters<typeof commit>) => {
    await commit(...args);
    process.send?.({ staged: true });
    await new Promise<void>(() => undefined);
  },
});
const app = buildApp({
  config: { LOG_LEVEL: 'silent', BETA_INVITE_ONLY: false },
  database: runtime.database,
  redis: { healthCheck: async () => true },
  competition: runtime.competition,
  auth: {
    authenticate: async () => ({
      id: process.env.LINKED_TEST_USER!,
      walletAddress: 'isolated-crash-wallet',
    }),
  } as unknown as AuthService,
  logger: false,
});
const response = await app.inject({
  method: 'POST',
  url: '/api/v1/trades/buy',
  headers: { authorization: 'Bearer test', 'idempotency-key': process.env.LINKED_TEST_KEY! },
  payload: { mint: s.mint, paperSol: '0.01' },
});
throw Error('UNEXPECTED_COMMIT:' + response.body);
