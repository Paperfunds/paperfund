import { config as loadDotenv } from 'dotenv';

import { parseEnvironment } from '@paperfund/config';
import {
  createDatabase,
  DisabledPayoutSigner,
  dryRunPayoutExecution,
  executeApprovedPayoutPlan,
  LocalKeypairPayoutSigner,
  retryPayoutExecution,
  SolanaPayoutRpc,
} from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const planId = process.argv[2];
const live = process.argv.includes('--live');
const retry = process.argv.includes('--retry');
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
  } as const;
  try {
    const signer =
      environment.PAYOUT_SIGNER_TYPE === 'LOCAL_KEYPAIR'
        ? LocalKeypairPayoutSigner.fromJsonSecret(environment.PAYOUT_SIGNER_SECRET_KEY)
        : new DisabledPayoutSigner();
    const result = live
      ? retry
        ? await retryPayoutExecution(database, {
            executionId: `execution:${planId}`,
            config: executionConfig,
            rpc,
            signer,
            now: new Date(),
          })
        : await executeApprovedPayoutPlan(database, {
            planId,
            config: executionConfig,
            rpc,
            signer,
            now: new Date(),
          })
      : await dryRunPayoutExecution(database, { planId, config: executionConfig, rpc });
    process.stdout.write(
      `${JSON.stringify(result, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))}\n`,
    );
  } finally {
    await database.close();
  }
}
