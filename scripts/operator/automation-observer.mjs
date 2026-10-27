import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { ROOT } from './common.mjs';
import { databaseStatus } from './treasury.mjs';
import { nextClaim, iso } from './automation-core.mjs';
const singleton = net.createServer((s) => s.destroy());
await new Promise((ok, no) => {
  singleton.once('error', no);
  singleton.listen(3192, '127.0.0.1', ok);
});
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'])
  process.once(sig, () => {
    stopping = true;
  });
const file = path.join(ROOT, 'artifacts/operator/automation-observer.json'),
  startedAt = iso(Date.now());
while (!stopping) {
  let database = null,
    error = null;
  try {
    database = await databaseStatus();
  } catch {
    error = 'READ_ONLY_DATABASE_UNAVAILABLE';
  }
  const state = {
    processId: process.pid,
    startedAt,
    at: iso(Date.now()),
    mode: 'READ_ONLY_OBSERVATION_NO_AUTHORITY_NO_KEYS',
    persistentFinancialScheduler: 'REQUIRES_PROTECTED_SERVICE_ENROLLMENT',
    nextClaimAt: iso(nextClaim(Date.now())),
    database: database
      ? {
          stop: database.stop,
          reservedPrincipalLamports: database.reservedPrincipalLamports,
          reservedFeeLamports: database.reservedFeeLamports,
          verifiedReceivedCreatorFeeLamports: database.verifiedReceivedCreatorFeeLamports,
        }
      : null,
    error,
  };
  const temp = file + '.pending-' + process.pid;
  await fs.writeFile(temp, JSON.stringify(state, null, 2));
  await fs.rename(temp, file);
  for (let i = 0; i < 15 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => singleton.close(r));
