import { createDatabase } from '@paperfund/db';
import { ExecutionRouter } from '@paperfund/execution';
import { IsolatedV2Adapter } from '../../integration/simple-price-v2-directional/adapter.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import { controlledReplay, solRecordings, REPLAY_POLICY } from './fixtures.js';
import { recoveryTick } from './worker.js';
import type { ReplayMode } from './worker.js';
export interface Job {
  url: string;
  token: string;
  directory: string;
  now: number;
  phase: 'PAUSE' | 'RUN' | 'CRASH_AFTER_TICK';
  mode: ReplayMode;
  missing?: boolean;
}
process.once('message', async (job: Job) => {
  const db = createDatabase(job.url);
  try {
    if (
      (await db.pool.query('select token from private_v2.isolation_guard')).rows[0]?.token !==
      job.token
    )
      throw Error('DISPOSABLE_GUARD_REQUIRED');
    const original = solRecordings()[0]!.evidence;
    const adapter = new IsolatedV2Adapter(
      db,
      job.token,
      REPLAY_POLICY,
      async () => {
        if (job.missing) throw Error('CONTROLLED_MISSING_EXIT_EVIDENCE');
        return controlledReplay(original, job.now);
      },
      new IsolatedHighWater(job.directory, REPLAY_POLICY),
      () => new Date(job.now),
    );
    const result = await recoveryTick(
      db,
      new ExecutionRouter([adapter]),
      new Date(job.now),
      REPLAY_POLICY,
      job.mode,
      job.token,
    );
    if (job.phase === 'PAUSE') {
      process.send?.({ type: 'READY', pid: process.pid, result });
      return;
    }
    if (job.phase === 'CRASH_AFTER_TICK') process.exit(75);
    process.send?.({ type: 'DONE', pid: process.pid, result });
    await db.close();
    process.disconnect?.();
  } catch (error) {
    process.send?.({
      type: 'ERROR',
      name: error instanceof Error ? error.name : 'Unknown',
      message:
        error instanceof Error
          ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[REDACTED]')
          : 'Unknown',
    });
    await db.close();
    process.exit(76);
  }
});
