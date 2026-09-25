CREATE TABLE "creator_fee_events" (
  "id" text PRIMARY KEY NOT NULL,
  "transaction_signature" text NOT NULL,
  "event_index" integer NOT NULL CHECK ("event_index" >= 0),
  "slot" bigint NOT NULL CHECK ("slot" >= 0),
  "event_time" timestamptz NOT NULL,
  "creator_fee_lamports" bigint NOT NULL CHECK ("creator_fee_lamports" > 0),
  "source_program" text NOT NULL,
  "token_project_identity" text,
  "observed_at" timestamptz NOT NULL,
  "normalized_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "verification_status" text NOT NULL CHECK ("verification_status" IN ('VERIFIED','REJECTED')),
  "accounting_status" text DEFAULT 'PENDING' NOT NULL CHECK ("accounting_status" IN ('PENDING','ATTRIBUTED','COUNTED','LATE_AFTER_FREEZE','INELIGIBLE')),
  "hourly_round_id" text REFERENCES "hourly_rounds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "creator_fee_events_chain_identity_unique" UNIQUE("transaction_signature","event_index"),
  CONSTRAINT "creator_fee_events_attribution_consistent" CHECK (
    ("accounting_status" IN ('ATTRIBUTED','COUNTED','LATE_AFTER_FREEZE') AND "hourly_round_id" IS NOT NULL)
    OR "accounting_status" IN ('PENDING','INELIGIBLE')
  )
);
CREATE INDEX "creator_fee_events_round_status_idx" ON "creator_fee_events" ("hourly_round_id","verification_status","accounting_status");
CREATE INDEX "creator_fee_events_event_time_idx" ON "creator_fee_events" ("event_time");

CREATE TABLE "hourly_reward_pools" (
  "id" text PRIMARY KEY NOT NULL,
  "hourly_round_id" text NOT NULL UNIQUE REFERENCES "hourly_rounds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "creator_fee_lamports" bigint NOT NULL,
  "allocation_mode" text NOT NULL CHECK ("allocation_mode" IN ('NORMAL','BUFFER_ACCUMULATION')),
  "natural_hourly_lamports" bigint NOT NULL,
  "explicit_buffer_contribution_lamports" bigint NOT NULL,
  "daily_allocation_lamports" bigint NOT NULL,
  "platform_allocation_lamports" bigint NOT NULL,
  "baseline_lamports" bigint,
  "baseline_input_round_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "baseline_window" integer NOT NULL CHECK ("baseline_window" > 0),
  "lambda_bps" integer NOT NULL CHECK ("lambda_bps" BETWEEN 0 AND 10000),
  "hourly_rate_bps" integer NOT NULL,
  "daily_rate_bps" integer NOT NULL,
  "buffer_rate_bps" integer NOT NULL,
  "platform_rate_bps" integer NOT NULL,
  "finalization_grace_seconds" integer NOT NULL CHECK ("finalization_grace_seconds" >= 0),
  "dynamic_target_lamports" bigint NOT NULL,
  "dynamic_buffer_deposit_lamports" bigint NOT NULL,
  "dynamic_buffer_support_lamports" bigint NOT NULL,
  "final_hourly_prize_lamports" bigint NOT NULL,
  "starting_buffer_lamports" bigint NOT NULL,
  "ending_buffer_lamports" bigint NOT NULL,
  "configuration_version" text NOT NULL,
  "status" text DEFAULT 'FROZEN' NOT NULL CHECK ("status" IN ('FROZEN','FINAL')),
  "finalized_at" timestamptz NOT NULL,
  "frozen_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "hourly_reward_pools_nonnegative" CHECK (
    "creator_fee_lamports" >= 0 AND "natural_hourly_lamports" >= 0
    AND "explicit_buffer_contribution_lamports" >= 0 AND "daily_allocation_lamports" >= 0
    AND "platform_allocation_lamports" >= 0 AND "dynamic_target_lamports" >= 0
    AND "dynamic_buffer_deposit_lamports" >= 0 AND "dynamic_buffer_support_lamports" >= 0
    AND "final_hourly_prize_lamports" >= 0 AND "starting_buffer_lamports" >= 0 AND "ending_buffer_lamports" >= 0
  ),
  CONSTRAINT "hourly_reward_pools_rates_total" CHECK ("hourly_rate_bps"+"daily_rate_bps"+"buffer_rate_bps"+"platform_rate_bps" = 10000),
  CONSTRAINT "hourly_reward_pools_conservation" CHECK (
    "creator_fee_lamports"+"starting_buffer_lamports"
    = "final_hourly_prize_lamports"+"daily_allocation_lamports"+"platform_allocation_lamports"+"ending_buffer_lamports"
  )
);
CREATE INDEX "hourly_reward_pools_finalized_idx" ON "hourly_reward_pools" ("status","finalized_at");

