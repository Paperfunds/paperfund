import { it, expect } from 'vitest';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { CommitWitness } from './commit-witness.js';
import { DisposableDatabase } from '../../integration/simple-price-v2/disposable.js';
import { FinalHarness } from '../simple-price-v2-final-settlement/harness.js';
import { privateTick } from '../simple-price-v2-final-settlement/worker.js';
import { controlledReplay, encode } from '../simple-price-v2-settlement/fixtures.js';
import type { Job } from './commit-child.js';
const root = 'artifacts/simple-price-v2-cutoff-evidence-review/';
async function runChild(
  owner: DisposableDatabase,
  id: string,
  phase: Job['phase'],
  clockOffsetMs = 0,
) {
  const c = fork(
    resolve('packages/execution/diagnostics/simple-price-v2-cutoff-evidence/commit-child.ts'),
    [],
    {
      execArgv: ['--import', 'tsx'],
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        PATH: process.env['PATH'] ?? '',
        SystemRoot: process.env['SystemRoot'] ?? '',
        TEMP: process.env['TEMP'] ?? '',
        TMP: process.env['TMP'] ?? '',
        TSX_TSCONFIG_PATH: resolve(
          'packages/execution/diagnostics/simple-price-v2-cutoff-evidence/tsconfig.json',
        ),
      },
    },
  );
  const exited = new Promise<number | null>((done, reject) => {
    const timer = setTimeout(() => {
      c.kill();
      reject(Error('OWNED_CHILD_TIMEOUT'));
    }, 20000);
    c.once('exit', (code) => {
      clearTimeout(timer);
      done(code);
    });
    c.once('error', reject);
  });
  const observed = new Promise<void>((done) => c.once('message', () => done()));
  c.send({
    url: owner.database!.pool.options.connectionString!,
    token: owner.token,
    id,
    phase,
    clockOffsetMs,
  } satisfies Job);
  if (phase === 'OBSERVED_ONLY') {
    await observed;
    c.kill();
    await exited;
  } else expect(await exited).toBe(75);
}
it('the preserved archive accepts an application-backdated capture actually inserted after the fixed cutoff: diagnostic counterexample, no financial fill', async () => {
  const h = new FinalHarness(),
    cutoff = Math.floor(Date.now() / 3600000) * 3600000;
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const round = (await privateTick(h.archive, h.directory, h.now)).currentRoundId;
    const actualBefore = (await h.database.pool.query('select clock_timestamp() t')).rows[0].t;
    expect(actualBefore.getTime()).toBeGreaterThan(cutoff);
    // Mock chronology is deliberately adversarial, not a mainnet observation or permission to trade.
    const id = await h.archive.capture(controlledReplay(h.original, cutoff - 500), cutoff - 500);
    h.now = new Date(cutoff + 100);
    expect(await h.archive.select(round, h.original.identity, cutoff)).toBeDefined();
    const row = (
      await h.database.pool.query(
        'select received_ms,persisted_ms from final_v2.captures where id=$1',
        [id],
      )
    ).rows[0];
    expect(BigInt(row.persisted_ms)).toBeLessThan(BigInt(actualBefore.getTime()));
    expect((await h.database.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(0);
    writeFileSync(
      root + 'archive-counterexample-' + Date.now() + '.json',
      encode({ cutoff, actualBefore, row, selectionAccepted: true, financialFills: 0 }),
      { flag: 'wx' },
    );
  } finally {
    await h.close();
  }
});
it('database-clock post-COMMIT witness: pre/post cutoff, delayed capture/commit, rollback, concurrency, process clocks, duplicates and restart', async () => {
  const owner = new DisposableDatabase(),
    results: Record<string, unknown> = {
      input: 'DUMMY_STORAGE_ROWS_NO_EXECUTION_PRICES',
      boundary: 'SHORT_DB_CLOCK_TEST_BOUNDARIES_NOT_HOURLY_COMPETITIONS',
    };
  try {
    const { database: db, token } = await owner.start(),
      p = new CommitWitness(db, token);
    await p.initialize();
    const settings = (await db.pool.query('show fsync')).rows[0];
    expect(settings.fsync).toBe('on');
    const time = async (ms = 3000) =>
      (
        await db.pool.query(
          "select clock_timestamp() at,clock_timestamp()+$1::int*interval '1 millisecond' cutoff",
          [ms],
        )
      ).rows[0] as { at: Date; cutoff: Date };
    const good = await time(),
      c = await p.begin(
        'early',
        { appClock: -999999999999, source: 'DUMMY' },
        good.at,
        good.cutoff,
      );
    await expect(c.query("select commit_probe.witness('early')")).rejects.toThrow('UNCOMMITTED');
    await c.query('rollback');
    c.release();
    expect(
      (await db.pool.query("select count(*)::int n from commit_probe.captures where id='early'"))
        .rows[0].n,
    ).toBe(0);
    const e = await p.begin(
      'early',
      { appClock: -999999999999, source: 'DUMMY' },
      good.at,
      good.cutoff,
    );
    await p.commitAndWitness(e, 'early');
    e.release();
    const early = await p.eligible('early');
    expect(early.witnessed_db_at.getTime()).toBeLessThanOrEqual(good.cutoff.getTime());
    results['early'] = early;
    const late = await time(200),
      l = await p.begin(
        'late-commit',
        { providerReceivedBeforeCutoff: true },
        late.at,
        late.cutoff,
      );
    await l.query('select pg_sleep(0.3)');
    await p.commitAndWitness(l, 'late-commit');
    l.release();
    await expect(p.eligible('late-commit')).rejects.toThrow('NO_PRE_CUTOFF_COMMIT_WITNESS');
    results['lateCommit'] = (
      await db.pool.query(
        "select c.*,w.witnessed_db_at from commit_probe.captures c join commit_probe.witnesses w on w.capture_id=c.id where c.id='late-commit'",
      )
    ).rows[0];
    const delayed = await time(200);
    await db.pool.query('select pg_sleep(0.3)');
    const d = await p.begin(
      'delayed-response',
      { requestInitiated: delayed.at, appClaimsReceivedBeforeCutoff: true },
      delayed.at,
      delayed.cutoff,
    );
    await p.commitAndWitness(d, 'delayed-response');
    d.release();
    await expect(p.eligible('delayed-response')).rejects.toThrow('NO_PRE_CUTOFF_COMMIT_WITNESS');
    const roll = await time(),
      r = await p.begin('rollback', {}, roll.at, roll.cutoff);
    await r.query('rollback');
    r.release();
    await expect(p.eligible('rollback')).rejects.toThrow('NO_PRE_CUTOFF_COMMIT_WITNESS');
    const race = await time(250),
      racing = await p.begin('concurrent', {}, race.at, race.cutoff);
    const fast = await p.begin('parallel-fast', {}, race.at, race.cutoff);
    await p.commitAndWitness(fast, 'parallel-fast');
    fast.release();
    expect(await p.eligible('parallel-fast')).toBeDefined();
    await expect(p.eligible('concurrent')).rejects.toThrow('NO_PRE_CUTOFF_COMMIT_WITNESS');
    await racing.query('select pg_sleep(0.35)');
    await p.commitAndWitness(racing, 'concurrent');
    racing.release();
    await expect(p.eligible('concurrent')).rejects.toThrow('NO_PRE_CUTOFF_COMMIT_WITNESS');
    // Even a capture with a pre-cutoff source time needs an actual earlier synchronous commit witness.
    const o = await time(),
      old = await p.begin(
        'old-source-new-commit',
        { appClock: 9999999999999 },
        new Date(o.at.getTime() - 10000),
        new Date(o.at.getTime() - 100),
      );
    await p.commitAndWitness(old, 'old-source-new-commit');
    old.release();
    await expect(p.eligible('old-source-new-commit')).rejects.toThrow();
    await expect(p.begin('early', {}, good.at, good.cutoff)).rejects.toThrow('duplicate');
    await runChild(owner, 'observed-not-persisted', 'OBSERVED_ONLY');
    await expect(p.eligible('observed-not-persisted')).rejects.toThrow();
    await runChild(owner, 'committed-no-witness', 'COMMITTED_ONLY');
    await expect(p.eligible('committed-no-witness')).rejects.toThrow();
    const restart = await db.pool.connect();
    await expect(
      restart.query("select commit_probe.witness('committed-no-witness')"),
    ).rejects.toThrow('SAME_BACKEND');
    restart.release();
    await runChild(owner, 'witnessed-lost-ack', 'WITNESSED');
    await runChild(owner, 'clock-ahead', 'WITNESSED', 60000);
    await runChild(owner, 'clock-behind', 'WITNESSED', -60000);
    expect(await p.eligible('clock-ahead')).toBeDefined();
    expect(await p.eligible('clock-behind')).toBeDefined();
    const recording = readdirSync(root).find((f) => f.endsWith('-observations.json'))!;
    const data = JSON.parse(readFileSync(root + recording, 'utf8'));
    const sample = data.records.find(
      (r: { market: string; complete: boolean }) => r.market === 'TUSD' && r.complete,
    );
    const envelope = {
      sourceFile: recording,
      record: sample,
      role: 'ARCHIVED_READ_ONLY_BYTES_COMMIT_ORDER_TEST_NOT_FRESH_EXECUTION_AUTHORITY',
    };
    const whole = await time(),
      large = await p.begin('complete-envelope', envelope, new Date(sample.sourceMs), whole.cutoff);
    await p.commitAndWitness(large, 'complete-envelope');
    large.release();
    expect((await p.eligible('complete-envelope')).hash).toBeDefined();
    expect(await new CommitWitness(db, token).eligible('witnessed-lost-ack')).toBeDefined();
    const b = await time(),
      sync = await p.begin('synchronous-enforced', {}, b.at, b.cutoff);
    await sync.query('set local synchronous_commit=off');
    await p.commitAndWitness(sync, 'synchronous-enforced');
    sync.release();
    expect(await p.eligible('synchronous-enforced')).toBeDefined();
    results['allCaptures'] = (
      await db.pool.query('select * from commit_probe.captures order by id')
    ).rows;
    results['witnesses'] = (
      await db.pool.query('select * from commit_probe.witnesses order by capture_id')
    ).rows;
    const before = Date.now(),
      clock = (await db.pool.query('select clock_timestamp() at')).rows[0].at,
      after = Date.now();
    results['clockBracket'] = { before, db: clock, after, utcQualification: false };
    expect((await db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(0);
  } finally {
    writeFileSync(root + 'commit-order-' + Date.now() + '.json', encode(results), { flag: 'wx' });
    await owner.close();
  }
});
