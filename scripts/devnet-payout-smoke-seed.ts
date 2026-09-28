import { config as loadDotenv } from 'dotenv';

import { parseEnvironment } from '@paperfund/config';
import { createDatabase, generateHourlyShadowPayoutPlan } from '@paperfund/db';

loadDotenv({ path: '.env', quiet: true });
const environment = parseEnvironment(process.env);
const databaseName = new URL(environment.DATABASE_URL).pathname.slice(1);
const recipients = (process.env.PHASE_5F_DEVNET_RECIPIENTS ?? '').split(',').filter(Boolean);
if (
  process.env.PHASE_5F_DEVNET_SMOKE_CONFIRM !== 'true' ||
  environment.PAYOUT_NETWORK !== 'devnet' ||
  !databaseName.startsWith('paperfund_p5f_devnet_') ||
  recipients.length !== 5
) {
  throw new Error(
    'Smoke seed requires explicit confirmation, devnet, an isolated paperfund_p5f_devnet_* database, and five recipients.',
  );
}

const database = createDatabase(environment.DATABASE_URL);
try {
  const prefix = `phase-5f-${Date.now().toString()}`;
  const roundId = `${prefix}-round`;
  const startsAt = new Date('2026-09-28T10:00:00.000Z');
  const endsAt = new Date('2026-09-28T11:00:00.000Z');
  await database.pool.query(
    `insert into hourly_rounds
     (id,starts_at,ends_at_exclusive,state,starting_paper_sol_lamports,max_unique_tokens,
      max_buy_ratio_bps,reward_finalization_grace_period_seconds,rules_version,finalized_at)
     values ($1,$2,$3,'FINALIZED',10000000000,5,2000,0,'phase-5f-smoke',$3)`,
    [roundId, startsAt, endsAt],
  );
  for (const [index, wallet] of recipients.entries()) {
    const userId = `${prefix}-user-${index + 1}`;
    const accountId = `${prefix}-account-${index + 1}`;
    const resultId = `${prefix}-result-${index + 1}`;
    const idempotencyId = `${prefix}-idempotency-${index + 1}`;
    const score = BigInt(5 - index) * 1_000_000n;
    await database.pool.query('insert into users (id,wallet_address) values ($1,$2)', [
      userId,
      wallet,
    ]);
    await database.pool.query(
      `insert into competition_accounts
       (id,user_id,hourly_round_id,starting_paper_sol_lamports,paper_sol_balance_lamports,
        realized_pnl_lamports)
       values ($1,$2,$3,10000000000,10000000000,0)`,
      [accountId, userId, roundId],
    );
    await database.pool.query(
      `update competition_accounts
       set paper_sol_balance_lamports=$2,final_settled_balance_lamports=$2,
           hourly_pnl_lamports=$3,finalized_at=$4 where id=$1`,
      [accountId, (10_000_000_000n + score).toString(), score.toString(), endsAt],
    );
    await database.pool.query(
      `insert into idempotency_records
       (id,operation_class,idempotency_key,request_hash,status,competition_account_id,
        result_entity_type,result_entity_id,completed_at)
       values ($1,'FINALIZE_HOURLY_RESULT',$1,'phase-5f','COMPLETED',$2,'HOURLY_RESULT',$3,$4)`,
      [idempotencyId, accountId, resultId, endsAt],
    );
    await database.pool.query(
      `insert into hourly_results
       (id,hourly_round_id,competition_account_id,user_id,final_settled_balance_lamports,
        starting_paper_sol_lamports,hourly_pnl_lamports,idempotency_record_id,finalized_at)
       values ($1,$2,$3,$4,$5,10000000000,$6,$7,$8)`,
      [
        resultId,
        roundId,
        accountId,
        userId,
        (10_000_000_000n + score).toString(),
        score.toString(),
        idempotencyId,
        endsAt,
      ],
    );
  }
  await database.pool.query(
    `insert into hourly_reward_pools
     (id,hourly_round_id,creator_fee_lamports,allocation_mode,natural_hourly_lamports,
      explicit_buffer_contribution_lamports,daily_allocation_lamports,platform_allocation_lamports,
      baseline_input_round_ids,baseline_window,lambda_bps,hourly_rate_bps,daily_rate_bps,
      buffer_rate_bps,platform_rate_bps,finalization_grace_seconds,dynamic_target_lamports,
      dynamic_buffer_deposit_lamports,dynamic_buffer_support_lamports,final_hourly_prize_lamports,
      starting_buffer_lamports,ending_buffer_lamports,configuration_version,status,finalized_at,frozen_at)
     values ($1,$2,5000000,'NORMAL',5000000,0,0,0,'[]',12,6000,6300,2700,0,1000,0,
             5000000,0,0,5000000,0,0,'phase-5f-smoke','FROZEN',$3,$3)`,
    [`${prefix}-reward`, roundId, endsAt],
  );
  const plan = await generateHourlyShadowPayoutPlan(database, {
    hourlyRoundId: roundId,
    now: new Date(),
  });
  process.stdout.write(`${plan.id}\n`);
} finally {
  await database.close();
}
