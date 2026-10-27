-- Pending local-only approval. Additive; existing quarantine/STOP/ledger guards are untouched.
create schema linked_recovery_candidate;
create table linked_recovery_candidate.incidents (
 account_id text not null references linked_candidate.branches(account_id),
 generation bigint not null check(generation>=0), interval_hash text not null,
 reason text not null, document jsonb not null, primary key(account_id,generation)
);
create table linked_recovery_candidate.resolutions (
 account_id text not null, generation bigint not null,
 proof_hash text not null, approval_hash text not null,
 fill_revision bigint not null, sequence bigint not null,
 document jsonb not null,
 primary key(account_id,generation),
 foreign key(account_id,generation) references linked_recovery_candidate.incidents(account_id,generation),
 foreign key(account_id,fill_revision,sequence) references linked_flow_candidate.steps(account_id,fill_revision,sequence)
);
create trigger immutable_incident before update or delete on linked_recovery_candidate.incidents
 for each row execute function linked_candidate.immutable();
create trigger immutable_resolution before update or delete on linked_recovery_candidate.resolutions
 for each row execute function linked_candidate.immutable();
-- No grants to public. Approved installation grants SELECT to API and SELECT/INSERT to worker only.
revoke all on schema linked_recovery_candidate from public;
revoke all on all tables in schema linked_recovery_candidate from public;
