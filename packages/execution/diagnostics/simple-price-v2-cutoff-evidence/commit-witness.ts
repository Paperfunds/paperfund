/** Narrow commit-order experiment, not a replacement archive or a financial integration. */
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../../../db/src/database.js';
import { fingerprint } from '../../candidates/simple-price-v2-directional/model.js';
export class CommitWitness {
  constructor(
    readonly db: DatabaseService,
    readonly token: string,
  ) {}
  async guard() {
    const r = (await this.db.pool.query('select token from private_v2.isolation_guard')).rows;
    if (r.length !== 1 || r[0].token !== this.token) throw Error('DISPOSABLE_DATABASE_REQUIRED');
  }
  async initialize() {
    await this.guard();
    await this.db.pool.query(`create schema commit_probe;
    create table commit_probe.captures(id text primary key,body jsonb not null,hash text not null,
      source_time timestamptz not null,cutoff timestamptz not null,
      received_db_at timestamptz not null default clock_timestamp(),writer_pid integer not null default pg_backend_pid(),
      writer_start timestamptz not null,
      writer_xid xid8 not null default pg_current_xact_id());
    create table commit_probe.witnesses(capture_id text primary key references commit_probe.captures(id),
      witnessed_db_at timestamptz not null,flush_lsn pg_lsn not null,postmaster_start timestamptz not null);
    create function commit_probe.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE_COMMIT_PROOF';end$$;
    create trigger immutable_capture before update or delete on commit_probe.captures for each row execute function commit_probe.immutable();
    create trigger immutable_witness before update or delete on commit_probe.witnesses for each row execute function commit_probe.immutable();
    create function commit_probe.witness(target text) returns timestamptz language plpgsql as $$
      declare c commit_probe.captures%rowtype; t timestamptz;
      begin
        select * into strict c from commit_probe.captures where id=target;
        if c.writer_pid<>pg_backend_pid() or c.writer_start<>(select backend_start from pg_stat_activity where pid=pg_backend_pid())
          then raise exception 'SAME_BACKEND_POST_COMMIT_WITNESS_REQUIRED';end if;
        if c.writer_xid=pg_current_xact_id() then raise exception 'UNCOMMITTED_CAPTURE_CANNOT_BE_WITNESSED';end if;
        if current_setting('fsync')<>'on' or current_setting('synchronous_commit')<>'on'
          then raise exception 'SYNCHRONOUS_DURABILITY_REQUIRED';end if;
        t:=clock_timestamp();
        insert into commit_probe.witnesses values(target,t,pg_current_wal_flush_lsn(),pg_postmaster_start_time()) on conflict do nothing;
        return t;
      end$$;`);
  }
  async begin(id: string, body: unknown, sourceTime: Date, cutoff: Date) {
    await this.guard();
    const client = await this.db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local synchronous_commit=on');
      await client.query(
        `insert into commit_probe.captures(id,body,hash,source_time,cutoff,writer_start)
        values($1,$2::jsonb,$3,$4,$5,(select backend_start from pg_stat_activity where pid=pg_backend_pid()))`,
        [id, JSON.stringify(body), fingerprint(body), sourceTime, cutoff],
      );
      return client;
    } catch (error) {
      await client.query('rollback');
      client.release();
      throw error;
    }
  }
  async commitAndWitness(client: PoolClient, id: string) {
    // Same backend cannot execute this next statement until synchronous COMMIT has returned.
    await client.query('set local synchronous_commit=on; commit');
    await client.query('select commit_probe.witness($1)', [id]);
  }
  async eligible(id: string) {
    await this.guard();
    const result = await this.db.pool.query(
      `select c.*,w.witnessed_db_at,w.flush_lsn::text
    from commit_probe.captures c join commit_probe.witnesses w on w.capture_id=c.id
    where c.id=$1 and c.source_time<=c.cutoff and c.received_db_at<=c.cutoff and w.witnessed_db_at<=c.cutoff`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw Error('NO_PRE_CUTOFF_COMMIT_WITNESS');
    if (fingerprint(row.body) !== row.hash) throw Error('CAPTURE_HASH_MISMATCH');
    return row;
  }
}
