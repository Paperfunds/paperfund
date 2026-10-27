import type { PoolClient } from 'pg';
import type { DatabaseService } from './database.js';
import { PayoutPlanError } from './payout-service.js';

// One session, including every financial query, owns the lock through external awaits.
// try-lock avoids filling a pool with waiting lock owners and starving the owner.
export async function withPayoutOperation<T>(
  database: DatabaseService,
  planId: string,
  run: (scoped: DatabaseService) => Promise<T>,
): Promise<T> {
  const client = await database.pool.connect();
  const key = 'paperfund-payout-operation:' + planId;
  let locked = false;
  let failed = false;
  const onError = () => {
    failed = true;
  };
  client.on('error', onError);
  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1,0)) locked',
      [key],
    );
    if (!result.rows[0]?.locked)
      throw new PayoutPlanError(
        'PAYOUT_OPERATION_BUSY',
        'Another PostgreSQL session owns this payout operation; retry later.',
      );
    locked = true;
    const lease = { query: client.query.bind(client), release() {} } as unknown as PoolClient;
    const scoped = {
      ...database,
      pool: {
        query: client.query.bind(client),
        async connect() {
          return lease;
        },
      } as unknown as DatabaseService['pool'],
    };
    return await run(scoped);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (locked) {
      try {
        await client.query('rollback');
        await client.query('select pg_advisory_unlock(hashtextextended($1,0))', [key]);
      } catch {
        failed = true;
      }
    }
    // A failed/lost session is destroyed rather than returning an uncertain lock to the pool.
    client.release(failed);
    client.off('error', onError);
  }
}

export async function payoutPlanForExecution(database: DatabaseService, executionId: string) {
  const row = (
    await database.pool.query<{ payout_plan_id: string }>(
      'select payout_plan_id from payout_executions where id=$1',
      [executionId],
    )
  ).rows[0];
  if (!row) throw new PayoutPlanError('PAYOUT_EXECUTION_NOT_FOUND', 'Payout execution not found.');
  return row.payout_plan_id;
}

export async function recordPayoutEvent(
  database: DatabaseService,
  input: {
    executionId: string;
    batchId?: string;
    signature?: string;
    event: string;
    detail: unknown;
  },
) {
  await database.pool.query(
    `insert into payout_operation_events (payout_execution_id,payout_batch_id,transaction_signature,event,detail)
    values ($1,$2,$3,$4,$5)`,
    [
      input.executionId,
      input.batchId ?? null,
      input.signature ?? null,
      input.event,
      JSON.stringify(input.detail),
    ],
  );
}

export async function requireSerializedExecution(database: DatabaseService, executionId: string) {
  const row = (
    await database.pool.query<{ safety_version: string | null }>(
      'select safety_version from payout_executions where id=$1',
      [executionId],
    )
  ).rows[0];
  if (!row || row.safety_version !== 'payout-serialized-v1')
    throw new PayoutPlanError(
      'PAYOUT_EXECUTION_REVIEW_REQUIRED',
      'Existing unpaid execution predates durable signing evidence; review/migration is required.',
    );
}
