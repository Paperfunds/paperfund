import { ExecutionRouter } from '@paperfund/execution';
import { createDatabase } from '../../src/database.js';
import { settleHourlyRound } from '../../src/financial-service.js';
import { linkedCandidateRuntime, LinkedStateStore } from './store.js';
const db = createDatabase(process.env.LINKED_TEST_DB_URL!),
  store = new LinkedStateStore(
    db,
    process.env.LINKED_TEST_ACCOUNT!,
    process.env.LINKED_TEST_ROUND!,
  ),
  seal = await store.cutoff();
if (!seal) throw Error('DURABLE_SEAL_REQUIRED');
const runtime = linkedCandidateRuntime(db, store, {
  now: () => Date.parse(seal.document.cutoff) + 120000,
  interval: async () => {
    throw Error('NO_REFRESH');
  },
  permission: async () => ({ discover: true, buy: false, authorizeLive: async () => undefined }),
});
const database = {
  ...runtime.database,
  async commitPersistedSettlementStep(
    ...args: Parameters<NonNullable<typeof runtime.database.commitPersistedSettlementStep>>
  ) {
    await runtime.database.commitPersistedSettlementStep!(...args);
    process.send?.({ staged: true });
    await new Promise<void>(() => undefined);
  },
};
await settleHourlyRound(database, new ExecutionRouter([runtime.adapter]), {
  hourlyRoundId: store.roundId,
  authoritativeTimestamp: new Date(Date.parse(seal.document.cutoff) + 120000),
});
throw Error('UNEXPECTED_SETTLEMENT_RETURN');
