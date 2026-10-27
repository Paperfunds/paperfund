import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { FundingArchive, SUPPLIED_WALLET, FUNDING_MINT } from '../../../scripts/funding-archive.js';
import {
  importCapturedCreatorFees,
  fundingProjection,
  connectCapturedFundingReview,
} from '../../../scripts/funding-integration.js';
import { fixture, fundAndApprove } from './legacy-beta-fixture.js';
import { finalizeHourlyRewardPool } from '../src/reward-service.js';
import { generateHourlyShadowPayoutPlan, getPayoutPlanAudit } from '../src/payout-service.js';
import { withPayoutTreasury, reservePayoutTreasury } from '../src/payout-treasury.js';
import { captureApprovalSnapshot, approvalSnapshotHash } from '../src/payout-approval.js';
import { executeApprovedPayoutPlan } from '../src/payout-execution.js';
import { changePayoutStop } from '../src/payout-security.js';
const pins = JSON.parse(readFileSync('scripts/funding-snapshot-pins.json', 'utf8')) as {
  captureManifestSha256: string;
  officialPinsSha256: string;
};
const root = resolve('../evidence/mainnet-verified'),
  official = resolve('../evidence/official');
const archive = () =>
  new FundingArchive(root, pins.captureManifestSha256, official, pins.officialPinsSha256);
const policy = {
  recipient: 10000n,
  plan: 10000n,
  outstanding: 20000n,
  daily: 20000n,
  pilot: 20000n,
  maxFeePerTransaction: 10n,
  maxEvidenceAgeMs: 60000,
};

