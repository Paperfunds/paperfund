import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { ExecutionRouter } from '@paperfund/execution';
import { PumpFunProtocolAdapter } from '@paperfund/protocols';
import { recordedPumpState } from '../../protocols/test/fixtures/pump-real-chain.js';
import { createDatabase } from '../src/database.js';
import {
  createDailyCompetition,
  createHourlyRound,
  createUser,
  initializeCompetitionAccount,
  createAsset,
  createMarket,
  executePaperBuy,
  executePaperSell,
  settleHourlyRound,
} from '../src/financial-service.js';
import { legacyHourlyProof } from '../src/legacy-proof.js';
import {
  FixtureCreatorFeeSource,
  ingestCreatorFeeEvents,
  finalizeHourlyRewardPool,
  type RewardAccountingConfig,
} from '../src/reward-service.js';
import { generateHourlyShadowPayoutPlan, getPayoutPlanAudit } from '../src/payout-service.js';
import {
  installPayoutSecurity,
  PinnedOperatorVerifier,
  operatorMessage,
  changePayoutStop,
  type PayoutAction,
} from '../src/payout-security.js';
import {
  installPayoutTreasury,
  type TreasuryObservation,
  type TreasuryPolicy,
} from '../src/payout-treasury.js';
import { captureApprovalSnapshot, approvalSnapshotHash } from '../src/payout-approval.js';
import {
  approvePayoutPlan,
  dryRunPayoutExecution,
  type PayoutRpc,
} from '../src/payout-execution.js';

