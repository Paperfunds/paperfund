-- Explicit-install only. No import/backfill of historical claim or platform payment.
create table payout_creator_distribution_evidence(
 identity text primary key, kind text not null check(kind in('CLAIM','PLATFORM')),
 network text not null, treasury text not null, document jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create trigger immutable_creator_distribution before update or delete on payout_creator_distribution_evidence for each row execute function reject_payout_detail_change();
revoke all on payout_creator_distribution_evidence from public;
