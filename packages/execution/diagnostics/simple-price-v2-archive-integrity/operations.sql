set role v2_archive_owner;
create function archive_integrity.submit(target text,capture text,mkey text,payload jsonb) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,archive_integrity,pg_temp as $$
 declare r archive_integrity.rounds;t timestamptz;h text;prior archive_integrity.submissions;why text;
 begin
 r:=archive_integrity.lock_round(target);t:=clock_timestamp();
 if r.state<>'OPEN' or t>=r.cutoff then raise exception 'ADMISSION_CLOSED';end if;
 if capture is null or length(capture)<1 or length(capture)>200 then raise exception 'CAPTURE_ID_REQUIRED';end if;
 h:=archive_integrity.digest(payload);
 select * into prior from archive_integrity.submissions where id=capture;
 if found then
 if prior.round_id=target and prior.market_key=mkey and prior.digest=h then return jsonb_build_object('status','EXISTING','id',capture,'digest',h);end if;
 raise exception 'CAPTURE_ID_CONFLICT';end if;
 select * into prior from archive_integrity.submissions where round_id=target and market_key=mkey and digest=h;
 if found then return jsonb_build_object('status','EXISTING','id',prior.id,'digest',h);end if;
 begin perform archive_integrity.check_body(payload,r,floor(extract(epoch from t)*1000)::bigint,mkey);
 exception when others then
 get stacked diagnostics why=message_text;
 insert into archive_integrity.faults(round_id,market_key,capture_id,at,reason,digest) values(target,mkey,capture,t,why,h);
 return jsonb_build_object('status','REJECTED','reason',why);end;
 insert into archive_integrity.submissions values(capture,target,mkey,payload,h,t,pg_current_xact_id());
 return jsonb_build_object('status','SUBMITTED','id',capture,'digest',h);
 end$$;
