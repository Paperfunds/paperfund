import { AsyncLocalStorage } from 'node:async_hooks';
import { assertPayoutTreasuryEffect } from './payout-treasury.js';
import { createPublicKey, verify } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DatabaseService } from './database.js';
import { PayoutPlanError } from './payout-service.js';

export type PayoutAction = 'APPROVE' | 'EXECUTE' | 'RETRY' | 'STOP' | 'RELEASE';
export interface OperatorRequest {
  readonly version: 'paperfund-payout-authority-v1';
  readonly issuer: string;
  readonly action: PayoutAction;
  readonly planId: string;
  readonly snapshotHash: string;
  readonly environment: string;
  readonly executionEnvironment: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly stopGeneration: string;
  readonly reason: string;
  readonly signature: string;
}
export function operatorMessage(r: Omit<OperatorRequest, 'signature'>) {
  return JSON.stringify([
    r.version,
    r.issuer,
    r.action,
    r.planId,
    r.snapshotHash,
    r.environment,
    r.executionEnvironment,
    r.nonce,
    r.expiresAt,
    r.stopGeneration,
    r.reason,
  ]);
}
export interface OperatorVerifier {
  verify(
    request: OperatorRequest,
  ): Promise<{ readonly subject: string; readonly permissions: readonly PayoutAction[] }>;
}
// Optional offline adapter. Public keys/permissions must come from a separately protected trusted policy.
// No production identities or policy are installed by this candidate.
export class PinnedOperatorVerifier implements OperatorVerifier {
  private readonly policy: ReadonlyMap<
    string,
    {
      subject: string;
      publicKey: ReturnType<typeof createPublicKey>;
      permissions: readonly PayoutAction[];
    }
  >;
  constructor(
    policy: Readonly<
      Record<
        string,
        { subject: string; publicKeyPem: string; permissions: readonly PayoutAction[] }
      >
    >,
  ) {
    this.policy = new Map(
      Object.entries(policy).map(([id, p]) => {
        const key = createPublicKey(p.publicKeyPem);
        if (key.asymmetricKeyType !== 'ed25519')
          throw new Error('Ed25519 operator policy required.');
        return [id, { subject: p.subject, publicKey: key, permissions: [...p.permissions] }];
      }),
    );
  }
  async verify(request: OperatorRequest) {
    const p = this.policy.get(request.issuer);
    if (
      !p ||
      !verify(
        null,
        Buffer.from(operatorMessage(request)),
        p.publicKey,
        Buffer.from(request.signature, 'base64'),
      )
    )
      throw denied('PAYOUT_OPERATOR_UNAUTHORIZED');
    return { subject: p.subject, permissions: p.permissions };
  }
}
function denied(code: string) {
  return new PayoutPlanError(code, 'Payout authority or stop policy denied this operation.');
}
interface Runtime {
  readonly controlPool: Pool;
  // Only the separate stop-control process receives a writer credential.
  readonly stopWritePool?: Pool;
  readonly verifier: OperatorVerifier;
  readonly environment: string;
  readonly clock: () => number;
}
const runtimes = new WeakMap<DatabaseService, Runtime>();
interface Permit {
  runtime: Runtime;
  request: OperatorRequest;
  subject: string;
}
async function verifyOperator(runtime: Runtime, request: OperatorRequest) {
  try {
    const actor = await runtime.verifier.verify(request);
    if (
      typeof actor.subject !== 'string' ||
      actor.subject.length < 1 ||
      actor.subject.length > 256 ||
      !Array.isArray(actor.permissions)
    )
      throw denied('PAYOUT_OPERATOR_UNAUTHORIZED');
    return actor;
  } catch (error) {
    throw error instanceof PayoutPlanError ? error : denied('PAYOUT_AUTHORIZATION_UNAVAILABLE');
  }
}
const current = new AsyncLocalStorage<Permit>();
export function installPayoutSecurity(database: DatabaseService, runtime: Runtime) {
  if (runtimes.has(database)) throw denied('PAYOUT_SECURITY_ALREADY_INSTALLED');
  runtimes.set(database, Object.freeze({ ...runtime }));
}
async function audit(
  runtime: Runtime,
  actor: string | null,
  action: string,
  planId: string | null,
  outcome: string,
  reason: string,
) {
  try {
    await runtime.controlPool.query(
      'insert into payout_security_events(actor,action,plan_id,outcome,reason) values($1,$2,$3,$4,$5)',
      [actor, action, planId, outcome, reason],
    );
  } catch {
    throw denied('PAYOUT_SECURITY_AUDIT_UNAVAILABLE');
  }
}
function checkedRequest(
  value: OperatorRequest | undefined,
  runtime: Runtime,
  action: PayoutAction,
  planId: string,
): OperatorRequest {
  if (!value) throw denied('PAYOUT_OPERATOR_REQUIRED');
  // Copy signed fields; subsequent caller mutation cannot change a running permit.
  const r = Object.freeze(JSON.parse(JSON.stringify(value)) as OperatorRequest);
  if (
    r.version !== 'paperfund-payout-authority-v1' ||
    r.action !== action ||
    r.planId !== planId ||
    r.environment !== runtime.environment ||
    !/^[a-zA-Z0-9:_-]{1,128}$/.test(r.issuer) ||
    !/^[a-zA-Z0-9:_-]{16,128}$/.test(r.nonce) ||
    !/^[a-f0-9]{64}$/.test(r.snapshotHash) ||
    !/^\d+$/.test(r.stopGeneration) ||
    typeof r.executionEnvironment !== 'string' ||
    r.executionEnvironment.length > 128 ||
    typeof r.reason !== 'string' ||
    r.reason.length < 1 ||
    r.reason.length > 256 ||
    typeof r.signature !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(r.signature) ||
    !Number.isSafeInteger(r.expiresAt) ||
    r.expiresAt <= runtime.clock() ||
    r.expiresAt > runtime.clock() + 300_000
  )
    throw denied('PAYOUT_OPERATOR_SCOPE_INVALID');
  return r;
}
async function verifyPermit(permit: Permit) {
  if (permit.request.expiresAt <= permit.runtime.clock()) throw denied('PAYOUT_OPERATOR_EXPIRED');
  const actor = await verifyOperator(permit.runtime, permit.request);
  if (actor.subject !== permit.subject || !actor.permissions.includes(permit.request.action))
    throw denied('PAYOUT_OPERATOR_UNAUTHORIZED');
}
async function checkStop(permit: Permit, step: string) {
  try {
    const row = (
      await permit.runtime.controlPool.query<{ stopped: boolean; generation: string }>(
        'select stopped,generation::text from payout_stop_state where singleton=true',
      )
    ).rows[0];
    if (!row || row.stopped) throw denied('PAYOUT_EMERGENCY_STOP');
    if (row.generation !== permit.request.stopGeneration)
      throw denied('PAYOUT_STOP_GENERATION_CHANGED');
  } catch (error) {
    const code = error instanceof PayoutPlanError ? error.code : 'PAYOUT_STOP_UNAVAILABLE';
    await audit(permit.runtime, permit.subject, step, permit.request.planId, 'BLOCKED', code);
    throw denied(code);
  }
}
export async function withPayoutAuthorization<T>(
  database: DatabaseService,
  request: OperatorRequest | undefined,
  action: 'APPROVE' | 'EXECUTE' | 'RETRY',
  planId: string,
  run: () => Promise<T>,
) {
  const runtime = runtimes.get(database);
  if (!runtime) throw denied('PAYOUT_AUTHORITY_NOT_CONFIGURED');
  let permit: Permit;
  try {
    const r = checkedRequest(request, runtime, action, planId);
    const actor = await verifyOperator(runtime, r);
    if (!actor.permissions.includes(action)) throw denied('PAYOUT_OPERATOR_UNAUTHORIZED');
    permit = { runtime, request: r, subject: actor.subject };
    if (action !== 'APPROVE') {
      const approval = (
        await database.pool.query<{ approver_identifier: string; plan_snapshot_hash: string }>(
          'select approver_identifier,plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
          [planId],
        )
      ).rows[0];
      if (approval?.approver_identifier === actor.subject)
        throw denied('PAYOUT_SEPARATION_REQUIRED');
      if (approval && approval.plan_snapshot_hash !== r.snapshotHash)
        throw denied('PAYOUT_OPERATOR_SNAPSHOT_MISMATCH');
      await checkStop(permit, action);
    }
    await runtime.controlPool.query(
      'insert into payout_authority_nonces(issuer,nonce,action,plan_id,snapshot_hash,signed_request) values($1,$2,$3,$4,$5,$6)',
      [r.issuer, r.nonce, action, planId, r.snapshotHash, JSON.stringify(r)],
    );
    await audit(runtime, actor.subject, action, planId, 'AUTHORIZED', 'SIGNED_ACTION_VERIFIED');
  } catch (error) {
    await audit(
      runtime,
      null,
      action,
      planId,
      'DENIED',
      error instanceof PayoutPlanError ? error.code : 'AUTHORIZATION_UNAVAILABLE',
    );
    throw error instanceof PayoutPlanError ? error : denied('PAYOUT_AUTHORIZATION_UNAVAILABLE');
  }
  return current.run(permit, run);
}
export function authorizedApprover(hash: string) {
  const permit = current.getStore();
  if (!permit || permit.request.action !== 'APPROVE' || permit.request.snapshotHash !== hash)
    throw denied('PAYOUT_OPERATOR_SNAPSHOT_MISMATCH');
  if (permit.request.expiresAt <= permit.runtime.clock()) throw denied('PAYOUT_OPERATOR_EXPIRED');
  return permit.subject;
}
export async function persistApprovalAuthorization(client: PoolClient, approvalId: string) {
  const permit = current.getStore();
  if (!permit || permit.request.action !== 'APPROVE') throw denied('PAYOUT_OPERATOR_REQUIRED');
  await client.query(
    'insert into payout_approval_authorizations(approval_id,subject,signed_request) values($1,$2,$3)',
    [approvalId, permit.subject, JSON.stringify(permit.request)],
  );
}
export async function assertApprovalAuthorization(database: DatabaseService, planId: string) {
  const permit = current.getStore();
  if (!permit) throw denied('PAYOUT_OPERATOR_REQUIRED');
  const row = (
    await database.pool.query<{
      subject: string;
      signed_request: OperatorRequest;
      plan_snapshot_hash: string;
      approver_identifier: string;
    }>(
      `select s.subject,s.signed_request,a.plan_snapshot_hash,a.approver_identifier from payout_plan_approvals a join payout_approval_authorizations s on s.approval_id=a.id where a.payout_plan_id=$1`,
      [planId],
    )
  ).rows[0];
  if (!row) throw denied('PAYOUT_APPROVAL_AUTHORITY_REVIEW_REQUIRED');
  const r = row.signed_request;
  if (
    r.version !== 'paperfund-payout-authority-v1' ||
    r.action !== 'APPROVE' ||
    r.planId !== planId ||
    r.snapshotHash !== row.plan_snapshot_hash ||
    r.environment !== permit.runtime.environment ||
    row.subject !== row.approver_identifier
  )
    throw denied('PAYOUT_APPROVAL_AUTHORITY_MISMATCH');
  const actor = await verifyOperator(permit.runtime, r);
  if (
    actor.subject !== row.subject ||
    !actor.permissions.includes('APPROVE') ||
    actor.subject === permit.subject
  )
    throw denied('PAYOUT_APPROVAL_AUTHORITY_MISMATCH');
}
export function assertPayoutEnvironment(network: string, treasury: string) {
  const permit = current.getStore();
  if (!permit || permit.request.executionEnvironment !== network + ':' + treasury)
    throw denied('PAYOUT_OPERATOR_ENVIRONMENT_MISMATCH');
}
export async function assertPayoutStep(step: 'SIGN' | 'BROADCAST' | 'RETRY', batchId?: string) {
  const permit = current.getStore();
  if (!permit || !['EXECUTE', 'RETRY'].includes(permit.request.action))
    throw denied('PAYOUT_OPERATOR_REQUIRED');
  try {
    await verifyPermit(permit);
    await audit(
      permit.runtime,
      permit.subject,
      step,
      permit.request.planId,
      'CHECKED',
      batchId ?? 'OPERATION',
    );
  } catch (error) {
    await audit(
      permit.runtime,
      permit.subject,
      step,
      permit.request.planId,
      'BLOCKED',
      'AUTHORIZATION_UNAVAILABLE',
    );
    throw error instanceof PayoutPlanError ? error : denied('PAYOUT_AUTHORIZATION_UNAVAILABLE');
  }
  // Prerequisite checks only. Effects must use invokeAuthorizedPayoutEffect below.
  await checkStop(permit, step);
}
export async function invokeAuthorizedPayoutEffect<T>(
  step: 'SIGN' | 'BROADCAST',
  batchId: string | undefined,
  invoke: () => Promise<T>,
): Promise<T> {
  await assertPayoutTreasuryEffect();
  await assertPayoutStep(step, batchId);
  const permit = current.getStore();
  if (!permit) throw denied('PAYOUT_OPERATOR_REQUIRED');
  // No await or promise handoff may separate this decision from invoke().
  // This authorizes initiation, not completion/cancellation of an external operation.
  const expiresAt = permit.request.expiresAt;
  const now = permit.runtime.clock();
  if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now) || now >= expiresAt) {
    await audit(
      permit.runtime,
      permit.subject,
      step,
      permit.request.planId,
      'BLOCKED',
      'PAYOUT_OPERATOR_EXPIRED',
    );
    throw denied('PAYOUT_OPERATOR_EXPIRED');
  }
  return invoke();
}
export async function changePayoutStop(database: DatabaseService, request: OperatorRequest) {
  const runtime = runtimes.get(database);
  if (!runtime) throw denied('PAYOUT_AUTHORITY_NOT_CONFIGURED');
  const action = request.action;
  if (action !== 'STOP' && action !== 'RELEASE') throw denied('PAYOUT_OPERATOR_SCOPE_INVALID');
  try {
    if (!runtime.stopWritePool) throw denied('PAYOUT_STOP_CONTROL_NOT_CONFIGURED');
    const r = checkedRequest(request, runtime, action, '*');
    const actor = await verifyOperator(runtime, r);
    if (!actor.permissions.includes(action)) throw denied('PAYOUT_OPERATOR_UNAUTHORIZED');
    const client = await runtime.stopWritePool.connect();
    try {
      await client.query('begin');
      await client.query(
        'insert into payout_authority_nonces(issuer,nonce,action,plan_id,snapshot_hash,signed_request) values($1,$2,$3,$4,$5,$6)',
        [r.issuer, r.nonce, action, '*', r.snapshotHash, JSON.stringify(r)],
      );
      // Finish row-lock waits before checking freshness. Keep the lock until commit/rollback.
      const stop = await client.query<{ generation_matches: boolean }>(
        'select generation=$1::bigint generation_matches from payout_stop_state where singleton=true for update',
        [r.stopGeneration],
      );
      if (!stop.rows[0]?.generation_matches) throw denied('PAYOUT_STOP_GENERATION_CONFLICT');
      const values = [action === 'STOP', r.reason, r.stopGeneration, r.expiresAt];
      const currentTime = runtime.clock();
      if (!Number.isSafeInteger(currentTime) || currentTime >= r.expiresAt)
        throw denied('PAYOUT_OPERATOR_EXPIRED');
      // No await/handoff after the application check. PostgreSQL independently checks its
      // current clock while we already own the row lock; transaction-start time is unsafe.
      const result = await client.query(
        `update payout_stop_state set stopped=$1,generation=generation+1,reason=$2,changed_at=clock_timestamp()
         where singleton=true and generation=$3 and extract(epoch from clock_timestamp())*1000 < $4::bigint
         returning generation::text`,
        values,
      );
      // Generation/existence were checked under the retained lock; deadline is the remaining gate.
      if (result.rowCount !== 1) throw denied('PAYOUT_OPERATOR_EXPIRED');
      await client.query(
        'insert into payout_security_events(actor,action,plan_id,outcome,reason) values($1,$2,null,$3,$4)',
        [actor.subject, action, 'APPLIED', r.reason],
      );
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await audit(
      runtime,
      null,
      action,
      null,
      'DENIED',
      error instanceof PayoutPlanError ? error.code : 'AUTHORIZATION_UNAVAILABLE',
    );
    throw error instanceof PayoutPlanError ? error : denied('PAYOUT_AUTHORIZATION_UNAVAILABLE');
  }
}