export async function fixture(
  start = new Date('2044-01-01T00:00:00Z'),
  realBoundary = false,
  oldSchema = false,
) {
  const name = 'legacy_beta_' + process.pid + '_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({
    connectionString: 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta',
  });
  await admin.query('create database "' + name + '"');
  const url = 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/' + name;
  // Explicit fixture-only admission. The isolated port above remains fixed;
  // production createDatabase continues to deny BUY unless separately authorized.
  const db = createDatabase(url, { authorizePaperBuy: async () => true });
  try {
    await migrate(db.client, {
      migrationsFolder: resolve(
        oldSchema ? '../before/packages/db/migrations' : 'packages/db/migrations',
      ),
    });
  } catch (error) {
    await db.close();
    await admin.query('drop database "' + name + '" with(force)');
    await admin.end();
    throw error;
  }
  const state = recordedPumpState('developed');
  const router = new ExecutionRouter([
    new PumpFunProtocolAdapter({ loadMarketState: async () => structuredClone(state) }),
  ]);
  const day = start.toISOString().slice(0, 10),
    dayStart = new Date(day + 'T00:00:00Z');
  await createDailyCompetition(db, {
    id: 'day',
    utcDate: day,
    startsAt: dayStart,
    endsAtExclusive: new Date(+dayStart + 86400000),
  });
  const round = 'hour',
    end = new Date(+start + 3600000);
  await createHourlyRound(db, {
    id: round,
    startsAt: start,
    endsAtExclusive: end,
    state: 'OPEN',
    rulesVersion: 'legacy-beta-fixture',
  });
  await createAsset(db, { id: 'asset', mintAddress: state.identity.tokenMint, decimals: 6 });
  await createAsset(db, {
    id: 'sol',
    mintAddress: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  });
  await createMarket(db, {
    id: state.identity.marketId,
    baseAssetId: 'asset',
    quoteAssetId: 'sol',
    venue: state.identity.protocolId,
    providerMarketId: state.identity.marketId,
  });
  const users = ['alice', 'bob'];
  for (const [i, user] of users.entries()) {
    const bytes = new Uint8Array(32);
    bytes[0] = i + 1;
    bytes[31] = 77;
    await createUser(db, { id: user, walletAddress: new PublicKey(bytes).toBase58() });
    await initializeCompetitionAccount(db, {
      accountId: user,
      userId: user,
      hourlyRoundId: round,
      idempotencyKey: 'start-' + user,
    });
  }
  const timestamp = realBoundary ? new Date() : new Date(+start + 60000);
  const buys = [];
  for (const user of users)
    buys.push(
      await executePaperBuy(db, router, {
        competitionAccountId: user,
        marketId: state.identity.marketId,
        requestedPaperSolLamports: 1000000000n,
        idempotencyKey: 'buy-' + user,
        authoritativeTimestamp: timestamp,
      }),
    );
  const part = await executePaperSell(db, router, {
    competitionAccountId: 'alice',
    marketId: state.identity.marketId,
    requestedTokenQuantity: buys[0]!.actualTokenOutputBaseUnits / 4n,
    idempotencyKey: 'partial',
    authoritativeTimestamp: timestamp,
  });
  const cleanup = async () => {
    await db.close();
    await admin.query('drop database "' + name + '" with(force)');
    await admin.end();
  };
  const close = async () =>
    settleHourlyRound(db, router, {
      hourlyRoundId: round,
      authoritativeTimestamp: realBoundary ? new Date() : end,
    });
  const qualify = async (rid = round) => {
    const proof = await legacyHourlyProof(db, router, rid);
    if (!proof.structural) throw Error('STRUCTURE_NOT_PROVEN:' + proof.reasons.join(','));
    await db.pool.query(
      `insert into legacy_test_qualifications(hourly_round_id,profile,proof_hash,proof) values($1,'TEST_ONLY_LOCALNET',$2,$3)`,
      [
        rid,
        proof.structuralHash,
        JSON.stringify({
          fixture: true,
          realFinancialAuthority: false,
          clock: 'SYNTHETIC_QUALIFICATION_NOT_HOST_UTC',
        }),
      ],
    );
  };
  return {
    db,
    router,
    state,
    round,
    start,
    end,
    dayStart,
    buys,
    part,
    cleanup,
    close,
    qualify,
    users,
    releaseWithoutDrop: async () => {
      await db.close();
      await admin.end();
      return name;
    },
  };
}
export async function fundAndApprove(
  f: Awaited<ReturnType<typeof fixture>>,
  testPolicy?: TreasuryPolicy,
  testTreasury?: string,
  observationTransform?: (observation:TreasuryObservation)=>TreasuryObservation,
  testRewardConfig?:RewardAccountingConfig,
) {
  const { db, round } = f,
    now = new Date(+f.end + 120000),
    sig = 'FIXTURE_FINALIZED_CREATOR_FEE';
  await ingestCreatorFeeEvents(
    db,
    new FixtureCreatorFeeSource([
      {
        transactionSignature: sig,
        eventIndex: 0,
        slot: 10n,
        eventTime: new Date(+f.start + 60000),
        creatorFeeLamports: 10000n,
        sourceProgram: 'FIXTURE_PUMP',
        observedAt: now,
        verificationStatus: 'VERIFIED',
      },
    ]),
  );
  await finalizeHourlyRewardPool(db, { hourlyRoundId: round, now, ...(testRewardConfig?{config:testRewardConfig}:{}) });
  const fee = (await db.pool.query('select id from creator_fee_events')).rows[0].id;
  await db.pool.query(
    `insert into creator_fee_observations(id,transaction_signature,event_index,slot,block_time,source_program,token_mint,creator_wallet,creator_fee_lamports,confirmation_status,first_observed_at,last_checked_at,finalized_at,canonical_creator_fee_event_id)
 values('fixture-observation',$1,0,10,$2,'FIXTURE_PUMP',$3,'fixture-authority',10000,'FINALIZED',$4,$4,$4,$5)`,
    [sig, new Date(+f.start + 60000), f.state.identity.tokenMint, now, fee],
  );
  await db.pool.query(
    `insert into creator_fee_ingestion_checkpoints(source_id,network,token_mint,creator_wallet,last_finalized_slot,last_success_at) values('fixture-source','localnet',$1,'fixture-authority',10,$2)`,
    [f.state.identity.tokenMint, now],
  );
  await f.qualify();
  const plan = await generateHourlyShadowPayoutPlan(db, { hourlyRoundId: round, now });
  const keys = Object.fromEntries(
    ['approver', 'executor', 'safety'].map((id) => [id, generateKeyPairSync('ed25519')]),
  );
  const treasuryBytes = new Uint8Array(32);
  treasuryBytes[0] = 99;
  treasuryBytes[31] = 88;
  const treasury = testTreasury ?? new PublicKey(treasuryBytes).toBase58();
  const environment = 'legacy-localnet-fixture',
    clock = () => +now;
  const verifier = new PinnedOperatorVerifier(
    Object.fromEntries(
      Object.entries(keys).map(([id, key]) => [
        id,
        {
          subject: id,
          publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          permissions: (id === 'approver'
            ? ['APPROVE']
            : id === 'safety'
              ? ['STOP', 'RELEASE']
              : ['EXECUTE', 'RETRY']) as PayoutAction[],
        },
      ]),
    ),
  );
  installPayoutSecurity(db, {
    controlPool: db.pool,
    stopWritePool: db.pool,
    verifier,
    environment,
    clock,
  });
  const state = { received: 10100n, funding: true };
  const h = (x: string) => createHash('sha256').update(x).digest('hex');
  installPayoutTreasury(db, {
    network: 'localnet',
    treasury,
    clock,
    policy: testPolicy ?? {
      recipient: 10000n,
      plan: 10000n,
      outstanding: 20000n,
      daily: 20000n,
      pilot: 20000n,
      maxFeePerTransaction: 10n,
      maxEvidenceAgeMs: 60000,
    },
    observe: async (planId, planSnapshotHash): Promise<TreasuryObservation> => {
      const proof = await legacyHourlyProof(db, f.router, round);
      const observation:TreasuryObservation = {
        planId,
        planSnapshotHash,
        network: 'localnet',
        treasury,
        observedAt: clock(),
        finalizedSlot: 11n,
        balance: state.received,
        receipts: state.funding
          ? [
              {
                identity: 'FIXTURE_RECEIVED_CASH:0',
                kind: 'CREATOR_FEE',
                creatorFeeEventId: fee,
                lamports: 10000n,
                finalizedSlot: 11n,
                evidenceHash: h('fixture-original-receipt'),
              },
              {
                identity: 'FIXTURE_NETWORK_FEE_CAPITAL:0',
                kind: 'NETWORK_FEES',
                creatorFeeEventId: null,
                lamports: 100n,
                finalizedSlot: 11n,
                evidenceHash: h('fixture-fee-capital'),
              },
            ]
          : [],
        settlementState: proof.localnetTestAccepted ? 'ACCEPTED' : 'REVIEW',
        settlementEvidenceHash: proof.structuralHash,
        fundingState: state.funding ? 'COMPLETE' : 'REVIEW',
        fundingEvidenceHash: h('fixture-complete-history'),
      };
      return observationTransform?observationTransform(observation):observation;
    },
  });
  const request = (action: PayoutAction, id = plan.id, hash = '0'.repeat(64), generation = '1') => {
    const issuer =
      action === 'APPROVE'
        ? 'approver'
        : ['STOP', 'RELEASE'].includes(action)
          ? 'safety'
          : 'executor';
    const body = {
      version: 'paperfund-payout-authority-v1' as const,
      issuer,
      action,
      planId: id,
      snapshotHash: hash,
      environment,
      executionEnvironment: ['EXECUTE', 'RETRY'].includes(action) ? 'localnet:' + treasury : '',
      nonce: randomUUID(),
      expiresAt: clock() + 240000,
      stopGeneration: generation,
      reason: 'Explicit isolated localnet fixture authorization',
    };
    return {
      ...body,
      signature: sign(null, Buffer.from(operatorMessage(body)), keys[issuer]!.privateKey).toString(
        'base64',
      ),
    };
  };
  const release = () => changePayoutStop(db, request('RELEASE', '*', '0'.repeat(64), '0'));
  const approve = async () => {
    const audit = (await getPayoutPlanAudit(db, plan.id))!;
    const hash = approvalSnapshotHash(await captureApprovalSnapshot(db, audit));
    return approvePayoutPlan(db, {
      planId: plan.id,
      now,
      approverIdentifier: 'approver',
      authority: request('APPROVE', plan.id, hash),
    });
  };
  let prepared = 0;
  const rpc: PayoutRpc = {
    assertNetwork: async (n) => {
      if (n !== 'localnet') throw Error('FIXTURE_NETWORK_ONLY');
    },
    getBalance: async () => state.received,
    prepareTransaction: async (from, recipients) => {
      prepared++;
      const blockhash = new PublicKey(new Uint8Array(32).fill(7)).toBase58(),
        tx = new Transaction({ feePayer: new PublicKey(from), recentBlockhash: blockhash });
      for (const r of recipients)
        tx.add(
          SystemProgram.transfer({
            fromPubkey: new PublicKey(from),
            toPubkey: new PublicKey(r.destination),
            lamports: r.lamports,
          }),
        );
      return {
        unsignedTransaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
        feeLamports: 5n,
        recentBlockhash: blockhash,
        lastValidBlockHeight: 100n,
      };
    },
    sendSignedTransaction: async () => {
      throw Error('BROADCAST_DISABLED_TRAP');
    },
    getBlockHeight: async () => 1n,
    getSignatureStatus: async () => null,
    getFinalizedTransfers: async () => null,
  };
  const config = {
    enabled: false,
    network: 'localnet' as const,
    mainnetConfirmed: false,
    treasuryAddress: treasury,
    maxRecipientsPerBatch: 8,
  };
  return {
    plan,
    now,
    state,
    request,
    release,
    approve,
    treasury,
    config,
    rpc,
    get prepared() {
      return prepared;
    },
    dry: () => dryRunPayoutExecution(db, { planId: plan.id, config, rpc }),
  };
}
