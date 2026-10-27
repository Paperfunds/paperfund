import { it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ensureCurrentAndNextRounds } from '@paperfund/db';
import { IntegrityHarness } from './harness.js';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function blocking(h: IntegrityHarness, waiter: number, blocker: number) {
  for (let i = 0; i < 100; i++) {
    const a = (await h.db.pool.query('select pg_blocking_pids($1) ids', [waiter])).rows[0]
      .ids as number[];
    if (a.includes(blocker)) return;
    await delay(10);
  }
  throw Error('EXPECTED_DATABASE_LOCK_BARRIER_NOT_OBSERVED');
}
async function pid(c: PoolClient) {
  return (await c.query('select pg_backend_pid() pid')).rows[0].pid as number;
}
async function childRead(h: IntegrityHarness, round: string) {
  const c = fork(
    resolve('packages/execution/diagnostics/simple-price-v2-archive-integrity/reader-child.ts'),
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
          'packages/execution/diagnostics/simple-price-v2-archive-integrity/tsconfig.json',
        ),
      },
    },
  );
  const message = new Promise<unknown>((done, reject) => {
    c.once('message', done);
    c.once('error', reject);
  });
  const exit = new Promise<number | null>((done, reject) => {
    const timer = setTimeout(() => {
      c.kill();
      reject(Error('OWNED_READER_TIMEOUT'));
    }, 15000);
    c.once('exit', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
  c.send({ url: h.readConnectionForChild(), round });
  const result = await message;
  expect(await exit).toBe(0);
  return result;
}
it('ordinary application roles cannot write tables, forge proof, escalate privileges or call another role admission path', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const writer = h.pools.writer,
      reader = h.pools.reader;
    for (const sql of [
      "insert into archive_integrity.certificates values('fake',clock_timestamp(),'0/0','0/0',clock_timestamp(),'attacker')",
      "update archive_integrity.rounds set cutoff=clock_timestamp()+interval '1 day'",
      'delete from archive_integrity.submissions',
      'truncate archive_integrity.seals',
      'alter table archive_integrity.seals disable trigger all',
      'drop function archive_integrity.seal(text,text)',
      "select archive_integrity.certify('fake','fake')",
      "select archive_integrity.seal('fake','ARCHIVE_DB_WAL_SEAL_V1')",
      "select archive_integrity.lock_round('fake')",
      'set role v2_archive_owner',
      'set role v2_archive_validator',
      'grant v2_archive_validator to v2_archive_writer',
      'set session_replication_role=replica',
      "create function archive_integrity.fake() returns void language sql as 'select null'",
    ])
      await expect(writer.query(sql), sql).rejects.toThrow();
    await expect(
      reader.query("select archive_integrity.submit('fake','fake','fake','{}')"),
    ).rejects.toThrow();
    await expect(
      h.pools.validator.query("select archive_integrity.submit('fake','fake','fake','{}')"),
    ).rejects.toThrow();
    // A pg_temp shadow never replaces schema-qualified authority.
    const c = await writer.connect();
    try {
      await c.query('create temp table certificates(capture_id text)');
      await c.query("insert into certificates values('fake')");
      await expect(c.query('select * from archive_integrity.certificates')).rejects.toThrow(
        'permission denied',
      );
    } finally {
      c.release();
    }
    const roles = (
      await h.db.pool.query(
        "select rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname like 'v2_archive_%' order by rolname",
      )
    ).rows;
    expect(
      roles.every(
        (r) =>
          !r.rolsuper && !r.rolcreaterole && !r.rolcreatedb && !r.rolreplication && !r.rolbypassrls,
      ),
    ).toBe(true);
    const owners = (
      await h.db.pool.query(
        "select p.proname,r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='archive_integrity'",
      )
    ).rows;
    expect(owners.every((r) => r.rolname === 'v2_archive_owner')).toBe(true);
    notes = { roles, owners, deniedDirectSQL: true };
  } finally {
    await h.close(notes);
  }
});
it('direct asynchronous SQL cannot forge pre-cutoff durability: committed visibility plus observed WAL flush is mandatory', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('async', 1500),
      body = await h.payload();
    const c = await h.pools.writer.connect();
    try {
      await c.query('begin');
      await c.query('set local synchronous_commit=off');
      expect((await h.submit(r.id, 'async-sql', body, c)).status).toBe('SUBMITTED');
      await c.query('commit');
    } finally {
      c.release();
    }
    // Even a direct validator SQL call is guarded inside PostgreSQL; no trusted commit helper is involved.
    const cert = await h.certify('async-sql', h.pools.validator, true);
    expect(cert.status).toBe('CERTIFIED');
    const proof = (
      await h.pools.reader.query(
        'select *,observed_flush_lsn>=flush_barrier_lsn covered from archive_integrity.certificates',
      )
    ).rows[0];
    expect(proof.covered).toBe(true);
    expect(proof.certified_at.getTime()).toBeLessThan(r.cutoff.getTime());
    await h.afterCutoff(r.cutoff);
    const seal = await h.seal(r.id);
    expect(seal.body.members).toHaveLength(1);
    notes = {
      proof,
      seal,
      asynchronousWriterCommit: true,
      proofDoesNotDependOnWriterCommitSetting: true,
    };
  } finally {
    await h.close(notes);
  }
});
it('a submission cannot certify itself inside its uncommitted transaction, even when the administrator changes test roles', async () => {
  const h = new IntegrityHarness();
  try {
    await h.start();
    const r = await h.round('own-transaction'),
      b = await h.payload(),
      c = await h.db.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role v2_archive_writer');
      const sub = await h.submit(r.id, 'own', b, c);
      await c.query('set local role v2_archive_validator');
      await expect(
        c.query('select archive_integrity.certify($1,$2)', ['own', sub.digest]),
      ).rejects.toThrow('SEPARATE_COMMITTED');
      await c.query('rollback');
    } finally {
      c.release();
    }
    expect(
      (await h.pools.reader.query('select count(*)::int n from archive_integrity.submissions'))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await h.close();
  }
});
it('a writer holding the admission lock across cutoff cannot certify its late commit; queued sealing freezes an empty REVIEW', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('late-commit', 550),
      w = await h.pools.writer.connect(),
      s = await h.pools.sealer.connect();
    try {
      await w.query('begin');
      expect((await h.submit(r.id, 'late', await h.payload(), w)).status).toBe('SUBMITTED');
      const wp = await pid(w),
        sp = await pid(s);
      const closing = h.seal(r.id, s);
      await blocking(h, sp, wp);
      await h.afterCutoff(r.cutoff);
      await w.query('commit');
      const seal = await closing;
      expect(seal.body.members).toHaveLength(0);
      expect(seal.body.reviewReasons).toContain('NO_ELIGIBLE_EVIDENCE');
      await expect(h.certify('late', h.pools.validator, true)).rejects.toThrow('ADMISSION_CLOSED');
      notes = { seal, blockedWriter: wp, waitingSealer: sp, lateCommitCertified: false };
    } finally {
      await w.query('rollback').catch(() => {});
      w.release();
      s.release();
    }
  } finally {
    await h.close(notes);
  }
});
it('a transaction beginning before cutoff cannot insert after closure; duplicate versions and late changes cannot alter the seal', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('began-early', 200),
      c = await h.pools.writer.connect();
    try {
      await c.query('begin');
      await h.afterCutoff(r.cutoff);
      const first = await h.seal(r.id);
      await expect(h.submit(r.id, 'too-late', await h.payload(), c)).rejects.toThrow(
        'ADMISSION_CLOSED',
      );
      await c.query('rollback');
      expect(await h.seal(r.id)).toEqual(first);
      await expect(
        h.pools.sealer.query('select archive_integrity.seal($1,$2)', [r.id, 'OTHER_VERSION']),
      ).rejects.toThrow('SEAL_VERSION_CONFLICT');
      expect(
        (await h.pools.reader.query('select count(*)::int n from archive_integrity.submissions'))
          .rows[0].n,
      ).toBe(0);
      notes = { seal: first };
    } finally {
      c.release();
    }
  } finally {
    await h.close(notes);
  }
});
it('an uncommitted pre-cutoff certificate serializes with sealing; rollback cannot leave eligible membership or advanced cursors', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('rolled-proof', 600);
    await h.submit(r.id, 'proof', await h.payload());
    const v = await h.pools.validator.connect(),
      s = await h.pools.sealer.connect();
    try {
      await v.query('begin');
      expect((await h.certify('proof', v)).status).toBe('CERTIFIED');
      const vp = await pid(v),
        sp = await pid(s);
      const closing = h.seal(r.id, s);
      await blocking(h, sp, vp);
      await h.afterCutoff(r.cutoff);
      await v.query('rollback');
      const seal = await closing;
      expect(seal.body.members).toHaveLength(0);
      expect(
        (await h.pools.reader.query('select count(*)::int n from archive_integrity.cursors'))
          .rows[0].n,
      ).toBe(0);
      notes = { seal, rolledBackProof: true };
    } finally {
      await v.query('rollback').catch(() => {});
      v.release();
      s.release();
    }
  } finally {
    await h.close(notes);
  }
});

