-- Private disposable schema only. Owner and login roles are created by the guarded installer.
create schema archive_integrity authorization v2_archive_owner;
set role v2_archive_owner;
create table archive_integrity.rounds(
 id text primary key, canonical_round_id text unique references public.hourly_rounds(id),
 cutoff timestamptz not null check(isfinite(cutoff)),
 clock_basis text not null check(clock_basis='UNQUALIFIED_DB_CLOCK_DIAGNOSTIC'),
 max_age_ms integer not null check(max_age_ms>0 and max_age_ms<=5000),
 model_version text not null,execution_policy_hash text not null check(length(execution_policy_hash)=64),
 markets jsonb not null check(jsonb_typeof(markets)='array' and jsonb_array_length(markets)>0),
 state text not null default 'OPEN' check(state in ('OPEN','SEALED')));
create table archive_integrity.submissions(
 id text primary key,round_id text not null references archive_integrity.rounds(id),market_key text not null,
 body jsonb not null,digest text not null check(length(digest)=64),
 received_at timestamptz not null,writer_xid xid8 not null,unique(round_id,market_key,digest));
create table archive_integrity.certificates(
 capture_id text primary key references archive_integrity.submissions(id),
 certified_at timestamptz not null,flush_barrier_lsn pg_lsn not null,observed_flush_lsn pg_lsn not null,
 postmaster_start timestamptz not null,validator text not null,
 check(observed_flush_lsn>=flush_barrier_lsn));
create table archive_integrity.cursors(
 market_key text not null,source text not null,upstream text not null,
 slot numeric(20,0) not null check(slot>0),source_ms bigint not null,economic_digest text not null,
 primary key(market_key,source,upstream));
create table archive_integrity.faults(
 id bigint generated always as identity primary key,round_id text not null references archive_integrity.rounds(id),
 market_key text not null,capture_id text,at timestamptz not null,reason text not null,digest text not null);
create table archive_integrity.seals(
 round_id text primary key references archive_integrity.rounds(id),version text not null,
 sealed_at timestamptz not null,body jsonb not null,digest text not null check(length(digest)=64),seal_xid xid8 not null default pg_current_xact_id());
create table archive_integrity.review_holds(
 round_id text primary key references archive_integrity.rounds(id),
 status text not null check(status='REVIEW_REQUIRED'),reasons jsonb not null);
create function archive_integrity.immutable() returns trigger language plpgsql
 set search_path=pg_catalog,archive_integrity,pg_temp as $$begin raise exception 'IMMUTABLE_ARCHIVE';end$$;
create function archive_integrity.round_transition() returns trigger language plpgsql
 set search_path=pg_catalog,archive_integrity,pg_temp as $$begin
 if tg_op<>'UPDATE' then raise exception 'IMMUTABLE_ROUND';end if;
 if old.state<>'OPEN' or new.state<>'SEALED' or (to_jsonb(old)-'state')<>(to_jsonb(new)-'state') then
 raise exception 'IMMUTABLE_ROUND';end if;return new;end$$;
create trigger round_state before update or delete on archive_integrity.rounds for each row execute function archive_integrity.round_transition();
create trigger round_truncate before truncate on archive_integrity.rounds execute function archive_integrity.immutable();
do $$declare t text;begin
 foreach t in array array['submissions','certificates','faults','seals','review_holds'] loop
 execute format('create trigger immutable_row before update or delete on archive_integrity.%I for each row execute function archive_integrity.immutable()',t);
 execute format('create trigger immutable_truncate before truncate on archive_integrity.%I execute function archive_integrity.immutable()',t);
 end loop;end$$;
create function archive_integrity.digest(value jsonb) returns text language sql immutable strict
 set search_path=pg_catalog,archive_integrity,pg_temp as $$select encode(sha256(convert_to(value::text,'UTF8')),'hex')$$;
-- All mutation paths take this same transaction-scoped lock before the round row lock.
create function archive_integrity.lock_round(target text) returns archive_integrity.rounds language plpgsql
 set search_path=pg_catalog,archive_integrity,pg_temp as $$declare r archive_integrity.rounds;begin
 perform pg_advisory_xact_lock(8412026,16);
 select * into strict r from archive_integrity.rounds where id=target for update;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ_COMMITTED_REQUIRED';end if;
 return r;end$$;
