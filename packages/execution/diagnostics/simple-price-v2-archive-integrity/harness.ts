import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { DisposableDatabase } from '../../integration/simple-price-v2/disposable.js';
import { pack, unpack } from '../../integration/simple-price-v2-directional/adapter.js';
import { controlledReplay, encode } from '../simple-price-v2-settlement/fixtures.js';
import {
  validateEvidence,
  calibrate,
  fingerprint,
  MODEL_VERSION,
} from '../../candidates/simple-price-v2-directional/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v2-directional/model.js';
import { REAL_POLICY } from '../../providers/simple-price-v2/provider.js';
export const VERSION = 'ARCHIVE_DB_WAL_SEAL_V1';
const roles = ['writer', 'validator', 'sealer', 'reader'] as const;
export class IntegrityHarness {
  readonly owner = new DisposableDatabase();
  pools = {} as Record<(typeof roles)[number], Pool>;
  readonly original: Evidence;
  readonly policy: Policy = REAL_POLICY;
  readonly key: string;
  private settings: Record<string, unknown> = {};
  private readerUrl = '';
  constructor() {
    const x = JSON.parse(
      readFileSync('artifacts/simple-price-v2-provider-review/live-markets.json', 'utf8'),
    );
    const keys = new Set(['n', 'd', 'bps', 'slot', 'input', 'output', 'minInput', 'maxInput']);
    this.original = JSON.parse(JSON.stringify(x[0].capture.evidence), (k, v: unknown) =>
      keys.has(k) && typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : v,
    ) as Evidence;
    this.key = fingerprint(this.original.identity);
  }
  get db() {
    return this.owner.database!;
  }
  async start() {
    const { database: db } = await this.owner.start();
    this.settings = (
      await db.pool.query(
        "select version() postgres,current_setting('wal_level') wal_level,current_setting('fsync') fsync,current_setting('full_page_writes') full_page_writes",
      )
    ).rows[0];
    await db.pool.query(
      'create role v2_archive_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
    );
    await db.pool.query(
      'grant usage on schema public to v2_archive_owner;grant references on public.hourly_rounds to v2_archive_owner;grant select on public.hourly_rounds,public.daily_competitions,public.payout_plans to v2_archive_owner',
    );
    await db.pool.query(
      'grant execute on function pg_catalog.pg_logical_emit_message(boolean,text,text,boolean) to v2_archive_owner',
    );
    for (const role of roles) {
      const password = randomBytes(24).toString('hex');
      await db.pool.query(
        'create role v2_archive_' +
          role +
          " login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '" +
          password +
          "'",
      );
      const u = new URL(db.pool.options.connectionString!);
      u.username = 'v2_archive_' + role;
      u.password = password;
      this.pools[role] = new Pool({ connectionString: u.toString(), max: 4 });
      if (role === 'reader') this.readerUrl = u.toString();
    }
    for (const name of ['schema.sql', 'operations.sql'])
      await db.pool.query(readFileSync(new URL('./' + name, import.meta.url), 'utf8'));
    // Definer functions never run with bootstrap/superuser privileges.
    await db.pool.query(
      'alter function archive_integrity.payout_hold() owner to v2_archive_owner;alter function archive_integrity.approval_hold() owner to v2_archive_owner',
    );
  }
  async round(id: string, leadMs = 3000, maxAgeMs = 5000) {
    const row = (
      await this.db.pool.query(
        "insert into archive_integrity.rounds(id,cutoff,clock_basis,max_age_ms,markets,model_version,execution_policy_hash) values($1,clock_timestamp()+$2::int*interval '1 millisecond','UNQUALIFIED_DB_CLOCK_DIAGNOSTIC',$4,$3::jsonb,$5,$6) returning *",
        [
          id,
          leadMs,
          JSON.stringify([{ key: this.key, identity: this.original.identity }]),
          maxAgeMs,
          MODEL_VERSION,
          fingerprint(this.policy),
        ],
      )
    ).rows[0];
    return row as { id: string; cutoff: Date };
  }
  async registerCanonical(roundId: string) {
    const r = (
      await this.db.pool.query(
        "insert into archive_integrity.rounds(id,canonical_round_id,cutoff,clock_basis,max_age_ms,markets,model_version,execution_policy_hash) select id,id,ends_at_exclusive,'UNQUALIFIED_DB_CLOCK_DIAGNOSTIC',5000,$2::jsonb,$3,$4 from public.hourly_rounds where id=$1 returning id,cutoff",
        [
          roundId,
          JSON.stringify([{ key: this.key, identity: this.original.identity }]),
          MODEL_VERSION,
          fingerprint(this.policy),
        ],
      )
    ).rows[0];
    if (!r) throw Error('CANONICAL_ROUND_REQUIRED');
    return r;
  }
  async payload(ago = 0) {
    const at =
      Number(
        (
          await this.db.pool.query(
            'select floor(extract(epoch from clock_timestamp())*1000)::bigint ms',
          )
        ).rows[0].ms,
      ) - ago;
    return {
      evidence: { ...pack(controlledReplay(this.original, at)) } as Record<string, unknown>,
      retainedSource: {
        kind: 'EXPLICIT_CONTROLLED_TIME_ARCHIVED_PRICE_FIXTURE',
        original: pack(this.original),
      },
    };
  }
  async submit(
    round: string,
    id: string,
    body: unknown,
    client: Pool | PoolClient = this.pools.writer,
  ) {
    return (
      await client.query('select archive_integrity.submit($1,$2,$3,$4::jsonb) result', [
        round,
        id,
        this.key,
        JSON.stringify(body),
      ])
    ).rows[0].result;
  }
  async certify(
    id: string,
    client: Pool | PoolClient = this.pools.validator,
    skipTrustedValidation = false,
  ) {
    const c = (
      await this.pools.validator.query('select * from archive_integrity.submissions where id=$1', [
        id,
      ])
    ).rows[0];
    if (!c) throw Error('NO_COMMITTED_CAPTURE');
    if (!skipTrustedValidation) {
      const at = Number(
        (
          await this.db.pool.query(
            'select floor(extract(epoch from clock_timestamp())*1000)::bigint ms',
          )
        ).rows[0].ms,
      );
      try {
        this.validate(unpack<Evidence>(c.body.evidence), at);
      } catch (e) {
        return (
          await client.query('select archive_integrity.reject_capture($1,$2,$3) result', [
            id,
            c.digest,
            e instanceof Error ? e.message : 'INVALID_FINANCIAL_EVIDENCE',
          ])
        ).rows[0].result;
      }
    }
    return (await client.query('select archive_integrity.certify($1,$2) result', [id, c.digest]))
      .rows[0].result;
  }

