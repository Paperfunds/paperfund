-- Explicit-install successor; never backfills or qualifies existing holds/captures.
alter table current_quote_settlement_policies add selection_version text not null default 'EXACT_BOUNDARY_V1'
 check(selection_version in('EXACT_BOUNDARY_V1','DURABLE_QUOTE_V2'));
alter table current_quote_settlement_policies add max_age_ms integer not null default 10000 check(max_age_ms>0 and max_age_ms<=10000);
alter table current_quote_settlement_policies add uncertainty_ms integer not null default 100 check(uncertainty_ms between 1 and 100);
alter table current_quote_settlement_policies add provider_id text;
alter table current_quote_settlement_policies add check(selection_version<>'DURABLE_QUOTE_V2' or (provider_id is not null and length(provider_id)>0));
alter table current_quote_cutoff_captures add writer_xid xid8 not null default pg_current_xact_id();
-- Caller-supplied timestamps/XIDs must never counterfeit committed visibility or deadline proof.
create function stamp_current_quote_capture() returns trigger language plpgsql as $$begin NEW.writer_xid:=pg_current_xact_id();NEW.recorded_at:=clock_timestamp();return NEW;end $$;
create trigger stamp_quote_capture before insert on current_quote_cutoff_captures for each row execute function stamp_current_quote_capture();
create function stamp_current_quote_policy() returns trigger language plpgsql as $$begin NEW.recorded_at:=clock_timestamp();return NEW;end $$;
create trigger stamp_quote_policy before insert on current_quote_settlement_policies for each row execute function stamp_current_quote_policy();
create table current_quote_capture_certificates(
 capture_id text primary key references current_quote_cutoff_captures(id), certified_at timestamptz not null,
 marker_lsn pg_lsn not null, flush_lsn pg_lsn not null check(flush_lsn>=marker_lsn),
 postmaster_started_at timestamptz not null, provider_id text not null
);
create table current_quote_capture_faults(
 id bigint generated always as identity primary key, round_id text not null references hourly_rounds(id),
 position_id text not null references positions(id), reason text not null, recorded_at timestamptz not null default clock_timestamp()
);
create table current_quote_capture_finality(
 capture_id text primary key references current_quote_capture_certificates(capture_id),
 header jsonb not null, observed_at timestamptz not null default clock_timestamp(), provider_id text not null
);
create function stamp_current_quote_finality() returns trigger language plpgsql as $$begin NEW.observed_at:=clock_timestamp();return NEW;end $$;
create trigger stamp_quote_finality before insert on current_quote_capture_finality for each row execute function stamp_current_quote_finality();
create trigger immutable_quote_certificate before update or delete on current_quote_capture_certificates for each row execute function reject_payout_detail_change();
create trigger immutable_quote_fault before update or delete on current_quote_capture_faults for each row execute function reject_payout_detail_change();
create trigger immutable_quote_finality before update or delete on current_quote_capture_finality for each row execute function reject_payout_detail_change();
revoke all on current_quote_capture_certificates,current_quote_capture_faults,current_quote_capture_finality from public;
create function certify_current_quote_capture(cid text) returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare c public.current_quote_cutoff_captures; r public.hourly_rounds; p public.current_quote_settlement_policies; marker pg_lsn; fl pg_lsn; at_time timestamptz;
begin
 select * into strict c from public.current_quote_cutoff_captures where id=cid;
 if c.writer_xid=pg_current_xact_id_if_assigned() then raise exception 'SEPARATELY_COMMITTED_CAPTURE_REQUIRED'; end if;
 select * into strict r from public.hourly_rounds where id=c.round_id for update;
 select * into strict p from public.current_quote_settlement_policies where id=c.policy_id;
 if p.selection_version<>'DURABLE_QUOTE_V2' or p.recorded_at>=r.starts_at or r.starts_at<p.effective_from or r.starts_at>=p.ends_before then raise exception 'FUTURE_QUOTE_POLICY_REQUIRED';end if;
 if exists(select 1 from public.current_quote_capture_certificates where capture_id=cid) then return true;end if;
 if current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on' or pg_is_in_recovery() then raise exception 'DURABILITY_NOT_QUALIFIED';end if;
 marker:=pg_logical_emit_message(false,'paperfund-current-quote',cid,true); fl:=pg_current_wal_flush_lsn();
 at_time:=clock_timestamp();
 if fl<marker or at_time+make_interval(secs=>p.uncertainty_ms/1000.0)>=r.ends_at_exclusive or r.state<>'OPEN' or c.bank_time>c.recorded_at or c.bank_time<r.ends_at_exclusive-make_interval(secs=>p.max_age_ms/1000.0)
 or exists(select 1 from public.legacy_source_reviews where hourly_round_id=r.id)
 or exists(select 1 from public.current_quote_capture_faults where round_id=r.id and position_id=c.position_id)
 then raise exception 'PRE_CUTOFF_DURABILITY_REQUIRED';end if;
 insert into public.current_quote_capture_certificates values(cid,at_time,marker,fl,pg_postmaster_start_time(),p.provider_id);
 return true;
