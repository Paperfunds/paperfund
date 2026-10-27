-- Candidate schema only. Installer refuses every database except a fresh disposable linked test DB.
create schema linked_candidate;
create table linked_candidate.branches (
 account_id text primary key references competition_accounts(id),
 round_id text not null references hourly_rounds(id),
 revision bigint not null check(revision>=0), initial_document jsonb not null,
 initial_hash text not null, document jsonb not null, state_hash text not null
);
create table linked_candidate.provider_evidence (
 hash text primary key, document jsonb not null
);
create table linked_candidate.receipts (
 account_id text not null references linked_candidate.branches(account_id),
 revision bigint not null check(revision>0), fill_id text not null unique references fills(id),
 execution_id text not null unique, before_hash text not null, after_hash text not null,
 interval_hash text references linked_candidate.provider_evidence(hash),
 document jsonb not null, primary key(account_id,revision)
);
create function linked_candidate.immutable() returns trigger language plpgsql as $$ begin raise exception 'LINKED_RECEIPT_IMMUTABLE'; end $$;
create trigger immutable_receipt before update or delete on linked_candidate.receipts for each row execute function linked_candidate.immutable();
create trigger immutable_evidence before update or delete on linked_candidate.provider_evidence for each row execute function linked_candidate.immutable();
create function linked_candidate.check_head() returns trigger language plpgsql as $$
 begin
 if new.revision > 0 and not exists(select 1 from linked_candidate.receipts r where r.account_id=new.account_id and r.revision=new.revision and r.after_hash=new.state_hash) then raise exception 'LINKED_FILL_RECEIPT_REQUIRED'; end if;
 return new;
 end $$;
create constraint trigger head_has_fill after insert or update on linked_candidate.branches deferrable initially deferred for each row execute function linked_candidate.check_head();
-- Freeze identity/anchor; every head update must advance one and only one revision.
create function linked_candidate.guard_branch() returns trigger language plpgsql as $$ begin
 if new.account_id is distinct from old.account_id or new.round_id is distinct from old.round_id or new.initial_document is distinct from old.initial_document or new.initial_hash is distinct from old.initial_hash or new.revision<>old.revision+1 then raise exception 'LINKED_BRANCH_IDENTITY_OR_REVISION'; end if;
 return new;
end $$;
create trigger guard_branch before update on linked_candidate.branches for each row execute function linked_candidate.guard_branch();
-- Candidate-only cutoff evidence. Never installed by production migrations.
create table linked_candidate.cutoff_seals (
 account_id text primary key references linked_candidate.branches(account_id),
 round_id text not null references hourly_rounds(id),
 hash text not null unique, document jsonb not null
);
create trigger immutable_cutoff before update or delete on linked_candidate.cutoff_seals for each row execute function linked_candidate.immutable();
