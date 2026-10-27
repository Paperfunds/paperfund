import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DisposableDatabase } from '../../integration/simple-price-v2/disposable.js';
import { CommitWitness } from '../simple-price-v2-cutoff-evidence/commit-witness.js';
import { encode } from '../simple-price-v2-settlement/fixtures.js';

it('independent review: visibility at seal, commit-setting trust, interruption, reordering and immutable retries', async () => {
  const owner = new DisposableDatabase();
  const results: Record<string, unknown> = {
    scope: 'INDEPENDENT_DUMMY_ROWS_NO_FINANCIAL_AUTHORITY',
  };
  try {
    const { database: db, token } = await owner.start();
    const p = new CommitWitness(db, token);
    await p.initialize();
    const time = async (ms = 3000) =>
      (
        await db.pool.query(
          "select clock_timestamp() at, clock_timestamp()+$1::int*interval '1 millisecond' cutoff",
          [ms],
        )
      ).rows[0] as { at: Date; cutoff: Date };
    // A witness timestamp is not a witness-row commit timestamp or a closed eligible set.
    const t = await time(250),
      c = await p.begin('late-visible-witness', {}, t.at, t.cutoff);
    await c.query('commit');
    await c.query('begin');
    await c.query("select commit_probe.witness('late-visible-witness')");
    const inTxn = (await c.query('select * from commit_probe.witnesses')).rows;
    await db.pool.query('select pg_sleep(0.35)');
    const sealedAt = (await db.pool.query('select clock_timestamp() at')).rows[0].at;
    await db.pool.query(
      'create table commit_probe.frozen_ids as select capture_id from commit_probe.witnesses',
    );
    await expect(p.eligible('late-visible-witness')).rejects.toThrow('NO_PRE_CUTOFF');
    await c.query('commit');
    c.release();
    const after = await p.eligible('late-visible-witness');
    expect(after.witnessed_db_at.getTime()).toBeLessThan(t.cutoff.getTime());
    expect(sealedAt.getTime()).toBeGreaterThan(t.cutoff.getTime());
    expect(
      (await db.pool.query('select count(*)::int n from commit_probe.frozen_ids')).rows[0].n,
    ).toBe(0);
    results['lateVisibleWitness'] = {
      cutoff: t.cutoff,
      inTxn,
      sealedAt,
      after,
      sealCount: 0,
      laterEligible: true,
      interpretation: 'CAPTURE_COMMITTED_EARLY_BUT_SELECTOR_IS_NOT_A_SEAL',
    };
    // SQL function observes its current setting, not the earlier transaction setting.
    const a = await time(),
      raw = await p.begin('async-bypass', {}, a.at, a.cutoff);
    await raw.query('set local synchronous_commit=off');
    const prior = (await raw.query('show synchronous_commit')).rows[0];
    await raw.query('commit');
    await raw.query("select commit_probe.witness('async-bypass')");
    raw.release();
    expect(await p.eligible('async-bypass')).toBeDefined();
    results['asyncBypass'] = {
      captureCommitSetting: prior.synchronous_commit,
      witnessAccepted: true,
      unflushedLossDemonstrated: false,
      interpretation: 'FUNCTION_ALONE_DOES_NOT_ATTEST_PREVIOUS_COMMIT_MODE',
    };
    // Killing only this disposable capture backend during an uncommitted transaction.
    const k = await time(),
      dying = await p.begin('killed-during-write', {}, k.at, k.cutoff);
    dying.on('error', () => {});
    const pid = (await dying.query('select pg_backend_pid() pid')).rows[0].pid;
    const pending = dying.query('select pg_sleep(5)').then(
      () => false,
      () => true,
    );
    await db.pool.query('select pg_terminate_backend($1)', [pid]);
    expect(await pending).toBe(true);
    dying.release(true);
    await expect(p.eligible('killed-during-write')).rejects.toThrow();
    expect(
      (
        await db.pool.query(
          "select count(*)::int n from commit_probe.captures where id='killed-during-write'",
        )
      ).rows[0].n,
    ).toBe(0);
    results['interruptedWrite'] = {
      backendTerminated: true,
      retainedRows: 0,
      financialMutation: 0,
    };
    // A genuinely early capture with a delayed post-commit witness fails conservatively.
    const d = await time(150),
      slow = await p.begin('delayed-witness', {}, d.at, d.cutoff);
    await slow.query('commit');
    await slow.query('select pg_sleep(0.25)');
    await slow.query("select commit_probe.witness('delayed-witness')");
    slow.release();
    await expect(p.eligible('delayed-witness')).rejects.toThrow('NO_PRE_CUTOFF');
    results['delayedWitness'] = 'REJECTED_NO_BACKDATED_RECOVERY';
    // Helper is deliberately a storage probe; separate chronology/freshness remains required.
    const n = await time(),
      newer = await p.begin('new-source', { slot: 200 }, n.at, n.cutoff);
    await p.commitAndWitness(newer, 'new-source');
    const first = (
      await newer.query("select * from commit_probe.witnesses where capture_id='new-source'")
    ).rows[0];
    await newer.query("select commit_probe.witness('new-source')");
    const retry = (
      await newer.query("select * from commit_probe.witnesses where capture_id='new-source'")
    ).rows[0];
    expect(retry).toEqual(first);
    newer.release();
    const older = await p.begin(
      'old-source',
      { slot: 199 },
      new Date(n.at.getTime() - 30000),
      n.cutoff,
    );
    await p.commitAndWitness(older, 'old-source');
    older.release();
    expect(await p.eligible('old-source')).toBeDefined();
    results['reorderedStorageAccepted'] = 'EXPECTED_STORAGE_ONLY_NO_SOURCE_AUTHORITY';
    await expect(p.begin('new-source', {}, n.at, n.cutoff)).rejects.toThrow('duplicate');
    await expect(
      db.pool.query(
        "update commit_probe.witnesses set witnessed_db_at=clock_timestamp() where capture_id='new-source'",
      ),
    ).rejects.toThrow('IMMUTABLE');
    expect((await new CommitWitness(db, token).eligible('new-source')).body).toEqual({ slot: 200 });
    const before = Date.now(),
      server = (await db.pool.query('select clock_timestamp() at')).rows[0].at,
      afterMs = Date.now();
    results['clockBracket'] = { before, server, after: afterMs, independentUtcProof: false };
    results['captures'] = (
      await db.pool.query('select * from commit_probe.captures order by id')
    ).rows;
    results['witnesses'] = (
      await db.pool.query('select * from commit_probe.witnesses order by capture_id')
    ).rows;
    expect((await db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(0);
  } finally {
    writeFileSync(
      'artifacts/simple-price-v2-final-qualification-review/independent-witness-' +
        Date.now() +
        '.json',
      encode(results),
      { flag: 'wx' },
    );
    await owner.close();
  }
});
