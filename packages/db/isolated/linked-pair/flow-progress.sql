-- Isolated additive extension. Original financial branch/receipt guards stay unchanged.
create schema linked_flow_candidate;
create table linked_flow_candidate.evidence (
 hash text primary key, payload bytea not null check(octet_length(payload)>0)
);
create table linked_flow_candidate.steps (
 account_id text not null references linked_candidate.branches(account_id),
 fill_revision bigint not null check(fill_revision>=0), sequence bigint not null check(sequence>0),
 base_hash text not null, before_hash text not null, after_hash text not null,
 evidence_hash text not null references linked_flow_candidate.evidence(hash),
 replay_at timestamptz not null, primary key(account_id,fill_revision,sequence)
);
create table linked_flow_candidate.heads (
 account_id text not null references linked_candidate.branches(account_id),
 fill_revision bigint not null check(fill_revision>=0),base_hash text not null,
 sequence bigint not null check(sequence>0),state_hash text not null,document jsonb not null,
 primary key(account_id,fill_revision)
);
create function linked_flow_candidate.immutable() returns trigger language plpgsql as $$
begin raise exception 'LINKED_FLOW_IMMUTABLE'; end $$;
create trigger immutable_evidence before update or delete on linked_flow_candidate.evidence for each row execute function linked_flow_candidate.immutable();
create trigger immutable_step before update or delete on linked_flow_candidate.steps for each row execute function linked_flow_candidate.immutable();
create function linked_flow_candidate.guard_head() returns trigger language plpgsql as $$
begin
 if TG_OP='UPDATE' and (new.account_id is distinct from old.account_id or new.fill_revision is distinct from old.fill_revision or new.base_hash is distinct from old.base_hash or new.sequence<>old.sequence+1) then raise exception 'LINKED_FLOW_SEQUENCE'; end if;
 if TG_OP='INSERT' and new.sequence<>1 then raise exception 'LINKED_FLOW_SEQUENCE'; end if;
 if not exists(select 1 from linked_candidate.branches b where b.account_id=new.account_id and b.revision=new.fill_revision and b.state_hash=new.base_hash) then raise exception 'LINKED_FLOW_BASE_CHANGED'; end if;
 return new;
end $$;
create trigger guard_head before insert or update on linked_flow_candidate.heads for each row execute function linked_flow_candidate.guard_head();
create trigger no_delete_head before delete on linked_flow_candidate.heads for each row execute function linked_flow_candidate.immutable();
create function linked_flow_candidate.prove_head() returns trigger language plpgsql as $$
begin
 if not exists(select 1 from linked_flow_candidate.steps s where s.account_id=new.account_id and s.fill_revision=new.fill_revision and s.sequence=new.sequence and s.base_hash=new.base_hash and s.after_hash=new.state_hash) then raise exception 'LINKED_FLOW_PROOF_REQUIRED'; end if;
 return new;
end $$;
create constraint trigger prove_head after insert or update on linked_flow_candidate.heads deferrable initially deferred for each row execute function linked_flow_candidate.prove_head();
