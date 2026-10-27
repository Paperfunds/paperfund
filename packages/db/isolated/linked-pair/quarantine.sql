-- Isolated only: shared raw-account group quarantined durably; no automatic reset/release.
create table linked_candidate.route_quarantine (
 account_id text primary key references linked_candidate.branches(account_id),
 interval_hash text not null, reason text not null, document jsonb not null
);
create trigger immutable_quarantine before update or delete on linked_candidate.route_quarantine for each row execute function linked_candidate.immutable();
create table linked_candidate.route_status (
 account_id text primary key references linked_candidate.branches(account_id),quarantined boolean not null default false
);
create function linked_candidate.guard_quarantine() returns trigger language plpgsql as $$ begin
 if TG_OP='DELETE' then raise exception 'LINKED_QUARANTINE_NO_RESET'; end if;
 if new.account_id is distinct from old.account_id or (old.quarantined and not new.quarantined) then raise exception 'LINKED_QUARANTINE_NO_RESET'; end if;
 return new; end $$;
create trigger guard_quarantine before update or delete on linked_candidate.route_status for each row execute function linked_candidate.guard_quarantine();
