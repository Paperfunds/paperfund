-- Qualified, append-only continuation. Installed only by the disposable candidate installer.
create table linked_candidate.settlement_steps (
 fill_id text primary key references fills(id),
 account_id text not null references linked_candidate.branches(account_id),
 position_id text not null references positions(id),
 revision bigint not null,
 seal_hash text not null references linked_candidate.cutoff_seals(hash),
 quantity_before numeric(78,0) not null check(quantity_before>0),
 basis_before bigint not null check(basis_before>=0),
 sold_quantity numeric(78,0) not null check(sold_quantity>0 and sold_quantity<=quantity_before),
 net_proceeds bigint not null check(net_proceeds>0),
 fee_lamports bigint not null check(fee_lamports>=0),
 evidence_id text not null references market_state_evidence(id),
 request_key text not null unique,
 unique(account_id,revision),
 foreign key(account_id,revision) references linked_candidate.receipts(account_id,revision)
);
create trigger immutable_settlement_step before update or delete on linked_candidate.settlement_steps for each row execute function linked_candidate.immutable();
create function linked_candidate.assert_forced_fill(fid text) returns boolean language plpgsql as $$
declare s linked_candidate.settlement_steps%rowtype; f fills%rowtype; r linked_candidate.receipts%rowtype; c linked_candidate.cutoff_seals%rowtype; o orders%rowtype; p positions%rowtype; eid text; pid text; k text;
begin
 select * into s from linked_candidate.settlement_steps where fill_id=fid;
 if not found then return false; end if;
 select * into f from fills where id=fid;
 select * into o from orders where id=f.order_id;
 select * into p from positions where id=s.position_id;
 select * into r from linked_candidate.receipts where account_id=s.account_id and revision=s.revision;
 select * into c from linked_candidate.cutoff_seals where hash=s.seal_hash;
 select position_id,evidence_id into pid,eid from order_market_state_evidence where order_id=o.id and purpose='SELL_EXECUTION';
 select idempotency_key into k from idempotency_records where id=f.idempotency_record_id;
 if o.execution_context<>'FORCED_HOURLY_SETTLEMENT' or f.side<>'SELL'
 or o.competition_account_id is distinct from s.account_id or p.competition_account_id is distinct from s.account_id
 or pid is distinct from s.position_id or eid is distinct from s.evidence_id or f.market_state_evidence_id is distinct from s.evidence_id
 or r.fill_id is distinct from f.id or r.execution_id is distinct from f.execution_id
 or c.account_id is distinct from s.account_id or c.round_id is distinct from (select hourly_round_id from competition_accounts where id=s.account_id)
 or r.document->>'cutoffSealHash' is distinct from s.seal_hash or s.revision<=(c.document->>'revision')::bigint
 or r.document->>'side' is distinct from 'SELL' or (r.document->>'input')::numeric is distinct from s.sold_quantity
 or (r.document->>'output')::bigint is distinct from s.net_proceeds
 or f.executed_at is distinct from (c.document->>'cutoff')::timestamptz
 or f.base_quantity is distinct from s.sold_quantity or f.actual_output_lamports is distinct from s.net_proceeds or f.fee_lamports is distinct from s.fee_lamports
 or k is distinct from s.request_key
 or f.cost_basis_lamports_removed is distinct from (case when s.sold_quantity=s.quantity_before then s.basis_before else floor(s.basis_before::numeric*s.sold_quantity/s.quantity_before)::bigint end)
 or p.remaining_base_units is distinct from s.quantity_before-s.sold_quantity
 or p.cost_basis_lamports is distinct from s.basis_before-f.cost_basis_lamports_removed
 or exists(select 1 from legacy_source_reviews h where h.hourly_round_id=c.round_id)
 then raise exception 'LINKED_FORCED_FILL_PROOF_MISMATCH' using errcode='23514'; end if;
 -- Every earlier forced sale of this position must have the same qualified proof family.
 if exists(select 1 from fills x join orders y on y.id=x.order_id join order_market_state_evidence e on e.order_id=y.id and e.purpose='SELL_EXECUTION'
  left join linked_candidate.settlement_steps t on t.fill_id=x.id where e.position_id=s.position_id and y.execution_context='FORCED_HOURLY_SETTLEMENT' and t.fill_id is null)
 then raise exception 'LINKED_UNPROVEN_PRIOR_FORCED_FILL' using errcode='23514'; end if;
 return true;
end $$;
-- Extend the existing deferred guard; preserve its entire legacy path verbatim.
-- This is deliberately not a production migration or a runtime feature flag.
do $$ declare def text; begin
 select pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure) into def;
 def:=replace(def,E'\r\n',E'\n');
 if position(E'BEGIN\n' in def)=0 or position('linked_candidate.assert_forced_fill' in def)>0 then raise exception 'LINKED_LEGACY_GUARD_LAYOUT'; end if;
 def:=overlay(def placing E'BEGIN\n IF linked_candidate.assert_forced_fill(NEW.id) THEN RETURN NEW; END IF;\n' from position(E'BEGIN\n' in def) for length(E'BEGIN\n'));
 execute def;
end $$;