create function archive_integrity.check_body(b jsonb,r archive_integrity.rounds,at_ms bigint,mkey text) returns void language plpgsql
 set search_path=pg_catalog,archive_integrity,pg_temp as $$
 declare e jsonb; o jsonb; n jsonb; q jsonb; obs jsonb; t numeric; s text; identity_expected jsonb;
 begin
 e:=b->'evidence';
 select x->'identity' into identity_expected from jsonb_array_elements(r.markets) x where x->>'key'=mkey;
 if e is null or e->'identity' is distinct from identity_expected or identity_expected is null then raise exception 'MARKET_IDENTITY_REQUIRED';end if;
 if not(e ? 'conversion') or jsonb_typeof(e->'conversion') not in ('null','object') then raise exception 'CONVERSION_DENOMINATION_REQUIRED';end if;
 if jsonb_typeof(e->'observations') is distinct from 'array' or jsonb_array_length(e->'observations')<2
 or jsonb_typeof(e#>'{calibration,quotes}') is distinct from 'array' or jsonb_array_length(e#>'{calibration,quotes}')<2 then raise exception 'COMPLETE_EVIDENCE_REQUIRED';end if;
 if jsonb_typeof(b->'retainedSource') is distinct from 'object' then raise exception 'RETAINED_SOURCE_REQUIRED';end if;
 obs:=e->'observations';
 if e->'conversion'<>'null'::jsonb then
 if jsonb_typeof(e#>'{conversion,observations}') is distinct from 'array' then raise exception 'FX_EVIDENCE_REQUIRED';end if;
 obs:=obs||(e#>'{conversion,observations}');end if;
 for o in select value from jsonb_array_elements(obs||(e#>'{calibration,quotes}')) loop
 if coalesce(o->>'source','')='' or coalesce(o->>'upstream','')='' then raise exception 'SOURCE_PROVENANCE_REQUIRED';end if;
 s:=o#>>'{slot,$bigint}';
 if s is null or s!~'^[1-9][0-9]{0,19}$' or s::numeric>18446744073709551615 then raise exception 'VALID_SLOT_REQUIRED';end if;
 if jsonb_typeof(o->'observedAtMs') is distinct from 'number' then raise exception 'SOURCE_TIME_REQUIRED';end if;
 t:=(o->>'observedAtMs')::numeric;
 if t<>trunc(t) or t<0 or t>9007199254740991 or t>at_ms or at_ms-t>r.max_age_ms
 or t>extract(epoch from r.cutoff)*1000 then raise exception 'SOURCE_TIME_OUT_OF_RANGE';end if;
 end loop;
 if jsonb_typeof(e->'feeObservedAtMs') is distinct from 'number' then raise exception 'FEE_TIME_REQUIRED';end if;
 t:=(e->>'feeObservedAtMs')::numeric;
 if t<>trunc(t) or t<0 or t>at_ms or at_ms-t>r.max_age_ms or t>extract(epoch from r.cutoff)*1000 then raise exception 'FEE_TIME_OUT_OF_RANGE';end if;
 if e->'conversion'<>'null'::jsonb then
 for o in select value from jsonb_array_elements(e#>'{conversion,observations}') loop
 select value into n from jsonb_array_elements(e->'observations') x where x->>'source'=o->>'source';
 if n is null or n->'slot' is distinct from o->'slot' or n->'observedAtMs' is distinct from o->'observedAtMs'
 or n->'upstream' is distinct from o->'upstream' then raise exception 'FX_CURSOR_CONFLICT';end if;
 end loop;end if;
 for q in select value from jsonb_array_elements(e#>'{calibration,quotes}') loop
 select value into n from jsonb_array_elements(e->'observations') x where x->>'source'=q->>'source';
 if n is not null and (n->'slot' is distinct from q->'slot' or n->'observedAtMs' is distinct from q->'observedAtMs') then raise exception 'QUOTE_CURSOR_CONFLICT';end if;
 end loop;
 end$$;
reset role;
