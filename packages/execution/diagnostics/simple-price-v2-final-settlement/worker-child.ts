import { createDatabase } from '@paperfund/db';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import { REPLAY_POLICY } from '../simple-price-v2-settlement/fixtures.js';
import { CutoffArchive } from './archive.js';
import { TEST_POLICY } from './harness.js';
import { privateTick } from './worker.js';
import { join } from 'node:path';
export interface Job {
  url: string;
  token: string;
  directory: string;
  now: number;
  lostAck?: boolean;
}
process.once('message', async (job: Job) => {
  const db = createDatabase(job.url);
  try {
    const archive = new CutoffArchive(
      db,
      job.token,
      REPLAY_POLICY,
      TEST_POLICY,
      () => job.now,
      new IsolatedHighWater(join(job.directory, 'pre-cutoff-ingestion'), REPLAY_POLICY),
    );
    await privateTick(archive, job.directory, new Date(job.now));
    await db.close();
    if (job.lostAck) process.exit(75);
    process.send?.({ type: 'DONE' });
    process.disconnect?.();
  } catch {
    await db.close();
    process.send?.({ type: 'ERROR' });
    process.exit(76);
  }
});
