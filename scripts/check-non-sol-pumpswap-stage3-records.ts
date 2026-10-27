/** Read-only preservation/rollback readiness check. */
import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { parseEnvironment, APPROVED_NON_SOL_PUMPSWAP_ROUTES } from '@paperfund/config';
import { createDatabase } from '@paperfund/db';
config({ quiet: true });
const e = parseEnvironment(process.env),
  db = createDatabase(e.DATABASE_URL),
  mints = APPROVED_NON_SOL_PUMPSWAP_ROUTES.map((r) => r.mint);
try {
  const positions = (
    await db.pool.query(
      'select count(*)::text count from positions p join assets a on a.id=p.asset_id where p.status=$2 and a.mint_address=any($1::text[])',
      [mints, 'OPEN'],
    )
  ).rows;
  const fills = (
    await db.pool.query(
      'select f.* from fills f join markets m on m.id=f.market_id join assets a on a.id=m.base_asset_id where a.mint_address=any($1::text[]) order by f.id',
      [mints],
    )
  ).rows;
  const result = {
    at: new Date().toISOString(),
    openPositions: positions[0]?.count,
    fillCount: fills.length,
    fillHash: createHash('sha256').update(JSON.stringify(fills)).digest('hex'),
  };
  const file = 'docs/evidence/non-sol-pumpswap-stage3-records.json';
  if (process.argv.includes('--baseline')) {
    if (existsSync(file)) throw Error('Refusing to overwrite baseline');
    writeFileSync(file, JSON.stringify(result, null, 2));
  } else {
    const prior = JSON.parse(readFileSync(file, 'utf8'));
    if (prior.fillHash !== result.fillHash) throw Error('Fill preservation mismatch');
    console.log('Stored target fills unchanged');
  }
  console.log(JSON.stringify(result));
  if (result.openPositions !== '0') process.exitCode = 2;
} finally {
  await db.close();
}
