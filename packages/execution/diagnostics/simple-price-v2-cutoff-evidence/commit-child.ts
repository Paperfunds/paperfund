import { createDatabase } from '@paperfund/db';
import { CommitWitness } from './commit-witness.js';
export interface Job {
  url: string;
  token: string;
  id: string;
  phase: 'OBSERVED_ONLY' | 'COMMITTED_ONLY' | 'WITNESSED';
  clockOffsetMs?: number;
}
process.once('message', async (job: Job) => {
  const db = createDatabase(job.url);
  try {
    const probe = new CommitWitness(db, job.token);
    await probe.guard();
    if (job.phase === 'OBSERVED_ONLY') {
      process.send?.({ type: 'OBSERVED' });
      setInterval(() => {}, 1000);
      return;
    }
    const t = (
      await db.pool.query(
        "select clock_timestamp() t,clock_timestamp()+interval '10 seconds' cutoff",
      )
    ).rows[0];
    const client = await probe.begin(
      job.id,
      {
        label: 'DUMMY_STORAGE_ORDER_ONLY',
        claimedApplicationTimeMs: Date.now() + (job.clockOffsetMs ?? 0),
      },
      t.t,
      t.cutoff,
    );
    if (job.phase === 'COMMITTED_ONLY') {
      await client.query('commit');
    } else {
      await probe.commitAndWitness(client, job.id);
    }
    client.release();
    await db.close();
    process.exit(75);
  } catch {
    await db.close();
    process.exit(76);
  }
});
