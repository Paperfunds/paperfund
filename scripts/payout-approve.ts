import { config as loadDotenv } from 'dotenv';

import { parseEnvironment } from '@paperfund/config';
import { approvePayoutPlan, createDatabase } from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const planId = process.argv[2];
const approverIdentifier = process.argv[3];
if (!planId || !approverIdentifier) {
  process.stderr.write('Usage: npm run payout:approve -- <plan-id> <operator-identifier>\n');
  process.exitCode = 2;
} else {
  const config = parseEnvironment(process.env);
  const database = createDatabase(config.DATABASE_URL);
  try {
    const result = await approvePayoutPlan(database, {
      planId,
      approverIdentifier,
      now: new Date(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await database.close();
  }
}
