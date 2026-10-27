import type { DatabaseService } from '../../../db/src/database.js';
import {
  fingerprint,
  validateEvidence,
  calibrate,
} from '../../candidates/simple-price-v2-directional/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v2-directional/model.js';
import { pack, unpack } from '../../integration/simple-price-v2-directional/adapter.js';
import type { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';

export const SELECTION_VERSION = 'PROPOSED_PRE_CUTOFF_PRIVATE_REPLAY_V1';
export interface SelectionPolicy {
  version: typeof SELECTION_VERSION;
  maxAgeMs: number;
  rationale: string;
  provenance: 'CONTROLLED_ARCHIVED_REPLAY_ONLY';
}
export interface CaptureRow {
  id: string;
  evidence: unknown;
  received_ms: string;
  persisted_ms: string;
  hash: string;
}
/** No live default or live ingestion entry point: confirmed-bank receipts do not yet establish
 * approved cutoff finality. Controlled clock is explicit and bound into the immutable policy. */
export class CutoffArchive {
  constructor(
    readonly db: DatabaseService,
    readonly token: string,
    readonly execution: Policy,
    readonly policy: SelectionPolicy,
    readonly clock: () => number,
    readonly highWater: IsolatedHighWater,
  ) {
    if (
      policy.version !== SELECTION_VERSION ||
      policy.provenance !== 'CONTROLLED_ARCHIVED_REPLAY_ONLY' ||
      !policy.rationale.trim() ||
      !Number.isSafeInteger(policy.maxAgeMs) ||
      policy.maxAgeMs <= 0 ||
      policy.maxAgeMs > execution.maxAgeMs
    )
      throw Error('EXPLICIT_PRIVATE_FRESHNESS_POLICY_REQUIRED');
  }
  async guard() {
    const rows = (await this.db.pool.query('select token from private_v2.isolation_guard')).rows;
    if (rows.length !== 1 || rows[0].token !== this.token) throw Error('DISPOSABLE_GUARD_REQUIRED');
  }
  async initialize() {
    await this.guard();
    await this.db.pool.query(`create schema final_v2;
      create table final_v2.policy(id boolean primary key check(id), hash text not null);
      create table final_v2.captures(id text primary key, market_key text not null, received_ms bigint not null,
        persisted_ms bigint not null, evidence jsonb not null, hash text not null);
      create table final_v2.capture_faults(id bigint generated always as identity primary key, market_key text not null, at_ms bigint not null, reason text not null, evidence_hash text not null);
      create table final_v2.decisions(round_id text not null references hourly_rounds(id), market_key text not null,
        capture_id text references final_v2.captures(id), reason text, primary key(round_id,market_key));
      create table final_v2.control(round_id text primary key references hourly_rounds(id), status text not null
        check(status in ('RUNNING','REVIEW_REQUIRED','FINALIZED')), passes integer not null default 0, failures jsonb not null default '[]');
      create table final_v2.audit(id bigint generated always as identity primary key, round_id text not null,
        at_ms bigint not null, event text not null, details jsonb not null);
      create function final_v2.immutable() returns trigger language plpgsql as $$ begin
        raise exception 'PRIVATE_IMMUTABLE_CUTOFF_EVIDENCE'; end $$;
      create trigger immutable_fault before update or delete on final_v2.capture_faults for each row execute function final_v2.immutable();
      create trigger immutable_capture before update or delete on final_v2.captures for each row execute function final_v2.immutable();
      create trigger immutable_decision before update or delete on final_v2.decisions for each row execute function final_v2.immutable();
      create trigger immutable_policy before update or delete on final_v2.policy for each row execute function final_v2.immutable();
      create trigger immutable_audit before update or delete on final_v2.audit for each row execute function final_v2.immutable();
      create function final_v2.hold_guard() returns trigger language plpgsql as $$ begin
        if exists(select 1 from final_v2.control c join hourly_rounds r on r.id=c.round_id
          where c.status='REVIEW_REQUIRED' and (c.round_id=NEW.hourly_round_id or
          (NEW.daily_competition_id is not null and exists(select 1 from daily_competitions d where d.id=NEW.daily_competition_id
           and r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive)))) then
          raise exception 'PRIVATE_SETTLEMENT_REVIEW_PAYOUT_HOLD'; end if; return NEW; end $$;
      create function final_v2.terminal_control() returns trigger language plpgsql as $control$ begin
        if OLD.status in ('REVIEW_REQUIRED','FINALIZED') then raise exception 'PRIVATE_TERMINAL_REVIEW_CONTROL'; end if;
        return NEW; end $control$;
      create trigger immutable_terminal_control before update or delete on final_v2.control for each row execute function final_v2.terminal_control();
      create trigger private_payout_hold before insert or update on payout_plans for each row execute function final_v2.hold_guard();`);
    await this.db.pool.query('insert into final_v2.policy values(true,$1)', [this.binding]);
  }
  get binding() {
    return fingerprint({ execution: this.execution, selection: this.policy });
  }
  async verifyBinding() {
    await this.guard();
    if (
      (await this.db.pool.query('select hash from final_v2.policy where id=true')).rows[0]?.hash !==
      this.binding
    )
      throw Error('PRIVATE_CUTOFF_POLICY_MISMATCH');
  }
  validate(e: Evidence, at: number) {
    // Strictly no source evidence from after receipt/cutoff, even inside the execution future allowance.
    const observations = [...e.observations, ...(e.conversion?.observations ?? [])];
    const times = [
      ...observations.map((o) => o.observedAtMs),
      e.feeObservedAtMs,
      ...e.calibration.quotes.map((q) => q.observedAtMs),
    ];
    if (times.some((t) => !Number.isSafeInteger(t) || t > at || at - t > this.policy.maxAgeMs))
      throw Error('NO_FRESH_PRE_CUTOFF_EVIDENCE');
    for (const o of observations) {
      if (o.slot === null) throw Error('CUTOFF_SLOT_REQUIRED');
      const native = e.observations.find((n) => n.source === o.source);
      if (!native || native.slot !== o.slot || native.observedAtMs !== o.observedAtMs)
        throw Error('NON_ATOMIC_NATIVE_FX_EVIDENCE');
      for (const q of e.calibration.quotes.filter((q) => q.source === o.source))
        if (q.slot !== o.slot || q.observedAtMs !== o.observedAtMs)
          throw Error('NON_ATOMIC_QUOTE_EVIDENCE');
    }
    const price = validateEvidence(e, e.identity, at, this.execution);
    calibrate(e, price, at, this.execution);
  }
  async capture(e: Evidence, receivedMs: number) {
    await this.verifyBinding();
    const persistedMs = this.clock();
    if (!Number.isSafeInteger(receivedMs) || receivedMs > persistedMs)
      throw Error('INVALID_CAPTURE_RECEIPT_ORDER');
    try {
      this.validate(e, receivedMs);
      this.validate(e, persistedMs);
      await this.highWater.accept(e, persistedMs);
    } catch (error) {
      await this.db.pool.query(
        'insert into final_v2.capture_faults(market_key,at_ms,reason,evidence_hash) values($1,$2,$3,$4)',
        [
          fingerprint(e.identity),
          persistedMs,
          error instanceof Error ? error.message : 'INVALID_CAPTURE',
          fingerprint(e),
        ],
      );
      throw error;
    }
    const body = pack(e),
      hash = fingerprint(body),
      id = fingerprint({ hash, receivedMs, persistedMs });
    await this.db.pool.query(
      `insert into final_v2.captures values($1,$2,$3,$4,$5::jsonb,$6) on conflict do nothing`,
      [id, fingerprint(e.identity), receivedMs, persistedMs, JSON.stringify(body), hash],
    );
    return id;
  }
  async select(round: string, identity: Evidence['identity'], cutoff: number): Promise<Evidence> {
    await this.verifyBinding();
    if (this.clock() < cutoff) throw Error('CUTOFF_NOT_REACHED');
    const actual = (
      await this.db.pool.query(
        'select starts_at,ends_at_exclusive from hourly_rounds where id=$1',
        [round],
      )
    ).rows[0];
    if (!actual || actual.ends_at_exclusive.getTime() !== cutoff)
      throw Error('ROUND_CUTOFF_MISMATCH');
    const key = fingerprint(identity),
      pinned = (
        await this.db.pool.query(
          'select * from final_v2.decisions where round_id=$1 and market_key=$2',
          [round, key],
        )
      ).rows[0];
    let row: CaptureRow | undefined;
    if (pinned) {
      if (pinned.reason) throw Error(pinned.reason);
      row = (
        await this.db.pool.query<CaptureRow>('select * from final_v2.captures where id=$1', [
          pinned.capture_id,
        ])
      ).rows[0];
    } else {
      // Latest received complete capture; never fall back to an earlier favorable capture if this fails.
      row = (
        await this.db.pool.query<CaptureRow>(
          `select * from final_v2.captures where market_key=$1
        and received_ms<=$2 and persisted_ms<=$2 order by received_ms desc,persisted_ms desc,id asc limit 1`,
          [key, cutoff],
        )
      ).rows[0];
    }
    let reason: string | null = null,
      e: Evidence | undefined;
    try {
      if (!row) throw Error('MISSING_DURABLE_PRE_CUTOFF_CAPTURE');
      if (
        (
          await this.db.pool.query(
            'select 1 from final_v2.capture_faults where market_key=$1 and at_ms<=$2 and at_ms>=$3',
            [key, cutoff, actual.starts_at.getTime()],
          )
        ).rowCount
      )
        throw Error('PRE_CUTOFF_CAPTURE_INTEGRITY_REVIEW');
      if (fingerprint(row.evidence) !== row.hash) throw Error('CUTOFF_CAPTURE_HASH_MISMATCH');
      e = unpack<Evidence>(row.evidence);
      this.validate(e, cutoff);
      if (fingerprint(e.identity) !== key) throw Error('CUTOFF_IDENTITY_MISMATCH');
    } catch (error) {
      reason = error instanceof Error ? error.message : 'INVALID_CUTOFF_CAPTURE';
    }
    if (!pinned)
      await this.db.pool.query(
        `insert into final_v2.decisions values($1,$2,$3,$4) on conflict do nothing`,
        [round, key, reason ? null : row!.id, reason],
      );
    const decision = (
      await this.db.pool.query(
        'select * from final_v2.decisions where round_id=$1 and market_key=$2',
        [round, key],
      )
    ).rows[0];
    if (decision.reason) throw Error(decision.reason);
    // A concurrent selector must agree with the immutable winner, not return its unpinned local candidate.
    if (!reason && decision.capture_id !== row?.id) return this.select(round, identity, cutoff);
    if (reason) throw Error(reason);
    return e!;
  }
}