end $$;
revoke all on function certify_current_quote_capture(text) from public;

create function current_quote_seal_capture_valid(sid text) returns boolean language sql stable as $$
 select exists(select 1 from current_quote_cutoff_seals s join current_quote_settlement_policies p on p.id=s.policy_id
 join current_quote_cutoff_captures c on c.id=s.capture_id and c.position_id=s.position_id and c.round_id=s.round_id and c.policy_id=s.policy_id
 join hourly_rounds r on r.id=s.round_id
 where s.id=sid and (p.selection_version='EXACT_BOUNDARY_V1' or (
  s.document->'next'='null'::jsonb and s.document->>'captureHash'=c.document->>'hash'
  and exists(select 1 from current_quote_capture_certificates cert join current_quote_capture_finality f using(capture_id)
   where cert.capture_id=c.id and cert.flush_lsn>=cert.marker_lsn and cert.provider_id=p.provider_id and f.provider_id=p.provider_id
   and cert.certified_at>=c.recorded_at and cert.certified_at+make_interval(secs=>p.uncertainty_ms/1000.0)<r.ends_at_exclusive
   and c.bank_time<=c.recorded_at and c.bank_time<r.ends_at_exclusive and c.bank_time>=r.ends_at_exclusive-make_interval(secs=>p.max_age_ms/1000.0)
   and f.observed_at>=cert.certified_at and f.observed_at+make_interval(secs=>p.uncertainty_ms/1000.0)<=r.ends_at_exclusive+interval '60 seconds'
   and f.header=s.document->'last' and (f.header->>'slot')::bigint=c.slot and (f.header->>'blockTime')::bigint=extract(epoch from c.bank_time)::bigint)
  and not exists(select 1 from current_quote_capture_faults fault where fault.round_id=s.round_id)
  and not exists(select 1 from fills fill join orders o on o.id=fill.order_id join positions pos on pos.competition_account_id=o.competition_account_id
   where pos.id=s.position_id and o.execution_context='NORMAL_USER' and fill.executed_at>c.recorded_at)
 )))
$$;
-- Extend financial source scope and digests; old exact-bank evidence retains its old digest.
alter function current_quote_source_scope(text,text) rename to current_quote_source_scope_before_durable;
create function current_quote_durable_evidence(rid text) returns jsonb language sql stable as $$
 select jsonb_build_object('certificates',(select coalesce(jsonb_agg(to_jsonb(c) order by c.capture_id),'[]'::jsonb) from current_quote_capture_certificates c join current_quote_cutoff_captures a on a.id=c.capture_id where a.round_id=rid),
 'finality',(select coalesce(jsonb_agg(to_jsonb(f) order by f.capture_id),'[]'::jsonb) from current_quote_capture_finality f join current_quote_cutoff_captures a on a.id=f.capture_id where a.round_id=rid),
 'faults',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from current_quote_capture_faults f where f.round_id=rid))
$$;
create function current_quote_source_scope(rid text,pid text) returns jsonb language plpgsql stable as $$
declare proof jsonb;begin
 proof:=current_quote_source_scope_before_durable(rid,pid);
 if exists(select 1 from current_quote_settlement_policies where id=pid and selection_version='DURABLE_QUOTE_V2') then
 proof:=proof||jsonb_build_object('qualified',(proof->>'qualified')::boolean
  and not exists(select 1 from current_quote_capture_faults where round_id=rid)
  and not exists(select 1 from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id
   join hourly_rounds r on r.id=a.hourly_round_id join current_quote_settlement_policies p on p.id=pid
   where r.id=rid and o.execution_context='NORMAL_USER' and
    (f.executed_at<r.starts_at+make_interval(secs=>p.uncertainty_ms/1000.0) or f.executed_at>=r.ends_at_exclusive-make_interval(secs=>p.uncertainty_ms/1000.0)))
  and not exists(select 1 from current_quote_cutoff_seals where round_id=rid and current_quote_seal_capture_valid(id) is not true),
 'cutoffEvidenceHash',encode(sha256(convert_to(jsonb_build_object('previous',proof->>'cutoffEvidenceHash','durable',current_quote_durable_evidence(rid))::text,'UTF8')),'hex'));
 end if;return proof;
end $$;
alter function legacy_hour_digest(text) rename to legacy_hour_digest_before_durable_quote;
create function legacy_hour_digest(rid text) returns text language plpgsql stable as $$
declare h text;begin
 h:=legacy_hour_digest_before_durable_quote(rid);
 if not exists(select 1 from current_quote_cutoff_seals s join current_quote_settlement_policies p on p.id=s.policy_id where s.round_id=rid and p.selection_version='DURABLE_QUOTE_V2')then return h;end if;
 return encode(sha256(convert_to(jsonb_build_object('previous',h,'durable',current_quote_durable_evidence(rid))::text,'UTF8')),'hex');
end $$;
