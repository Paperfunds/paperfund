-- Additive current-engine protection. No historical fill/result is rewritten.
CREATE TABLE legacy_settlement_liquidations (
 position_id text PRIMARY KEY REFERENCES positions(id) ON DELETE RESTRICT,
 hourly_round_id text NOT NULL REFERENCES hourly_rounds(id) ON DELETE RESTRICT,
 policy_version text NOT NULL CHECK(policy_version='legacy-single-liquidation-v1'),
 quantity_before numeric(78,0) NOT NULL CHECK(quantity_before>0),
 basis_before bigint NOT NULL CHECK(basis_before>=0),
 sold_quantity numeric(78,0) NOT NULL CHECK(sold_quantity>0 AND sold_quantity<=quantity_before),
 net_proceeds bigint NOT NULL CHECK(net_proceeds>0),
 fee_lamports bigint NOT NULL CHECK(fee_lamports>=0),
 evidence_id text NOT NULL REFERENCES market_state_evidence(id) ON DELETE RESTRICT,
 fill_id text NOT NULL UNIQUE REFERENCES fills(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER legacy_liquidation_immutable BEFORE UPDATE OR DELETE ON legacy_settlement_liquidations
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TABLE legacy_source_reviews (
 id text PRIMARY KEY,
 hourly_round_id text NOT NULL REFERENCES hourly_rounds(id) ON DELETE RESTRICT,
 position_id text REFERENCES positions(id) ON DELETE RESTRICT,
 reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER legacy_review_immutable BEFORE UPDATE OR DELETE ON legacy_source_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();

-- This release has NO financially qualified mainnet policy. Controlled positive tests can
-- enroll localnet proofs through the protected owner only; normal API/worker receive no grant.
CREATE TABLE legacy_test_qualifications (
 hourly_round_id text PRIMARY KEY REFERENCES hourly_rounds(id) ON DELETE RESTRICT,
 profile text NOT NULL CHECK(profile='TEST_ONLY_LOCALNET'),
 proof_hash text NOT NULL CHECK(proof_hash ~ '^[0-9a-f]{64}$'),
 proof jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER legacy_test_qualification_immutable BEFORE UPDATE OR DELETE ON legacy_test_qualifications
 FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
REVOKE ALL ON legacy_test_qualifications FROM PUBLIC;

CREATE FUNCTION legacy_hour_digest(rid text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'round',(SELECT to_jsonb(r) FROM hourly_rounds r WHERE id=rid),
 'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM competition_accounts a WHERE hourly_round_id=rid),
 'positions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM positions p JOIN competition_accounts a ON a.id=p.competition_account_id WHERE a.hourly_round_id=rid),
 'fills',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]'::jsonb) FROM fills f JOIN orders o ON o.id=f.order_id JOIN competition_accounts a ON a.id=o.competition_account_id WHERE a.hourly_round_id=rid),
 'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) FROM ledger_entries l JOIN competition_accounts a ON a.id=l.competition_account_id WHERE a.hourly_round_id=rid),
 'results',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]'::jsonb) FROM hourly_results h WHERE hourly_round_id=rid),
 'liquidations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY position_id),'[]'::jsonb) FROM legacy_settlement_liquidations l WHERE hourly_round_id=rid)
 )::text,'UTF8')),'hex')
