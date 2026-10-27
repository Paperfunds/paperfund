-- STAGED: explicit approved installation only. Grants and policy enrollment are separate.
create table current_quote_settlement_policies(
 id text primary key, effective_from timestamptz not null, ends_before timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check(effective_from=date_trunc('hour',effective_from)),
 check(ends_before=date_trunc('hour',ends_before) and ends_before>effective_from and ends_before<=effective_from+interval '7 days'),
 check(recorded_at<effective_from)
);
create table current_quote_cutoff_captures(
 id text primary key, position_id text not null references positions(id), round_id text not null references hourly_rounds(id),
 policy_id text not null references current_quote_settlement_policies(id), slot bigint not null check(slot>=0),
 bank_time timestamptz not null, document jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(position_id,slot)
);
create table current_quote_cutoff_seals(
 id text primary key, position_id text not null unique references positions(id), round_id text not null references hourly_rounds(id),
 policy_id text not null references current_quote_settlement_policies(id), capture_id text not null references current_quote_cutoff_captures(id),
 quantity_before bigint not null check(quantity_before>0), basis_before bigint not null check(basis_before>=0),
 document jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table current_quote_settlement_steps(
 seal_id text not null references current_quote_cutoff_seals(id), step_index integer not null check(step_index>=0),
 fill_id text unique references fills(id) deferrable initially deferred,
 writeoff_journal_id text unique references journal_transactions(id) deferrable initially deferred,
 primary key(seal_id,step_index), check((fill_id is null)<>(writeoff_journal_id is null))
);
create trigger current_quote_policy_immutable before update or delete on current_quote_settlement_policies for each row execute function reject_payout_detail_change();
create trigger current_quote_capture_immutable before update or delete on current_quote_cutoff_captures for each row execute function reject_payout_detail_change();
create trigger current_quote_seal_immutable before update or delete on current_quote_cutoff_seals for each row execute function reject_payout_detail_change();
create trigger current_quote_step_immutable before update or delete on current_quote_settlement_steps for each row execute function reject_payout_detail_change();
revoke all on current_quote_settlement_policies,current_quote_cutoff_captures,current_quote_cutoff_seals,current_quote_settlement_steps from public;

create function current_quote_forced_fill_valid(fid text) returns boolean language plpgsql stable as $$
declare f fills%rowtype; s current_quote_settlement_steps%rowtype; seal current_quote_cutoff_seals%rowtype; p jsonb; link record;
begin
 select * into s from current_quote_settlement_steps where fill_id=fid;
 if not found then return false; end if;
 select * into f from fills where id=fid;
 select * into seal from current_quote_cutoff_seals where id=s.seal_id;
 p:=seal.document->'steps'->s.step_index;
 select o.competition_account_id,o.execution_context,e.position_id,a.hourly_round_id into link
  from orders o join order_market_state_evidence e on e.order_id=o.id and e.purpose='SELL_EXECUTION'
  join competition_accounts a on a.id=o.competition_account_id where o.id=f.order_id;
 return coalesce(link.execution_context='FORCED_HOURLY_SETTLEMENT' and link.position_id=seal.position_id and link.hourly_round_id=seal.round_id
  and f.side='SELL' and f.base_quantity=(p->>'quantity')::bigint and f.actual_output_lamports=(p->>'output')::bigint
  and f.fee_lamports=(p->>'fees')::bigint and f.market_state_evidence_id='market-state:'||(p->'evidence'->>'fingerprint')
  and f.executed_at=(seal.document->>'cutoff')::timestamptz and not (p->>'writeoff')::boolean
  and exists(select 1 from current_quote_settlement_policies q join hourly_rounds r on r.id=seal.round_id
   where q.id=seal.policy_id and r.starts_at>=q.effective_from and r.starts_at<q.ends_before and q.recorded_at<r.starts_at)
  and not exists(select 1 from legacy_source_reviews h where h.hourly_round_id=seal.round_id),false);
end $$;
create function current_quote_writeoff_valid(jid text) returns boolean language sql stable as $$
 select exists(select 1 from current_quote_settlement_steps t join current_quote_cutoff_seals s on s.id=t.seal_id
  join journal_transactions j on j.id=t.writeoff_journal_id join positions p on p.id=s.position_id
  where j.id=jid and (s.document->'steps'->t.step_index->>'writeoff')::boolean
  and j.operation_type='FORCED_HOURLY_SETTLEMENT_WRITEOFF' and j.source_entity_type='SETTLEMENT_WRITEOFF' and j.source_entity_id=s.position_id
  and j.competition_account_id=p.competition_account_id
  and j.metadata->>'tokenQuantity'=s.document->'steps'->t.step_index->>'quantity'
  and j.metadata->>'costBasisLamports'=s.document->'steps'->t.step_index->>'basisBefore'
  and j.metadata->'marketStateEvidence'->>'fingerprint'=s.document->'steps'->t.step_index->'evidence'->>'fingerprint'
  and not exists(select 1 from legacy_source_reviews h where h.hourly_round_id=s.round_id))
$$;
create function current_quote_source_scope(rid text,pid text) returns jsonb language sql stable as $$
 with r as(select * from hourly_rounds where id=rid), fs as(
  select f.*,o.execution_context from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.hourly_round_id=rid
 ), js as(select j.* from journal_transactions j join competition_accounts a on a.id=j.competition_account_id where a.hourly_round_id=rid),
 seals as(select * from current_quote_cutoff_seals where round_id=rid)
 select jsonb_build_object(
  'routeCount',(select count(*)::int from(select distinct market_id,protocol_id,adapter_version from fs)x),
  'routeEvidenceHash',encode(sha256(convert_to((select coalesce(jsonb_agg(jsonb_build_object('id',id,'market',market_id,'protocol',protocol_id,'adapter',adapter_version,'evidence',market_state_evidence_id) order by id),'[]'::jsonb) from fs)::text,'UTF8')),'hex'),
  'cutoffEvidenceHash',encode(sha256(convert_to(jsonb_build_object('seals',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from seals s),
   'steps',(select coalesce(jsonb_agg(to_jsonb(t) order by t.seal_id,t.step_index),'[]'::jsonb) from current_quote_settlement_steps t join seals s on s.id=t.seal_id))::text,'UTF8')),'hex'),
  'settlementKind',case when exists(select 1 from fs where execution_context='FORCED_HOURLY_SETTLEMENT') or exists(select 1 from js where source_entity_type='SETTLEMENT_WRITEOFF') then 'PINNED_CUTOFF_EXITS' else 'FLAT_AT_CUTOFF' end,
  'qualified',exists(select 1 from r join current_quote_settlement_policies p on p.id=pid and p.recorded_at<r.starts_at and r.starts_at>=p.effective_from and r.starts_at<p.ends_before where r.state='FINALIZED')
    and not exists(select 1 from legacy_source_reviews h where h.hourly_round_id=rid)
    and not exists(select 1 from positions p join competition_accounts a on a.id=p.competition_account_id where a.hourly_round_id=rid and p.status='OPEN')
    and (select count(*) from competition_accounts where hourly_round_id=rid)=(select count(*) from hourly_results where hourly_round_id=rid)
    and not exists(select 1 from fs,r where execution_context='NORMAL_USER' and (executed_at<r.starts_at or executed_at>=r.ends_at_exclusive))
    and not exists(select 1 from fs where execution_context='FORCED_HOURLY_SETTLEMENT' and current_quote_forced_fill_valid(id) is not true)
    and not exists(select 1 from js where source_entity_type='SETTLEMENT_WRITEOFF' and current_quote_writeoff_valid(id) is not true))
