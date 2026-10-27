import pg from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, SystemInstruction, Transaction } from '@solana/web3.js';
import { createHourlyRound } from '../../packages/db/src/financial-service.ts';
import { finalizeHourlyRewardPool } from '../../packages/db/src/reward-service.ts';
import {
  getPayoutPlanAudit,
  finalizeDailyRewardPool,
  generateDailyShadowPayoutPlan,
} from '../../packages/db/src/payout-service.ts';
import { fixture, fundAndApprove } from '../../packages/db/test/legacy-beta-fixture.ts';
import { createMainnetPayoutRuntime } from './automation-mainnet.mjs';
import { ExistingPayoutAutomation } from './automation-payout.mjs';
import { verifyFinancialAcceptance } from './mainnet-evidence.mjs';
import { publishFinancialAcceptance, revokeFinancialAcceptance } from './mainnet-tools.mjs';
import { keyHandle } from './claim-runtime.mjs';
import { encode58 } from './key-public.mjs';
import { MAINNET, sha } from './automation-core.mjs';
const hash = (s) => sha(s),
  evidence = [];
function envelope(p, k) {
  const b = Buffer.from(JSON.stringify(p));
  return {
    payloadBase64: b.toString('base64'),
    signatureBase64: sign('sha256', b, k).toString('base64'),
  };
}
async function setup() {
  const f = await fixture();
  let root, runtime;
  try {
    await f.close();
    const walletKey = Keypair.generate(),
      wallet = walletKey.publicKey.toBase58(),
      fund = await fundAndApprove(f, undefined, wallet);
    let nowClock = +fund.now;
    const clock = () => nowClock;
    const signingPool = new pg.Pool({
        connectionString: f.db.pool.options.connectionString,
        options: '-c role=paperfund_mainnet_signer',
        max: 4,
      }),
      database = { ...f.db, pool: signingPool },
      requestKey = generateKeyPairSync('ed25519').privateKey,
      cert = generateKeyPairSync('rsa', { modulusLength: 2048 }),
      structuralHash = (await f.db.pool.query('select legacy_hour_digest($1) hash', [f.round]))
        .rows[0].hash;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfund-mainnet-offline-'));
    const feeId = (await f.db.pool.query('select id from creator_fee_events')).rows[0].id,
      first = encode58(Buffer.alloc(64, 21)),
      second = encode58(Buffer.alloc(64, 22)),
      source = Keypair.generate().publicKey.toBase58();
    let stopped = true,
      revoked = false,
      unlock = 0,
      sends = 0,
      balance = 10100,
      payout = null,
      payoutSig = null,
      pending = false,
      loseAck = false;
    const acceptance = {
      schema: 'paperfund-mainnet-financial-acceptance-v1',
      profile: 'MAINNET_FINALIZED_V1',
      network: 'mainnet-beta',
      genesis: MAINNET,
      wallet,
      mint: f.state.identity.tokenMint,
      issuedAt: new Date(clock() - 1000).toISOString(),
      expiresAt: new Date(clock() + 3600000).toISOString(),
      hours: [
        {
          roundId: f.round,
          structuralHash,
          startsAt: f.start.toISOString(),
          endsAt: f.end.toISOString(),
          preCutoffCaptureHash: hash('synthetic-cutoff'),
        },
      ],
      utc: {
        method: 'NTP_ROOT_DISTANCE_BOUNDED',
        maxUncertaintyMs: 80,
        sourceUncertaintyMs: 10,
        asymmetryBoundMs: 10,
        holdoverBoundMs: 10,
        hostDbBoundMs: 10,
        evidenceHashes: [hash('SYNTHETIC_UTC_NOT_PRODUCTION')],
        coveredFrom: f.start.toISOString(),
        coveredThrough: new Date(clock() + 300000).toISOString(),
      },
      provider: {
        network: 'mainnet-beta',
        genesis: MAINNET,
        identities: ['SYNTHETIC_A', 'SYNTHETIC_B'],
        universeComplete: true,
        evidenceHashes: [hash('synthetic-cutoff')],
        coveredFrom: f.start.toISOString(),
        coveredThrough: f.end.toISOString(),
      },
      funding: {
        historyComplete: true,
        openingBalanceLamports: '0',
        openingSlot: '1',
        throughSlot: '11',
        historySignatures: [first, second],
        evidenceHash: hash('SYNTHETIC_CUSTODY_HISTORY'),
        receipts: [
          {
            identity: first + ':0',
            signature: first,
            transferIndex: 0,
            kind: 'CREATOR_FEE',
            source,
            creatorFeeEventId: feeId,
            lamports: '10000',
            allocations: [{ creatorFeeEventId: feeId, lamports: '10000' }],
          },
          {
            identity: second + ':0',
            signature: second,
            transferIndex: 0,
            kind: 'NETWORK_FEES',
            source,
            creatorFeeEventId: null,
            lamports: '100',
          },
        ],
      },
    };
    const env = envelope(acceptance, cert.privateKey);
    fs.writeFileSync(path.join(root, 'mainnet-acceptance.json'), JSON.stringify(env));
    fs.writeFileSync(path.join(root, 'mainnet-acceptance-revocations.json'), '[]');
    fs.writeFileSync(
      path.join(root, 'standing-policy-root.cer'),
      cert.publicKey.export({ type: 'spki', format: 'pem' }),
    );
    await f.db.pool.query(
      'insert into mainnet_source_acceptances(id,hourly_round_id,profile,network,genesis,structural_hash,acceptance_hash,signed_envelope,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        randomUUID(),
        f.round,
        acceptance.profile,
        acceptance.network,
        MAINNET,
        structuralHash,
        sha(Buffer.from(env.payloadBase64, 'base64')),
        env,
        acceptance.expiresAt,
      ],
    );
    await f.db.pool.query("update creator_fee_ingestion_checkpoints set network='mainnet-beta'");
    const policy = {
      id: 'offline-mainnet-test-000001',
      operator: 'DISPOSABLE_OPERATOR',
      wallet,
      mint: acceptance.mint,
      financialStopGeneration: '0',
      expiresAt: acceptance.expiresAt,
      payouts: {
        hourly: { enabled: true, maxRoundLamports: '10000' },
        daily: { enabled: true, maxRoundLamports: '10000' },
        maxRecipientLamports: '10000',
        maxDailyLamports: '20000',
        maxOutstandingLamports: '20000',
        maxFeeLamports: '10',
      },
    };
    const historyTransaction = (signature, value, pre, post) => ({
      slot: 11,
      transaction: {
        signatures: [signature],
        message: {
          accountKeys: [wallet],
          instructions: [
            {
              program: 'system',
              parsed: { type: 'transfer', info: { source, destination: wallet, lamports: value } },
            },
          ],
        },
      },
      meta: { err: null, fee: 0, preBalances: [pre], postBalances: [post], innerInstructions: [] },
    });
    const txs = new Map([
      [first, historyTransaction(first, 10000, 0, 10000)],
      [second, historyTransaction(second, 100, 10000, 10100)],
    ]);
    const readRpc = async (method, args) => {
      if (method === 'getGenesisHash') return MAINNET;
      if (method === 'getMultipleAccounts')
        return {
          context: { slot: 20 },
          value: [
            {
              owner: SystemProgram.programId.toBase58(),
              executable: false,
              data: ['', 'base64'],
              lamports: balance,
            },
          ],
        };
      if (method === 'getSignaturesForAddress')
        return [
          ...(payout ? [{ signature: payoutSig, slot: 12 }] : []),
          { signature: second, slot: 11 },
          { signature: first, slot: 11 },
        ];
      if (method === 'getTransaction') {
        if (args[0] !== payoutSig) return txs.get(args[0]);
        const transfers = payout.instructions.map((ix) => SystemInstruction.decodeTransfer(ix)),
          total = transfers.reduce((n, r) => n + Number(r.lamports), 0);
        if (args[1].encoding === 'base64')
          return {
            slot: 12,
            transaction: [payout.serialize().toString('base64'), 'base64'],
            meta: { err: null, fee: 5 },
          };
        return {
          slot: 12,
          transaction: {
            signatures: [payoutSig],
            message: {
              accountKeys: [wallet, ...transfers.map((r) => r.toPubkey.toBase58())],
              instructions: [],
            },
          },
          meta: {
            err: null,
            fee: 5,
            preBalances: [10100, ...transfers.map(() => 0)],
            postBalances: [10100 - total - 5, ...transfers.map((r) => Number(r.lamports))],
          },
        };
      }
      if (method === 'getLatestBlockhash')
        return {
          context: { slot: 20 },
          value: {
            blockhash: new PublicKey(Buffer.alloc(32, 7)).toBase58(),
            lastValidBlockHeight: 100,
          },
        };
      if (method === 'getFeeForMessage') return { context: { slot: 20 }, value: 5 };
      if (method === 'simulateTransaction') return { context: { slot: 20 }, value: { err: null } };
      if (method === 'getBlockHeight') return 1;
      if (method === 'getSignatureStatuses')
        return {
          value: [
            payout && !pending ? { confirmationStatus: 'finalized', err: null, slot: 12 } : null,
          ],
        };
      if (method === 'sendTransaction') {
        sends++;
        assert.equal(sends, 1, 'No automatic resend');
        payout = Transaction.from(Buffer.from(args[0], 'base64'));
        assert.ok(payout.verifySignatures());
        payoutSig = encode58(payout.signature);
        balance -=
          payout.instructions.reduce(
            (n, ix) => n + Number(SystemInstruction.decodeTransfer(ix).lamports),
            0,
          ) + 5;
        if (loseAck) throw Error('SYNTHETIC_LOST_ACK');
        return payoutSig;
      }
      throw Error('UNEXPECTED_RPC_' + method);
    };
    const loadPolicy = () => {
      if (revoked) throw Error('AUTO_POLICY_REVOKED');
      return structuredClone(policy);
    };
    const guard = async () => {
      if (stopped) throw Error('AUTO_FINANCIAL_STOP_ASSERTED');
      return loadPolicy();
    };
    runtime = createMainnetPayoutRuntime({
      config: {
        mainnetTreasury: wallet,
        signerSid: 'DISPOSABLE_SIGNER',
        mainnetTreasuryPolicy: {
          recipient: '10000',
          plan: '10000',
          outstanding: '20000',
          daily: '20000',
          pilot: '30000',
          maxFeePerTransaction: '10',
          maxEvidenceAgeMs: 60000,
        },
      },
      installation: root,
      requestKey,
      loadPolicy,
      readRpc,
      clock,
      database,
    });
    const adapter = new ExistingPayoutAutomation(runtime, async () => {
      unlock++;
      const h = keyHandle(JSON.stringify([...walletKey.secretKey]), wallet);
      return h;
    });
    const src = { planId: fund.plan.id, snapshotHash: (await runtime.queue())[0]?.snapshotHash };
    return {
      f,
      fund,
      runtime,
      readRpc,
      adapter,
      src,
      policy,
      guard,
      root,
      acceptance,
      env,
      cert,
      clock,
      setNow: (v) => (nowClock = v),
      get sends() {
        return sends;
      },
      get unlock() {
        return unlock;
      },
      get payoutTransaction(){return payout;} ,
      get payoutSig() {
        return payoutSig;
      },
      setPending: (v) => (pending = v),
      setLoseAck: (v) => (loseAck = v),
      setRevoked: (v) => (revoked = v),
      release: async () => {
        await f.db.pool.query(
          'update payout_stop_state set stopped=false,generation=generation+1 where singleton=true',
        );
        policy.financialStopGeneration = '1';
        stopped = false;
      },
      cleanup: async () => {
        await runtime.close();
        await signingPool.end();
        await f.cleanup();
        if (root) fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await f.cleanup();
    if (root) fs.rmSync(root, { recursive: true, force: true });
    throw e;
  }
}
test('actual mainnet backend: pinned winners, STOP, reserved principal, disposable isolated signing, finality and duplicate recovery', async () => {
  const f = await setup();
  try {
    assert.equal((await f.runtime.queue())[0].qualified, true);
    const prepared = await f.adapter.prepare('hourly', f.src, f.policy);
    await assert.rejects(f.adapter.execute(prepared, f.policy, f.guard), /STOP/);
    assert.equal(f.unlock, 0);
    assert.equal(f.sends, 0);
    await f.release();
    await f.adapter.execute(prepared, f.policy, f.guard);
    const r = await f.adapter.recover(prepared);
    assert.equal(r.finalized, true);
    assert.equal(f.sends, 1);
    assert.equal(f.unlock, 1);
    const audit=await getPayoutPlanAudit(f.f.db,f.src.planId);
    const expected=audit.allocations.filter(a=>BigInt(a.allocatedLamports)>0n).map(a=>({wallet:audit.sourceLeaderboard.find(w=>w.userId===a.userId).walletAddress,lamports:String(a.allocatedLamports)})).sort((a,b)=>a.wallet.localeCompare(b.wallet));
    const actual=f.payoutTransaction.instructions.map(ix=>SystemInstruction.decodeTransfer(ix)).map(r=>({wallet:r.toPubkey.toBase58(),lamports:String(r.lamports)})).sort((a,b)=>a.wallet.localeCompare(b.wallet));
    assert.equal(expected.length,2);assert.deepEqual(actual,expected);

    assert.equal(
      (await f.f.db.pool.query('select principal::text from payout_treasury_reservations')).rows[0]
        .principal,
      '6300',
    );
    assert.equal(
      (await f.f.db.pool.query('select principal::text,fee::text from payout_treasury_settlements'))
        .rows[0].fee,
      '5',
    );
    await f.adapter.recover(prepared);
    assert.equal(f.sends, 1);
    await assert.rejects(
      f.f.db.pool.query('update payout_treasury_reservations set principal=1'),
      /immutable/i,
    );
    await assert.rejects(
      f.runtime.database.pool.query('update payout_stop_state set stopped=false'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      f.runtime.database.pool.query(
        "insert into mainnet_acceptance_revocations values('forbidden','test',default)",
      ),
      (e) => e.code === '42501',
    );
    evidence.push({
      case: 'ACTUAL_MAINNET_CODE_SYNTHETIC_RPC_ONLY',
      passed: true,
      signing: 'FRESH_DISPOSABLE_KEY',
      principal: '6300',
      fee: '5',
      sendCount: f.sends,
      realNetworkRequests: 0,
    });
  } finally {
    await f.cleanup();
  }
});
test('lost acknowledgement persists signature; revoked standing policy still permits finalized recovery without another signature or send', async () => {
  const f = await setup();
  try {
    await f.release();
    f.setPending(true);
    f.setLoseAck(true);
    const prepared = await f.adapter.prepare('hourly', f.src, f.policy);
    await f.adapter.execute(prepared, f.policy, f.guard).catch(() => {});
    assert.equal(f.sends, 1);
    f.setRevoked(true);
    f.setPending(false);
    assert.equal((await f.adapter.recover(prepared)).finalized, true);
    assert.equal(f.sends, 1);
    assert.equal(f.unlock, 1);
    evidence.push({ case: 'LOST_ACK_REVOKED_POLICY_RECOVERY', passed: true, noResend: true });
  } finally {
    await f.cleanup();
  }
});
test('mainnet acceptance rejects changed evidence, UTC coverage and REVIEW; localnet proof alone cannot authorize a mainnet execution', async () => {
  const f = await setup();
  try {
    assert.throws(
      () =>
        verifyFinancialAcceptance(
          { ...f.env, payloadBase64: Buffer.from('{}').toString('base64') },
          f.cert.publicKey.export({ type: 'spki', format: 'pem' }),
          [],
          f.clock(),
        ),
      /SIGNATURE/,
    );
    const bad = structuredClone(f.acceptance);
    delete bad.utc.coveredThrough;
    assert.throws(
      () =>
        verifyFinancialAcceptance(
          envelope(bad, f.cert.privateKey),
          f.cert.publicKey.export({ type: 'spki', format: 'pem' }),
          [],
          f.clock(),
        ),
      /COVERAGE/,
    );
    await f.f.db.pool.query(
      "insert into legacy_source_reviews(id,hourly_round_id,reason) values('new-review',$1,'INDEPENDENT_HOLD')",
      [f.f.round],
    );
    assert.equal((await f.runtime.queue())[0].qualified, false);
    assert.equal(
      (
        await f.f.db.pool.query('select mainnet_source_allowed($1,$2) allowed', [
          'HOURLY',
          f.f.round,
        ])
      ).rows[0].allowed,
      false,
    );
    assert.equal(f.unlock, 0);
    assert.equal(f.sends, 0);
    evidence.push({ case: 'TAMPER_UTC_AND_REVIEW_BLOCKED', passed: true });
  } finally {
    await f.cleanup();
  }
});

test('daily dispatch requires all 24 accepted hours, then uses immutable top-25 plan and the same isolated payout lifecycle', async () => {
  const f = await setup();
  try {
    assert.equal(
      (await f.f.db.pool.query("select mainnet_source_allowed('DAILY','day') allowed")).rows[0]
        .allowed,
      false,
    );
    const end = +f.f.dayStart + 86400000,
      now = end + 120000;
    f.setNow(now);
    for (let i = 1; i < 24; i++) {
      const starts = new Date(+f.f.dayStart + i * 3600000),
        ends = new Date(+starts + 3600000),
        id = 'daily-hour-' + i;
      await createHourlyRound(f.f.db, {
        id,
        startsAt: starts,
        endsAtExclusive: ends,
        state: 'FINALIZED',
        rulesVersion: 'DISPOSABLE_DAILY_MAINNET_TEST',
      });
      await f.f.db.pool.query('update hourly_rounds set finalized_at=$2 where id=$1', [id, ends]);
      await finalizeHourlyRewardPool(f.f.db, { hourlyRoundId: id, now: new Date(+ends + 120000) });
    }
    await f.f.db.pool.query(
      "update daily_competitions set state='FINALIZED',finalized_at=$1 where id='day'",
      [new Date(now)],
    );
    await finalizeDailyRewardPool(f.f.db, { dailyCompetitionId: 'day', now: new Date(now) });
    const hours = (
      await f.f.db.pool.query(
        'select id,starts_at,ends_at_exclusive,legacy_hour_digest(id) digest from hourly_rounds order by starts_at',
      )
    ).rows;
    const accepted = structuredClone(f.acceptance);
    accepted.issuedAt = new Date(now - 1000).toISOString();
    accepted.expiresAt = new Date(now + 3600000).toISOString();
    accepted.utc.coveredThrough = new Date(now + 300000).toISOString();
    accepted.provider.coveredThrough = accepted.utc.coveredThrough;
    accepted.hours = hours.map((h) => ({
      roundId: h.id,
      structuralHash: h.digest,
      startsAt: h.starts_at.toISOString(),
      endsAt: h.ends_at_exclusive.toISOString(),
      preCutoffCaptureHash: hash('synthetic-cutoff'),
    }));
    const env = envelope(accepted, f.cert.privateKey),
      aHash = sha(Buffer.from(env.payloadBase64, 'base64'));
    for (const h of accepted.hours)
      await f.f.db.pool.query(
        'insert into mainnet_source_acceptances(id,hourly_round_id,profile,network,genesis,structural_hash,acceptance_hash,signed_envelope,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          randomUUID(),
          h.roundId,
          accepted.profile,
          accepted.network,
          MAINNET,
          h.structuralHash,
          aHash,
          env,
          accepted.expiresAt,
        ],
      );
    fs.writeFileSync(path.join(f.root, 'mainnet-acceptance.json'), JSON.stringify(env));
    f.policy.expiresAt = accepted.expiresAt;
    assert.equal(
      (await f.f.db.pool.query("select mainnet_source_allowed('DAILY','day') allowed")).rows[0]
        .allowed,
      true,
    );
    await f.f.db.pool.query('update creator_fee_ingestion_checkpoints set last_success_at=$1', [
      new Date(now),
    ]);
    const plan = await generateDailyShadowPayoutPlan(f.f.db, {
        dailyCompetitionId: 'day',
        now: new Date(now),
      }),
      source = (await f.runtime.queue()).find((r) => r.id === plan.id);
    assert.equal(source.qualified, true);
    assert.equal(source.principalLamports, '2700');
    await f.release();
    const prepared = await f.adapter.prepare(
      'daily',
      { planId: plan.id, snapshotHash: source.snapshotHash },
      f.policy,
    );
    await f.adapter.execute(prepared, f.policy, f.guard);
    assert.equal((await f.adapter.recover(prepared)).finalized, true);
    assert.equal(f.sends, 1);
    evidence.push({
      case: 'DAILY_24_ACCEPTED_HOURS_SYNTHETIC_RPC_ONLY',
      passed: true,
      principal: '2700',
      realNetworkRequests: 0,
    });
  } finally {
    await f.cleanup();
  }
});

test('financial acceptance dry-run is read-only and publication preserves STOP and creates no payout authority', async () => {
  const f = await setup();
  try {
    const p = structuredClone(f.acceptance),
      docs = {
        cutoff: JSON.stringify({ syntheticOnly: true, kind: 'cutoff' }),
        utc: JSON.stringify({ syntheticOnly: true, kind: 'utc' }),
        funding: JSON.stringify({ syntheticOnly: true, kind: 'funding' }),
      };
    for (const text of Object.values(docs))
      fs.writeFileSync(path.join(f.root, sha(text) + '.json'), text);
    p.hours[0].preCutoffCaptureHash = sha(docs.cutoff);
    p.provider.evidenceHashes = [sha(docs.cutoff)];
    p.utc.evidenceHashes = [sha(docs.utc)];
    p.funding.evidenceHash = sha(docs.funding);
    const env = envelope(p, f.cert.privateKey),
      args = {
        pool: f.f.db.pool,
        envelope: env,
        certificate: f.cert.publicKey.export({ type: 'spki', format: 'pem' }),
        evidenceDirectory: f.root,
        rpc: f.readRpc,
        now: f.clock(),
      };
    const before = (
      await f.f.db.pool.query('select count(*)::int n from mainnet_source_acceptances')
    ).rows[0].n;
    assert.equal((await publishFinancialAcceptance(args)).published, false);
    assert.equal(
      (await f.f.db.pool.query('select count(*)::int n from mainnet_source_acceptances')).rows[0].n,
      before,
    );
    assert.equal((await publishFinancialAcceptance({ ...args, persist: true })).published, true);
    assert.equal(
      (await f.f.db.pool.query('select stopped from payout_stop_state')).rows[0].stopped,
      true,
    );
    assert.equal(
      (await f.f.db.pool.query('select count(*)::int n from payout_plan_approvals')).rows[0].n,
      0,
    );
    assert.equal(f.unlock, 0);
    assert.equal(f.sends, 0);
    evidence.push({
      case: 'READ_ONLY_ACCEPTANCE_AND_APPEND_ONLY_PUBLICATION',
      passed: true,
      transactionAuthority: 'NONE',
    });
  } finally {
    await f.cleanup();
  }
});

test('financial acceptance revocation latches without deleting evidence or requiring spending authority', async () => {
  const f = await setup();
  try {
    const hash = sha(Buffer.from(f.env.payloadBase64, 'base64'));
    assert.equal((await f.runtime.queue())[0].qualified, true);
    await revokeFinancialAcceptance(f.f.db.pool, f.root, hash, 'DISPOSABLE_REVIEW_REVOCATION');
    assert.equal((await f.runtime.queue())[0].qualified, false);
    assert.equal(
      (await f.f.db.pool.query("select localnet_source_allowed('HOURLY',$1) allowed", [f.f.round]))
        .rows[0].allowed,
      true,
    );
    assert.equal(
      (await f.f.db.pool.query("select mainnet_source_allowed('HOURLY',$1) allowed", [f.f.round]))
        .rows[0].allowed,
      false,
    );
    await assert.rejects(
      f.f.db.pool.query(
        "insert into payout_executions(id,payout_plan_id,network,treasury_address,signer_type,state,total_payout_lamports,estimated_fee_lamports,prepared_at,safety_version) values('FORBIDDEN_MAINNET',$1,'mainnet-beta',$2,'ISOLATED_TEST','PREPARED',6300,5,$3,'payout-serialized-v1')",
        [f.fund.plan.id, f.policy.wallet, f.fund.now],
      ),
      /MAINNET_QUALIFICATION_UNAVAILABLE/,
    );

    assert.equal(
      (await f.f.db.pool.query('select count(*)::int n from mainnet_source_acceptances')).rows[0].n,
      1,
    );
    assert.equal(
      (await f.f.db.pool.query('select stopped from payout_stop_state')).rows[0].stopped,
      true,
    );
    assert.equal(f.unlock, 0);
    assert.equal(f.sends, 0);
    evidence.push({ case: 'FINANCIAL_ACCEPTANCE_REVOCATION_RETAINS_EVIDENCE', passed: true });
  } finally {
    await f.cleanup();
  }
});
test('no enrolled financial database is a specific inactive state, not a null backend', () => {
  const r = createMainnetPayoutRuntime({ config: {} });
  assert.equal(r.acceptedMainnet, false);
  assert.equal(r.reason, 'MAINNET_DATABASE_ENROLLMENT_REQUIRED');
});
process.on('beforeExit', () => {
  fs.writeFileSync(
    'artifacts/operator/automation-mainnet-test-results.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        syntheticOnly: true,
        mainnetSigned: false,
        mainnetBroadcast: false,
        cases: evidence,
      },
      null,
      2,
    ),
  );
});