$$;
CREATE FUNCTION legacy_source_allowed(kind text,source text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='HOURLY' THEN
  EXISTS(SELECT 1 FROM legacy_test_qualifications q JOIN hourly_rounds r ON r.id=q.hourly_round_id WHERE q.hourly_round_id=source AND r.state='FINALIZED' AND q.proof_hash=legacy_hour_digest(r.id))
  AND NOT EXISTS(SELECT 1 FROM legacy_source_reviews h WHERE h.hourly_round_id=source)
 ELSE
  (SELECT count(*) FROM hourly_rounds r JOIN daily_competitions d
    ON r.starts_at>=d.starts_at AND r.starts_at<d.ends_at_exclusive WHERE d.id=source)=24
  AND NOT EXISTS(SELECT 1 FROM hourly_rounds r JOIN daily_competitions d
    ON r.starts_at>=d.starts_at AND r.starts_at<d.ends_at_exclusive
    LEFT JOIN legacy_test_qualifications q ON q.hourly_round_id=r.id
    WHERE d.id=source AND (q.hourly_round_id IS NULL OR q.proof_hash<>legacy_hour_digest(r.id) OR r.state<>'FINALIZED'
      OR EXISTS(SELECT 1 FROM legacy_source_reviews h WHERE h.hourly_round_id=r.id))) END
$$;
CREATE FUNCTION guard_legacy_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payout_plans%ROWTYPE; rid text;
BEGIN
 IF TG_TABLE_NAME='payout_plans' THEN
  IF TG_OP='UPDATE' AND NEW.state NOT IN ('CALCULATED','FROZEN','VALIDATED','APPROVED') THEN RETURN NEW; END IF;
  IF NOT legacy_source_allowed(NEW.competition_type,coalesce(NEW.hourly_round_id,NEW.daily_competition_id)) THEN
   RAISE EXCEPTION 'PAYOUT_SETTLEMENT_REVIEW' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM payout_plans WHERE id=NEW.payout_plan_id;
  IF NOT legacy_source_allowed(p.competition_type,coalesce(p.hourly_round_id,p.daily_competition_id)) THEN
   RAISE EXCEPTION 'PAYOUT_SETTLEMENT_REVIEW' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='payout_executions' THEN
   IF NEW.network<>'localnet' THEN RAISE EXCEPTION 'MAINNET_QUALIFICATION_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_plan_guard BEFORE INSERT OR UPDATE ON payout_plans FOR EACH ROW EXECUTE FUNCTION guard_legacy_source();
CREATE TRIGGER legacy_approval_guard BEFORE INSERT ON payout_plan_approvals FOR EACH ROW EXECUTE FUNCTION guard_legacy_source();
CREATE TRIGGER legacy_execution_guard BEFORE INSERT ON payout_executions FOR EACH ROW EXECUTE FUNCTION guard_legacy_source();

CREATE FUNCTION verify_legacy_forced_fill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link record; attempt legacy_settlement_liquidations%ROWTYPE; n bigint;
BEGIN
 IF (SELECT execution_context FROM orders WHERE id=NEW.order_id)<>'FORCED_HOURLY_SETTLEMENT' THEN RETURN NEW; END IF;
 SELECT e.position_id,o.competition_account_id INTO link FROM order_market_state_evidence e
  JOIN orders o ON o.id=e.order_id WHERE e.order_id=NEW.order_id AND e.purpose='SELL_EXECUTION';
 SELECT * INTO attempt FROM legacy_settlement_liquidations WHERE position_id=link.position_id;
 IF attempt.fill_id IS DISTINCT FROM NEW.id OR attempt.evidence_id IS DISTINCT FROM NEW.market_state_evidence_id
  OR attempt.sold_quantity IS DISTINCT FROM NEW.base_quantity OR attempt.net_proceeds IS DISTINCT FROM NEW.actual_output_lamports
  OR attempt.fee_lamports IS DISTINCT FROM NEW.fee_lamports THEN
  RAISE EXCEPTION 'FORCED_LIQUIDATION_BINDING_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO n FROM fills f JOIN orders o ON o.id=f.order_id
  JOIN order_market_state_evidence e ON e.order_id=o.id AND e.purpose='SELL_EXECUTION'
  WHERE e.position_id=link.position_id AND o.execution_context='FORCED_HOURLY_SETTLEMENT';
 IF n<>1 THEN RAISE EXCEPTION 'FORCED_LIQUIDITY_ALREADY_CONSUMED' USING ERRCODE='23514'; END IF;
 IF attempt.sold_quantity<attempt.quantity_before AND NOT EXISTS(
  SELECT 1 FROM legacy_source_reviews h WHERE h.hourly_round_id=attempt.hourly_round_id AND h.position_id=attempt.position_id
 ) THEN RAISE EXCEPTION 'PARTIAL_SETTLEMENT_REVIEW_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER legacy_forced_fill_guard AFTER INSERT ON fills DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION verify_legacy_forced_fill();

CREATE FUNCTION guard_reviewed_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM legacy_source_reviews WHERE hourly_round_id=NEW.hourly_round_id) THEN
  RAISE EXCEPTION 'SETTLEMENT_REVIEW' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_result_review BEFORE INSERT ON hourly_results FOR EACH ROW EXECUTE FUNCTION guard_reviewed_result();
