import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const base = 'C:/Users/stanp/.codex/isolated-validation/paperfund-mainnet-funding-20261018';
const load = (path: string) => import(pathToFileURL(base + '/candidate/' + path).href);
const { FundingArchive } = await load('scripts/funding-archive.ts');
const { importCapturedCreatorFees, fundingProjection, connectCapturedFundingReview } = await load(
  'scripts/funding-integration.ts',
);
const { fixture } = await load('packages/db/test/legacy-beta-fixture.ts');
const { generateHourlyShadowPayoutPlan, getPayoutPlanAudit } = await load(
  'packages/db/src/payout-service.ts',
);
const { finalizeHourlyRewardPool } = await load('packages/db/src/reward-service.ts');
const { withPayoutTreasury, reservePayoutTreasury } = await load(
  'packages/db/src/payout-treasury.ts',
);
const { captureApprovalSnapshot, approvalSnapshotHash } = await load(
  'packages/db/src/payout-approval.ts',
);
test('genuine retained finalized token fee enters accepted observer once; unclaimed accrual cannot reserve treasury capital', async () => {
  const pins = JSON.parse(
    await readFile(base + '/candidate/scripts/funding-snapshot-pins.json', 'utf8'),
  );
  const archive = new FundingArchive(
    base + '/evidence/mainnet-verified',
    pins.captureManifestSha256,
    base + '/evidence/official',
    pins.officialPinsSha256,
  );
  const f = await fixture(new Date('2026-10-15T15:00:00Z'));
  try {
    await f.close();
    const now = new Date();
    await importCapturedCreatorFees(f.db, archive, now, false);
    await importCapturedCreatorFees(f.db, archive, new Date(+now + 1000), false);
    const events = (
      await f.db.pool.query(
        'select transaction_signature,creator_fee_lamports::text,verification_status from creator_fee_events',
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].creator_fee_lamports, '1');
    assert.equal(events[0].verification_status, 'VERIFIED');
    await finalizeHourlyRewardPool(f.db, { hourlyRoundId: f.round, now });
    await f.qualify();
    const plan = await generateHourlyShadowPayoutPlan(f.db, { hourlyRoundId: f.round, now });
    const audit = await getPayoutPlanAudit(f.db, plan.id);
    const snapshotHash = approvalSnapshotHash(await captureApprovalSnapshot(f.db, audit));
    const policy = {
      recipient: 10000n,
      plan: 10000n,
      outstanding: 20000n,
      daily: 20000n,
      pilot: 20000n,
      maxFeePerTransaction: 10n,
      maxEvidenceAgeMs: 60000,
    };
    connectCapturedFundingReview(f.db, archive, policy, () => +now);
    await assert.rejects(
      withPayoutTreasury(f.db, plan.id, (scoped: unknown) =>
        reservePayoutTreasury(scoped, snapshotHash),
      ),
    );
    assert.equal(
      (await f.db.pool.query('select count(*)::text n from payout_treasury_reservations')).rows[0]
        .n,
      '0',
    );
    const projection = fundingProjection(archive);
    assert.equal(projection.receivedCreatorFeeLamports, 0n);
    assert.equal(projection.reservableMainnetPrincipalLamports, 0n);
    await writeFile(
      'C:/Users/stanp/Documents/ChatGPT/Paperfund-new/artifacts/operator/actual-funding-observer.json',
      JSON.stringify(
        {
          events,
          receivedLamports: '0',
          reservableLamports: '0',
          reservations: 0,
          source: 'PINNED_ACTUAL_FINALIZED_ARCHIVE',
          realTransfers: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await f.cleanup();
  }
});
