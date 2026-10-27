import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ExecutionRouter } from '@paperfund/execution';
import { createDatabase } from '../../src/database.js';
import { executePaperBuy } from '../../src/financial-service.js';
import { genericPumpSwapIdentity } from '../../../protocols/src/generic-pump-swap.js';
import { linkedCandidateRuntime, LinkedStateStore } from './store.js';
const db = createDatabase(process.env.LINKED_TEST_DB_URL!);
const evidence = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261021/flow/provider-459438275-459438282.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
);
const s = evidence.before,
  identity = genericPumpSwapIdentity(s.mint, s.quoteMint, s.bridgePool),
  store = new LinkedStateStore(
    db,
    process.env.LINKED_TEST_ACCOUNT!,
    process.env.LINKED_TEST_ROUND!,
  );
const runtime = linkedCandidateRuntime(db, store, {
    now: () => Date.parse(s.observedAt),
    interval: async () => null,
    permission: async () => ({ discover: true, buy: true, authorizeLive: async () => undefined }),
  }),
  router = new ExecutionRouter([runtime.adapter]);
const database = {
  ...runtime.database,
  async commitMarketExecution(
    ...args: Parameters<NonNullable<typeof runtime.database.commitMarketExecution>>
  ) {
    await runtime.database.commitMarketExecution!(...args);
    process.send?.({ staged: true });
    await new Promise<void>(() => undefined);
  },
};
await executePaperBuy(database, router, {
  competitionAccountId: store.accountId,
  marketId: identity.marketId,
  requestedPaperSolLamports: 100000000n,
  idempotencyKey: process.env.LINKED_TEST_KEY!,
  authoritativeTimestamp: new Date(s.observedAt),
});
throw Error('CRASH_TEST_UNEXPECTED_COMMIT');
