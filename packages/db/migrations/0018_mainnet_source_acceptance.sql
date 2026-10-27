
-- STAGED ONLY. No acceptance, grants, STOP release, or production data mutation is included.
-- Only a separately protected acceptance publisher may insert verified signed evidence.
CREATE TABLE mainnet_source_acceptances (
 id text PRIMARY KEY,
 hourly_round_id text NOT NULL REFERENCES hourly_rounds(id) ON DELETE RESTRICT,
 profile text NOT NULL CHECK(profile='MAINNET_FINALIZED_V1'),
 network text NOT NULL CHECK(network='mainnet-beta'),
 genesis text NOT NULL CHECK(genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'),
 structural_hash text NOT NULL CHECK(structural_hash ~ '^[a-f0-9]{64}$'),
 acceptance_hash text NOT NULL CHECK(acceptance_hash ~ '^[a-f0-9]{64}$'),
 signed_envelope jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(hourly_round_id,acceptance_hash)
);
CREATE TABLE mainnet_acceptance_revocations (
 acceptance_hash text PRIMARY KEY,
 reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER mainnet_acceptance_immutable BEFORE UPDATE OR DELETE ON mainnet_source_acceptances
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER mainnet_revocation_immutable BEFORE UPDATE OR DELETE ON mainnet_acceptance_revocations
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
REVOKE ALL ON mainnet_source_acceptances,mainnet_acceptance_revocations FROM PUBLIC;

CREATE FUNCTION mainnet_hour_allowed(rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM mainnet_source_acceptances q JOIN hourly_rounds r ON r.id=q.hourly_round_id
  WHERE q.hourly_round_id=rid AND r.state='FINALIZED' AND q.structural_hash=legacy_hour_digest(rid)
   AND q.expires_at>statement_timestamp()
   AND NOT EXISTS(SELECT 1 FROM mainnet_acceptance_revocations v WHERE v.acceptance_hash=q.acceptance_hash))
 AND NOT EXISTS(SELECT 1 FROM legacy_source_reviews h WHERE h.hourly_round_id=rid)
$$;
CREATE FUNCTION mainnet_source_allowed(kind text,source text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='HOURLY' THEN mainnet_hour_allowed(source)
 WHEN kind='DAILY' THEN
  EXISTS(SELECT 1 FROM daily_competitions WHERE id=source AND state='FINALIZED')
  AND (SELECT count(*) FROM hourly_rounds r JOIN daily_competitions d
   ON r.starts_at>=d.starts_at AND r.starts_at<d.ends_at_exclusive WHERE d.id=source)=24
  AND NOT EXISTS(SELECT 1 FROM hourly_rounds r JOIN daily_competitions d
   ON r.starts_at>=d.starts_at AND r.starts_at<d.ends_at_exclusive
   WHERE d.id=source AND NOT mainnet_hour_allowed(r.id))
 ELSE false END
$$;
-- Retain the existing localnet test branch byte-for-byte under a new name.
ALTER FUNCTION legacy_source_allowed(text,text) RENAME TO localnet_source_allowed;
CREATE FUNCTION legacy_source_allowed(kind text,source text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT localnet_source_allowed(kind,source) OR mainnet_source_allowed(kind,source)
$$;
CREATE OR REPLACE FUNCTION guard_legacy_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payout_plans%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='payout_plans' THEN
  IF TG_OP='UPDATE' AND NEW.state NOT IN ('CALCULATED','FROZEN','VALIDATED','APPROVED') THEN RETURN NEW; END IF;
  IF NOT legacy_source_allowed(NEW.competition_type,coalesce(NEW.hourly_round_id,NEW.daily_competition_id)) THEN
   RAISE EXCEPTION 'PAYOUT_SETTLEMENT_REVIEW' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM payout_plans WHERE id=NEW.payout_plan_id;
  IF TG_TABLE_NAME='payout_executions' THEN
   IF NEW.network='mainnet-beta' THEN
    IF NOT mainnet_source_allowed(p.competition_type,coalesce(p.hourly_round_id,p.daily_competition_id)) THEN
     RAISE EXCEPTION 'MAINNET_QUALIFICATION_UNAVAILABLE' USING ERRCODE='23514'; END IF;
   ELSIF NEW.network='localnet' THEN
    IF NOT localnet_source_allowed(p.competition_type,coalesce(p.hourly_round_id,p.daily_competition_id)) THEN
     RAISE EXCEPTION 'LOCALNET_QUALIFICATION_UNAVAILABLE' USING ERRCODE='23514'; END IF;
   ELSE RAISE EXCEPTION 'UNSUPPORTED_PAYOUT_NETWORK' USING ERRCODE='23514'; END IF;
  ELSIF NOT legacy_source_allowed(p.competition_type,coalesce(p.hourly_round_id,p.daily_competition_id)) THEN
   RAISE EXCEPTION 'PAYOUT_SETTLEMENT_REVIEW' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Roles have no logins or live members. Enrollment is a separate protected operator action.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='paperfund_mainnet_signer') THEN CREATE ROLE paperfund_mainnet_signer NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='paperfund_mainnet_acceptance_publisher') THEN CREATE ROLE paperfund_mainnet_acceptance_publisher NOLOGIN; END IF;

 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('paperfund_mainnet_signer','paperfund_mainnet_acceptance_publisher')
  AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls
   OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid))) THEN
  RAISE EXCEPTION 'Existing mainnet group role has unexpected privileges; preserve and review';
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO paperfund_mainnet_signer,paperfund_mainnet_acceptance_publisher;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO paperfund_mainnet_signer,paperfund_mainnet_acceptance_publisher;
GRANT SELECT ON mainnet_source_acceptances,mainnet_acceptance_revocations TO paperfund_beta_api,paperfund_beta_worker,paperfund_beta_observer;
GRANT INSERT ON mainnet_source_acceptances,mainnet_acceptance_revocations TO paperfund_mainnet_acceptance_publisher;
GRANT INSERT ON payout_plan_approvals,payout_approval_snapshots,payout_approval_authorizations,
 payout_authority_nonces,payout_security_events,payout_executions,payout_batches,payout_batch_allocations,
 payout_broadcast_attempts,payout_operation_events,payout_treasury_receipts,payout_treasury_reservations,
 payout_treasury_days,payout_treasury_settlements TO paperfund_mainnet_signer;
GRANT UPDATE ON payout_plans,payout_executions,payout_batches TO paperfund_mainnet_signer;
GRANT USAGE,SELECT ON SEQUENCE payout_security_events_id_seq TO paperfund_mainnet_signer;
-- Row locks only; the immutable trigger prevents an identity change.
GRANT UPDATE(id) ON hourly_results TO paperfund_mainnet_signer;

GRANT INSERT ON payout_signed_transactions TO paperfund_mainnet_signer;
GRANT USAGE,SELECT ON SEQUENCE payout_operation_events_id_seq TO paperfund_mainnet_signer;
