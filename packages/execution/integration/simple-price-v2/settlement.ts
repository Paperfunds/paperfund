import { settleHourlyRound } from '../../../db/src/financial-service.js';
import type { DatabaseService } from '../../../db/src/database.js';
import type { ExecutionRouter } from '@paperfund/execution';
import { withGenericActor } from '@paperfund/protocols';
/** Private three-pass fixture policy only; actual core liquidation/finalization is reused unchanged. */
export async function settlePrivate(
  db: DatabaseService,
  router: ExecutionRouter,
  round: string,
  now: Date,
) {
  const lock = await db.pool.connect();
  try {
    await lock.query(
      "select pg_advisory_lock(hashtextextended('private-v2-settlement:'||$1::text,0))",
      [round],
    );
    await lock.query(
      'insert into private_v2.settlement_control(round_id) values($1) on conflict do nothing',
      [round],
    );
    const control = (
      await lock.query<{ attempts: number; status: string; failures: unknown[] }>(
        'select * from private_v2.settlement_control where round_id=$1',
        [round],
      )
    ).rows[0]!;
    if (control.status === 'REVIEW_REQUIRED' || control.status === 'FINALIZED') return control;
    const result = await withGenericActor(
      { intent: 'READ', systemRead: true, isolateCaptures: true },
      () => settleHourlyRound(db, router, { hourlyRoundId: round, authoritativeTimestamp: now }),
    );
    const status =
      result.state === 'FINALIZED'
        ? 'FINALIZED'
        : control.attempts + 1 >= 3
          ? 'REVIEW_REQUIRED'
          : 'RETRY_PENDING';
    const failures = result.failures;
    await lock.query(
      'update private_v2.settlement_control set attempts=attempts+1,status=$2,failures=$3::jsonb where round_id=$1',
      [round, status, JSON.stringify(failures)],
    );
    return { attempts: control.attempts + 1, status, failures };
  } finally {
    await lock.query(
      "select pg_advisory_unlock(hashtextextended('private-v2-settlement:'||$1::text,0))",
      [round],
    );
    lock.release();
  }
}