create function archive_integrity.reject_capture(capture text,expected_digest text,why text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,archive_integrity,pg_temp as $$
 declare c archive_integrity.submissions;r archive_integrity.rounds;t timestamptz;begin
 select * into strict c from archive_integrity.submissions where id=capture;
 r:=archive_integrity.lock_round(c.round_id);t:=clock_timestamp();
 if r.state<>'OPEN' or t>=r.cutoff then raise exception 'ADMISSION_CLOSED';end if;
 if c.digest<>expected_digest or coalesce(why,'')='' then raise exception 'VALIDATION_BINDING_REQUIRED';end if;
 insert into archive_integrity.faults(round_id,market_key,capture_id,at,reason,digest) values(c.round_id,c.market_key,c.id,t,why,c.digest);
 return jsonb_build_object('status','REJECTED','reason',why);end$$;
create function archive_integrity.certify(capture text,expected_digest text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,archive_integrity,pg_temp as $$
 declare c archive_integrity.submissions;r archive_integrity.rounds;t timestamptz;ins pg_lsn;fl pg_lsn;
 oldproof archive_integrity.certificates;o jsonb;h archive_integrity.cursors;econ text;s numeric;ms bigint;why text;
 begin
 -- Visibility must come from an earlier transaction, including when the caller previously committed asynchronously.
 select * into strict c from archive_integrity.submissions where id=capture;
 if c.writer_xid=pg_current_xact_id_if_assigned() then raise exception 'SEPARATE_COMMITTED_CAPTURE_REQUIRED';end if;
 -- Flush a marker inserted AFTER committed capture visibility; this flushes its earlier commit WAL too.
 if current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on' or pg_is_in_recovery() then raise exception 'DURABILITY_NOT_QUALIFIED';end if;
 ins:=pg_logical_emit_message(false,'paperfund-v2-capture-proof',c.digest,true);fl:=pg_current_wal_flush_lsn();
 if fl<ins then raise exception 'WAL_FLUSH_BARRIER_FAILED';end if;
 r:=archive_integrity.lock_round(c.round_id);
 if c.digest<>expected_digest then raise exception 'VALIDATION_BINDING_REQUIRED';end if;
 select * into oldproof from archive_integrity.certificates where capture_id=capture;
 if found then return jsonb_build_object('status','CERTIFIED','id',capture,'at',oldproof.certified_at);end if;
 t:=clock_timestamp();
 if r.state<>'OPEN' or t>=r.cutoff then raise exception 'ADMISSION_CLOSED';end if;
 if c.digest<>expected_digest or c.digest<>archive_integrity.digest(c.body) then raise exception 'VALIDATION_BINDING_REQUIRED';end if;
 perform archive_integrity.check_body(c.body,r,floor(extract(epoch from t)*1000)::bigint,c.market_key);
 -- Complete precheck first: a rejected cursor must not partly advance other providers.
 for o in select value from jsonb_array_elements(c.body#>'{evidence,observations}') order by value->>'source',value->>'upstream' loop
 s:=(o#>>'{slot,$bigint}')::numeric;ms:=(o->>'observedAtMs')::bigint;
 econ:=archive_integrity.digest(jsonb_build_object('native',o,'fx',(select value from jsonb_array_elements(coalesce(nullif(c.body#>'{evidence,conversion,observations}','null'::jsonb),'[]'::jsonb)) z where z->>'source'=o->>'source'),
 'fees',c.body#>'{evidence,fees}','directional',c.body#>'{evidence,directionalCosts}'));
 select * into h from archive_integrity.cursors where market_key=c.market_key and source=o->>'source' and upstream=o->>'upstream';
 why:=null;
 if found then
 if s<h.slot or ms<h.source_ms then why:='PROVIDER_CURSOR_REGRESSION';
 elsif s=h.slot and ms=h.source_ms and econ<>h.economic_digest then why:='SAME_CURSOR_CONFLICT';end if;
 end if;
 if why is not null then
 insert into archive_integrity.faults(round_id,market_key,capture_id,at,reason,digest) values(c.round_id,c.market_key,c.id,t,why,c.digest);
 return jsonb_build_object('status','REJECTED','reason',why);end if;
 end loop;
 insert into archive_integrity.certificates values(c.id,t,ins,fl,pg_postmaster_start_time(),session_user);
 for o in select value from jsonb_array_elements(c.body#>'{evidence,observations}') order by value->>'source',value->>'upstream' loop
 econ:=archive_integrity.digest(jsonb_build_object('native',o,'fx',(select value from jsonb_array_elements(coalesce(nullif(c.body#>'{evidence,conversion,observations}','null'::jsonb),'[]'::jsonb)) z where z->>'source'=o->>'source'),
 'fees',c.body#>'{evidence,fees}','directional',c.body#>'{evidence,directionalCosts}'));
 insert into archive_integrity.cursors values(c.market_key,o->>'source',o->>'upstream',(o#>>'{slot,$bigint}')::numeric,(o->>'observedAtMs')::bigint,econ)
 on conflict(market_key,source,upstream) do update set slot=excluded.slot,source_ms=excluded.source_ms,economic_digest=excluded.economic_digest;
 end loop;
 return jsonb_build_object('status','CERTIFIED','id',capture,'at',t);
 end$$;
create function archive_integrity.valid_at_cutoff(payload jsonb,r archive_integrity.rounds,mkey text) returns boolean language plpgsql
 set search_path=pg_catalog,archive_integrity,pg_temp as $$begin
 perform archive_integrity.check_body(payload,r,floor(extract(epoch from r.cutoff)*1000)::bigint,mkey);return true;
 exception when others then return false;end$$;
create function archive_integrity.seal(target text,requested_version text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,archive_integrity,pg_temp as $$
 declare r archive_integrity.rounds;t timestamptz;prior archive_integrity.seals;members jsonb;selected jsonb;
 faults jsonb;reasons jsonb;body jsonb;validation_capture archive_integrity.submissions;why text;
 begin
 if requested_version is distinct from 'ARCHIVE_DB_WAL_SEAL_V1' then raise exception 'SEAL_VERSION_CONFLICT';end if;
 r:=archive_integrity.lock_round(target);
 select * into prior from archive_integrity.seals where round_id=target;
 if found then return jsonb_build_object('status','SEAL_WRITE_REQUIRES_DURABILITY_READ','digest',prior.digest,'body',prior.body);end if;
 t:=clock_timestamp();if t<r.cutoff then raise exception 'CUTOFF_NOT_REACHED';end if;
 -- Recheck the stored source/FX/fee/quote cursors at C, not at delayed sealing time.
 for validation_capture in select distinct on (x.market_key) x.* from archive_integrity.submissions x join archive_integrity.certificates p on p.capture_id=x.id where x.round_id=target order by x.market_key,x.received_at desc,x.id asc loop
 begin perform archive_integrity.check_body(validation_capture.body,r,floor(extract(epoch from r.cutoff)*1000)::bigint,validation_capture.market_key);
 exception when others then get stacked diagnostics why=message_text;
 insert into archive_integrity.faults(round_id,market_key,capture_id,at,reason,digest) values(target,validation_capture.market_key,validation_capture.id,t,'CUTOFF_VALIDATION:'||why,validation_capture.digest);
 end;end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'digest',c.digest,'market',c.market_key,'certifiedAt',p.certified_at) order by c.id),'[]'::jsonb)
 into members from archive_integrity.submissions c join archive_integrity.certificates p on p.capture_id=c.id
 where c.round_id=target and p.certified_at<r.cutoff and c.received_at<r.cutoff and archive_integrity.valid_at_cutoff(c.body,r,c.market_key)
 and not exists(select 1 from archive_integrity.faults f where f.round_id=target and f.market_key=c.market_key);
 select coalesce(jsonb_agg(jsonb_build_object('market',m->>'key','captureId',picked.id,'digest',picked.digest,
 'reason',case when picked.id is null then 'NO_ELIGIBLE_EVIDENCE' else 'FINANCIAL_POLICY_UNAPPROVED' end) order by m->>'key'),'[]'::jsonb)
 into selected from jsonb_array_elements(r.markets) m left join lateral (
 select c.id,c.digest from archive_integrity.submissions c join archive_integrity.certificates p on p.capture_id=c.id
 where c.round_id=target and c.market_key=m->>'key' and p.certified_at<r.cutoff and c.received_at<r.cutoff
 and not exists(select 1 from archive_integrity.faults f where f.round_id=target and f.market_key=c.market_key)
 order by c.received_at desc,c.id asc limit 1) picked on true;
 select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) into faults from archive_integrity.faults f where round_id=target;
 reasons:='["FINANCIAL_POLICY_UNAPPROVED","UTC_CLOCK_UNQUALIFIED","FINALITY_UNVERIFIED"]'::jsonb;
 if jsonb_array_length(members)=0 then reasons:=reasons||'"NO_ELIGIBLE_EVIDENCE"'::jsonb;end if;
 if jsonb_array_length(faults)>0 then reasons:=reasons||'"PROVIDER_INTEGRITY_FAULTS"'::jsonb;end if;
 body:=jsonb_build_object('version',requested_version,'round',target,'canonicalRound',r.canonical_round_id,'cutoff',r.cutoff,
 'clockBasis',r.clock_basis,'modelVersion',r.model_version,'executionPolicyHash',r.execution_policy_hash,'maxAgeMs',r.max_age_ms,'sealedAt',t,'members',members,'selected',selected,'faults',faults,'reviewReasons',reasons);
 insert into archive_integrity.seals(round_id,version,sealed_at,body,digest) values(target,requested_version,t,body,archive_integrity.digest(body));
 insert into archive_integrity.review_holds values(target,'REVIEW_REQUIRED',reasons);
 update archive_integrity.rounds set state='SEALED' where id=target;
 return jsonb_build_object('status','SEAL_WRITE_REQUIRES_DURABILITY_READ','digest',archive_integrity.digest(body),'body',body);
 end$$;
-- A seal write response is provisional. Only a separate visibility + WAL check can expose a durable seal.
create function archive_integrity.read_seal(target text) returns jsonb language plpgsql security definer
 set search_path=pg_catalog,archive_integrity,pg_temp as $$
 declare s archive_integrity.seals;i pg_lsn;f pg_lsn;begin
 select * into strict s from archive_integrity.seals where round_id=target;
 if s.seal_xid=pg_current_xact_id_if_assigned() then raise exception 'SEPARATE_COMMITTED_SEAL_REQUIRED';end if;

 if current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on' or pg_is_in_recovery() then raise exception 'DURABILITY_NOT_QUALIFIED';end if;
 i:=pg_logical_emit_message(false,'paperfund-v2-seal-read',s.digest,true);f:=pg_current_wal_flush_lsn();
 if f<i then raise exception 'WAL_FLUSH_BARRIER_FAILED';end if;
 if archive_integrity.digest(s.body)<>s.digest then raise exception 'SEALED_DIGEST_CONFLICT';end if;
 return jsonb_build_object('status','REVIEW_REQUIRED','durability','COMMITTED_WAL_FLUSH_OBSERVED',
 'digest',s.digest,'body',s.body,'flushBarrierLsn',i,'observedFlushLsn',f);
 end$$;
revoke all on all tables in schema archive_integrity from public;
revoke all on all sequences in schema archive_integrity from public;
revoke all on all functions in schema archive_integrity from public;
grant usage on schema archive_integrity to v2_archive_writer,v2_archive_validator,v2_archive_sealer,v2_archive_reader;
grant execute on function archive_integrity.submit(text,text,text,jsonb) to v2_archive_writer;
grant execute on function archive_integrity.certify(text,text),archive_integrity.reject_capture(text,text,text) to v2_archive_validator;
grant execute on function archive_integrity.seal(text,text) to v2_archive_sealer;
grant select on all tables in schema archive_integrity to v2_archive_validator,v2_archive_sealer;
grant execute on function archive_integrity.read_seal(text) to v2_archive_reader;
grant select on archive_integrity.submissions,archive_integrity.certificates,archive_integrity.cursors,archive_integrity.faults,archive_integrity.rounds to v2_archive_reader;
reset role;
-- These two guards affect ONLY this disposable database. They cannot approve, sign or execute payouts.
create function archive_integrity.payout_hold() returns trigger language plpgsql security definer
 set search_path=pg_catalog,archive_integrity,pg_temp as $$begin
 if exists(select 1 from archive_integrity.rounds x join public.hourly_rounds r on r.id=x.canonical_round_id
 where x.canonical_round_id=new.hourly_round_id or (new.daily_competition_id is not null and exists(
 select 1 from public.daily_competitions d where d.id=new.daily_competition_id and r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive))) then
 raise exception 'ARCHIVE_POLICY_REVIEW_PAYOUT_HOLD';end if;return new;end$$;
create trigger isolated_archive_payout_hold before insert or update on public.payout_plans for each row execute function archive_integrity.payout_hold();
create function archive_integrity.approval_hold() returns trigger language plpgsql security definer
 set search_path=pg_catalog,archive_integrity,pg_temp as $$begin
 if exists(select 1 from public.payout_plans p join archive_integrity.rounds x on true join public.hourly_rounds r on r.id=x.canonical_round_id
 where p.id=new.payout_plan_id and (x.canonical_round_id=p.hourly_round_id or (p.daily_competition_id is not null and exists(select 1 from public.daily_competitions d where d.id=p.daily_competition_id and r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive)))) then raise exception 'ARCHIVE_POLICY_REVIEW_APPROVAL_HOLD';end if;return new;end$$;
create trigger isolated_archive_approval_hold before insert on public.payout_plan_approvals for each row execute function archive_integrity.approval_hold();
revoke all on function archive_integrity.payout_hold(),archive_integrity.approval_hold() from public;
