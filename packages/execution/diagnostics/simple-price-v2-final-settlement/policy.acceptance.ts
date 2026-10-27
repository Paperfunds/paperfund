import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { FinalHarness, TEST_POLICY } from './harness.js';
import { CutoffArchive } from './archive.js';
import { privateTick } from './worker.js';
import { controlledReplay, encode } from '../simple-price-v2-settlement/fixtures.js';
import { snapshotHash } from '../../candidates/simple-price-v2-directional/model.js';
import type { Evidence } from '../../candidates/simple-price-v2-directional/model.js';
const cutoff = Date.parse('2030-01-01T13:00:00Z');
it('strict boundary, stale/missing historical evidence, immutable selection, native/FX/fee/slot conflicts and invalid-capture quarantine', async () => {
  const h = new FinalHarness(),
    notes: Record<string, unknown> = { scope: 'CONTROLLED_CLOCK_AND_ARCHIVED_PRICES_ONLY' };
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const rounds = await privateTick(h.archive, h.directory, h.now);
    expect(
      () =>
        new CutoffArchive(
          h.database,
          h.token,
          h.policy,
          { ...TEST_POLICY, maxAgeMs: 5001 },
          () => cutoff,
          h.archive.highWater,
        ),
    ).toThrow('EXPLICIT_PRIVATE_FRESHNESS');
    const mismatch = new CutoffArchive(
      h.database,
      h.token,
      h.policy,
      { ...TEST_POLICY, maxAgeMs: 4000 },
      () => cutoff,
      h.archive.highWater,
    );
    await expect(mismatch.verifyBinding()).rejects.toThrow('POLICY_MISMATCH');
    const e = controlledReplay(h.original, cutoff - 500),
      i = e.identity;
    const before = (await h.database.pool.query('select count(*)::int n from fills')).rows[0].n;
    await expect(h.archive.select(rounds.currentRoundId, i, cutoff)).rejects.toThrow(
      'CUTOFF_NOT_REACHED',
    );
    h.archive.validate(controlledReplay(h.original, cutoff - 1), cutoff);
    h.archive.validate(controlledReplay(h.original, cutoff), cutoff);
    expect(() => h.archive.validate(controlledReplay(h.original, cutoff + 1), cutoff)).toThrow(
      'PRE_CUTOFF',
    );
    expect(() => h.archive.validate(controlledReplay(h.original, cutoff - 5001), cutoff)).toThrow(
      'PRE_CUTOFF',
    );
    expect(() => h.archive.validate({ ...e, feeObservedAtMs: cutoff + 1 }, cutoff)).toThrow(
      'PRE_CUTOFF',
    );
    const badSlot = {
      ...e,
      observations: e.observations.map((o, n) => (n === 0 ? { ...o, slot: null } : o)),
    };
    expect(() => h.archive.validate(badSlot, cutoff)).toThrow('SLOT_REQUIRED');
    const fx = {
      ...e,
      conversion: {
        price: { n: 1n, d: 1n },
        observations: e.observations.map((o) => ({ ...o, slot: o.slot! + 1n })),
      },
    };
    expect(() => h.archive.validate(fx, cutoff)).toThrow('NON_ATOMIC_NATIVE_FX');
    const changed = {
      ...e,
      observations: e.observations.map((o, n) =>
        n === 0 ? { ...o, price: { n: o.price.n * 10n, d: o.price.d } } : o,
      ),
    };
    const contradiction: Evidence = {
      ...changed,
      calibration: { ...changed.calibration, snapshotHash: snapshotHash(changed) },
    };
    expect(() => h.archive.validate(contradiction, cutoff)).toThrow('CONTRADICTORY');
    const first = await h.archive.capture(e, cutoff - 500);
    expect(await h.archive.capture(e, cutoff - 500)).toBe(first);
    h.now = new Date(cutoff);
    const exact = controlledReplay(h.original, cutoff);
    const exactId = await h.archive.capture(exact, cutoff);
    expect(await h.archive.select(rounds.currentRoundId, i, cutoff)).toEqual(exact);
    h.now = new Date(cutoff + 1);
    await h.archive.capture(controlledReplay(h.original, cutoff + 1), cutoff + 1);
    expect(await h.archive.select(rounds.currentRoundId, i, cutoff)).toEqual(exact);
    expect(
      (
        await h.database.pool.query('select capture_id from final_v2.decisions where round_id=$1', [
          rounds.currentRoundId,
        ])
      ).rows[0].capture_id,
    ).toBe(exactId);
    await expect(
      h.database.pool.query('update final_v2.captures set hash=$1 where id=$2', [
        'tamper',
        exactId,
      ]),
    ).rejects.toThrow('IMMUTABLE');
    await expect(
      h.database.pool.query('delete from final_v2.decisions where round_id=$1', [
        rounds.currentRoundId,
      ]),
    ).rejects.toThrow('IMMUTABLE');
    h.now = new Date(cutoff + 3600000);
    await expect(h.archive.select(rounds.nextRoundId, i, cutoff + 3600000)).rejects.toThrow(
      'NO_FRESH_PRE_CUTOFF_EVIDENCE',
    );
    await expect(
      h.archive.select(
        rounds.nextRoundId,
        { ...i, mint: 'NO_CAPTURE_FOR_THIS_MINT' },
        cutoff + 3600000,
      ),
    ).rejects.toThrow('MISSING_DURABLE');
    // A regressing feed cannot replace accepted authority, nor silently fall back to it after an integrity fault.
    await expect(
      h.archive.capture(controlledReplay(h.original, cutoff - 100), cutoff + 100),
    ).rejects.toThrow();
    const faults = (await h.database.pool.query('select reason from final_v2.capture_faults')).rows;
    expect(faults).toHaveLength(1);
    expect((await h.database.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(
      before,
    );
    notes['faults'] = faults;
    notes['decisions'] = (
      await h.database.pool.query('select * from final_v2.decisions order by round_id,market_key')
    ).rows;
    writeFileSync(
      'artifacts/simple-price-v2-final-settlement-review/boundaries-' + Date.now() + '.json',
      encode(notes),
      { flag: 'wx' },
    );
  } finally {
    await h.close();
  }
});
it('a rejected out-of-order capture is quarantined before cutoff instead of silently selecting an older successful price', async () => {
  const h = new FinalHarness();
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const round = (await privateTick(h.archive, h.directory, h.now)).currentRoundId,
      u = await h.user();
    expect((await h.buy(u, h.original.identity, '0.1')).statusCode).toBe(200);
    await h.archive.capture(controlledReplay(h.original, cutoff - 500), cutoff - 500);
    h.now = new Date(cutoff - 400);
    await expect(
      h.archive.capture(controlledReplay(h.original, cutoff - 600), cutoff - 400),
    ).rejects.toThrow('REGRESSING_EVIDENCE');
    const before = (
      await h.database.pool.query(
        'select paper_sol_balance_lamports from competition_accounts where id=$1',
        [u.accountId],
      )
    ).rows;
    h.now = new Date(cutoff + 100);
    await expect(h.archive.select(round, h.original.identity, cutoff)).rejects.toThrow(
      'PRE_CUTOFF_CAPTURE_INTEGRITY_REVIEW',
    );
    await privateTick(h.archive, h.directory, h.now);
    await privateTick(h.archive, h.directory, h.now);
    expect(
      (
        await h.database.pool.query(
          'select paper_sol_balance_lamports from competition_accounts where id=$1',
          [u.accountId],
        )
      ).rows,
    ).toEqual(before);
    expect((await h.database.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(1);
    expect(
      (
        await h.database.pool.query(
          'select status,passes from final_v2.control where round_id=$1',
          [round],
        )
      ).rows[0],
    ).toEqual({ status: 'REVIEW_REQUIRED', passes: 1 });
  } finally {
    await h.close();
  }
});
