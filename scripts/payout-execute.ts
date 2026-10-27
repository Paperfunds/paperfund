import { parseEnvironment } from '@paperfund/config';
import { createDatabase, dryRunPayoutExecution, SolanaPayoutRpc } from '@paperfund/db';

const planId = process.argv[2];
const live = process.argv.includes('--live');

if (!planId) {
  process.stderr.write('Usage: npm run payout:execute -- <plan-id> [--live] [--retry]\n');
  process.exitCode = 2;
} else {
  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment.DATABASE_URL);
  const rpc = new SolanaPayoutRpc(environment.SOLANA_RPC_URL, environment.SOLANA_COMMITMENT);
  const executionConfig = {
    enabled: environment.PAYOUT_EXECUTION_ENABLED,
    network: environment.PAYOUT_NETWORK,
    mainnetConfirmed: environment.PAYOUT_MAINNET_CONFIRM,
    treasuryAddress: environment.PAYOUT_TREASURY_PUBLIC_KEY,
    maxRecipientsPerBatch: environment.PAYOUT_MAX_RECIPIENTS_PER_BATCH,
    mainnetMaxPlanLamports: BigInt(environment.PAYOUT_MAINNET_MAX_PLAN_LAMPORTS),
  } as const;
  try {
    if (live)
      throw new Error(
        'PAYOUT_AUTHORITY_NOT_CONFIGURED: use the separately authorized signing runtime.',
      );
    const result = await dryRunPayoutExecution(database, { planId, config: executionConfig, rpc });
    process.stdout.write(
      `${JSON.stringify(result, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))}\n`,
    );
  } finally {
    await database.close();
  }
}
