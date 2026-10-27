import { getPayoutPlanAudit, validatePayoutPlan } from '../../packages/db/src/payout-service.ts';
import {
  captureApprovalSnapshot,
  approvalSnapshotHash,
} from '../../packages/db/src/payout-approval.ts';
import {
  approvePayoutPlan,
  executeApprovedPayoutPlan,
  reconcilePayoutExecution,
} from '../../packages/db/src/payout-execution.ts';
import { createIsolatedPayoutSigner } from '../../packages/payout-signer/src/isolated-signer.ts';
import { amount, fail, sha } from './automation-core.mjs';
// Uses the existing payout lifecycle. Mainnet acceptance is verified by the protected backend.
export class ExistingPayoutAutomation {
  constructor(runtime, openKey) {
    this.runtime = runtime;
    this.openKey = openKey;
  }
  required() {
    if (!this.runtime) fail('MAINNET_PAYOUT_ACCEPTANCE_NOT_DEPLOYED');
    if (this.runtime.config?.network !== 'mainnet-beta' || this.runtime.acceptedMainnet !== true)
      fail('MAINNET_PAYOUT_ACCEPTANCE_NOT_DEPLOYED');
    return this.runtime;
  }
  async prepare(channel, source, p) {
    const r = this.required();
    const status = await r.status?.();
    if (status && status.accepted !== true) fail('FINANCIAL_ACCEPTANCE_REQUIRED');
    if (r.config.treasuryAddress !== p.wallet) fail('PAYOUT_TREASURY_MISMATCH');
    if (!['hourly', 'daily'].includes(channel)) fail('PAYOUT_CHANNEL_INVALID');
    const audit = await getPayoutPlanAudit(r.database, source.planId);
    if (!audit || audit.competitionType !== (channel === 'hourly' ? 'HOURLY' : 'DAILY'))
      fail('PAYOUT_SOURCE_MISMATCH');
    if (!(await validatePayoutPlan(r.database, audit.id)).valid) fail('PAYOUT_VALIDATION_FAILED');
    const snapshotHash = approvalSnapshotHash(await captureApprovalSnapshot(r.database, audit));
    if (snapshotHash !== source.snapshotHash) fail('PAYOUT_SNAPSHOT_CHANGED');
    const recipients = audit.allocations
      .filter((a) => a.allocatedLamports > 0n)
      .map((a) => ({
        userId: a.userId,
        destination: audit.sourceLeaderboard.find((s) => s.userId === a.userId)?.walletAddress,
        lamports: String(a.allocatedLamports),
      }));
    if (
      recipients.some((a) => !a.destination) ||
      new Set(recipients.map((a) => a.userId)).size !== recipients.length ||
      recipients.reduce((n, a) => n + amount(a.lamports), 0n) !== audit.prizePoolLamports
    )
      fail('PAYOUT_SNAPSHOT_INVALID');
    const transactionCount = Math.ceil(recipients.length / r.config.maxRecipientsPerBatch);
    if (transactionCount < 1 || transactionCount > 32) fail('PAYOUT_BATCH_LIMIT');
    return {
      channel,
      planId: audit.id,
      snapshotHash,
      recipients,
      transactionCount,
      principalLamports: String(audit.prizePoolLamports),
      maximumFeeLamports: String(amount(p.payouts.maxFeeLamports) * BigInt(transactionCount)),
      wallet: p.wallet,
    };
  }
  async execute(prepared, p, guard) {
    const r = this.required();
    if (r.config.treasuryAddress !== p.wallet) fail('PAYOUT_TREASURY_MISMATCH');
    const boundGuard = async () => {
      const current = await guard();
      if ((r.clock?.() ?? Date.now()) >= Date.parse(p.expiresAt))
        fail('POLICY_EXPIRED_BEFORE_EFFECT');
      if (current && sha(JSON.stringify(current)) !== sha(JSON.stringify(p)))
        fail('POLICY_CHANGED');
    };
    const run = async () => {
      await boundGuard();
      const prior = (
        await r.database.pool.query(
          'select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
          [prepared.planId],
        )
      ).rows[0];
      const approval = await r.authorize('APPROVE', prepared.planId, prepared.snapshotHash, p);
      if (prior) {
        if (prior.plan_snapshot_hash !== prepared.snapshotHash) fail('PAYOUT_SNAPSHOT_CHANGED');
      } else
        await approvePayoutPlan(r.database, {
          planId: prepared.planId,
          now: new Date(r.clock?.() ?? Date.now()),
          approverIdentifier: approval.subject,
          authority: approval.request,
        });
      await boundGuard();
      const execution = await r.authorize('EXECUTE', prepared.planId, prepared.snapshotHash, p);
      if (execution.subject === approval.subject) fail('PAYOUT_SEPARATION_REQUIRED');
      const signer = createIsolatedPayoutSigner(p.wallet, {
        open: async () => {
          await boundGuard();
          const handle = await this.openKey(p.wallet);
          return {
            publicKey: handle.publicKey,
            signTransaction: async (bytes) => {
              await boundGuard();
              return handle.signTransaction(bytes);
            },
          };
        },
      });
      return executeApprovedPayoutPlan(r.database, {
        planId: prepared.planId,
        config: r.config,
        rpc: r.rpc,
        signer,
        now: new Date(r.clock?.() ?? Date.now()),
        authority: execution.request,
      });
    };
    return r.runGuarded ? r.runGuarded(boundGuard, run) : run();
  }

  async recover(prepared) {
    const r = this.required();
    const rows = (
      await r.database.pool.query(
        'select id,state from payout_executions where payout_plan_id=$1',
        [prepared.planId],
      )
    ).rows;
    if (!rows.length) return { neverSubmitted: true };
    if (rows.length !== 1) fail('PAYOUT_EXECUTIONS_REVIEW');
    await reconcilePayoutExecution(r.database, {
      executionId: rows[0].id,
      rpc: r.rpc,
      now: new Date(),
    });
    const result = (
      await r.database.pool.query('select state from payout_executions where id=$1', [rows[0].id])
    ).rows[0];
    return {
      finalized: result.state === 'VERIFIED',
      success: result.state === 'VERIFIED',
      executionId: rows[0].id,
    };
  }
}
