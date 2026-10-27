import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixture, fundAndApprove } from './legacy-beta-fixture.js';
import {
  previewPayoutTreasury,
  reservePayoutTreasury,
  withPayoutTreasury,
  type TreasuryObservation,
} from '../src/payout-treasury.js';
const h = 'a'.repeat(64);
async function setup(buffer = false) {
  const f = await fixture();
  await f.close();
  await f.db.pool.query(
    readFileSync('packages/db/isolated/current-quotes/platform-accounting.sql', 'utf8'),
  );
  const controls = {
    partial: false,
    duplicate: false,
    changed: false,
    short: false,
    extra: false,
    lowReserve: false,
  };
  const funded = await fundAndApprove(
    f,
    {
      recipient: 10000n,
      plan: 10000n,
      outstanding: 20000n,
      daily: 20000n,
      pilot: 20000n,
      maxFeePerTransaction: 10n,
      maxEvidenceAgeMs: 60000,
      reserveLamports: 50n,
    },
    undefined,
    (o: TreasuryObservation) => {
      const fee = o.receipts[0]!.creatorFeeEventId!,
        allocation = (lamports: bigint) => [{ creatorFeeEventId: fee, lamports }];
      const principal = controls.partial ? 8000n : 9000n;
      const creatorReceipt = {
        ...o.receipts[0]!,
        identity: 'test-reward-part-a',
        lamports: 8000n,
        allocations: allocation(8000n),
      };
      return {
        ...o,
        balance: principal + (controls.lowReserve ? 30n : 100n) - (controls.short ? 1n : 0n),
        receipts: [
          creatorReceipt,
          ...(controls.partial
            ? []
            : [
                {
                  ...creatorReceipt,
                  identity: 'test-reward-part-b',
                  lamports: 1000n,
                  allocations: allocation(1000n),
                },
              ]),
          { ...o.receipts[1]!, lamports: controls.lowReserve ? 30n : 100n },
        ],
        creatorClaims: [
          {
            identity: 'test-claim',
            grossLamports: 10000n,
            allocations: allocation(10000n),
            finalizedSlot: 11n,
            evidenceHash: h,
          },
        ],
        platformSettlements: [
          {
            identity: 'test-platform:0',
            claimIdentity: 'test-claim',
            kind: 'TRANSFER' as const,
            destination: 'separate-platform',
            lamports: controls.extra ? 1000n : 990n,
            allocations: allocation(controls.extra ? 1000n : 990n),
            finalizedSlot: 11n,
            evidenceHash: controls.changed ? 'b'.repeat(64) : h,
          },
          {
            identity: controls.duplicate ? 'test-platform:0' : 'test-claim:fee',
            claimIdentity: 'test-claim',
            kind: 'COST' as const,
            destination: 'NETWORK_FEE',
            lamports: 10n,
            allocations: allocation(10n),
            finalizedSlot: 11n,
            evidenceHash: h,
          },
        ],
      };
    },
    buffer
      ? {
          allocationMode: 'BUFFER_ACCUMULATION',
          baselineWindow: 12,
          lambdaBps: 6000n,
          configurationVersion: 'isolated-buffer-test',
        }
      : undefined,
  );
  return { f, funded, controls };
}
it('reconciles gross split, claim cost and player liabilities without receiving platform cash; preview keeps STOP and writes nothing', async () => {
  const { f, funded } = await setup();
  try {
    const p = await previewPayoutTreasury(f.db, funded.plan.id);
    expect(p.playerTreasuryBalance).toBe(9100n);
    expect(p.unpaidLiabilities).toBe(9000n);
    expect(p.platformSettled).toBe(1000n);
    expect(p.principal).toBe(6300n);
    expect(p.financialAuthority).toBe('NONE');
    expect((await f.db.pool.query('select stopped from payout_stop_state')).rows[0].stopped).toBe(
      true,
    );
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_creator_distribution_evidence'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0].n,
    ).toBe(0);
  } finally {
    await f.cleanup();
  }
});
it('preserves 58/27/5/10 and holds buffer and daily capital independently of the hourly prize', async () => {
  const { f, funded } = await setup(true);
  try {
    const p = await previewPayoutTreasury(f.db, funded.plan.id);
    expect(p.principal).toBe(5800n);
    expect(p.unpaidLiabilities).toBe(9000n);
    expect(p.platformSettled).toBe(1000n);
    const pool = (
      await f.db.pool.query(
        'select daily_allocation_lamports,explicit_buffer_contribution_lamports,platform_allocation_lamports from hourly_reward_pools',
      )
    ).rows[0];
    expect(pool).toMatchObject({
      daily_allocation_lamports: '2700',
      explicit_buffer_contribution_lamports: '500',
      platform_allocation_lamports: '1000',
    });
  } finally {
    await f.cleanup();
  }
});
it('holds partial funding, excess platform cost, duplicate receipts and insufficient actual balance', async () => {
  const { f, funded, controls } = await setup();
  try {
    controls.partial = true;
    await expect(previewPayoutTreasury(f.db, funded.plan.id)).rejects.toMatchObject({
      code: 'PAYOUT_CREATOR_REVENUE_NOT_RECEIVED',
    });
    controls.partial = false;
    controls.duplicate = true;
    await expect(previewPayoutTreasury(f.db, funded.plan.id)).rejects.toMatchObject({
      code: 'PAYOUT_PLATFORM_SETTLEMENT_INVALID',
    });
    controls.duplicate = false;
    controls.extra = true;
    await expect(previewPayoutTreasury(f.db, funded.plan.id)).rejects.toThrow();
    controls.extra = false;
    controls.short = true;
    await expect(previewPayoutTreasury(f.db, funded.plan.id)).rejects.toMatchObject({
      code: 'PAYOUT_TREASURY_BALANCE_MISMATCH',
    });
    controls.short = false;
    controls.lowReserve = true;
    await expect(previewPayoutTreasury(f.db, funded.plan.id)).rejects.toMatchObject({
      code: 'PAYOUT_TREASURY_INSUFFICIENT',
    });
    controls.lowReserve = false;
    expect((await previewPayoutTreasury(f.db, funded.plan.id)).unpaidLiabilities).toBe(9000n);
  } finally {
    await f.cleanup();
  }
});
it('persists immutable external claims and platform evidence once, recovers without double credit and rejects changed history', async () => {
  const { f, funded, controls } = await setup();
  try {
    const first = await previewPayoutTreasury(f.db, funded.plan.id);
    await withPayoutTreasury(f.db, funded.plan.id, (db) =>
      reservePayoutTreasury(db, funded.plan.id, first.snapshotHash),
    );
    const second = await previewPayoutTreasury(f.db, funded.plan.id);
    expect(second).toEqual(first);
    await withPayoutTreasury(f.db, funded.plan.id, (db) =>
      reservePayoutTreasury(db, funded.plan.id, first.snapshotHash),
    );
    expect(
      (await f.db.pool.query('select count(*)::int n from payout_creator_distribution_evidence'))
        .rows[0].n,
    ).toBe(3);
    await expect(
      f.db.pool.query(
        "delete from payout_creator_distribution_evidence where identity='test-claim'",
      ),
    ).rejects.toThrow();
    controls.changed = true;
    await expect(previewPayoutTreasury(f.db, funded.plan.id)).rejects.toMatchObject({
      code: 'PAYOUT_PLATFORM_EVIDENCE_CHANGED',
    });
  } finally {
    await f.cleanup();
  }
});
