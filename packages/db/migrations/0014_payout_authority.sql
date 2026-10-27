-- Isolated candidate only. No operator identities, keys, grants to live roles or release are seeded.
CREATE TABLE payout_stop_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 stopped boolean NOT NULL DEFAULT true,
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 reason text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO payout_stop_state(singleton,reason) VALUES(true,'INITIAL_STOP_REQUIRES_AUTHORIZED_RELEASE');
CREATE TABLE payout_security_events (
 id bigserial PRIMARY KEY,
 actor text,
 action text NOT NULL,
 plan_id text,
 outcome text NOT NULL,
 reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payout_security_events_immutable BEFORE UPDATE OR DELETE ON payout_security_events
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TABLE payout_authority_nonces (
 issuer text NOT NULL,
 nonce text NOT NULL,
 action text NOT NULL,
 plan_id text NOT NULL,
 snapshot_hash text NOT NULL,
 signed_request jsonb NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(issuer,nonce)
);
CREATE TRIGGER payout_authority_nonces_immutable BEFORE UPDATE OR DELETE ON payout_authority_nonces
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TABLE payout_approval_authorizations (
 approval_id text PRIMARY KEY REFERENCES payout_plan_approvals(id) ON DELETE RESTRICT,
 subject text NOT NULL,
 signed_request jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payout_approval_authorizations_immutable BEFORE UPDATE OR DELETE ON payout_approval_authorizations
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE FUNCTION guard_payout_stop_state() RETURNS trigger AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'stop state cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.generation<>OLD.generation+1 THEN RAISE EXCEPTION 'stop generation must advance exactly once' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payout_stop_state_guard BEFORE UPDATE OR DELETE ON payout_stop_state
 FOR EACH ROW EXECUTE FUNCTION guard_payout_stop_state();
-- Table owners/superusers bypass ACLs: separate non-owner runtime/control roles are deployment prerequisites.
REVOKE ALL ON payout_stop_state,payout_security_events,payout_authority_nonces,payout_approval_authorizations FROM PUBLIC;
