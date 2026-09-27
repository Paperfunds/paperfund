ALTER TABLE payout_plans DROP CONSTRAINT payout_plans_state_valid;
ALTER TABLE payout_plans ADD COLUMN approved_at timestamptz;
ALTER TABLE payout_plans ADD COLUMN signed_at timestamptz;
ALTER TABLE payout_plans ADD COLUMN broadcast_at timestamptz;
ALTER TABLE payout_plans ADD COLUMN verified_at timestamptz;
ALTER TABLE payout_plans ADD CONSTRAINT payout_plans_state_valid CHECK (
  state IN ('CALCULATED','FROZEN','VALIDATED','APPROVED','SIGNED','BROADCAST','VERIFIED','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')
);

CREATE OR REPLACE FUNCTION enforce_payout_plan_lifecycle() RETURNS trigger AS $$
DECLARE old_order integer;
DECLARE new_order integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_plans rows are immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.competition_type,NEW.hourly_round_id,NEW.daily_competition_id,
         NEW.prize_pool_lamports,NEW.curve_version,NEW.tie_policy_version,
         NEW.participant_count,NEW.nominal_winner_count,NEW.actual_winner_count,
         NEW.calculated_at,NEW.config_snapshot,NEW.source_result_snapshot,
         NEW.total_allocated_lamports,NEW.conservation_holds,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.competition_type,OLD.hourly_round_id,OLD.daily_competition_id,
         OLD.prize_pool_lamports,OLD.curve_version,OLD.tie_policy_version,
         OLD.participant_count,OLD.nominal_winner_count,OLD.actual_winner_count,
         OLD.calculated_at,OLD.config_snapshot,OLD.source_result_snapshot,
         OLD.total_allocated_lamports,OLD.conservation_holds,OLD.created_at) THEN
    RAISE EXCEPTION 'frozen payout plan financial fields are immutable' USING ERRCODE = '23514';
  END IF;
  old_order := array_position(ARRAY['CALCULATED','FROZEN','VALIDATED','APPROVED','SIGNED','BROADCAST','VERIFIED'], OLD.state);
  new_order := array_position(ARRAY['CALCULATED','FROZEN','VALIDATED','APPROVED','SIGNED','BROADCAST','VERIFIED'], NEW.state);
  IF old_order IS NOT NULL AND new_order IS NOT NULL AND new_order < old_order THEN
    RAISE EXCEPTION 'payout plan lifecycle cannot move backward' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'VERIFIED' AND NEW.state <> 'VERIFIED' THEN
    RAISE EXCEPTION 'verified payout plan is terminal' USING ERRCODE = '23514';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state='CALCULATED' AND NEW.state='FROZEN') OR
    (OLD.state='FROZEN' AND NEW.state='VALIDATED') OR
    (OLD.state='VALIDATED' AND NEW.state='APPROVED') OR
    (OLD.state='APPROVED' AND NEW.state IN ('SIGNED','FAILED_FINAL')) OR
    (OLD.state='SIGNED' AND NEW.state IN ('BROADCAST','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')) OR
    (OLD.state='BROADCAST' AND NEW.state IN ('VERIFIED','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')) OR
    (OLD.state='FAILED_RETRYABLE' AND NEW.state IN ('SIGNED','FAILED_FINAL','RECONCILIATION_REQUIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid payout plan lifecycle transition: % to %', OLD.state, NEW.state USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE payout_plan_approvals (
  id text PRIMARY KEY,
  payout_plan_id text NOT NULL UNIQUE REFERENCES payout_plans(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_method text NOT NULL CHECK (approval_method = 'OPERATOR_CLI'),
  approver_identifier text NOT NULL CHECK (length(approver_identifier) > 0),
  plan_snapshot_hash text NOT NULL CHECK (length(plan_snapshot_hash) = 64),
  approved_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE payout_executions (
  id text PRIMARY KEY,
  payout_plan_id text NOT NULL UNIQUE REFERENCES payout_plans(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  network text NOT NULL CHECK (network IN ('localnet','devnet','mainnet-beta')),
  treasury_address text NOT NULL,
  signer_type text NOT NULL,
  state text NOT NULL CHECK (state IN ('PREPARED','SIGNED','BROADCAST','PARTIAL_VERIFIED','VERIFIED','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')),
  total_payout_lamports bigint NOT NULL CHECK (total_payout_lamports >= 0),
  estimated_fee_lamports bigint NOT NULL CHECK (estimated_fee_lamports >= 0),
  prepared_at timestamptz NOT NULL,
  signed_at timestamptz,
  broadcast_at timestamptz,
  last_broadcast_at timestamptz,
  verified_at timestamptz,
  failure_code text,
  failure_detail text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE payout_batches (
  id text PRIMARY KEY,
  payout_execution_id text NOT NULL REFERENCES payout_executions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index >= 0),
  intent_version text NOT NULL,
  intent_hash text NOT NULL UNIQUE CHECK (length(intent_hash) = 64),
  state text NOT NULL CHECK (state IN ('PREPARED','SIGNED','BROADCAST','VERIFIED','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')),
  recipient_count integer NOT NULL CHECK (recipient_count > 0),
  total_lamports bigint NOT NULL CHECK (total_lamports > 0),
  fee_lamports bigint NOT NULL CHECK (fee_lamports >= 0),
  recent_blockhash text NOT NULL,
  last_valid_block_height bigint NOT NULL CHECK (last_valid_block_height >= 0),
  unsigned_transaction_base64 text NOT NULL,
  signed_transaction_base64 text,
  transaction_signature text UNIQUE,
  signed_at timestamptz,
  broadcast_at timestamptz,
  last_broadcast_at timestamptz,
  verified_at timestamptz,
  confirmation_slot bigint,
  failure_code text,
  failure_detail text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT payout_batches_execution_index_unique UNIQUE(payout_execution_id,batch_index)
);

CREATE TABLE payout_batch_allocations (
  payout_batch_id text NOT NULL REFERENCES payout_batches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  payout_allocation_id text NOT NULL UNIQUE REFERENCES payout_allocations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  destination_address text NOT NULL,
  lamports bigint NOT NULL CHECK (lamports > 0),
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY(payout_batch_id,payout_allocation_id),
  CONSTRAINT payout_batch_allocations_ordinal_unique UNIQUE(payout_batch_id,ordinal)
);

CREATE TABLE payout_broadcast_attempts (
  id text PRIMARY KEY,
  payout_batch_id text NOT NULL REFERENCES payout_batches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  transaction_signature text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED','UNCERTAIN','REJECTED','ALREADY_PROCESSED')),
  rpc_detail text,
  attempted_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT payout_broadcast_attempts_batch_number_unique UNIQUE(payout_batch_id,attempt_number)
);

CREATE TABLE no_participant_reward_outcomes (
  id text PRIMARY KEY,
  competition_type text NOT NULL CHECK (competition_type IN ('HOURLY','DAILY')),
  hourly_round_id text UNIQUE REFERENCES hourly_rounds(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  daily_competition_id text UNIQUE REFERENCES daily_competitions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  carried_lamports bigint NOT NULL CHECK (carried_lamports >= 0),
  reward_buffer_movement_id text UNIQUE,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT no_participant_reward_outcomes_source_exact CHECK (
    (competition_type='HOURLY' AND hourly_round_id IS NOT NULL AND daily_competition_id IS NULL) OR
    (competition_type='DAILY' AND hourly_round_id IS NULL AND daily_competition_id IS NOT NULL)
  )
);

ALTER TABLE reward_buffer_movements DROP CONSTRAINT reward_buffer_movements_hour_reason_unique;
ALTER TABLE reward_buffer_movements ALTER COLUMN hourly_reward_pool_id DROP NOT NULL;
ALTER TABLE reward_buffer_movements ADD COLUMN daily_reward_pool_id text REFERENCES daily_reward_pools(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE reward_buffer_movements DROP CONSTRAINT reward_buffer_movements_reason_check;
ALTER TABLE reward_buffer_movements ADD CONSTRAINT reward_buffer_movements_reason_check CHECK (
  reason IN ('EXPLICIT_ACCUMULATION','DYNAMIC_EXCESS_DEPOSIT','WEAK_HOUR_SUPPORT','ZERO_PARTICIPANT_CARRY_FORWARD')
);
ALTER TABLE reward_buffer_movements ADD CONSTRAINT reward_buffer_movements_source_exact CHECK (
  (hourly_reward_pool_id IS NOT NULL AND daily_reward_pool_id IS NULL) OR
  (hourly_reward_pool_id IS NULL AND daily_reward_pool_id IS NOT NULL)
);
CREATE UNIQUE INDEX reward_buffer_movements_hour_reason_unique ON reward_buffer_movements(hourly_reward_pool_id,reason) WHERE hourly_reward_pool_id IS NOT NULL;
CREATE UNIQUE INDEX reward_buffer_movements_daily_reason_unique ON reward_buffer_movements(daily_reward_pool_id,reason) WHERE daily_reward_pool_id IS NOT NULL;
ALTER TABLE no_participant_reward_outcomes ADD CONSTRAINT no_participant_reward_outcomes_movement_fk
  FOREIGN KEY(reward_buffer_movement_id) REFERENCES reward_buffer_movements(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER payout_plan_approvals_immutable BEFORE UPDATE OR DELETE ON payout_plan_approvals FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER payout_batch_allocations_immutable BEFORE UPDATE OR DELETE ON payout_batch_allocations FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER payout_broadcast_attempts_immutable BEFORE UPDATE OR DELETE ON payout_broadcast_attempts FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
CREATE TRIGGER no_participant_reward_outcomes_immutable BEFORE UPDATE OR DELETE ON no_participant_reward_outcomes FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();

CREATE OR REPLACE FUNCTION enforce_payout_batch_intent_immutable() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.payout_execution_id,NEW.batch_index,NEW.intent_version,NEW.intent_hash,
         NEW.recipient_count,NEW.total_lamports,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.payout_execution_id,OLD.batch_index,OLD.intent_version,OLD.intent_hash,
         OLD.recipient_count,OLD.total_lamports,OLD.created_at) THEN
    RAISE EXCEPTION 'payout batch intent is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payout_batch_intent_immutable BEFORE UPDATE ON payout_batches
FOR EACH ROW EXECUTE FUNCTION enforce_payout_batch_intent_immutable();

CREATE OR REPLACE FUNCTION enforce_payout_batch_allocation_total() RETURNS trigger AS $$
DECLARE batch_id text;
DECLARE expected_total bigint;
DECLARE expected_count integer;
DECLARE actual_total bigint;
DECLARE actual_count integer;
BEGIN
  batch_id := COALESCE(NEW.payout_batch_id,OLD.payout_batch_id);
  SELECT total_lamports,recipient_count INTO expected_total,expected_count FROM payout_batches WHERE id=batch_id;
  SELECT COALESCE(SUM(lamports),0),COUNT(*)::integer INTO actual_total,actual_count
    FROM payout_batch_allocations WHERE payout_batch_id=batch_id;
  IF actual_total <> expected_total OR actual_count <> expected_count THEN
    RAISE EXCEPTION 'payout batch allocations do not match batch intent' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER payout_batch_allocation_total_exact
AFTER INSERT OR UPDATE OR DELETE ON payout_batch_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_payout_batch_allocation_total();
