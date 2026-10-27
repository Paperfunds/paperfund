import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { PoolClient } from 'pg';
import { buildPayoutBatches } from '@paperfund/core';
import type { PayoutNetwork } from '@paperfund/core';
import type { DatabaseService } from './database.js';
import { getPayoutPlanAudit, PayoutPlanError } from './payout-service.js';

export const APPROVAL_SNAPSHOT_VERSION = 'paperfund-approved-payout-v2';
type Audit = NonNullable<Awaited<ReturnType<typeof getPayoutPlanAudit>>>;

// Key order is explicit and independent of PostgreSQL jsonb object ordering.
export function canonicalApprovalJson(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (typeof input === 'bigint') return input.toString();
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      );
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean' ||
      (typeof input === 'number' && Number.isSafeInteger(input))
    )
      return input;
    throw new PayoutPlanError('PAYOUT_APPROVAL_EVIDENCE_INVALID', 'Unsupported approval value.');
  }
  return JSON.stringify(normalize(value));
}

export function approvalSnapshotHash(snapshot: unknown): string {
  return createHash('sha256').update(canonicalApprovalJson(snapshot)).digest('hex');
}

export function transactionDatabase(
  database: DatabaseService,
  client: PoolClient,
): DatabaseService {
  return {
    ...database,
    pool: {
      query: client.query.bind(client),
    } as unknown as DatabaseService['pool'],
  };
}

export async function captureApprovalSnapshot(database: DatabaseService, audit: Audit) {
  const allocationRows = (
    await database.pool.query<{
      id: string;
      user_id: string;
      lamports: string;
      detail: string;
    }>(
      `select id,user_id,allocated_lamports::text lamports,to_jsonb(a)::text detail
      from payout_allocations a where payout_plan_id=$1 order by competitive_rank,user_id`,
      [audit.id],
    )
  ).rows;
  if (allocationRows.length !== audit.allocations.length)
    throw new PayoutPlanError(
      'PAYOUT_APPROVAL_EVIDENCE_INVALID',
      'Allocation set is inconsistent.',
    );
  const allocations = allocationRows.map((row, index) => {
    const allocation = audit.allocations[index]!;
    const source = audit.sourceLeaderboard.filter((item) => item['userId'] === row.user_id);
    if (
      source.length !== 1 ||
      typeof source[0]!['walletAddress'] !== 'string' ||
      allocation.userId !== row.user_id ||
      allocation.allocatedLamports.toString() !== row.lamports
    )
      throw new PayoutPlanError(
        'PAYOUT_APPROVAL_EVIDENCE_INVALID',
        'Allocation/source identity is inconsistent.',
      );
    const destination = source[0]!['walletAddress'] as string;
    try {
      if (new PublicKey(destination).toBase58() !== destination) throw new Error();
    } catch {
      throw new PayoutPlanError(
        'PAYOUT_APPROVAL_EVIDENCE_INVALID',
        'Approved destination is invalid.',
      );
    }
    return {
      allocationId: row.id,
      userId: row.user_id,
      destination,
      lamports: row.lamports,
      detail: row.detail,
    };
  });
  const hourly = audit.competitionType === 'HOURLY';
  const sourceId = audit.hourlyRoundId ?? audit.dailyCompetitionId;
  const authority = (
    await database.pool.query<{
      source_state: string;
      pool_state: string;
      pool_lamports: string;
      pool: string;
    }>(
      hourly
        ? `select r.state source_state,p.status pool_state,p.final_hourly_prize_lamports::text pool_lamports,
        to_jsonb(p)::text pool from hourly_rounds r join hourly_reward_pools p on p.hourly_round_id=r.id where r.id=$1`
        : `select d.state source_state,p.status pool_state,p.accumulated_lamports::text pool_lamports,
        to_jsonb(p)::text pool from daily_competitions d join daily_reward_pools p on p.daily_competition_id=d.id where d.id=$1`,
      [sourceId],
    )
  ).rows[0];
  if (
    !authority ||
    authority.source_state !== 'FINALIZED' ||
    !['FROZEN', 'FINAL'].includes(authority.pool_state) ||
    authority.pool_lamports !== audit.prizePoolLamports.toString()
  )
    throw new PayoutPlanError(
      'PAYOUT_APPROVAL_SOURCE_INVALID',
      'Approved source and funding must remain finalized and consistent.',
    );
  const results = (
    await database.pool.query<{ detail: string }>(
      hourly
        ? `select to_jsonb(r)::text detail from hourly_results r where hourly_round_id=$1 order by id`
        : `select to_jsonb(r)::text detail from daily_results r where daily_competition_id=$1 order by id`,
      [sourceId],
    )
  ).rows.map((row) => row.detail);
  const funding = (
    await database.pool.query<{ detail: string }>(
      hourly
        ? `select to_jsonb(e)::text detail from creator_fee_events e where hourly_round_id=$1 and accounting_status='COUNTED' order by id`
        : `select to_jsonb(c)::text || '|' || to_jsonb(p)::text detail from daily_reward_contributions c
        join hourly_reward_pools p on p.id=c.hourly_reward_pool_id
        where c.daily_reward_pool_id=(select id from daily_reward_pools where daily_competition_id=$1) order by c.id`,
      [sourceId],
    )
  ).rows.map((row) => row.detail);
  const dailyFees = hourly
    ? []
    : (
        await database.pool.query<{ detail: string }>(
          `select to_jsonb(e)::text detail from creator_fee_events e
     join hourly_reward_pools p on p.hourly_round_id=e.hourly_round_id
     join daily_reward_contributions c on c.hourly_reward_pool_id=p.id
     join daily_reward_pools d on d.id=c.daily_reward_pool_id
     where d.daily_competition_id=$1 and e.accounting_status='COUNTED' order by e.id`,
          [sourceId],
        )
      ).rows.map((row) => row.detail);
  return {
    version: APPROVAL_SNAPSHOT_VERSION,
    plan: {
      id: audit.id,
      competitionType: audit.competitionType,
      sourceId,
      prizePoolLamports: audit.prizePoolLamports.toString(),
      curveVersion: audit.curveVersion,
      tiePolicyVersion: audit.tiePolicyVersion,
      participantCount: audit.participantCount,
      nominalWinnerCount: audit.nominalWinnerCount,
      actualWinnerCount: audit.actualWinnerCount,
      calculatedAt: audit.calculatedAt,
      frozenAt: audit.frozenAt,
      validatedAt: audit.validatedAt,
      configSnapshot: audit.configSnapshot,
      sourceLeaderboard: audit.sourceLeaderboard,
      rankBuckets: audit.rankBuckets,
      conservation: audit.conservation,
      allocations: audit.allocations.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'walletAddress')),
      ),
    },
    allocations,
    authority,
    results,
    funding,
    dailyFees,
  };
}