it('committed certification serializes before sealing, survives real reader process restart, and duplicate seals/mutations cannot replace history', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('commit-proof', 600);
    await h.submit(r.id, 'frozen', await h.payload());
    const v = await h.pools.validator.connect(),
      s = await h.pools.sealer.connect();
    let sealed: Record<string, unknown>;
    try {
      await v.query('begin');
      expect((await h.certify('frozen', v)).status).toBe('CERTIFIED');
      const vp = await pid(v),
        sp = await pid(s);
      const closing = h.seal(r.id, s);
      await blocking(h, sp, vp);
      await h.afterCutoff(r.cutoff);
      await v.query('commit');
      sealed = await closing;
      expect((sealed.body as { members: unknown[] }).members).toHaveLength(1);
    } finally {
      await v.query('rollback').catch(() => {});
      v.release();
      s.release();
    }
    expect(await Promise.all([h.seal(r.id), h.seal(r.id), h.seal(r.id)])).toEqual([
      sealed,
      sealed,
      sealed,
    ]);
    const a = await childRead(h, r.id),
      b = await childRead(h, r.id);
    expect(b).toEqual(a);
    for (const sql of [
      "update archive_integrity.submissions set body='{}'",
      'delete from archive_integrity.certificates',
      "update archive_integrity.seals set digest=repeat('0',64)",
      'truncate archive_integrity.seals',
      'delete from archive_integrity.review_holds',
      "update archive_integrity.rounds set state='OPEN'",
    ])
      await expect(h.db.pool.query(sql)).rejects.toThrow('IMMUTABLE');
    const raw = (
      await h.pools.validator.query(
        'select body::text canonical,digest from archive_integrity.seals where round_id=$1',
        [r.id],
      )
    ).rows[0];
    expect(createHash('sha256').update(raw.canonical).digest('hex')).toBe(raw.digest);
    await expect(h.submit(r.id, 'new-later', await h.payload())).rejects.toThrow(
      'ADMISSION_CLOSED',
    );
    expect(await h.seal(r.id)).toEqual(sealed);
    notes = { sealed, firstReader: a, restartedReader: b, final: await h.snapshot() };
  } finally {
    await h.close(notes);
  }
});
it('reordered/conflicting evidence quarantines the market and persists provider chronology across rounds', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('cursor-first', 1000),
      next = await h.round('cursor-next', 1000),
      body = await h.payload();
    expect((await h.submit(r.id, 'newest', body)).status).toBe('SUBMITTED');
    expect((await h.certify('newest')).status).toBe('CERTIFIED');
    expect((await h.submit(r.id, 'newest', body)).status).toBe('EXISTING');
    expect((await h.submit(r.id, 'content-duplicate', body)).id).toBe('newest');
    const conflict = structuredClone(body),
      observations = conflict.evidence['observations'] as { price: { n: { $bigint: string } } }[];
    observations[0]!.price.n.$bigint = (BigInt(observations[0]!.price.n.$bigint) * 10n).toString();
    expect((await h.submit(r.id, 'conflict', conflict)).status).toBe('SUBMITTED');
    expect((await h.certify('conflict', h.pools.validator, true)).reason).toBe(
      'SAME_CURSOR_CONFLICT',
    );
    expect((await h.submit(next.id, 'reordered', await h.payload(200))).status).toBe('SUBMITTED');
    expect((await h.certify('reordered', h.pools.validator, true)).reason).toBe(
      'PROVIDER_CURSOR_REGRESSION',
    );
    await h.afterCutoff(r.cutoff);
    const sealed = await h.seal(r.id);
    await h.afterCutoff(next.cutoff);
    const sealedNext = await h.seal(next.id);
    expect(sealed.body.members).toHaveLength(0);
    expect(sealedNext.body.members).toHaveLength(0);
    expect(sealed.body.reviewReasons).toContain('PROVIDER_INTEGRITY_FAULTS');
    notes = { sealed, sealedNext, final: await h.snapshot() };
  } finally {
    await h.close(notes);
  }
});
it('invalid source timestamp, slot, fee/FX cursor, denomination and fee calibration cannot acquire financial authority', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('invalid-evidence', 1000),
      body = await h.payload();
    const badTime = structuredClone(body);
    (badTime.evidence['observations'] as { observedAtMs: number }[])[0]!.observedAtMs += 100000;
    const badSlot = structuredClone(body);
    (badSlot.evidence['observations'] as { slot: unknown }[])[0]!.slot = null;
    const badFee = structuredClone(body);
    badFee.evidence['feeObservedAtMs'] = Number.MAX_SAFE_INTEGER;
    const badFx = structuredClone(body);
    badFx.evidence['conversion'] = {
      price: { n: { $bigint: '1' }, d: { $bigint: '1' } },
      observations: structuredClone(body.evidence['observations']),
    };
    const fx = (badFx.evidence['conversion'] as { observations: { slot: { $bigint: string } }[] })
      .observations;
    fx[0]!.slot.$bigint = (BigInt(fx[0]!.slot.$bigint) + 1n).toString();
    const missingDenomination = structuredClone(body);
    delete missingDenomination.evidence['conversion'];
    const results = [];
    for (const [i, x] of [badTime, badSlot, badFee, badFx, missingDenomination].entries()) {
      const result = await h.submit(r.id, 'invalid-' + i, x);
      expect(result.status).toBe('REJECTED');
      results.push(result);
    }
    const invalidMath = structuredClone(body);
    (invalidMath.evidence['fees'] as { bps: { $bigint: string } }[])[0]!.bps.$bigint = '9000';
    expect((await h.submit(r.id, 'bad-math', invalidMath)).status).toBe('SUBMITTED');
    expect((await h.certify('bad-math')).status).toBe('REJECTED');
    await h.afterCutoff(r.cutoff);
    const seal = await h.seal(r.id);
    expect(seal.body.members).toHaveLength(0);
    expect(seal.body.reviewReasons).toContain('FINALITY_UNVERIFIED');
    expect(
      (await h.pools.reader.query('select count(*)::int n from archive_integrity.certificates'))
        .rows[0].n,
    ).toBe(0);
    expect((await h.db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(0);
    notes = { results, seal, final: await h.snapshot() };
  } finally {
    await h.close(notes);
  }
});
it('owned backend interruption rolls back admission and releases its sealing lock', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('crash', 400),
      w = await h.pools.writer.connect();
    w.on('error', () => {});
    try {
      await w.query('begin');
      await h.submit(r.id, 'lost', await h.payload(), w);
      const wp = await pid(w),
        pending = w.query('select pg_sleep(10)').then(
          () => false,
          () => true,
        );
      await h.db.pool.query('select pg_terminate_backend($1)', [wp]);
      expect(await pending).toBe(true);
    } finally {
      w.release(true);
    }
    await h.afterCutoff(r.cutoff);
    const seal = await h.seal(r.id);
    expect(seal.body.members).toHaveLength(0);
    expect(
      (await h.pools.reader.query('select count(*)::int n from archive_integrity.submissions'))
        .rows[0].n,
    ).toBe(0);
    notes = { seal, ownedBackendInterrupted: true };
  } finally {
    await h.close(notes);
  }
});
it('canonical UTC cutoff is loaded from the database and its unapproved archive blocks hourly/daily plans and approval of a pre-existing disposable plan', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const rounds = await ensureCurrentAndNextRounds(h.db, new Date());
    // Zero-value mock plan inserted BEFORE archive registration, with no approvals/executions.
    await h.db.pool.query(
      "insert into payout_plans(id,competition_type,hourly_round_id,prize_pool_lamports,curve_version,tie_policy_version,participant_count,nominal_winner_count,actual_winner_count,calculated_at,config_snapshot,source_result_snapshot,total_allocated_lamports,conservation_holds) values('MOCK_PREEXISTING_PLAN','HOURLY',$1,0,'MOCK','MOCK',0,10,0,clock_timestamp(),'{}','{}',0,true)",
      [rounds.currentRoundId],
    );
    const r = await h.registerCanonical(rounds.currentRoundId),
      actual = (
        await h.db.pool.query('select ends_at_exclusive from hourly_rounds where id=$1', [
          rounds.currentRoundId,
        ])
      ).rows[0];
    expect(r.cutoff).toEqual(actual.ends_at_exclusive);
    await expect(
      h.db.pool.query(
        "insert into payout_plans(id,competition_type,hourly_round_id) values('HELD','HOURLY',$1)",
        [rounds.currentRoundId],
      ),
    ).rejects.toThrow('ARCHIVE_POLICY_REVIEW_PAYOUT_HOLD');
    const day = (
      await h.db.pool.query('select id from daily_competitions order by starts_at limit 1')
    ).rows[0].id;
    await expect(
      h.db.pool.query(
        "insert into payout_plans(id,competition_type,daily_competition_id) values('HELD_DAY','DAILY',$1)",
        [day],
      ),
    ).rejects.toThrow('ARCHIVE_POLICY_REVIEW_PAYOUT_HOLD');
    await expect(
      h.db.pool.query(
        "insert into payout_plan_approvals(id,payout_plan_id,approval_method,approver_identifier,plan_snapshot_hash,approved_at) values('NO_APPROVAL','MOCK_PREEXISTING_PLAN','OPERATOR_CLI','MOCK',repeat('0',64),clock_timestamp())",
      ),
    ).rejects.toThrow('ARCHIVE_POLICY_REVIEW_APPROVAL_HOLD');
    expect(
      (await h.db.pool.query('select count(*)::int n from payout_plan_approvals')).rows[0].n,
    ).toBe(0);
    expect((await h.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      0,
    );
    notes = { round: r, actual, canonicalSource: 'DATABASE_HOURLY_ROUNDS', mockPlanOnly: true };
  } finally {
    await h.close(notes);
  }
});

