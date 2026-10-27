import 'dotenv/config';
import { createDatabase } from '../packages/db/src/database.js';
import { reconcileAccountLedger, settleHourlyRound } from '../packages/db/src/financial-service.js';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
import { parseEnvironment } from '@paperfund/config';

const roundId = process.argv[2];
if (!roundId || process.argv.slice(3).some((arg) => arg !== '--settle')) {
  throw new Error('Usage: npm run settlement:round -- <hourly-round-id> [--settle]');
}
const config = parseEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const stringify = (value: unknown) =>
  JSON.stringify(
    value,
    (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
try {
  const round = (await database.pool.query('select * from hourly_rounds where id = $1', [roundId]))
    .rows[0];
  if (!round) throw new Error('Hourly round does not exist.');
  const accounts = (
    await database.pool.query(
      'select * from competition_accounts where hourly_round_id = $1 order by id',
      [roundId],
    )
  ).rows;
  const audit = [];
  for (const account of accounts) {
    audit.push({
      account,
      positions: (
        await database.pool.query(
          'select * from positions where competition_account_id = $1 order by id',
          [account.id],
        )
      ).rows,
      journals: (
        await database.pool.query(
          'select * from journal_transactions where competition_account_id = $1 order by created_at',
          [account.id],
        )
      ).rows,
      ledger: await reconcileAccountLedger(database, account.id),
      repairs: (
        await database.pool.query(
          `select r.* from settlement_writeoff_metadata_repairs r
        join journal_transactions j on j.id=r.journal_transaction_id where j.competition_account_id=$1`,
          [account.id],
        )
      ).rows,
      hourlyResults: (
        await database.pool.query('select * from hourly_results where competition_account_id=$1', [
          account.id,
        ])
      ).rows,
    });
  }
  console.log(stringify({ round, audit }));
  if (process.argv.includes('--settle')) {
    const router = createProductionExecutionRouter({
      rpcUrl: config.SOLANA_RPC_URL,
      rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
      commitment: config.SOLANA_COMMITMENT,
    });
    const result = await settleHourlyRound(database, router, {
      hourlyRoundId: roundId,
      authoritativeTimestamp: new Date(),
    });
    console.log(stringify({ settlement: result }));
    for (const account of accounts) {
      console.log(
        stringify({
          ledgerAfter: await reconcileAccountLedger(database, account.id),
          repairs: (
            await database.pool.query(
              `select r.* from settlement_writeoff_metadata_repairs r
          join journal_transactions j on j.id = r.journal_transaction_id where j.competition_account_id = $1`,
              [account.id],
            )
          ).rows,
        }),
      );
    }
    if (result.state !== 'FINALIZED') process.exitCode = 1;
  }
} finally {
  await database.close();
}