$$;
-- Preserve the original historical verifier, with a qualified current-policy branch only.
do $$ declare def text; begin
 select pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure) into def;
 def:=replace(def,E'\r\n',E'\n');
 if position(E'BEGIN\n' in def)=0 or position('current_quote_forced_fill_valid' in def)>0 then raise exception 'CURRENT_CUTOFF_GUARD_LAYOUT'; end if;
 def:=overlay(def placing E'BEGIN\n IF current_quote_forced_fill_valid(NEW.id) THEN RETURN NEW; END IF;\n' from position(E'BEGIN\n' in def) for length(E'BEGIN\n'));
 execute def;
end $$;
-- Include new immutable settlement evidence in the existing source-acceptance digest.
alter function legacy_hour_digest(text) rename to legacy_hour_digest_before_current_quote;
create function legacy_hour_digest(rid text) returns text language plpgsql stable as $$
declare seals jsonb;
begin
 select jsonb_agg(to_jsonb(s) order by s.id) into seals from current_quote_cutoff_seals s where s.round_id=rid;
 if seals is null then return legacy_hour_digest_before_current_quote(rid); end if;
 return encode(sha256(convert_to(jsonb_build_object('previous',legacy_hour_digest_before_current_quote(rid),'seals',seals,
  'captures',(select jsonb_agg(to_jsonb(c) order by c.id) from current_quote_cutoff_captures c where c.id in(select capture_id from current_quote_cutoff_seals where round_id=rid)),
  'steps',(select jsonb_agg(to_jsonb(t) order by t.seal_id,t.step_index) from current_quote_settlement_steps t join current_quote_cutoff_seals s on s.id=t.seal_id where s.round_id=rid))::text,'UTF8')),'hex');
end $$;
