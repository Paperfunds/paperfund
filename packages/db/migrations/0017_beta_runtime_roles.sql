-- Group roles only: no passwords, login identities or live memberships are provisioned.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='paperfund_beta_api') THEN CREATE ROLE paperfund_beta_api NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='paperfund_beta_worker') THEN CREATE ROLE paperfund_beta_worker NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='paperfund_beta_observer') THEN CREATE ROLE paperfund_beta_observer NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='paperfund_beta_safety') THEN CREATE ROLE paperfund_beta_safety NOLOGIN; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO paperfund_beta_api,paperfund_beta_worker,paperfund_beta_observer,paperfund_beta_safety;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename NOT LIKE 'payout_%' AND tablename<>'legacy_test_qualifications' LOOP
  EXECUTE format('GRANT SELECT ON %I TO paperfund_beta_api,paperfund_beta_worker',t.tablename);
 END LOOP;
END $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO paperfund_beta_observer;
GRANT SELECT ON payout_plans,payout_rank_buckets,payout_allocations TO paperfund_beta_api,paperfund_beta_worker;
GRANT INSERT ON users,assets,markets,competition_accounts,competition_token_slots,positions,orders,fills,
 market_state_evidence,order_market_state_evidence,journal_transactions,ledger_entries,idempotency_records,
 chart_fill_fx_evidence,chart_fill_fx_capture_failures TO paperfund_beta_api,paperfund_beta_worker;
GRANT UPDATE ON markets,competition_accounts,positions,orders,idempotency_records TO paperfund_beta_api,paperfund_beta_worker;
-- PostgreSQL row-share locking requires an UPDATE privilege. Permit a no-op on immutable ID
-- rather than granting the API authority over the round's financial state.
GRANT UPDATE(id) ON hourly_rounds TO paperfund_beta_api;
GRANT UPDATE(id) ON hourly_results TO paperfund_beta_worker;
CREATE FUNCTION beta_round_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'ROUND_ID_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER beta_round_identity_guard BEFORE UPDATE OF id ON hourly_rounds
 FOR EACH ROW EXECUTE FUNCTION beta_round_identity_immutable();
GRANT INSERT,UPDATE ON app_meta TO paperfund_beta_api,paperfund_beta_worker;
GRANT INSERT,UPDATE ON hourly_rounds,daily_competitions,daily_results,hourly_reward_pools,daily_reward_pools,
 reward_buffer_state,creator_fee_observations,creator_fee_ingestion_checkpoints,creator_fee_reconciliation_findings
 TO paperfund_beta_worker;
GRANT INSERT ON hourly_results,daily_result_hourly_results,legacy_source_reviews,legacy_settlement_liquidations,
 settlement_writeoff_metadata_repairs,creator_fee_events,daily_reward_contributions,reward_buffer_movements,
 late_fee_reconciliations,no_participant_reward_outcomes TO paperfund_beta_worker;
GRANT SELECT ON payout_stop_state TO paperfund_beta_safety;
GRANT UPDATE ON payout_stop_state TO paperfund_beta_safety;
GRANT INSERT ON payout_security_events,payout_authority_nonces TO paperfund_beta_safety;
GRANT SELECT ON payout_authority_nonces TO paperfund_beta_safety;
GRANT USAGE,SELECT ON SEQUENCE payout_security_events_id_seq TO paperfund_beta_safety;
-- No service role owns tables/functions or can write qualifications, approvals, reservations,
-- receipts, signatures, treasury debits, grants or schemas. Safety writes no payment rows.