it('sealing revalidates source, fee and quote freshness at cutoff instead of reusing ingestion-time freshness', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('expired-at-cutoff', 800, 500);
    await h.submit(r.id, 'initially-fresh', await h.payload());
    expect((await h.certify('initially-fresh')).status).toBe('CERTIFIED');
    await h.afterCutoff(r.cutoff);
    const seal = await h.seal(r.id);
    expect(seal.body.members).toHaveLength(0);
    expect(
      seal.body.faults.some((f: { reason: string }) =>
        f.reason.startsWith('CUTOFF_VALIDATION:SOURCE_TIME_OUT_OF_RANGE'),
      ),
    ).toBe(true);
    expect(seal.body.selected[0].captureId).toBeNull();
    notes = { seal, fixtureOnlyAgeMs: 500, notLiveThresholdApproval: true };
  } finally {
    await h.close(notes);
  }
});
it('a seal write is provisional until separately committed WAL is observed; claimed finality/UTC cannot clear REVIEW', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('seal-durability', 300),
      body = await h.payload();
    const claimed = {
      ...body,
      retainedSource: {
        ...body.retainedSource,
        finalized: true,
        utcQualified: true,
        financialPolicyApproved: true,
      },
    };
    await h.submit(r.id, 'claims', claimed);
    expect((await h.certify('claims')).status).toBe('CERTIFIED');
    await h.afterCutoff(r.cutoff);
    const c = await h.db.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local synchronous_commit=off');
      await c.query('set local role v2_archive_sealer');
      const seal = await h.seal(r.id, c);
      expect(seal.status).toBe('SEAL_WRITE_REQUIRES_DURABILITY_READ');
      await expect(h.pools.reader.query('select * from archive_integrity.seals')).rejects.toThrow(
        'permission denied',
      );
      await expect(
        h.pools.reader.query('select archive_integrity.read_seal($1)', [r.id]),
      ).rejects.toThrow();
      await c.query('savepoint proof_read');
      await c.query('set local role v2_archive_reader');
      await expect(c.query('select archive_integrity.read_seal($1)', [r.id])).rejects.toThrow(
        'SEPARATE_COMMITTED_SEAL_REQUIRED',
      );
      await c.query('rollback to savepoint proof_read');
      await c.query('commit');
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
    let read: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      read = (await h.pools.reader.query('select archive_integrity.read_seal($1) result', [r.id]))
        .rows[0].result;
      if (read.status !== 'WAIT_SEAL_WAL_FLUSH') break;
      await delay(10);
    }
    expect(read.status).toBe('REVIEW_REQUIRED');
    expect(read.durability).toBe('COMMITTED_WAL_FLUSH_OBSERVED');
    expect((read.body as { reviewReasons: string[] }).reviewReasons).toEqual(
      expect.arrayContaining([
        'FINALITY_UNVERIFIED',
        'UTC_CLOCK_UNQUALIFIED',
        'FINANCIAL_POLICY_UNAPPROVED',
      ]),
    );
    notes = { read, callerClaimsDoNotAuthorize: true };
  } finally {
    await h.close(notes);
  }
});

it('an expired older certificate does not quarantine a newer fresh observation or invite favorable fallback', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const r = await h.round('fresh-successor', 1200, 800);
    await h.submit(r.id, 'old', await h.payload());
    expect((await h.certify('old')).status).toBe('CERTIFIED');
    await h.db.pool.query(
      'select pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp()))-0.5))',
      [r.cutoff],
    );
    await h.submit(r.id, 'new', await h.payload());
    expect((await h.certify('new')).status).toBe('CERTIFIED');
    await h.afterCutoff(r.cutoff);
    const seal = await h.seal(r.id);
    expect(seal.body.members.map((m: { id: string }) => m.id)).toEqual(['new']);
    expect(seal.body.selected[0].captureId).toBe('new');
    expect(seal.body.faults).toHaveLength(0);
    notes = { seal };
  } finally {
    await h.close(notes);
  }
});
