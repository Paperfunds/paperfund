/* eslint-disable @typescript-eslint/no-explicit-any -- External preserved fixture has a dynamically loaded test-only contract. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { reviewPlan, databaseStatus, withReadonlyDatabase } from './treasury.mjs';
import { WALLET } from './common.mjs';
const root =
  'C:/Users/stanp/.codex/isolated-validation/paperfund-mainnet-funding-20261018/candidate';
const load = (path: string) => import(pathToFileURL(root + '/' + path).href);
const { fixture, fundAndApprove } = await load('packages/db/test/legacy-beta-fixture.ts');
const { executeApprovedPayoutPlan, retryPayoutExecution } = await load(
  'packages/db/src/payout-execution.ts',
);
const { generateHourlyShadowPayoutPlan } = await load('packages/db/src/payout-service.ts');
const { legacyHourlyProof } = await load('packages/db/src/legacy-proof.ts');
const evidence: any[] = [];
test('accepted engine connects verified localnet winners, immutable source wallets, signed approval and reservations', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    const url = f.db.pool.options.connectionString;
    const review = await reviewPlan(p.plan.id, url);
    assert.equal(review.allocations.length, 2);
    assert.equal(
      review.allocations.reduce((n: any, r: any) => n + BigInt(r.lamports), 0n),
      6300n,
    );
    const pinned = review.allocations.map((r: any) => r.recipient);
    await f.db.pool.query('update users set wallet_address=$1 where id=$2', [WALLET, f.users[0]]);
    assert.deepEqual(
      (await reviewPlan(p.plan.id, url)).allocations.map((r: any) => r.recipient),
      pinned,
    );
    // Restore mutable identity so the stronger existing approval source checks can proceed.
    await f.db.pool.query('update users set wallet_address=$1 where id=$2', [
      pinned.find((_: any, i: number) => review.allocations[i].userId === f.users[0]),
      f.users[0],
    ]);
    await assert.rejects(
      withReadonlyDatabase(
        (c: any) => c.query('update users set wallet_address=wallet_address'),
        url,
      ),
      (e) => (e as any).code === '25006',
    );
    const before = await f.db.pool.query(
      'select count(*)::text n from payout_treasury_reservations',
    );
    assert.equal(before.rows[0].n, '0');
    await p.release();
    await p.approve();
    await p.dry();
    const status = await databaseStatus(url);
    assert.equal(status.reservedPrincipalLamports, '6300');
    assert.equal(status.remainingApprovedPayoutBudgetLamports, '0');
    p.state.received = 6300n;
    await assert.rejects(p.dry());
    p.state.received = 10100n;
    const hash = (
      await f.db.pool.query(
        'select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
        [p.plan.id],
      )
    ).rows[0].plan_snapshot_hash;
    let signs = 0;
    const signer = {
      type: 'ISOLATED_TEST_TRAP',
      publicKey: p.treasury,
      signTransaction: async () => {
        signs++;
        throw Error('CONTROLLED_INTERRUPTION_BEFORE_SIGNATURE');
      },
    };
    await assert.rejects(
      executeApprovedPayoutPlan(f.db, {
        planId: p.plan.id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer,
        now: p.now,
      }),
    );
    assert.equal(signs, 0);
    await assert.rejects(
      executeApprovedPayoutPlan(f.db, {
        planId: p.plan.id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer,
        now: p.now,
        authority: p.request('EXECUTE', p.plan.id, hash),
      }),
    );
    assert.equal(signs, 1);
    const execution = (await f.db.pool.query('select id from payout_executions')).rows[0];
    await f.db.pool.query(
      "insert into legacy_source_reviews values('review',$1,null,'INDEPENDENT_REVIEW',default)",
      [f.round],
    );
    await assert.rejects(
      retryPayoutExecution(f.db, {
        executionId: execution.id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer,
        now: p.now,
        authority: p.request('RETRY', p.plan.id, hash),
      }),
    );
    assert.equal(signs, 1);
    assert.equal(
      (await f.db.pool.query('select count(*)::text n from payout_signed_transactions')).rows[0].n,
      '0',
    );
    evidence.push({
      case: 'winner-to-wallet',
      principal: '6300',
      pinned,
      approved: true,
      unsignedPreflight: true,
      authorizationRequired: true,
      reservationRetained: true,
      reviewRetryBlocked: true,
      realTransfers: 0,
    });
  } finally {
    await f.cleanup();
  }
});
test('invalid current competition evidence stays REVIEW and cannot become a payout source', async () => {
  const f = await fixture();
  try {
    await f.close();
    const proof = await legacyHourlyProof(f.db, f.router, f.round);
    assert.equal(proof.realFinancialAccepted, false);
    assert.equal(proof.localnetTestAccepted, false);
    await assert.rejects(
      generateHourlyShadowPayoutPlan(f.db, {
        hourlyRoundId: f.round,
        now: new Date(+f.end + 120000),
      }),
    );
    evidence.push({
      case: 'unqualified-evidence',
      realFinancialAccepted: false,
      planningBlocked: true,
    });
  } finally {
    await f.cleanup();
  }
});
test('repeated and concurrent settlement consumes capacity once and preserves exact ledger', async () => {
  const f = await fixture();
  try {
    await f.close();
    const before = (await f.db.pool.query('select count(*)::text n from fills')).rows[0].n;
    await Promise.all([f.close(), f.close()]);
    assert.equal((await f.db.pool.query('select count(*)::text n from fills')).rows[0].n, before);
    assert.equal(
      (await f.db.pool.query('select count(*)::text n from legacy_settlement_liquidations')).rows[0]
        .n,
      '2',
    );
    evidence.push({ case: 'settlement-replay', fillsUnchanged: true, liquidations: '2' });
  } finally {
    await f.cleanup();
  }
});
test('retain acceptance observations', async () => {
  await writeFile(
    'C:/Users/stanp/Documents/ChatGPT/Paperfund-new/artifacts/operator/pipeline-observations.json',
    JSON.stringify(evidence, null, 2),
  );
});

test('accepted executor reconciles an uncertain synthetic send once and never broadcasts a replacement on replay', async () => {
  const { Transaction, SystemInstruction } = await import('@solana/web3.js');
  const bs58 = (await import('bs58')).default;
  const { reconcilePayoutExecution } = await load('packages/db/src/payout-execution.ts');
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    await p.release();
    await p.approve();
    const approval = (
      await f.db.pool.query(
        'select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
        [p.plan.id],
      )
    ).rows[0].plan_snapshot_hash;
    let signs = 0,
      sends = 0,
      sent: any;
    const signer = {
      type: 'SYNTHETIC_SIGNED_ARTIFACT_NOT_CHAIN_VALID',
      publicKey: p.treasury,
      signTransaction: async (unsigned: any) => {
        signs++;
        const tx = Transaction.from(unsigned);
        const signature = Buffer.alloc(64, 17);
        tx.addSignature(tx.feePayer!, signature);
        return {
          signedTransaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
          signature: bs58.encode(signature),
        };
      },
    };
    const rpc = {
      ...p.rpc,
      sendSignedTransaction: async (bytes: any) => {
        sends++;
        sent = Transaction.from(bytes);
        throw Error('LOST_SEND_ACK');
      },
      getSignatureStatus: async () =>
        sent ? { confirmationStatus: 'finalized', error: null, slot: 20n } : null,
      getFinalizedTransfers: async () =>
        sent
          ? {
              error: null,
              slot: 20n,
              feeLamports: 5n,
              transfers: sent.instructions.map((ix: any) => {
                const t = SystemInstruction.decodeTransfer(ix);
                return {
                  source: t.fromPubkey.toBase58(),
                  destination: t.toPubkey.toBase58(),
                  lamports: BigInt(t.lamports),
                };
              }),
            }
          : null,
    };
    await executeApprovedPayoutPlan(f.db, {
      planId: p.plan.id,
      config: { ...p.config, enabled: true },
      rpc,
      signer,
      now: p.now,
      authority: p.request('EXECUTE', p.plan.id, approval),
    });
    const execution = (await f.db.pool.query('select id from payout_executions')).rows[0];
    await reconcilePayoutExecution(f.db, { executionId: execution.id, rpc, now: p.now });
    await reconcilePayoutExecution(f.db, { executionId: execution.id, rpc, now: p.now });
    const records = (
      await f.db.pool.query('select principal::text,fee::text from payout_treasury_settlements')
    ).rows;
    assert.equal(records.length, 1);
    assert.equal(records[0].principal, '6300');
    assert.equal(records[0].fee, '5');
    assert.equal(
      (await databaseStatus(f.db.pool.options.connectionString)).reservedFeeLamports,
      '0',
    );
    assert.equal(sends, 1);
    assert.equal(signs, 1);
    const plan = (await f.db.pool.query('select state from payout_plans where id=$1', [p.plan.id]))
      .rows[0];
    assert.equal(plan.state, 'VERIFIED');
    const review = await reviewPlan(p.plan.id, f.db.pool.options.connectionString);
    assert.equal(
      review.allocations.reduce((n: any, r: any) => n + BigInt(r.lamports), 0n),
      6300n,
    );
    evidence.push({
      case: 'synthetic-lost-ack-reconciliation',
      signatureValidity: 'MOCK_NOT_A_REAL_CHAIN_SIGNATURE',
      principal: '6300',
      fee: '5',
      signs,
      sends,
      verifiedRecords: 1,
      realTransfers: 0,
    });
    await writeFile(
      'C:/Users/stanp/Documents/ChatGPT/Paperfund-new/artifacts/operator/pipeline-observations.json',
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    await f.cleanup();
  }
});
