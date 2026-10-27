import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fixture, fundAndApprove } from './legacy-beta-fixture.js';
import { getAccountFinancialState, reconcileAccountLedger } from '../src/financial-service.js';
import { legacyHourlyProof } from '../src/legacy-proof.js';
import { generateHourlyShadowPayoutPlan } from '../src/payout-service.js';
import { changePayoutStop } from '../src/payout-security.js';
import {
  executeApprovedPayoutPlan,
  DisabledPayoutSigner,
  retryPayoutExecution,
} from '../src/payout-execution.js';
import { CompetitionService } from '../../../apps/api/src/competition.js';

it('conserves BUY, partial SELL and one forced full exit; duplicate and restarted closes preserve cash, basis, P&L and ranks', async () => {
  const f = await fixture();
  try {
    const first = await f.close();
    expect(first.state).toBe('FINALIZED');
    expect(first.forcedSells).toHaveLength(2);
    for (const [user, i] of f.users.map((u, i) => [u, i] as const)) {
      const a = await getAccountFinancialState(f.db, user),
        sell = first.forcedSells.find((s) => s.competitionAccountId === user)!;
      const proceeds =
        sell.actualNetPaperSolOutputLamports +
        (i === 0 ? f.part.actualNetPaperSolOutputLamports : 0n);
      expect(a.paperSolBalanceLamports).toBe(
        10000000000n - f.buys[i]!.actualPaperSolInputLamports + proceeds,
      );
      expect(a.realizedPnlLamports).toBe(proceeds - f.buys[i]!.actualPaperSolInputLamports);
      expect((await reconcileAccountLedger(f.db, user)).reconciled).toBe(true);
    }
    const before = (await f.db.pool.query('select count(*)::int n from fills')).rows[0].n;
    await Promise.all([f.close(), f.close()]);
    expect((await f.db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(before);
    expect((await legacyHourlyProof(f.db, f.router, f.round)).structural).toBe(true);
    const leaderboard = await new CompetitionService(f.db, f.router).hourlyLeaderboard(f.round);
    expect(leaderboard!.entries).toHaveLength(2);
    expect(
      (await f.db.pool.query('select count(*)::int n from daily_result_hourly_results')).rows[0].n,
    ).toBe(2);
    await expect(
      generateHourlyShadowPayoutPlan(f.db, {
        hourlyRoundId: f.round,
        now: new Date(+f.end + 120000),
      }),
    ).rejects.toMatchObject({ code: 'PAYOUT_SETTLEMENT_REVIEW' });
  } finally {
    await f.cleanup();
  }
}, 30000);

it('rejects unfunded obligations, then accepts independently supplied fixture receipts and signed approval without sign/send', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    await p.release();
    p.state.funding = false;
    await expect(p.approve()).rejects.toThrow();
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0].n,
    ).toBe(0);
    p.state.funding = true;
    await p.approve();
    const approved = (
      await f.db.pool.query('select state from payout_plans where id=$1', [p.plan.id])
    ).rows[0].state;
    expect(approved).toBe('APPROVED');
    const before = (
      await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')
    ).rows[0].n;
    const dry = await p.dry();
    expect(dry.totalPayoutLamports).toBe(6300n);
    expect(dry.sufficientBalance).toBe(true);
    await p.dry();
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0].n,
    ).toBe(before);
    expect((await f.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      0,
    );
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_signed_transactions')).rows[0].n,
    ).toBe(0);
    writeFileSync(
      new URL('../../../../evidence/funded-localnet-authorization.json', import.meta.url),
      JSON.stringify({
        scope: 'SYNTHETIC_LOCALNET_NO_SIGN_OR_SEND',
        plan: p.plan.id,
        state: approved,
        principal: '6300',
        independentlySuppliedReceipt: '10000',
        feeCapital: '100',
        dryRunOnly: true,
      }),
    );
  } finally {
    await f.cleanup();
  }
}, 30000);

it('current REVIEW blocks planning, reapproval, preflight and retry while preserving the admitted reservation', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    await p.release();
    await p.approve();
    const hash = (
      await f.db.pool.query(
        'select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
        [p.plan.id],
      )
    ).rows[0].plan_snapshot_hash;
    let signCalls = 0;
    const signer = {
      type: 'ISOLATED_TEST_TRAP',
      publicKey: p.treasury,
      signTransaction: async () => {
        signCalls++;
        throw Error('SIGN_DISABLED');
      },
    };
    await expect(
      executeApprovedPayoutPlan(f.db, {
        planId: p.plan.id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer,
        now: p.now,
        authority: p.request('EXECUTE', p.plan.id, hash),
      }),
    ).rejects.toThrow();
    const executions = (await f.db.pool.query('select id,state from payout_executions')).rows;
    expect(executions).toHaveLength(1);
    expect(executions[0].state).toBe('PREPARED');
    await expect(f.db.pool.query(`insert into payout_executions
      select (jsonb_populate_record(null::payout_executions,to_jsonb(e)||
      jsonb_build_object('id','forbidden-mainnet','network','mainnet-beta'))).* from payout_executions e`))
      .rejects.toThrow('MAINNET_QUALIFICATION_UNAVAILABLE');
    const callsBeforeReview = signCalls;
    await f.db.pool.query(
      `insert into legacy_source_reviews values('incident',$1,null,'INDEPENDENT_REVIEW',default)`,
      [f.round],
    );
    await expect(
      generateHourlyShadowPayoutPlan(f.db, { hourlyRoundId: f.round, now: p.now }),
    ).rejects.toMatchObject({ code: 'PAYOUT_SETTLEMENT_REVIEW' });
    await expect(p.approve()).rejects.toThrow();
    await expect(p.dry()).rejects.toThrow();
    await expect(
      retryPayoutExecution(f.db, {
        executionId: executions[0].id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer,
        now: p.now,
        authority: p.request('RETRY', p.plan.id, hash),
      }),
    ).rejects.toThrow();
    expect(signCalls).toBe(callsBeforeReview);
    await expect(
      f.db.pool.query("update payout_plans set state='APPROVED' where id=$1", [p.plan.id]),
    ).rejects.toThrow('PAYOUT_SETTLEMENT_REVIEW');
    await expect(
      executeApprovedPayoutPlan(f.db, {
        planId: p.plan.id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer: {
          type: 'ISOLATED_TEST_TRAP',
          publicKey: p.treasury,
          signTransaction: async () => {
            throw Error('SIGN_DISABLED');
          },
        },
        now: p.now,
        authority: p.request('EXECUTE', p.plan.id, hash),
      }),
    ).rejects.toThrow();
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0].n,
    ).toBe(1);
    expect((await f.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      1,
    );
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_signed_transactions')).rows[0].n,
    ).toBe(0);
  } finally {
    await f.cleanup();
  }
}, 30000);

it('signed emergency STOP refuses new execution before any payment effect', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    await p.release();
    await p.approve();
    const hash = (
      await f.db.pool.query(
        'select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
        [p.plan.id],
      )
    ).rows[0].plan_snapshot_hash;
    await changePayoutStop(f.db, p.request('STOP', '*', '0'.repeat(64), '1'));
    await expect(
      executeApprovedPayoutPlan(f.db, {
        planId: p.plan.id,
        config: p.config,
        rpc: p.rpc,
        signer: new DisabledPayoutSigner(),
        now: p.now,
        authority: p.request('EXECUTE', p.plan.id, hash),
      }),
    ).rejects.toThrow();
    expect((await f.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      0,
    );
  } finally {
    await f.cleanup();
  }
}, 30000);