export async function assertApprovalBinding(database: DatabaseService, planId: string) {
  const client = await database.pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const scoped = transactionDatabase(database, client);
    const evidence = (
      await client.query<{
        approval_method: string;
        approver_identifier: string;
        plan_snapshot_hash: string;
        snapshot_version: string | null;
        snapshot: unknown;
        times_match: boolean;
      }>(
        `select a.approval_method,a.approver_identifier,a.plan_snapshot_hash,s.snapshot_version,s.snapshot,
        a.approved_at=p.approved_at times_match from payout_plans p
        join payout_plan_approvals a on a.payout_plan_id=p.id
        left join payout_approval_snapshots s on s.approval_id=a.id where p.id=$1`,
        [planId],
      )
    ).rows[0];
    if (!evidence)
      throw new PayoutPlanError(
        'PAYOUT_APPROVAL_MISSING',
        'Persisted approval evidence is required.',
      );
    if (evidence.snapshot_version === null)
      throw new PayoutPlanError(
        'PAYOUT_REAPPROVAL_REQUIRED',
        'Legacy approval has no immutable v2 evidence; explicit reviewed migration/reapproval is required.',
      );
    if (
      evidence.snapshot_version !== APPROVAL_SNAPSHOT_VERSION ||
      evidence.approval_method !== 'OPERATOR_CLI' ||
      !evidence.approver_identifier.trim() ||
      !evidence.times_match
    )
      throw new PayoutPlanError(
        'PAYOUT_APPROVAL_EVIDENCE_INVALID',
        'Unsupported or contradictory approval evidence.',
      );
    if (approvalSnapshotHash(evidence.snapshot) !== evidence.plan_snapshot_hash)
      throw new PayoutPlanError(
        'PAYOUT_APPROVAL_HASH_MISMATCH',
        'Stored approval snapshot does not match its hash.',
      );
    const audit = await getPayoutPlanAudit(scoped, planId);
    if (!audit || !['APPROVED', 'SIGNED', 'BROADCAST', 'FAILED_RETRYABLE'].includes(audit.state))
      throw new PayoutPlanError(
        'PAYOUT_PLAN_NOT_APPROVED',
        'Plan is not authorized to create a payment.',
      );
    const snapshot = await captureApprovalSnapshot(scoped, audit);
    if (approvalSnapshotHash(snapshot) !== evidence.plan_snapshot_hash)
      throw new PayoutPlanError(
        'PAYOUT_APPROVAL_SNAPSHOT_MISMATCH',
        'Current payout authority differs from the approved immutable snapshot.',
      );
    await client.query('commit');
    return snapshot;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function assertExecutionBinding(database: DatabaseService, executionId: string) {
  return bindExecution(database, executionId, false);
}

// Observation uses recorded immutable authority, not permission to initiate a new payment.
// No transactions, locks, writes, funding observations, reservations or current-role checks here.
export async function assertObservedExecutionBinding(
  database: DatabaseService,
  executionId: string,
) {
  return bindExecution(database, executionId, true);
}

async function observedApproval(database: DatabaseService, planId: string) {
  type Snapshot = Awaited<ReturnType<typeof captureApprovalSnapshot>>;
  const row = (
    await database.pool.query<{
      snapshot: Snapshot;
      snapshot_version: string;
      plan_snapshot_hash: string;
      approval_method: string;
      approver_identifier: string;
      times_match: boolean;
      subject: string;
      signed_request: { version: string; action: string; planId: string; snapshotHash: string };
      admitted_request: unknown;
      approval_hash: string;
      source_key: string;
      principal: string;
      recipients: unknown;
      network: PayoutNetwork;
      treasury: string;
    }>(
      `select s.snapshot,s.snapshot_version,a.plan_snapshot_hash,a.approval_method,a.approver_identifier,
       a.approved_at=p.approved_at times_match,u.subject,u.signed_request,n.signed_request admitted_request,
       r.approval_hash,r.source_key,r.principal::text,r.recipients,r.network,r.treasury
     from payout_plans p join payout_plan_approvals a on a.payout_plan_id=p.id
     join payout_approval_snapshots s on s.approval_id=a.id
     join payout_approval_authorizations u on u.approval_id=a.id
     join payout_authority_nonces n on n.issuer=u.signed_request->>'issuer'
       and n.nonce=u.signed_request->>'nonce' and n.action='APPROVE'
       and n.plan_id=p.id and n.snapshot_hash=a.plan_snapshot_hash
     join payout_treasury_reservations r on r.plan_id=p.id where p.id=$1`,
      [planId],
    )
  ).rows[0];
  if (!row)
    throw new PayoutPlanError(
      'PAYOUT_OBSERVATION_REVIEW_REQUIRED',
      'Recorded approval/reservation evidence is required; no history was upgraded.',
    );
  const snapshot = row.snapshot;
  if (
    row.snapshot_version !== APPROVAL_SNAPSHOT_VERSION ||
    !snapshot ||
    snapshot.version !== APPROVAL_SNAPSHOT_VERSION ||
    snapshot.plan?.id !== planId ||
    !Array.isArray(snapshot.allocations) ||
    row.approval_method !== 'OPERATOR_CLI' ||
    !row.times_match ||
    !row.approver_identifier.trim() ||
    approvalSnapshotHash(snapshot) !== row.plan_snapshot_hash ||
    row.approval_hash !== row.plan_snapshot_hash ||
    row.subject !== row.approver_identifier ||
    canonicalApprovalJson(row.admitted_request) !== canonicalApprovalJson(row.signed_request) ||
    row.signed_request?.version !== 'paperfund-payout-authority-v1' ||
    row.signed_request.action !== 'APPROVE' ||
    row.signed_request.planId !== planId ||
    row.signed_request.snapshotHash !== row.plan_snapshot_hash
  )
    throw new PayoutPlanError(
      'PAYOUT_OBSERVATION_EVIDENCE_MISMATCH',
      'Recorded approval evidence is contradictory.',
    );
  const positive = snapshot.allocations.filter((a) => BigInt(a.lamports) > 0n);
  if (
    row.source_key !== snapshot.plan.competitionType + ':' + snapshot.plan.sourceId ||
    row.principal !== positive.reduce((n, a) => n + BigInt(a.lamports), 0n).toString() ||
    canonicalApprovalJson(row.recipients) !== canonicalApprovalJson(positive)
  )
    throw new PayoutPlanError(
      'PAYOUT_OBSERVATION_EVIDENCE_MISMATCH',
      'Reservation differs from immutable approval.',
    );
  return { snapshot, network: row.network, treasury: row.treasury };
}

async function bindExecution(
  database: DatabaseService,
  executionId: string,
  observationOnly: boolean,
) {
  const execution = (
    await database.pool.query<{
      payout_plan_id: string;
      network: PayoutNetwork;
      treasury_address: string;
      total_payout_lamports: string;
    }>('select * from payout_executions where id=$1', [executionId])
  ).rows[0];
  if (!execution)
    throw new PayoutPlanError('PAYOUT_EXECUTION_NOT_FOUND', 'Payout execution not found.');
  const recorded = observationOnly
    ? await observedApproval(database, execution.payout_plan_id)
    : null;
  if (
    recorded &&
    (execution.network !== recorded.network || execution.treasury_address !== recorded.treasury)
  )
    throw new PayoutPlanError(
      'PAYOUT_OBSERVATION_EVIDENCE_MISMATCH',
      'Execution differs from reserved environment.',
    );
  const snapshot =
    recorded?.snapshot ?? (await assertApprovalBinding(database, execution.payout_plan_id));
  const approved = snapshot.allocations
    .filter((row) => BigInt(row.lamports) > 0n)
    .map((row) => ({
      allocationId: row.allocationId,
      destination: row.destination,
      lamports: BigInt(row.lamports),
    }));
  const batches = (
    await database.pool.query<{
      id: string;
      batch_index: number;
      recipient_count: number;
      total_lamports: string;
      intent_version: string;
      intent_hash: string;
    }>('select * from payout_batches where payout_execution_id=$1 order by batch_index', [
      executionId,
    ])
  ).rows;
  const expected = buildPayoutBatches({
    planId: execution.payout_plan_id,
    network: execution.network,
    treasury: execution.treasury_address,
    recipients: approved,
    maxRecipientsPerBatch: batches[0]?.recipient_count ?? 1,
  });
  if (
    batches.length !== expected.length ||
    execution.total_payout_lamports !== approved.reduce((n, r) => n + r.lamports, 0n).toString()
  )
    throw new PayoutPlanError(
      'PAYOUT_APPROVED_INTENT_MISMATCH',
      'Execution does not conserve approved allocations.',
    );
  for (const [index, batch] of batches.entries()) {
    const intent = expected[index]!;
    const mappings = (
      await database.pool.query<{
        payout_allocation_id: string;
        destination_address: string;
        lamports: string;
      }>('select * from payout_batch_allocations where payout_batch_id=$1 order by ordinal', [
        batch.id,
      ])
    ).rows;
    if (
      batch.batch_index !== index ||
      batch.intent_version !== intent.version ||
      batch.intent_hash !== intent.intentHash ||
      batch.total_lamports !== intent.totalLamports.toString() ||
      batch.recipient_count !== intent.recipients.length ||
      canonicalApprovalJson(
        mappings.map((row) => [row.payout_allocation_id, row.destination_address, row.lamports]),
      ) !==
        canonicalApprovalJson(
          intent.recipients.map((row) => [
            row.allocationId,
            row.destination,
            row.lamports.toString(),
          ]),
        )
    )
      throw new PayoutPlanError(
        'PAYOUT_APPROVED_INTENT_MISMATCH',
        'Persisted batch differs from approved destinations, identities or amounts.',
      );
  }
  return { snapshot, execution };
}

// Historical VERIFIED records need no new authority: return without RPC, signing or writes.
export async function verifiedPayoutReplay(database: DatabaseService, planId: string) {
  const execution = (
    await database.pool.query<{
      id: string;
      state: string;
      plan_state: string;
    }>(
      `select e.id,e.state,p.state plan_state from payout_executions e join payout_plans p on p.id=e.payout_plan_id
     where p.id=$1`,
      [planId],
    )
  ).rows[0];
  if (!execution || execution.state !== 'VERIFIED' || execution.plan_state !== 'VERIFIED')
    return null;
  const states = (
    await database.pool.query<{ state: string }>(
      'select state from payout_batches where payout_execution_id=$1 order by batch_index',
      [execution.id],
    )
  ).rows.map((row) => row.state);
  if (!states.length || states.some((state) => state !== 'VERIFIED'))
    throw new PayoutPlanError(
      'PAYOUT_APPROVAL_EVIDENCE_INVALID',
      'Historical verification states conflict.',
    );
  return { executionId: execution.id, state: 'VERIFIED', batchStates: states };
}
