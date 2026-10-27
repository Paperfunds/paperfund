import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, sign, verify, createPublicKey } from 'node:crypto';
import { installPayoutSecurity, operatorMessage } from '../../packages/db/src/payout-security.ts';
import { installPayoutTreasury } from '../../packages/db/src/payout-treasury.ts';
import { getPayoutPlanAudit } from '../../packages/db/src/payout-service.ts';
import {
  captureApprovalSnapshot,
  approvalSnapshotHash,
} from '../../packages/db/src/payout-approval.ts';
import {
  verifyFinancialAcceptance,
  verifyTreasuryHistory,
  MainnetPayoutRpc,
} from './mainnet-evidence.mjs';
import { amount, fail, sha, safeError } from './automation-core.mjs';
import { assertCurrentQuoteSourceScope } from './current-quote-acceptance.mjs';

export function standingPayoutAuthority({ loadPolicy, requestKey, signerSid, clock = Date.now }) {
  const publicKey = createPublicKey(requestKey);
  const reason = (p) => 'standing:' + p.id + ':' + sha(JSON.stringify(p));
  function scope(r, p) {
    if (
      !['APPROVE', 'EXECUTE'].includes(r.action) ||
      r.reason !== reason(p) ||
      r.environment !== 'paperfund-mainnet-automation-v1' ||
      r.executionEnvironment !== 'mainnet-beta:' + p.wallet ||
      r.stopGeneration !== p.financialStopGeneration
    )
      fail('PAYOUT_STANDING_SCOPE_INVALID');
    if (r.issuer !== 'standing-' + (r.action === 'APPROVE' ? 'approval' : 'execution'))
      fail('PAYOUT_STANDING_SCOPE_INVALID');
    return {
      subject: r.action === 'APPROVE' ? 'operator:' + p.operator : 'isolated-executor:' + signerSid,
      permissions: [r.action],
    };
  }
  return {
    verifier: {
      async verify(r) {
        const p = loadPolicy(clock());
        const actor = scope(r, p);
        if (
          !verify(
            null,
            Buffer.from(operatorMessage(r)),
            publicKey,
            Buffer.from(r.signature, 'base64'),
          )
        )
          fail('PAYOUT_STANDING_SIGNATURE_INVALID');
        return actor;
      },
    },
    async authorize(action, planId, snapshotHash, p) {
      const current = loadPolicy(clock());
      if (sha(JSON.stringify(current)) !== sha(JSON.stringify(p))) fail('POLICY_CHANGED');
      const request = {
        version: 'paperfund-payout-authority-v1',
        issuer: 'standing-' + (action === 'APPROVE' ? 'approval' : 'execution'),
        action,
        planId,
        snapshotHash,
        environment: 'paperfund-mainnet-automation-v1',
        executionEnvironment: 'mainnet-beta:' + p.wallet,
        nonce: randomUUID(),
        expiresAt: Math.min(clock() + 240000, Date.parse(p.expiresAt)),
        stopGeneration: p.financialStopGeneration,
        reason: reason(p),
      };
      const actor = scope(request, p);
      request.signature = sign(null, Buffer.from(operatorMessage(request)), requestKey).toString(
        'base64',
      );
      return { request, subject: actor.subject };
    },
  };
}
export async function assertMainnetSource(database, audit, p, envelope) {
  if (!audit) fail('PAYOUT_SOURCE_MISMATCH');
  const hourly = audit.competitionType === 'HOURLY';
  const hours = (
    await database.pool.query(
      hourly
        ? 'select id from hourly_rounds where id=$1'
        : 'select r.id from hourly_rounds r join daily_competitions d on r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive where d.id=$1 order by r.starts_at',
      [audit.hourlyRoundId ?? audit.dailyCompetitionId],
    )
  ).rows;
  if (hours.length !== (hourly ? 1 : 24)) fail('SOURCE_HOUR_COVERAGE_INVALID');
  const allowed = (
    await database.pool.query('select mainnet_source_allowed($1,$2) allowed', [
      audit.competitionType,
      audit.hourlyRoundId ?? audit.dailyCompetitionId,
    ])
  ).rows[0]?.allowed;
  if (allowed !== true) fail('MAINNET_SOURCE_NOT_ACCEPTED');
  for (const hour of hours) {
    const accepted = p.hours.find((h) => h.roundId === hour.id);
    if (!accepted) fail('SOURCE_ACCEPTANCE_MISSING');
    await assertCurrentQuoteSourceScope(database.pool, p, accepted);
    const row = (
      await database.pool.query(
        'select q.structural_hash,q.signed_envelope,legacy_hour_digest(q.hourly_round_id) current_hash from mainnet_source_acceptances q where q.hourly_round_id=$1 and q.acceptance_hash=$2',
        [hour.id, p.acceptanceHash],
      )
    ).rows[0];
    if (
      !row ||
      row.structural_hash !== accepted.structuralHash ||
      row.current_hash !== accepted.structuralHash ||
      approvalSnapshotHash(row.signed_envelope) !== approvalSnapshotHash(envelope)
    )
      fail('SOURCE_ACCEPTANCE_CHANGED');
  }
  return approvalSnapshotHash(p.hours.filter((h) => hours.some((r) => r.id === h.roundId)));
}
export function createMainnetPayoutRuntime({
  config,
  installation,
  requestKey,
  loadPolicy,
  readRpc,
  clock = Date.now,
  database: injectedDatabase,
}) {
  if (
    (!config.mainnetDatabaseUrl || config.mainnetEnrollmentState === 'PENDING') &&
    !injectedDatabase
  )
    return {
      acceptedMainnet: false,
      reason: 'MAINNET_DATABASE_ENROLLMENT_REQUIRED',
      async close() {},
    };
  const pool =
    injectedDatabase?.pool ??
    new pg.Pool({
      connectionString: config.mainnetDatabaseUrl,
      max: 4,
      connectionTimeoutMillis: 3000,
      statement_timeout: 15000,
      application_name: 'paperfund-isolated-mainnet-payout',
    });
  pool.on?.('error', () => {});
  const database = injectedDatabase ?? { pool, close: () => pool.end() };
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(installation, name), 'utf8').replace(/^\uFEFF/, ''));
  const loadAcceptance = () => {
    if (!fs.existsSync(path.join(installation, 'mainnet-acceptance.json')))
      fail('FINANCIAL_ACCEPTANCE_REQUIRED');
    const envelope = read('mainnet-acceptance.json');
    const p = verifyFinancialAcceptance(
      envelope,
      fs.readFileSync(path.join(installation, 'standing-policy-root.cer')),
      read('mainnet-acceptance-revocations.json'),
      clock(),
    );
    if (
      config.mainnetFundingModel !== undefined &&
      (config.mainnetFundingModel !== 'CREATOR_SPLIT_V1' ||
        p.funding.model !== config.mainnetFundingModel ||
        p.funding.platformWallet !== config.platformWallet)
    )
      fail('MAINNET_FUNDING_MODEL_MISMATCH');
    return { p, envelope };
  };
  const authority = standingPayoutAuthority({
    loadPolicy,
    requestKey,
    signerSid: config.signerSid,
    clock,
  });
  installPayoutSecurity(database, {
    controlPool: pool,
    verifier: authority.verifier,
    environment: 'paperfund-mainnet-automation-v1',
    clock,
  });
  const limits = config.mainnetTreasuryPolicy;
  if (!limits) fail('MAINNET_TREASURY_LIMITS_REQUIRED');
  installPayoutTreasury(database, {
    network: 'mainnet-beta',
    treasury: config.mainnetTreasury,
    clock,
    policy: {
      recipient: amount(limits.recipient),
      plan: amount(limits.plan),
      outstanding: amount(limits.outstanding),
      daily: amount(limits.daily),
      pilot: amount(limits.pilot),
      maxFeePerTransaction: amount(limits.maxFeePerTransaction),
      maxEvidenceAgeMs: limits.maxEvidenceAgeMs,
      ...(limits.reserveLamports !== undefined
        ? { reserveLamports: amount(limits.reserveLamports) }
        : {}),
    },
    observe: async (planId, planSnapshotHash) => {
      const { p, envelope } = loadAcceptance();
      if (p.wallet !== config.mainnetTreasury) fail('PAYOUT_TREASURY_MISMATCH');
      const audit = await getPayoutPlanAudit(database, planId);
      if (!audit) fail('PAYOUT_SOURCE_MISMATCH');
      const settlementEvidenceHash = await assertMainnetSource(database, audit, p, envelope),
        cash = await verifyTreasuryHistory(readRpc, p, config.platformWallet);
      return {
        planId,
        planSnapshotHash,
        network: 'mainnet-beta',
        treasury: p.wallet,
        observedAt: clock(),
        ...cash,
        settlementState: 'ACCEPTED',
        settlementEvidenceHash,
        fundingState: 'COMPLETE',
        fundingEvidenceHash: p.funding.evidenceHash,
      };
    },
  });
  const effects = new AsyncLocalStorage();
  const rpc = new MainnetPayoutRpc(readRpc, async () => {
    const g = effects.getStore();
    if (!g) fail('PAYOUT_EFFECT_SCOPE_REQUIRED');
    await g();
  });
  return {
    acceptedMainnet: true,
    database,
    rpc,
    authorize: async (action, planId, snapshotHash, p) => {
      const { p: accepted, envelope } = loadAcceptance(),
        audit = await getPayoutPlanAudit(database, planId);
      await assertMainnetSource(database, audit, accepted, envelope);
      if (approvalSnapshotHash(await captureApprovalSnapshot(database, audit)) !== snapshotHash)
        fail('PAYOUT_SNAPSHOT_CHANGED');
      const channel = audit.competitionType === 'HOURLY' ? 'hourly' : 'daily';
      if (
        p.wallet !== config.mainnetTreasury ||
        accepted.wallet !== p.wallet ||
        accepted.mint !== p.mint ||
        p.payouts[channel]?.enabled !== true ||
        audit.prizePoolLamports > amount(p.payouts[channel].maxRoundLamports) ||
        audit.allocations.some((a) => a.allocatedLamports > amount(p.payouts.maxRecipientLamports))
      )
        fail('PAYOUT_POLICY_LIMIT');
      return authority.authorize(action, planId, snapshotHash, p);
    },
    clock,
    runGuarded: (g, run) => effects.run(g, run),
    config: {
      enabled: true,
      network: 'mainnet-beta',
      mainnetConfirmed: true,
      treasuryAddress: config.mainnetTreasury,
      maxRecipientsPerBatch: Math.min(config.mainnetMaxRecipientsPerBatch ?? 8, 8),
      mainnetMaxPlanLamports: amount(limits.plan),
    },
    async status() {
      try {
        const { p } = loadAcceptance();
        if (p.wallet !== config.mainnetTreasury) fail('PAYOUT_TREASURY_MISMATCH');
        const role = (
          await pool.query(
            'select rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user',
          )
        ).rows[0];
        if (!injectedDatabase && (role.rolsuper || role.rolcreatedb || role.rolcreaterole))
          fail('DEDICATED_MAINNET_DATABASE_ROLE_REQUIRED');
        if (
          !(await pool.query("select to_regclass('public.mainnet_source_acceptances') present"))
            .rows[0].present
        )
          fail('MAINNET_SCHEMA_NOT_DEPLOYED');
        if (Date.parse(p.utc.coveredThrough) < clock()) fail('UTC_ACCEPTANCE_COVERAGE_EXPIRED');
        return {
          accepted: true,
          provider: 'QUALIFIED',
          utc: 'QUALIFIED',
          profile: 'MAINNET_FINALIZED_V1',
          acceptanceHash: p.acceptanceHash,
          expiresAt: p.expiresAt,
        };
      } catch (e) {
        return { accepted: false, reason: safeError(e) };
      }
    },
    async queue() {
      const rows = (
          await pool.query(
            "select id,competition_type,prize_pool_lamports::text from payout_plans where state in ('VALIDATED','APPROVED','PAYING') order by calculated_at",
          )
        ).rows,
        out = [];
      for (const r of rows) {
        try {
          const { p, envelope } = loadAcceptance(),
            audit = await getPayoutPlanAudit(database, r.id);
          await assertMainnetSource(database, audit, p, envelope);
          out.push({
            id: r.id,
            type: r.competition_type,
            principalLamports: r.prize_pool_lamports,
            qualified: true,
            snapshotHash: approvalSnapshotHash(await captureApprovalSnapshot(database, audit)),
          });
        } catch (e) {
          out.push({
            id: r.id,
            type: r.competition_type,
            principalLamports: r.prize_pool_lamports,
            qualified: false,
            reason: safeError(e),
          });
        }
      }
      return out;
    },
    async close() {
      if (!injectedDatabase) await pool.end();
    },
  };
}