CREATE TABLE "daily_reward_pools" (
  "id" text PRIMARY KEY NOT NULL,
  "daily_competition_id" text NOT NULL UNIQUE REFERENCES "daily_competitions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "accumulated_lamports" bigint DEFAULT 0 NOT NULL CHECK ("accumulated_lamports" >= 0),
  "status" text DEFAULT 'OPEN' NOT NULL CHECK ("status" IN ('OPEN','FROZEN','FINAL')),
  "finalized_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "daily_reward_contributions" (
  "id" text PRIMARY KEY NOT NULL,
  "daily_reward_pool_id" text NOT NULL REFERENCES "daily_reward_pools"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "hourly_reward_pool_id" text NOT NULL UNIQUE REFERENCES "hourly_reward_pools"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "amount_lamports" bigint NOT NULL CHECK ("amount_lamports" >= 0),
  "contributed_at" timestamptz NOT NULL,
  CONSTRAINT "daily_reward_contributions_pool_hour_unique" UNIQUE("daily_reward_pool_id","hourly_reward_pool_id")
);

CREATE TABLE "reward_buffer_state" (
  "id" text PRIMARY KEY NOT NULL,
  "balance_lamports" bigint DEFAULT 0 NOT NULL CHECK ("balance_lamports" >= 0),
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "reward_buffer_movements" (
  "id" text PRIMARY KEY NOT NULL,
  "hourly_reward_pool_id" text NOT NULL REFERENCES "hourly_reward_pools"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reason" text NOT NULL CHECK ("reason" IN ('EXPLICIT_ACCUMULATION','DYNAMIC_EXCESS_DEPOSIT','WEAK_HOUR_SUPPORT')),
  "amount_lamports" bigint NOT NULL CHECK ("amount_lamports" <> 0),
  "starting_balance_lamports" bigint NOT NULL CHECK ("starting_balance_lamports" >= 0),
  "ending_balance_lamports" bigint NOT NULL CHECK ("ending_balance_lamports" >= 0),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "reward_buffer_movements_hour_reason_unique" UNIQUE("hourly_reward_pool_id","reason"),
  CONSTRAINT "reward_buffer_movements_balance_exact" CHECK ("ending_balance_lamports" = "starting_balance_lamports"+"amount_lamports")
);

CREATE TABLE "late_fee_reconciliations" (
  "id" text PRIMARY KEY NOT NULL,
  "creator_fee_event_id" text NOT NULL UNIQUE REFERENCES "creator_fee_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "hourly_round_id" text NOT NULL REFERENCES "hourly_rounds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reason" text DEFAULT 'LATE_AFTER_FREEZE' NOT NULL CHECK ("reason" = 'LATE_AFTER_FREEZE'),
  "status" text DEFAULT 'OPEN' NOT NULL CHECK ("status" IN ('OPEN','RESOLVED')),
  "discovered_at" timestamptz NOT NULL,
  "resolution_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE OR REPLACE FUNCTION reject_reward_immutable_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER creator_fee_events_verified_immutable
BEFORE UPDATE OF transaction_signature,event_index,slot,event_time,creator_fee_lamports,source_program,token_project_identity,verification_status
ON creator_fee_events FOR EACH ROW WHEN (OLD.verification_status = 'VERIFIED')
EXECUTE FUNCTION reject_reward_immutable_change();
CREATE TRIGGER hourly_reward_pools_immutable BEFORE UPDATE OR DELETE ON hourly_reward_pools FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_change();
CREATE TRIGGER daily_reward_contributions_immutable BEFORE UPDATE OR DELETE ON daily_reward_contributions FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_change();
CREATE TRIGGER reward_buffer_movements_immutable BEFORE UPDATE OR DELETE ON reward_buffer_movements FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_change();

CREATE OR REPLACE FUNCTION enforce_daily_reward_pool_total() RETURNS trigger AS $$
DECLARE expected bigint;
BEGIN
  SELECT COALESCE(SUM(amount_lamports),0) INTO expected FROM daily_reward_contributions WHERE daily_reward_pool_id = NEW.id;
  IF NEW.accumulated_lamports <> expected THEN
    RAISE EXCEPTION 'daily reward pool total must equal contributions' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER daily_reward_pool_total_exact
AFTER UPDATE OF accumulated_lamports ON daily_reward_pools
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_daily_reward_pool_total();

