import { config as loadDotenv } from 'dotenv';

import { parseEnvironment } from '@paperfund/config';
import {
  createDatabase,
  getCreatorFeeIngestionHealth,
  SolanaJsonRpcClient,
  SolanaPumpCreatorFeeSource,
} from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const config = parseEnvironment(process.env);
const database = createDatabase(config.DATABASE_URL);
const source = new SolanaPumpCreatorFeeSource(
  new SolanaJsonRpcClient(config.SOLANA_RPC_URL),
  {
    tokenMint: config.PAPERFUND_TOKEN_MINT,
    creatorWallet: config.PAPERFUND_CREATOR_WALLET,
  },
  config.CREATOR_FEE_NETWORK,
  config.CREATOR_FEE_PAGE_SIZE,
);
try {
  const health = await getCreatorFeeIngestionHealth(database, source.id);
  process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
} finally {
  await database.close();
}
