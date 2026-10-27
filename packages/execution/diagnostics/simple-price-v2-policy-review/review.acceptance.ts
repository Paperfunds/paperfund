import { it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { IntegrityHarness } from '../simple-price-v2-archive-integrity/harness.js';

it('independent catalog audit denies every role direct archive mutation and non-designated APIs', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    const rights = (
      await h.db.pool.query(
        "select r.rolname,c.relname,has_table_privilege(r.oid,c.oid,'INSERT') ins,has_table_privilege(r.oid,c.oid,'UPDATE') upd,has_table_privilege(r.oid,c.oid,'DELETE') del,has_table_privilege(r.oid,c.oid,'TRUNCATE') trunc from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace where r.rolname in ('v2_archive_writer','v2_archive_validator','v2_archive_sealer','v2_archive_reader') and n.nspname='archive_integrity' and c.relkind='r'",
      )
    ).rows;
    expect(rights).toHaveLength(28);
    expect(rights.every((x) => !x.ins && !x.upd && !x.del && !x.trunc)).toBe(true);
    const grants = (
      await h.db.pool.query(
        "select r.rolname,p.proname,has_function_privilege(r.oid,p.oid,'EXECUTE') allowed,p.prosecdef,p.proconfig from pg_roles r cross join pg_proc p join pg_namespace n on n.oid=p.pronamespace where r.rolname in ('v2_archive_writer','v2_archive_validator','v2_archive_sealer','v2_archive_reader') and n.nspname='archive_integrity' order by r.rolname,p.proname",
      )
    ).rows;
    const allowed = grants
      .filter((x) => x.allowed)
      .map((x) => x.rolname + ':' + x.proname)
      .sort();
    expect(allowed).toEqual([
      'v2_archive_reader:read_seal',
      'v2_archive_sealer:seal',
      'v2_archive_validator:certify',
      'v2_archive_validator:reject_capture',
      'v2_archive_writer:submit',
    ]);
    expect(
      grants
        .filter((x) => x.allowed)
        .every(
          (x) =>
            x.prosecdef &&
            x.proconfig.includes('search_path=pg_catalog, archive_integrity, pg_temp'),
        ),
    ).toBe(true);
    const memberships = (
      await h.db.pool.query(
        "select * from pg_auth_members where member in(select oid from pg_roles where rolname like 'v2_archive_%')",
      )
    ).rows;
    expect(memberships).toEqual([]);
    const r = await h.round('isolation-level');
    const c = await h.pools.writer.connect();
    try {
      await c.query('begin isolation level repeatable read');
      await expect(h.submit(r.id, 'snapshot', await h.payload(), c)).rejects.toThrow(
        'READ_COMMITTED_REQUIRED',
      );
      await c.query('rollback');
    } finally {
      c.release();
    }
    notes = { rights, grants, memberships };
  } finally {
    await h.close(notes);
  }
});

it('owned PostgreSQL backend crash invokes recovery and retains durable seal, original bytes and REVIEW', async () => {
  const h = new IntegrityHarness();
  let notes: unknown = {};
  try {
    await h.start();
    for (const p of [...Object.values(h.pools), h.db.pool]) p.on('error', () => {});
    const r = await h.round('recovery', 1200);
    expect((await h.submit(r.id, 'durable', await h.payload())).status).toBe('SUBMITTED');
    expect((await h.certify('durable')).status).toBe('CERTIFIED');
    await h.afterCutoff(r.cutoff);
    await h.seal(r.id);
    const before = (
      await h.pools.reader.query('select archive_integrity.read_seal($1) result', [r.id])
    ).rows[0].result;
    const original = (
      await h.pools.reader.query('select id,body,digest from archive_integrity.submissions')
    ).rows;
    const hostBefore = Date.now();
    const dbBefore = (
      await h.db.pool.query('select clock_timestamp() time,pg_postmaster_start_time() postmaster')
    ).rows[0];
    const hostAfter = Date.now();
    const victim = await h.db.pool.connect();
    victim.on('error', () => {});
    const pid = Number((await victim.query('select pg_backend_pid() pid')).rows[0].pid);
    const ids = execFileSync(
      'docker',
      ['ps', '--quiet', '--filter', 'label=' + h.owner.label + '=' + h.owner.token],
      { encoding: 'utf8' },
    )
      .trim()
      .split(/\s+/);
    expect(ids).toHaveLength(1);
    const info = JSON.parse(execFileSync('docker', ['inspect', ids[0]!], { encoding: 'utf8' }))[0];
    expect(info.Config.Labels[h.owner.label]).toBe(h.owner.token);
    expect(
      info.Mounts.every((m: { Type: string }) => m.Type !== 'bind' && m.Type !== 'volume'),
    ).toBe(true);
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    // Only a backend PID obtained from this exact UUID-owned disposable database is signalled.
    execFileSync('docker', ['exec', info.Id, 'kill', '-9', String(pid)], { stdio: 'ignore' });
    victim.release(true);
    let recovered = false;
    for (let i = 0; i < 150; i++) {
      try {
        await h.db.pool.query('select 1');
        recovered = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(recovered).toBe(true);
    const after = (
      await h.pools.reader.query('select archive_integrity.read_seal($1) result', [r.id])
    ).rows[0].result;
    expect(after.body).toEqual(before.body);
    expect(after.digest).toBe(before.digest);
    expect(after.status).toBe('REVIEW_REQUIRED');
    expect(after.durability).toBe('COMMITTED_WAL_FLUSH_OBSERVED');
    expect(
      (await h.pools.reader.query('select id,body,digest from archive_integrity.submissions')).rows,
    ).toEqual(original);
    const dbAfter = (
      await h.db.pool.query('select clock_timestamp() time,pg_postmaster_start_time() postmaster')
    ).rows[0];
    expect(dbAfter.postmaster).toEqual(dbBefore.postmaster);
    const recoveryLog = spawnSync('docker', ['logs', info.Id], { encoding: 'utf8' });
    expect(recoveryLog.status).toBe(0);
    const serverLog = recoveryLog.stdout + recoveryLog.stderr;
    expect(serverLog).toContain('was terminated by signal 9');
    expect(serverLog).toContain('reinitializing');
    expect(serverLog).toContain('redo done');
    notes = {
      before,
      after,
      original,
      clockBracket: { hostBefore, hostAfter, dbBefore, dbAfter },
      backendCrash: true,
      postmasterRestart: false,
      tmpfsNotPowerLossProof: true,
      serverLog,
    };
  } finally {
    await h.close(notes);
  }
});
