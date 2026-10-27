// Process-restart test helper. Refuses every database except a unique disposable fixture.
import { createDatabase } from '../../src/database.js';
import { CurrentQuoteSettlement } from '../../src/current-quote-settlement.js';
import { settleHourlyRound } from '../../src/financial-service.js';
import { ExecutionRouter } from '@paperfund/execution';
import { PumpFunProtocolAdapter } from '@paperfund/protocols';
const [name, policy, round, cutoff] = process.argv.slice(2);
if (!name || !/^current_cutoff_[a-f0-9]+$/.test(name) || !policy || !round || !cutoff)
  throw Error('DISPOSABLE_FIXTURE_REQUIRED');
const db = createDatabase('postgresql://beta:disposable-beta-only@127.0.0.1:55462/' + name);
try {
  const router = new ExecutionRouter([
    new PumpFunProtocolAdapter({
      loadMarketState: async () => {
        throw Error('NO_FRESH_BANK_ALLOWED_AFTER_RESTART');
      },
    }),
  ]);
  const settlement = new CurrentQuoteSettlement(db, router, policy, {
    capture: async () => {
      throw Error('NO_NEW_CAPTURE');
    },
    frontier: async () => {
      throw Error('NO_NEW_FRONTIER');
    },
  });
  const result = await settleHourlyRound(settlement.database(), router, {
    hourlyRoundId: round,
    authoritativeTimestamp: new Date(cutoff),
  });
  console.log(
    JSON.stringify({
      state: result.state,
      forcedSells: result.forcedSells.length,
      failures: result.failures.length,
    }),
  );
} finally {
  await db.close();
}
