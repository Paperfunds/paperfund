import { config as loadDotenv } from 'dotenv';

import { parseEnvironment } from '@paperfund/config';
import {
  createDatabase,
  runCreatorFeeBackfill,
  SolanaJsonRpcClient,
  SolanaPumpCreatorFeeSource,
} from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const fromSlot = process.argv[2];
const toSlotExclusive = process.argv[3];
const maxTransactions = process.argv[4];
if (!fromSlot || !toSlotExclusive) {
  process.stderr.write(
    'Usage: npm run creator-fees:backfill -- <from-slot> <to-slot-exclusive> [max-transactions]\n',
  );
  process.exitCode = 2;
} else {
  const config = parseEnvironment(process.env);
  const database = createDatabase(config.DATABASE_URL);
  const source = new SolanaPumpCreatorFeeSource(
    new SolanaJsonRpcClient(config.SOLANA_RPC_URL, {
      timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
      maxAttempts: config.CREATOR_FEE_RPC_MAX_ATTEMPTS,
      minimumRequestIntervalMs: config.CREATOR_FEE_RPC_MIN_INTERVAL_MS,
    }),
    {
      tokenMint: config.PAPERFUND_TOKEN_MINT,
      creatorWallet: config.PAPERFUND_CREATOR_WALLET,
    },
    config.CREATOR_FEE_NETWORK,
    config.CREATOR_FEE_PAGE_SIZE,
  );
  try {
    const result = await runCreatorFeeBackfill(database, source, {
      fromSlot: BigInt(fromSlot),
      toSlotExclusive: BigInt(toSlotExclusive),
      ...(maxTransactions ? { maxTransactions: Number(maxTransactions) } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await database.close();
  }
}