  validate(e: Evidence, at: number) {
    const obs = [...e.observations, ...(e.conversion?.observations ?? [])];
    const times = [
      ...obs.map((o) => o.observedAtMs),
      e.feeObservedAtMs,
      ...e.calibration.quotes.map((q) => q.observedAtMs),
    ];
    if (times.some((t) => !Number.isSafeInteger(t) || t > at || at - t > this.policy.maxAgeMs))
      throw Error('STRICT_SOURCE_TIME_REQUIRED');
    for (const o of obs) {
      const n = e.observations.find((n) => n.source === o.source);
      if (o.slot === null || !n || n.slot !== o.slot || n.observedAtMs !== o.observedAtMs)
        throw Error('NATIVE_FX_CURSOR_CONFLICT');
    }
    const price = validateEvidence(e, e.identity, at, this.policy);
    calibrate(e, price, at, this.policy);
  }
  async seal(id: string, client: Pool | PoolClient = this.pools.sealer) {
    return (await client.query('select archive_integrity.seal($1,$2) result', [id, VERSION]))
      .rows[0].result;
  }
  async afterCutoff(cutoff: Date) {
    await this.db.pool.query(
      'select pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.01)',
      [cutoff],
    );
  }
  readConnectionForChild() {
    return this.readerUrl;
  }
  async snapshot() {
    return Object.fromEntries(
      await Promise.all(
        ['rounds', 'submissions', 'certificates', 'cursors', 'faults', 'seals', 'review_holds'].map(
          async (t) => [
            t,
            (await this.pools.validator.query('select * from archive_integrity.' + t)).rows,
          ],
        ),
      ),
    );
  }
  async close(notes: unknown = {}) {
    try {
      writeFileSync(
        'artifacts/simple-price-v2-archive-integrity-review/integrity-' +
          Date.now() +
          '-' +
          randomBytes(3).toString('hex') +
          '.json',
        encode({ settings: this.settings, caseEvidence: notes }),
        { flag: 'wx' },
      );
    } finally {
      for (const p of Object.values(this.pools)) await p.end();
      await this.owner.close();
    }
  }
}
