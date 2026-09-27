import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  carryZeroParticipantPoolToRewardBuffer,
  approvePayoutPlan,
  createDatabase,
  dryRunPayoutExecution,
  executeApprovedPayoutPlan,
  finalizeDailyRewardPool,
  generateDailyShadowPayoutPlan,
  generateHourlyShadowPayoutPlan,
  getPayoutPlanAudit,
  getUserRewardAllocations,
  retryPayoutExecution,
  validatePayoutPlan,
  type DatabaseService,
  type PayoutRpc,
  type PayoutSigner,
} from '../src/index.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p5c_${process.pid}_${Date.now()}`;
let database: DatabaseService;
let adminPool: Pool;

function mockPreparedTransaction(
  treasury: string,
  recipients: readonly { destination: string; lamports: bigint }[],
) {
  const recentBlockhash = Keypair.generate().publicKey.toBase58();
  const transaction = new Transaction({
    feePayer: new PublicKey(treasury),
    recentBlockhash,
  });
  for (const recipient of recipients)
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(treasury),
        toPubkey: new PublicKey(recipient.destination),
        lamports: recipient.lamports,
      }),
    );
  return {
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    recentBlockhash,
  };
}

async function addUsers(prefix: string, scores: readonly bigint[]) {
  const users = scores.map((score, index) => ({ id: `${prefix}-user-${index + 1}`, score }));
  for (const user of users) {
    await database.pool.query('insert into users (id,wallet_address) values ($1,$2)', [
      user.id,
      `${user.id}-wallet`,
    ]);
  }
  return users;
}

