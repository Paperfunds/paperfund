import pg from 'pg';
import { readSetting, hash, json, WALLET } from './common.mjs';
export async function withReadonlyDatabase(run, connectionString) {
  const url = connectionString || (await readSetting('DATABASE_URL'));
  if (!url) throw Error('DATABASE_NOT_CONFIGURED');
  const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    application_name: 'paperfund-local-operator-readonly',
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('begin isolation level repeatable read read only');
    const result = await run(client);
    await client.query('rollback');
    return result;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}
export async function databaseStatus(connectionString) {
  return withReadonlyDatabase(async (c) => {
    const tables = (
      await c.query("select tablename from pg_tables where schemaname='public'")
    ).rows.map((r) => r.tablename);
    const exists = (n) => tables.includes(n);
    const role = (await c.query('select rolsuper from pg_roles where rolname=current_user'))
      .rows[0];
    const rounds = (
      await c.query(
        'select id,state,starts_at,ends_at_exclusive from hourly_rounds order by starts_at desc limit 12',
      )
    ).rows;
    const days = (
      await c.query(
        'select id,state,utc_date from daily_competitions order by utc_date desc limit 3',
      )
    ).rows;
    const plans = (
      await c.query(
        'select id,competition_type,state,prize_pool_lamports::text,source_result_snapshot from payout_plans order by calculated_at desc limit 30',
      )
    ).rows;
    const totals = (
      await c.query(
        "select coalesce(sum(prize_pool_lamports) filter(where state<>'VERIFIED'),0)::text unpaid from payout_plans",
      )
    ).rows[0];
    const paid = exists('payout_treasury_settlements')
      ? (
          await c.query(
            'select coalesce(sum(principal),0)::text amount from payout_treasury_settlements',
          )
        ).rows[0].amount
      : null;
    const ownership = (
      await c.query(
        "select ((select coalesce(sum(final_hourly_prize_lamports),0) from hourly_reward_pools where status in ('FROZEN','FINAL'))+(select coalesce(sum(accumulated_lamports),0) from daily_reward_pools where status in ('FROZEN','FINAL'))+(select coalesce(sum(balance_lamports),0) from reward_buffer_state))::text amount",
      )
    ).rows[0].amount;
    const unpaidRewards = paid === null ? null : (BigInt(ownership) - BigInt(paid)).toString();
    const stops = exists('payout_stop_state')
      ? (
          await c.query(
            'select stopped,generation::text,reason from payout_stop_state where singleton=true',
          )
        ).rows[0]
      : null;
    const reservations = exists('payout_treasury_reservations')
      ? (
          await c.query(
            'select coalesce(sum(r.principal-coalesce(s.principal,0)),0)::text principal,coalesce(sum(case when coalesce(s.principal,0)=r.principal then 0 else r.fee_budget-coalesce(s.fee,0) end),0)::text fees from payout_treasury_reservations r left join (select plan_id,sum(principal) principal,sum(fee) fee from payout_treasury_settlements group by plan_id)s on s.plan_id=r.plan_id',
          )
        ).rows[0]
      : null;
    const receipts = exists('payout_treasury_receipts')
      ? (
          await c.query(
            'select kind,network,treasury,sum(lamports)::text lamports from payout_treasury_receipts group by kind,network,treasury',
          )
        ).rows
      : [];
    const received = receipts
      .filter(
        (r) => r.kind === 'CREATOR_FEE' && r.network === 'mainnet-beta' && r.treasury === WALLET,
      )
      .reduce((n, r) => n + BigInt(r.lamports), 0n);
    const reviews = exists('legacy_source_reviews')
      ? (
          await c.query(
            'select hourly_round_id,reason from legacy_source_reviews order by recorded_at desc limit 50',
          )
        ).rows
      : [];
    const holds = exists('payout_execution_holds')
      ? (await c.query('select count(*)::text count from payout_execution_holds')).rows[0]
      : null;
    return {
      healthy: true,
      roleRestriction: role.rolsuper
        ? 'SUPERUSER_READ_ONLY_SESSION_REQUIRES_RESTRICTED_DEPLOYMENT'
        : 'READ_ONLY_SESSION_ROLE_GRANTS_NOT_CERTIFIED',
      rounds,
      days,
      plans,
      unpaidPlanLamports: totals.unpaid,
      unpaidRewardsAndBufferLamports: unpaidRewards,
      reservedPrincipalLamports: reservations?.principal ?? null,
      reservedFeeLamports: reservations?.fees ?? null,
      verifiedReceivedCreatorFeeLamports: received.toString(),
      receipts,
      reservationCoverage: reservations
        ? 'PERSISTED_RESERVATIONS'
        : 'SECURITY_MIGRATIONS_NOT_DEPLOYED',
      remainingApprovedPayoutBudgetLamports: '0',
      stop: stops ?? { stopped: null, reason: 'STOP_AUTHORITY_NOT_DEPLOYED_EFFECTS_DISABLED' },
      reviews,
      holds,
      settlementQualification: 'UNQUALIFIED',
      providerQualification: 'UNQUALIFIED',
      clockQualification: 'UNQUALIFIED',
      safeToShutdownFinancialRuntime: false,
    };
  }, connectionString);
}
export async function reviewPlan(planId, connectionString) {
  if (typeof planId !== 'string' || planId.length < 1 || planId.length > 256)
    throw Error('INVALID_PLAN_ID');
  return withReadonlyDatabase(async (c) => {
    const plan = (await c.query('select * from payout_plans where id=$1', [planId])).rows[0];
    if (!plan) throw Error('PLAN_NOT_FOUND');
    const allocations = (
      await c.query(
        'select id,user_id,competitive_rank,allocated_lamports::text lamports from payout_allocations where payout_plan_id=$1 order by competitive_rank,user_id',
        [planId],
      )
    ).rows;
    const source = plan.source_result_snapshot;
    if (!Array.isArray(source)) throw Error('SOURCE_SNAPSHOT_INVALID');
    const pinned = allocations.map((a) => {
      const recipients = source.filter((s) => s.userId === a.user_id);
      if (recipients.length !== 1 || typeof recipients[0].walletAddress !== 'string')
        throw Error('PINNED_RECIPIENT_MISSING');
      return {
        allocationId: a.id,
        userId: a.user_id,
        rank: a.competitive_rank,
        recipient: recipients[0].walletAddress,
        lamports: a.lamports,
      };
    });
    // Review envelope only. Accepted approval runtime independently recomputes its stronger v2 hash.
    const review = {
      kind: 'READ_ONLY_REVIEW_NOT_AUTHORIZATION',
      planId,
      competitionType: plan.competition_type,
      state: plan.state,
      sourceId: plan.hourly_round_id ?? plan.daily_competition_id,
      curveVersion: plan.curve_version,
      sourceSnapshot: source,
      prizePoolLamports: plan.prize_pool_lamports,
      allocations: pinned,
      network: 'mainnet-beta',
      treasury: WALLET,
      authority: 'NONE',
      blockers: [
        'UTC_UNQUALIFIED',
        'PROVIDER_UNQUALIFIED',
        'NON_PAYING_CANDIDATE',
        'SECURITY_DEPLOYMENT_REQUIRED',
      ],
    };
    return { ...review, reviewHash: hash(json(review)) };
  }, connectionString);
}