it('replays actual finalized ownership, single real fee and absent claims without confusing wallet transfers or unrelated pools with revenue', () => {
  const a = archive(),
    p = fundingProjection(a);
  expect(a.identity).toEqual({ tokenMint: FUNDING_MINT, creatorWallet: SUPPLIED_WALLET });
  expect(a.config.creatorMatchesSupplied).toBe(true);
  expect(a.config.sharingExists).toBe(false);
  expect(a.config.pumpSwapPoolExists).toBe(false);
  expect(a.config.currentCurveFeeBps).toEqual({ protocolFeeBps: '95', creatorFeeBps: '30' });
  expect(a.verifiedEvents).toHaveLength(1);
  expect(a.verifiedEvents[0]!.creatorFeeLamports).toBe(1n);
  expect(a.successfulClaims).toEqual([]);
  expect(a.walletBalance).toBe(0n);
  expect(a.rpcReportedHistoryExhausted).toBe(true);
  expect(p).toMatchObject({
    earnedLamports: 1n,
    accruedVaultExcessLamports: 1n,
    receivedCreatorFeeLamports: 0n,
    designatedTreasury: null,
    reservableMainnetPrincipalLamports: 0n,
    fundingState: 'REVIEW',
    treasuryReceipts: [],
  });
  writeFileSync(
    '../evidence/funding-projection.json',
    JSON.stringify(p, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
});

it('rejects changed capture bytes or manifest pins before any accounting import', () => {
  const copied = mkdtempSync(resolve(tmpdir(), 'paperfund-funding-integrity-'));
  cpSync(root, copied, { recursive: true });
  expect(() => new FundingArchive(root, '0'.repeat(64), official, pins.officialPinsSha256)).toThrow(
    'CAPTURE_MANIFEST_PIN_MISMATCH',
  );
  const manifest = JSON.parse(readFileSync(resolve(copied, 'provenance.json'), 'utf8')) as {
    captures: { file: string }[];
  };
  writeFileSync(resolve(copied, manifest.captures[0]!.file), '{}');
  expect(
    () => new FundingArchive(copied, pins.captureManifestSha256, official, pins.officialPinsSha256),
  ).toThrow('RPC_BYTES_CHANGED');
});

it('imports actual fee provenance once through accepted ingestion, then refuses treasury reservation and approval without received funds', async () => {
  const a = archive(),
    f = await fixture(new Date('2026-10-15T15:00:00Z'));
  try {
    const now = new Date();
    await f.close();
    const first = await importCapturedCreatorFees(f.db, a, now, false);
    expect(first.finalized).toBe(1);
    await importCapturedCreatorFees(f.db, a, new Date(+now + 1000), false);
    const events = (await f.db.pool.query('select * from creator_fee_events')).rows;
    expect(events).toHaveLength(1);
    expect(events[0].creator_fee_lamports).toBe('1');
    expect(events[0].normalized_metadata.captureManifestSha256).toBe(a.sourceHash);
    expect(events[0].hourly_round_id).toBe(f.round);
    expect(events[0].accounting_status).toBe('ATTRIBUTED');
    const observations = (await f.db.pool.query('select * from creator_fee_observations')).rows;
    expect(observations).toHaveLength(1);
    expect(observations[0].confirmation_status).toBe('FINALIZED');
    expect(observations[0].evidence.transactionResponseSha256).toMatch(/^[a-f0-9]{64}$/);
    const reward = await finalizeHourlyRewardPool(f.db, { hourlyRoundId: f.round, now });
    expect(
      (await f.db.pool.query('select accounting_status from creator_fee_events')).rows[0]
        .accounting_status,
    ).toBe('COUNTED');
    await expect(
      generateHourlyShadowPayoutPlan(f.db, { hourlyRoundId: f.round, now }),
    ).rejects.toMatchObject({ code: 'PAYOUT_SETTLEMENT_REVIEW' });
    // A controlled local qualification only lets us reach the next independent funding barrier.
    await f.qualify();
    const plan = await generateHourlyShadowPayoutPlan(f.db, { hourlyRoundId: f.round, now });
    const connected = connectCapturedFundingReview(f.db, a, policy, () => +now);
    const observation = await connected.observe(plan.id, 'a'.repeat(64));
    expect(observation.receipts).toEqual([]);
    expect(observation.balance).toBe(0n);
    expect(observation.fundingState).toBe('REVIEW');
    const hash = approvalSnapshotHash(
      await captureApprovalSnapshot(f.db, (await getPayoutPlanAudit(f.db, plan.id))!),
    );
    await expect(
      withPayoutTreasury(f.db, plan.id, (db) => reservePayoutTreasury(db, plan.id, hash)),
    ).rejects.toMatchObject({ code: 'PAYOUT_TREASURY_EVIDENCE_UNAVAILABLE' });
    for (const table of [
      'payout_treasury_receipts',
      'payout_treasury_reservations',
      'payout_plan_approvals',
      'payout_executions',
      'payout_signed_transactions',
    ])
      expect((await f.db.pool.query('select count(*)::int n from ' + table)).rows[0].n).toBe(0);
    expect((await f.db.pool.query('select stopped from payout_stop_state')).rows[0].stopped).toBe(
      true,
    );
    writeFileSync(
      '../evidence/mainnet-funding-isolated-integration.json',
      JSON.stringify(
        {
          scope: 'ISOLATED_DB_REAL_CAPTURE_NO_MAINNET_EFFECTS',
          sourceHash: a.sourceHash,
          events: events.map((e) => ({
            id: e.id,
            lamports: e.creator_fee_lamports,
            round: e.hourly_round_id,
            provenance: e.normalized_metadata,
          })),
          reward,
          planPrincipal: plan.prizePoolLamports,
          receipts: 0,
          reservations: 0,
          approvals: 0,
          executions: 0,
          stop: true,
          providerQualified: false,
          utcQualified: false,
        },
        (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
  } finally {
    await f.cleanup();
  }
}, 30000);

it('retains the accepted independent synthetic funded path and STOP without payment signing', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    await p.release();
    await p.approve();
    expect((await p.dry()).totalPayoutLamports).toBe(6300n);

    await changePayoutStop(f.db, p.request('STOP', '*', '0'.repeat(64), '1'));
    const hash = (
      await f.db.pool.query(
        'select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',
        [p.plan.id],
      )
    ).rows[0].plan_snapshot_hash;
    await expect(
      executeApprovedPayoutPlan(f.db, {
        planId: p.plan.id,
        config: { ...p.config, enabled: true },
        rpc: p.rpc,
        signer: {
          type: 'TRAP',
          publicKey: p.treasury,
          signTransaction: async () => {
            throw Error('SIGN_FORBIDDEN');
          },
        },
        authority: p.request('EXECUTE', p.plan.id, hash, '2'),
        now: p.now,
      }),
    ).rejects.toThrow();
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0].n,
    ).toBe(1);
    expect((await f.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      0,
    );
  } finally {
    await f.cleanup();
  }
}, 30000);

it.each([
  ['recipient', 'PAYOUT_RECIPIENT_LIMIT_HOLD'],
  ['plan', 'PAYOUT_EXPOSURE_LIMIT_HOLD'],
  ['outstanding', 'PAYOUT_EXPOSURE_LIMIT_HOLD'],
  ['daily', 'PAYOUT_DAILY_LIMIT_HOLD'],
  ['pilot', 'PAYOUT_EXPOSURE_LIMIT_HOLD'],
] as const)(
  'enforces explicit test %s ceiling before admitting any reservation',
  async (key, code) => {
    const f = await fixture();
    try {
      await f.close();
      const p = await fundAndApprove(f, { ...policy, [key]: 1n });
      await p.release();
      await expect(p.approve()).rejects.toMatchObject({ code });
      expect(
        (await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0]
          .n,
      ).toBe(0);
      expect(
        (await f.db.pool.query('select count(*)::int n from payout_plan_approvals')).rows[0].n,
      ).toBe(0);
    } finally {
      await f.cleanup();
    }
  },
  30000,
);

it('rejects an unsigned network fee exceeding its explicit test ceiling', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f, { ...policy, maxFeePerTransaction: 1n });
    await p.release();
    await p.approve();
    await expect(p.dry()).rejects.toMatchObject({ code: 'PAYOUT_NETWORK_FEE_LIMIT_HOLD' });
    expect((await f.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      0,
    );
  } finally {
    await f.cleanup();
  }
}, 30000);