async function seedHourly(prefix: string, scores: readonly bigint[], prizePool: bigint) {
  const hour = Number(prefix.replace(/\D/g, '').slice(-2)) % 20;
  const startsAt = new Date(`2026-09-20T${hour.toString().padStart(2, '0')}:00:00.000Z`);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const roundId = `${prefix}-round`;
  await database.pool.query(
    `insert into hourly_rounds
     (id,starts_at,ends_at_exclusive,state,starting_paper_sol_lamports,max_unique_tokens,
      max_buy_ratio_bps,reward_finalization_grace_period_seconds,rules_version,finalized_at)
     values ($1,$2,$3,'FINALIZED',10000000000,5,2000,0,'test',$3)`,
    [roundId, startsAt, endsAt],
  );
  const users = await addUsers(prefix, scores);
  for (const [index, user] of users.entries()) {
    const accountId = `${prefix}-account-${index}`;
    const idemId = `${prefix}-idem-${index}`;
    const balance = 10_000_000_000n + user.score;
    await database.pool.query(
      `insert into competition_accounts
       (id,user_id,hourly_round_id,starting_paper_sol_lamports,paper_sol_balance_lamports,
        realized_pnl_lamports)
       values ($1,$2,$3,10000000000,10000000000,0)`,
      [accountId, user.id, roundId],
    );
    await database.pool.query(
      `update competition_accounts
       set paper_sol_balance_lamports=$2,final_settled_balance_lamports=$2,
           hourly_pnl_lamports=$3,finalized_at=$4 where id=$1`,
      [accountId, balance.toString(), user.score.toString(), endsAt],
    );
    await database.pool.query(
      `insert into idempotency_records
       (id,operation_class,idempotency_key,request_hash,status,competition_account_id,
        result_entity_type,result_entity_id,completed_at)
       values ($1,'FINALIZE_HOURLY_RESULT',$2,'hash','COMPLETED',$3,'HOURLY_RESULT',$4,$5)`,
      [idemId, idemId, accountId, `${prefix}-result-${index}`, endsAt],
    );
    await database.pool.query(
      `insert into hourly_results
       (id,hourly_round_id,competition_account_id,user_id,final_settled_balance_lamports,
        starting_paper_sol_lamports,hourly_pnl_lamports,idempotency_record_id,finalized_at)
       values ($1,$2,$3,$4,$5,10000000000,$6,$7,$8)`,
      [
        `${prefix}-result-${index}`,
        roundId,
        accountId,
        user.id,
        balance.toString(),
        user.score.toString(),
        idemId,
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
     values ($1,$2,$3,'NORMAL',$3,0,0,0,'[]',12,6000,6300,2700,0,1000,0,$3,0,0,$3,0,0,
             'test','FROZEN',$4,$4)`,
    [`${prefix}-reward`, roundId, prizePool.toString(), endsAt],
  );
  return { roundId, users };
}

async function seedDaily(prefix: string, scores: readonly bigint[], prizePool: bigint) {
  const dayNumber = (Number(prefix.replace(/\D/g, '').slice(-2)) % 20) + 1;
  const date = `2026-08-${dayNumber.toString().padStart(2, '0')}`;
  const startsAt = new Date(`${date}T00:00:00.000Z`);
  const endsAt = new Date(startsAt.getTime() + 86_400_000);
  const dailyId = `${prefix}-daily`;
  await database.pool.query(
    `insert into daily_competitions (id,utc_date,starts_at,ends_at_exclusive,state,finalized_at)
     values ($1,$2,$3,$4,'FINALIZED',$4)`,
    [dailyId, date, startsAt, endsAt],
  );
  const users = await addUsers(prefix, scores);
  for (const [index, user] of users.entries()) {
    await database.pool.query(
      `insert into daily_results
       (id,daily_competition_id,user_id,cumulative_pnl_lamports,completed_hourly_round_count)
       values ($1,$2,$3,$4,1)`,
      [`${prefix}-daily-result-${index}`, dailyId, user.id, user.score.toString()],
    );
  }
  await database.pool.query(
    `insert into daily_reward_pools
     (id,daily_competition_id,accumulated_lamports,status,finalized_at)
     values ($1,$2,$3,'FROZEN',$4)`,
    [`${prefix}-daily-reward`, dailyId, prizePool.toString(), endsAt],
  );
  return { dailyId, users };
}

async function seedApprovedHourly(prefix: string, scores: readonly bigint[], prizePool: bigint) {
  const source = await seedHourly(prefix, scores, prizePool);
  const wallets = source.users.map(() => Keypair.generate().publicKey.toBase58());
  for (const [index, user] of source.users.entries())
    await database.pool.query('update users set wallet_address=$2 where id=$1', [
      user.id,
      wallets[index],
    ]);
  const plan = await generateHourlyShadowPayoutPlan(database, {
    hourlyRoundId: source.roundId,
    now: new Date(),
  });
  await approvePayoutPlan(database, {
    planId: plan.id,
    approverIdentifier: 'test-operator',
    now: new Date(),
  });
  return { source, plan, wallets };
}

describe('Phase 5C shadow payout persistence', () => {
  beforeAll(async () => {
    if (!sourceDatabaseUrl)
      throw new Error('DATABASE_URL is required for payout integration tests.');
    const admin = new URL(sourceDatabaseUrl);
    admin.pathname = '/postgres';
    const test = new URL(sourceDatabaseUrl);
    test.pathname = `/${databaseName}`;
    adminPool = new Pool({ connectionString: admin.toString() });
    await adminPool.query(`create database "${databaseName}"`);
    database = createDatabase(test.toString());
    await migrate(database.client, {
      migrationsFolder: resolve(process.cwd(), 'packages/db/migrations'),
    });
  }, 30_000);

  afterAll(async () => {
    if (database) await database.close();
    if (adminPool) {
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.end();
    }
  });

  it('persists an exact cutoff-crossing hourly tie with complete audit evidence', async () => {
    const source = await seedHourly(
      'hour-01',
      [100n, 90n, 80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n, 10n, 0n],
      1_000_003n,
    );
    const plan = await generateHourlyShadowPayoutPlan(database, {
      hourlyRoundId: source.roundId,
      now: new Date('2026-09-21T00:00:00.000Z'),
    });
    expect(plan.state).toBe('VALIDATED');
    expect(plan.curveVersion).toBe('hourly-top10-v1');
    expect(plan.tiePolicyVersion).toBe('combined-funded-ordinals-v1');
    expect(plan.actualWinnerCount).toBe(11);
    const cutoff = plan.allocations.filter((row) => row.competitiveRank === 10);
    expect(cutoff).toHaveLength(2);
    expect(cutoff.reduce((sum, row) => sum + row.allocatedLamports, 0n)).toBe(
      plan.rankBuckets[9]!.finalAllocationLamports,
    );
    expect(plan.allocations.reduce((sum, row) => sum + row.allocatedLamports, 0n)).toBe(1_000_003n);
    await expect(validatePayoutPlan(database, plan.id)).resolves.toMatchObject({ valid: true });
    await expect(getUserRewardAllocations(database, source.users[11]!.id)).resolves.toEqual([
      expect.objectContaining({
        competitiveRank: 12,
        won: false,
        rewardAllocationLamports: 0n,
        status: 'NOT_A_WINNER',
      }),
    ]);
  });

  it('renormalizes an underfilled daily field and pays negative-score winners', async () => {
    const source = await seedDaily('day-02', [-1n, -2n, -3n, -4n, -5n, -6n, -7n], 7_777n);
    const plan = await generateDailyShadowPayoutPlan(database, {
      dailyCompetitionId: source.dailyId,
      now: new Date('2026-09-21T00:00:00.000Z'),
    });
    expect(plan.allocations).toHaveLength(7);
    expect(plan.allocations.reduce((sum, row) => sum + row.allocatedLamports, 0n)).toBe(7_777n);
    expect(plan.configSnapshot['occupiedWeightPpm']).toBe('684740');
  });

  it('is idempotent and concurrency-safe', async () => {
    const source = await seedHourly('hour-03', [3n, 2n, 1n], 999n);
    const [left, right] = await Promise.all([
      generateHourlyShadowPayoutPlan(database, { hourlyRoundId: source.roundId, now: new Date() }),
      generateHourlyShadowPayoutPlan(database, { hourlyRoundId: source.roundId, now: new Date() }),
    ]);
    expect(left).toEqual(right);
    const count = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payout_plans where hourly_round_id=$1',
      [source.roundId],
    );
    expect(count.rows[0]!.count).toBe('1');
  });

  it('keeps frozen details immutable and returns the same plan on retry', async () => {
    const source = await seedDaily('day-04', [2n, 1n], 101n);
    const first = await generateDailyShadowPayoutPlan(database, {
      dailyCompetitionId: source.dailyId,
      now: new Date(),
    });
    await expect(
      database.pool.query(
        'update payout_allocations set allocated_lamports=allocated_lamports+1 where payout_plan_id=$1',
        [first.id],
      ),
    ).rejects.toThrow(/immutable/);
    const retry = await generateDailyShadowPayoutPlan(database, {
      dailyCompetitionId: source.dailyId,
      now: new Date(Date.now() + 1_000),
    });
    expect(retry).toEqual(first);
  });

  it('validator detects authoritative source drift and daily freeze is idempotent', async () => {
    const source = await seedDaily('day-05', [3n, 2n, 1n], 333n);
    const plan = await generateDailyShadowPayoutPlan(database, {
      dailyCompetitionId: source.dailyId,
      now: new Date(),
    });
    await database.pool.query('update daily_results set cumulative_pnl_lamports=99 where id=$1', [
      'day-05-daily-result-2',
    ]);
    const validation = await validatePayoutPlan(database, plan.id);
    expect(validation.valid).toBe(false);
    expect(validation.checks.ranksAndTiesMatch).toBe(false);

    const emptyDate = '2026-08-20';
    await database.pool.query(
      `insert into daily_competitions (id,utc_date,starts_at,ends_at_exclusive,state,finalized_at)
       values ('empty-daily',$1,$2,$3,'FINALIZED',$3)`,
      [emptyDate, new Date(`${emptyDate}T00:00:00.000Z`), new Date('2026-08-21T00:00:00.000Z')],
    );
    const first = await finalizeDailyRewardPool(database, {
      dailyCompetitionId: 'empty-daily',
      now: new Date('2026-08-21T00:01:00.000Z'),
    });
    const second = await finalizeDailyRewardPool(database, {
      dailyCompetitionId: 'empty-daily',
      now: new Date('2026-08-21T00:02:00.000Z'),
    });
    expect(first.accumulatedLamports).toBe(0n);
    expect(second).toEqual(first);
  });

  it('exposes the persisted audit model without unexplained lamports', async () => {
    const source = await seedHourly('hour-06', [9n, 8n, 8n], 17n);
    const generated = await generateHourlyShadowPayoutPlan(database, {
      hourlyRoundId: source.roundId,
      now: new Date(),
    });
    const audit = await getPayoutPlanAudit(database, generated.id);
    expect(audit?.sourceLeaderboard).toHaveLength(3);
    expect(audit?.rankBuckets.reduce((sum, row) => sum + row.finalAllocationLamports, 0n)).toBe(
      17n,
    );
    expect(audit?.allocations.reduce((sum, row) => sum + row.allocatedLamports, 0n)).toBe(17n);
    expect(audit?.conservation).toEqual({
      totalAllocatedLamports: 17n,
      prizePoolLamports: 17n,
      holds: true,
    });
  });

  it('carries zero-participant hourly and daily prizes into the Reward Buffer exactly once', async () => {
    const hourly = await seedHourly('hour-07', [], 700n);
    const daily = await seedDaily('day-08', [], 800n);
    const now = new Date('2026-09-22T00:00:00.000Z');
    await expect(
      carryZeroParticipantPoolToRewardBuffer(database, {
        competitionType: 'HOURLY',
        sourceId: hourly.roundId,
        now,
      }),
    ).resolves.toMatchObject({ carriedLamports: 700n, created: true });
    await expect(
      carryZeroParticipantPoolToRewardBuffer(database, {
        competitionType: 'HOURLY',
        sourceId: hourly.roundId,
        now,
      }),
    ).resolves.toMatchObject({ carriedLamports: 700n, created: false });
    await expect(
      carryZeroParticipantPoolToRewardBuffer(database, {
        competitionType: 'DAILY',
        sourceId: daily.dailyId,
        now,
      }),
    ).resolves.toMatchObject({ carriedLamports: 800n, created: true });
    const buffer = await database.pool.query<{ balance: string }>(
      `select balance_lamports::text balance from reward_buffer_state where id='PRIMARY'`,
    );
    expect(buffer.rows[0]!.balance).toBe('1500');
    const plans = await database.pool.query<{ count: string }>(
      `select count(*)::text count from payout_plans
       where hourly_round_id=$1 or daily_competition_id=$2`,
      [hourly.roundId, daily.dailyId],
    );
    expect(plans.rows[0]!.count).toBe('0');
  });

  it('requires approval, dry-runs without signing, batches, and marks only verified transfers paid', async () => {
    const source = await seedHourly('hour-09', [3n, 2n, 1n], 999n);
    const wallets = source.users.map(() => Keypair.generate().publicKey.toBase58());
    for (const [index, user] of source.users.entries())
      await database.pool.query('update users set wallet_address=$2 where id=$1', [
        user.id,
        wallets[index],
      ]);
    const plan = await generateHourlyShadowPayoutPlan(database, {
      hourlyRoundId: source.roundId,
      now: new Date(),
    });
    const treasury = Keypair.generate().publicKey.toBase58();
    const prepared = new Map<number, readonly { destination: string; lamports: bigint }[]>();
    const preparedIds = new Map<string, number>();
    let prepareCount = 0;
    let sendCount = 0;
    let signCount = 0;
    const broadcast = new Set<string>();
    const rpc: PayoutRpc = {
      async assertNetwork() {},
      async getBalance() {
        return 10_000n;
      },
      async prepareTransaction(treasuryAddress, recipients) {
        const id = ++prepareCount;
        prepared.set(id, recipients);
        const transaction = mockPreparedTransaction(treasuryAddress, recipients);
        preparedIds.set(Buffer.from(transaction.unsignedTransaction).toString('base64'), id);
        return {
          unsignedTransaction: transaction.unsignedTransaction,
          feeLamports: 5n,
          recentBlockhash: transaction.recentBlockhash,
          lastValidBlockHeight: 100n,
        };
      },
      async sendSignedTransaction(bytes) {
        sendCount += 1;
        const signature = `sig-${bytes[0]}`;
        broadcast.add(signature);
        if (sendCount === 1) throw new Error('simulated response loss after acceptance');
        return signature;
      },
      async getBlockHeight() {
        return 50n;
      },
      async getSignatureStatus(signature) {
        return broadcast.has(signature)
          ? { confirmationStatus: 'finalized', error: null, slot: 42n }
          : null;
      },
      async getFinalizedTransfers(signature) {
        const id = Number(signature.slice(4));
        return {
          error: null,
          slot: 42n,
          transfers: (prepared.get(id) ?? []).map((recipient) => ({
            source: treasury,
            ...recipient,
          })),
        };
      },
    };
    const signer: PayoutSigner = {
      type: 'MOCK',
      publicKey: treasury,
      async signTransaction(bytes) {
        signCount += 1;
        const id = preparedIds.get(Buffer.from(bytes).toString('base64'))!;
        return {
          signedTransaction: Uint8Array.from([id, 99]),
          signature: `sig-${id}`,
        };
      },
    };
    const config = {
      enabled: true,
      network: 'localnet' as const,
      mainnetConfirmed: false,
      treasuryAddress: treasury,
      maxRecipientsPerBatch: 1,
    };
    await expect(
      dryRunPayoutExecution(database, { planId: plan.id, config, rpc }),
    ).rejects.toMatchObject({
      code: 'PAYOUT_PLAN_NOT_APPROVED',
    });
    await approvePayoutPlan(database, {
      planId: plan.id,
      approverIdentifier: 'test-operator',
      now: new Date(),
    });
    const preview = await dryRunPayoutExecution(database, { planId: plan.id, config, rpc });
    expect(preview.batches).toHaveLength(3);
    expect(preview.requiredLamports).toBe(1_014n);
    expect(signCount).toBe(0);
    expect(sendCount).toBe(0);
    const executed = await executeApprovedPayoutPlan(database, {
      planId: plan.id,
      config,
      rpc,
      signer,
      now: new Date(),
    });
    expect(executed.state).toBe('VERIFIED');
    expect(signCount).toBe(3);
    expect(sendCount).toBe(3);
    await executeApprovedPayoutPlan(database, {
      planId: plan.id,
      config,
      rpc,
      signer,
      now: new Date(),
    });
    expect(signCount).toBe(3);
    expect(sendCount).toBe(3);
    await expect(
      executeApprovedPayoutPlan(database, {
        planId: plan.id,
        config: { ...config, enabled: false },
        rpc,
        signer,
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'PAYOUT_EXECUTION_DISABLED' });
    await expect(getUserRewardAllocations(database, source.users[0]!.id)).resolves.toEqual([
      expect.objectContaining({ status: 'PAID', payoutPlanState: 'VERIFIED' }),
    ]);
  });

  it('fails before signing when the treasury cannot cover payouts plus fees', async () => {
    const source = await seedHourly('hour-10', [1n], 500n);
    const wallet = Keypair.generate().publicKey.toBase58();
    await database.pool.query('update users set wallet_address=$2 where id=$1', [
      source.users[0]!.id,
      wallet,
    ]);
    const plan = await generateHourlyShadowPayoutPlan(database, {
      hourlyRoundId: source.roundId,
      now: new Date(),
    });
    await approvePayoutPlan(database, {
      planId: plan.id,
      approverIdentifier: 'test-operator',
      now: new Date(),
    });
    const treasury = Keypair.generate().publicKey.toBase58();
    let signCount = 0;
    const signer: PayoutSigner = {
      type: 'MOCK',
      publicKey: treasury,
      async signTransaction() {
        signCount += 1;
        return { signedTransaction: new Uint8Array(), signature: 'unused' };
      },
    };
    const rpc: PayoutRpc = {
      async assertNetwork() {},
      async getBalance() {
        return 504n;
      },
      async prepareTransaction(treasuryAddress, recipients) {
        const transaction = mockPreparedTransaction(treasuryAddress, recipients);
        return {
          unsignedTransaction: transaction.unsignedTransaction,
          feeLamports: 5n,
          recentBlockhash: transaction.recentBlockhash,
          lastValidBlockHeight: 100n,
        };
      },
      async sendSignedTransaction() {
        throw new Error('must not broadcast');
      },
      async getBlockHeight() {
        return 0n;
      },
      async getSignatureStatus() {
        return null;
      },
      async getFinalizedTransfers() {
        return null;
      },
    };
    await expect(
      executeApprovedPayoutPlan(database, {
        planId: plan.id,
        config: {
          enabled: true,
          network: 'localnet',
          mainnetConfirmed: false,
          treasuryAddress: treasury,
          maxRecipientsPerBatch: 8,
        },
        rpc,
        signer,
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'PAYOUT_TREASURY_INSUFFICIENT' });
    expect(signCount).toBe(0);
    const executions = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payout_executions where payout_plan_id=$1',
      [plan.id],
    );
    expect(executions.rows[0]!.count).toBe('0');
  });

  it('requires reconciliation instead of marking a mismatched on-chain transfer paid', async () => {
    const { plan } = await seedApprovedHourly('hour-11', [1n], 100n);
    const treasury = Keypair.generate().publicKey.toBase58();
    let broadcast = false;
    const rpc: PayoutRpc = {
      async assertNetwork() {},
      async getBalance() {
        return 1_000n;
      },
      async prepareTransaction(treasuryAddress, recipients) {
        const transaction = mockPreparedTransaction(treasuryAddress, recipients);
        return {
          unsignedTransaction: transaction.unsignedTransaction,
          feeLamports: 5n,
          recentBlockhash: transaction.recentBlockhash,
          lastValidBlockHeight: 100n,
        };
      },
      async sendSignedTransaction() {
        broadcast = true;
        return 'sig-mismatch';
      },
      async getBlockHeight() {
        return 1n;
      },
      async getSignatureStatus() {
        return broadcast ? { confirmationStatus: 'finalized', error: null, slot: 50n } : null;
      },
      async getFinalizedTransfers() {
        return {
          error: null,
          slot: 50n,
          transfers: [
            {
              source: treasury,
              destination: Keypair.generate().publicKey.toBase58(),
              lamports: 100n,
            },
          ],
        };
      },
    };
    const signer: PayoutSigner = {
      type: 'MOCK',
      publicKey: treasury,
      async signTransaction() {
        return { signedTransaction: Uint8Array.from([1]), signature: 'sig-mismatch' };
      },
    };
    const result = await executeApprovedPayoutPlan(database, {
      planId: plan.id,
      config: {
        enabled: true,
        network: 'localnet',
        mainnetConfirmed: false,
        treasuryAddress: treasury,
        maxRecipientsPerBatch: 8,
      },
      rpc,
      signer,
      now: new Date(),
    });
    expect(result.state).toBe('RECONCILIATION_REQUIRED');
    expect((await getPayoutPlanAudit(database, plan.id))!.state).toBe('RECONCILIATION_REQUIRED');
  });

  it('preserves a verified batch while rebuilding only a proven-expired batch', async () => {
    const { plan } = await seedApprovedHourly('hour-12', [2n, 1n], 300n);
    const treasury = Keypair.generate().publicKey.toBase58();
    const recipients = new Map<number, readonly { destination: string; lamports: bigint }[]>();
    const preparedIds = new Map<string, number>();
    const sends = new Map<string, number>();
    let prepareId = 0;
    const rpc: PayoutRpc = {
      async assertNetwork() {},
      async getBalance() {
        return 10_000n;
      },
      async prepareTransaction(treasuryAddress, rows) {
        const id = ++prepareId;
        recipients.set(id, rows);
        const transaction = mockPreparedTransaction(treasuryAddress, rows);
        preparedIds.set(Buffer.from(transaction.unsignedTransaction).toString('base64'), id);
        return {
          unsignedTransaction: transaction.unsignedTransaction,
          feeLamports: 5n,
          recentBlockhash: transaction.recentBlockhash,
          lastValidBlockHeight: 100n,
        };
      },
      async sendSignedTransaction(bytes) {
        const signature = `sig-${bytes[0]}`;
        sends.set(signature, (sends.get(signature) ?? 0) + 1);
        return signature;
      },
      async getBlockHeight() {
        return 101n;
      },
      async getSignatureStatus(signature) {
        return (signature === 'sig-1' || signature === 'sig-3') && sends.has(signature)
          ? { confirmationStatus: 'finalized', error: null, slot: 60n }
          : null;
      },
      async getFinalizedTransfers(signature) {
        const id = Number(signature.slice(4));
        return {
          error: null,
          slot: 60n,
          transfers: (recipients.get(id) ?? []).map((row) => ({ source: treasury, ...row })),
        };
      },
    };
    const signer: PayoutSigner = {
      type: 'MOCK',
      publicKey: treasury,
      async signTransaction(bytes) {
        const id = preparedIds.get(Buffer.from(bytes).toString('base64'))!;
        return { signedTransaction: Uint8Array.from([id]), signature: `sig-${id}` };
      },
    };
    const config = {
      enabled: true,
      network: 'localnet' as const,
      mainnetConfirmed: false,
      treasuryAddress: treasury,
      maxRecipientsPerBatch: 1,
    };
    const partial = await executeApprovedPayoutPlan(database, {
      planId: plan.id,
      config,
      rpc,
      signer,
      now: new Date(),
    });
    expect(partial.state).toBe('FAILED_RETRYABLE');
    expect(partial.batchStates.sort()).toEqual(['FAILED_RETRYABLE', 'VERIFIED']);
    const retried = await retryPayoutExecution(database, {
      executionId: `execution:${plan.id}`,
      config,
      rpc,
      signer,
      now: new Date(),
    });
    expect(retried.state).toBe('VERIFIED');
    expect(sends.get('sig-1')).toBe(1);
    expect(sends.get('sig-2')).toBe(1);
    expect(sends.get('sig-3')).toBe(1);
  });
});
