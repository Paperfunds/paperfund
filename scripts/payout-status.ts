import { parseEnvironment } from '@paperfund/config';
import { createDatabase, reconcilePayoutExecution, SolanaPayoutRpc } from '@paperfund/db';

const planId = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const reconcile = process.argv.includes('--reconcile');
if (!planId) {
  process.stderr.write('Usage: npm run payout:status -- <plan-id> [--reconcile]\n');
  process.exitCode = 2;
} else {
  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment.DATABASE_URL);
  try {
    const executionId = `execution:${planId}`;
    if (reconcile) {
      const rpc = new SolanaPayoutRpc(environment.SOLANA_RPC_URL, environment.SOLANA_COMMITMENT);
      await reconcilePayoutExecution(database, { executionId, rpc, now: new Date() });
    }
    const plan = (
      await database.pool.query(
        `select p.id,p.state,p.prize_pool_lamports::text,p.total_allocated_lamports::text,
                p.participant_count,p.actual_winner_count,p.approved_at,a.approver_identifier,
                p.broadcast_at,p.verified_at,
                (select count(*)::int from payout_allocations pa where pa.payout_plan_id=p.id) allocation_count
         from payout_plans p left join payout_plan_approvals a on a.payout_plan_id=p.id
         where p.id=$1`,
        [planId],
      )
    ).rows[0];
    if (!plan) throw new Error(`Payout plan ${planId} was not found.`);
    const execution =
      (
        await database.pool.query(
          `select e.id,e.state,e.network,e.treasury_address,e.total_payout_lamports::text,
                e.estimated_fee_lamports::text,e.broadcast_at,e.verified_at,e.failure_code,
                e.failure_detail,e.updated_at,
                (select count(*)::int from payout_batches b where b.payout_execution_id=e.id) batch_count
         from payout_executions e where e.payout_plan_id=$1`,
          [planId],
        )
      ).rows[0] ?? null;
    const batches = execution
      ? (
          await database.pool.query(
            `select b.batch_index,b.state,b.recipient_count,b.total_lamports::text,
                    b.transaction_signature,
                    (select count(*)::int from payout_broadcast_attempts a
                     where a.payout_batch_id=b.id) broadcast_attempt_count,
                    b.confirmation_slot::text,b.failure_code,b.failure_detail,
                    b.broadcast_at,b.verified_at,b.updated_at
             from payout_batches b where b.payout_execution_id=$1 order by b.batch_index`,
            [execution.id],
          )
        ).rows
      : [];
    process.stdout.write(`${JSON.stringify({ plan, execution, batches })}\n`);
  } finally {
    await database.close();
  }
}
