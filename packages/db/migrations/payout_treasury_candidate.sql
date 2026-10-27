-- ISOLATED REVIEW CANDIDATE ONLY. No production journal entry, backfill or monetary defaults.
CREATE TABLE payout_treasury_receipts (
 identity text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('CREATOR_FEE','NETWORK_FEES')),
 creator_fee_event_id text REFERENCES creator_fee_events(id) ON DELETE RESTRICT,
 allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array'),
 network text NOT NULL,
 treasury text NOT NULL,
 lamports bigint NOT NULL CHECK(lamports>0),
 finalized_slot bigint NOT NULL CHECK(finalized_slot>=0),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 CHECK((kind='CREATOR_FEE')=(creator_fee_event_id IS NOT NULL))
);
CREATE TABLE payout_treasury_reservations (
 plan_id text PRIMARY KEY REFERENCES payout_plans(id) ON DELETE RESTRICT,
 source_key text NOT NULL UNIQUE,
 approval_hash text NOT NULL,
 funding_hash text NOT NULL,
 principal bigint NOT NULL CHECK(principal>0),
 fee_budget bigint NOT NULL CHECK(fee_budget>=0),
 recipients jsonb NOT NULL,
 network text NOT NULL,
 treasury text NOT NULL,
 reserved_at timestamptz NOT NULL
);
CREATE TABLE payout_treasury_days (
 plan_id text NOT NULL REFERENCES payout_treasury_reservations(plan_id) ON DELETE RESTRICT,
 utc_day date NOT NULL,
 exposure bigint NOT NULL CHECK(exposure>0),
 PRIMARY KEY(plan_id,utc_day)
);
CREATE TABLE payout_treasury_settlements (
 batch_id text PRIMARY KEY REFERENCES payout_batches(id) ON DELETE RESTRICT,
 plan_id text NOT NULL REFERENCES payout_treasury_reservations(plan_id) ON DELETE RESTRICT,
 signature text NOT NULL UNIQUE,
 principal bigint NOT NULL CHECK(principal>=0),
 fee bigint NOT NULL CHECK(fee>=0),
 finalized_slot bigint NOT NULL CHECK(finalized_slot>=0)
);
CREATE TRIGGER payout_treasury_receipts_immutable BEFORE UPDATE OR DELETE ON payout_treasury_receipts
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER payout_treasury_reservations_immutable BEFORE UPDATE OR DELETE ON payout_treasury_reservations
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER payout_treasury_days_immutable BEFORE UPDATE OR DELETE ON payout_treasury_days
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER payout_treasury_settlements_immutable BEFORE UPDATE OR DELETE ON payout_treasury_settlements
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
REVOKE ALL ON payout_treasury_receipts,payout_treasury_reservations,payout_treasury_days,payout_treasury_settlements FROM PUBLIC;
