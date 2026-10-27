-- Candidate only; no backfill or production journal registration.
ALTER TABLE payout_executions ADD COLUMN safety_version text CHECK (safety_version IS NULL OR safety_version='payout-serialized-v1');
CREATE TABLE payout_signed_transactions (
  payout_batch_id text PRIMARY KEY REFERENCES payout_batches(id) ON DELETE RESTRICT,
  transaction_signature text NOT NULL UNIQUE,
  intent_hash text NOT NULL,
  unsigned_transaction_base64 text NOT NULL,
  signed_transaction_base64 text NOT NULL,
  recent_blockhash text NOT NULL,
  last_valid_block_height bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payout_signed_transactions_immutable BEFORE UPDATE OR DELETE ON payout_signed_transactions
FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TABLE payout_operation_events (
  id bigserial PRIMARY KEY,
  payout_execution_id text NOT NULL REFERENCES payout_executions(id) ON DELETE RESTRICT,
  payout_batch_id text REFERENCES payout_batches(id) ON DELETE RESTRICT,
  transaction_signature text,
  event text NOT NULL,
  detail jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payout_operation_events_immutable BEFORE UPDATE OR DELETE ON payout_operation_events
FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();

CREATE FUNCTION enforce_serialized_payout_batch() RETURNS trigger AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.state='VERIFIED' AND NEW.state<>'VERIFIED' THEN RAISE EXCEPTION 'verified batch is terminal' USING ERRCODE='23514'; END IF;
    IF OLD.signed_transaction_base64 IS NOT NULL AND
      ROW(NEW.transaction_signature,NEW.signed_transaction_base64,NEW.unsigned_transaction_base64,NEW.recent_blockhash,NEW.last_valid_block_height)
      IS DISTINCT FROM ROW(OLD.transaction_signature,OLD.signed_transaction_base64,OLD.unsigned_transaction_base64,OLD.recent_blockhash,OLD.last_valid_block_height)
    THEN RAISE EXCEPTION 'persisted signing cycle cannot be replaced' USING ERRCODE='23514'; END IF;
    IF OLD.state<>'PREPARED' AND NEW.state='PREPARED' THEN RAISE EXCEPTION 'signed payout cannot return to preparation' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.state IN ('SIGNED','BROADCAST','VERIFIED','FAILED_RETRYABLE') AND
    (NEW.signed_transaction_base64 IS NULL OR NEW.transaction_signature IS NULL)
  THEN RAISE EXCEPTION 'payment state requires durable signed evidence' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payout_batch_recovery_guard BEFORE INSERT OR UPDATE ON payout_batches
FOR EACH ROW EXECUTE FUNCTION enforce_serialized_payout_batch();

CREATE FUNCTION persist_payout_signing_evidence() RETURNS trigger AS $$
BEGIN
  IF NEW.signed_transaction_base64 IS NOT NULL AND (TG_OP='INSERT' OR OLD.signed_transaction_base64 IS NULL) THEN
    INSERT INTO payout_signed_transactions
      (payout_batch_id,transaction_signature,intent_hash,unsigned_transaction_base64,signed_transaction_base64,recent_blockhash,last_valid_block_height)
      VALUES (NEW.id,NEW.transaction_signature,NEW.intent_hash,NEW.unsigned_transaction_base64,NEW.signed_transaction_base64,NEW.recent_blockhash,NEW.last_valid_block_height);
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payout_signing_evidence AFTER INSERT OR UPDATE ON payout_batches
FOR EACH ROW EXECUTE FUNCTION persist_payout_signing_evidence();

CREATE FUNCTION audit_payout_transition() RETURNS trigger AS $$
DECLARE execution_id text;
DECLARE batch_id text;
DECLARE signature text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.state=NEW.state THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='payout_batches' THEN execution_id:=NEW.payout_execution_id;batch_id:=NEW.id;signature:=NEW.transaction_signature;
  ELSIF TG_TABLE_NAME='payout_executions' THEN execution_id:=NEW.id;
  ELSE SELECT id INTO execution_id FROM payout_executions WHERE payout_plan_id=NEW.id; END IF;
  IF execution_id IS NOT NULL THEN
    INSERT INTO payout_operation_events(payout_execution_id,payout_batch_id,transaction_signature,event,detail)
    VALUES(execution_id,batch_id,signature,'STATE_TRANSITION',jsonb_build_object('table',TG_TABLE_NAME,'old',CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END,'new',NEW.state));
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payout_batch_transition_audit AFTER INSERT OR UPDATE ON payout_batches FOR EACH ROW EXECUTE FUNCTION audit_payout_transition();
CREATE TRIGGER payout_execution_transition_audit AFTER INSERT OR UPDATE ON payout_executions FOR EACH ROW EXECUTE FUNCTION audit_payout_transition();
CREATE TRIGGER payout_plan_transition_audit AFTER UPDATE ON payout_plans FOR EACH ROW EXECUTE FUNCTION audit_payout_transition();

CREATE FUNCTION enforce_payout_execution_authority() RETURNS trigger AS $$
BEGIN
 IF OLD.state='VERIFIED' AND NEW.state<>'VERIFIED' THEN RAISE EXCEPTION 'verified execution is terminal' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.payout_plan_id,NEW.network,NEW.treasury_address,NEW.signer_type,NEW.total_payout_lamports,NEW.safety_version)
 IS DISTINCT FROM ROW(OLD.payout_plan_id,OLD.network,OLD.treasury_address,OLD.signer_type,OLD.total_payout_lamports,OLD.safety_version)
 THEN RAISE EXCEPTION 'execution financial authority is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payout_execution_authority BEFORE UPDATE ON payout_executions FOR EACH ROW EXECUTE FUNCTION enforce_payout_execution_authority();

-- paperfund-payout-lifecycle-compat-v1: exactly two known 0006 bodies are supported.
-- Preserve immutable fields, DELETE prohibition, monotonicity and VERIFIED terminality.
-- Restore only the missing explicit transition guard, with accepted 0013 recovery edges.
DO $compat$ DECLARE definition text; body text; BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid='public.enforce_payout_plan_lifecycle()'::regprocedure AND NOT prosecdef AND proconfig IS NULL AND NOT proisstrict AND provolatile='v' AND prorettype='trigger'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql');
 IF md5(replace(body,E'\r\n',E'\n'))='8fc6ccaa3408cc115f7692a96e50f92f' THEN
  definition:=replace(definition,'  RETURN NEW;','  IF NEW.state <> OLD.state AND NOT (
    (OLD.state=''CALCULATED'' AND NEW.state=''FROZEN'') OR
    (OLD.state=''FROZEN'' AND NEW.state=''VALIDATED'') OR
    (OLD.state=''VALIDATED'' AND NEW.state=''APPROVED'') OR
    (OLD.state=''APPROVED'' AND NEW.state IN (''SIGNED'',''FAILED_FINAL'')) OR
    (OLD.state=''SIGNED'' AND NEW.state IN (''BROADCAST'',''FAILED_RETRYABLE'',''FAILED_FINAL'',''RECONCILIATION_REQUIRED'')) OR
    (OLD.state=''BROADCAST'' AND NEW.state IN (''VERIFIED'',''FAILED_RETRYABLE'',''FAILED_FINAL'',''RECONCILIATION_REQUIRED'')) OR
    (OLD.state=''FAILED_RETRYABLE'' AND NEW.state IN (''SIGNED'',''BROADCAST'',''VERIFIED'',''FAILED_FINAL'',''RECONCILIATION_REQUIRED'')) OR (OLD.state=''RECONCILIATION_REQUIRED'' AND NEW.state IN (''BROADCAST'',''VERIFIED'',''FAILED_FINAL'')) OR (OLD.state=''APPROVED'' AND NEW.state=''RECONCILIATION_REQUIRED'')
  ) THEN
    RAISE EXCEPTION ''invalid payout plan lifecycle transition: % to %'', OLD.state, NEW.state USING ERRCODE = ''23514'';
  END IF;
  RETURN NEW;');
 ELSIF md5(replace(body,E'\r\n',E'\n'))='746ce4823748990b2176548a8953195c' THEN
  definition:=replace(definition,'(OLD.state=''FAILED_RETRYABLE'' AND NEW.state IN (''SIGNED'',''FAILED_FINAL'',''RECONCILIATION_REQUIRED''))','(OLD.state=''FAILED_RETRYABLE'' AND NEW.state IN (''SIGNED'',''BROADCAST'',''VERIFIED'',''FAILED_FINAL'',''RECONCILIATION_REQUIRED'')) OR (OLD.state=''RECONCILIATION_REQUIRED'' AND NEW.state IN (''BROADCAST'',''VERIFIED'',''FAILED_FINAL'')) OR (OLD.state=''APPROVED'' AND NEW.state=''RECONCILIATION_REQUIRED'')');
 ELSE RAISE EXCEPTION 'unsupported payout lifecycle definition: review migration'; END IF;
 EXECUTE definition;
 IF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid='public.enforce_payout_plan_lifecycle()'::regprocedure)<>'3f93d2f9f835ae77a90ccb11c07c6a1c' THEN RAISE EXCEPTION 'payout lifecycle compatibility postimage mismatch'; END IF;
END $compat$;
COMMENT ON FUNCTION public.enforce_payout_plan_lifecycle() IS 'paperfund-payout-lifecycle-compat-v1; preserved guards plus accepted 0013 recovery';
