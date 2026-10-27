-- STAGED ONLY. Requires separate reviewed deployment and policy activation. No data is inserted.
CREATE TABLE beta_payout_policies (
 policy_hash text PRIMARY KEY CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
 effective_from timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 signed_policy jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>effective_from)
);
CREATE FUNCTION guard_beta_future_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.effective_from<=clock_timestamp() OR NEW.recorded_at>clock_timestamp() THEN RAISE EXCEPTION 'BETA_POLICY_REQUIRES_FUTURE_ACTIVATION'; END IF; NEW.recorded_at=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER beta_future_activation BEFORE INSERT ON beta_payout_policies FOR EACH ROW EXECUTE FUNCTION guard_beta_future_activation();
CREATE TABLE beta_source_acceptances (
 id text PRIMARY KEY, hourly_round_id text NOT NULL REFERENCES hourly_rounds(id),
 profile text NOT NULL CHECK(profile='BETA_RECORDED_AUTHORITY_V1'),
 network text NOT NULL CHECK(network='mainnet-beta'),
 genesis text NOT NULL CHECK(genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'),
 structural_hash text NOT NULL CHECK(structural_hash ~ '^[a-f0-9]{64}$'),
 acceptance_hash text NOT NULL CHECK(acceptance_hash ~ '^[a-f0-9]{64}$'),
 policy_hash text NOT NULL REFERENCES beta_payout_policies(policy_hash),
 signed_envelope jsonb NOT NULL, expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(hourly_round_id,acceptance_hash)
);
CREATE TRIGGER beta_policies_immutable BEFORE UPDATE OR DELETE ON beta_payout_policies FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER beta_acceptances_immutable BEFORE UPDATE OR DELETE ON beta_source_acceptances FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
REVOKE ALL ON beta_payout_policies,beta_source_acceptances FROM PUBLIC;
GRANT SELECT ON beta_payout_policies,beta_source_acceptances TO paperfund_mainnet_signer,paperfund_mainnet_acceptance_publisher,paperfund_beta_api,paperfund_beta_worker,paperfund_beta_observer;
GRANT INSERT ON beta_payout_policies,beta_source_acceptances TO paperfund_mainnet_acceptance_publisher;
ALTER FUNCTION mainnet_hour_allowed(text) RENAME TO strict_mainnet_hour_allowed;
CREATE FUNCTION mainnet_hour_allowed(rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT strict_mainnet_hour_allowed(rid) OR EXISTS(
 SELECT 1 FROM beta_source_acceptances q JOIN hourly_rounds r ON r.id=q.hourly_round_id
 JOIN beta_payout_policies p ON p.policy_hash=q.policy_hash
 WHERE r.id=rid AND r.state='FINALIZED' AND r.starts_at>=p.effective_from
 AND p.recorded_at<p.effective_from AND r.ends_at_exclusive<=statement_timestamp() AND r.ends_at_exclusive<=p.expires_at AND p.expires_at>statement_timestamp()
 AND q.expires_at>statement_timestamp() AND q.structural_hash=legacy_hour_digest(rid)
 AND NOT EXISTS(SELECT 1 FROM legacy_source_reviews h WHERE h.hourly_round_id=rid)
 AND NOT EXISTS(SELECT 1 FROM mainnet_acceptance_revocations v WHERE v.acceptance_hash=q.acceptance_hash))
$$;
CREATE OR REPLACE FUNCTION mainnet_source_allowed(kind text,source text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='HOURLY' THEN mainnet_hour_allowed(source)
 WHEN kind='DAILY' THEN
 EXISTS(SELECT 1 FROM daily_competitions WHERE id=source AND state='FINALIZED')
 AND (SELECT count(*) FROM hourly_rounds r JOIN daily_competitions d ON r.starts_at>=d.starts_at AND r.starts_at<d.ends_at_exclusive WHERE d.id=source)=24
 AND NOT EXISTS(SELECT 1 FROM hourly_rounds r JOIN daily_competitions d ON r.starts_at>=d.starts_at AND r.starts_at<d.ends_at_exclusive WHERE d.id=source AND NOT mainnet_hour_allowed(r.id))
 ELSE false END
$$;
-- Existing global STOP, treasury reservation, execution, signer and finality guards are unchanged.

-- Explicitly reviewed beta-only source publication and existing immutable plan construction.
-- No grants on strict acceptance, policy activation, STOP, trades or reward-pool balances.
GRANT INSERT ON beta_source_acceptances,payout_plans,payout_rank_buckets,payout_allocations TO paperfund_mainnet_signer;
