CREATE TABLE "payout_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"payout_plan_id" text NOT NULL,
	"user_id" text NOT NULL,
	"competitive_rank" integer NOT NULL,
	"tie_group_size" integer NOT NULL,
	"ordinal_start" integer NOT NULL,
	"ordinal_end" integer NOT NULL,
	"funded_ordinal_count" integer NOT NULL,
	"allocated_lamports" bigint NOT NULL,
	"dust_adjustment_lamports" bigint NOT NULL,
	"allocation_explanation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_allocations_plan_user_unique" UNIQUE("payout_plan_id","user_id"),
	CONSTRAINT "payout_allocations_rank_valid" CHECK ("payout_allocations"."competitive_rank" > 0 and "payout_allocations"."tie_group_size" > 0 and "payout_allocations"."ordinal_start" > 0 and "payout_allocations"."ordinal_end" >= "payout_allocations"."ordinal_start" and "payout_allocations"."funded_ordinal_count" > 0),
	CONSTRAINT "payout_allocations_amount_valid" CHECK ("payout_allocations"."allocated_lamports" >= 0 and "payout_allocations"."dust_adjustment_lamports" >= 0 and "payout_allocations"."dust_adjustment_lamports" <= 1)
);
--> statement-breakpoint
CREATE TABLE "payout_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_type" text NOT NULL,
	"hourly_round_id" text,
	"daily_competition_id" text,
	"prize_pool_lamports" bigint NOT NULL,
	"curve_version" text NOT NULL,
	"tie_policy_version" text NOT NULL,
	"participant_count" integer NOT NULL,
	"nominal_winner_count" integer NOT NULL,
	"actual_winner_count" integer NOT NULL,
	"state" text DEFAULT 'CALCULATED' NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"frozen_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"config_snapshot" jsonb NOT NULL,
	"source_result_snapshot" jsonb NOT NULL,
	"total_allocated_lamports" bigint NOT NULL,
	"conservation_holds" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_plans_hour_curve_unique" UNIQUE("hourly_round_id","curve_version"),
	CONSTRAINT "payout_plans_daily_curve_unique" UNIQUE("daily_competition_id","curve_version"),
	CONSTRAINT "payout_plans_type_valid" CHECK ("payout_plans"."competition_type" in ('HOURLY','DAILY')),
	CONSTRAINT "payout_plans_source_exact" CHECK (("payout_plans"."competition_type" = 'HOURLY' and "payout_plans"."hourly_round_id" is not null and "payout_plans"."daily_competition_id" is null) or ("payout_plans"."competition_type" = 'DAILY' and "payout_plans"."hourly_round_id" is null and "payout_plans"."daily_competition_id" is not null)),
	CONSTRAINT "payout_plans_state_valid" CHECK ("payout_plans"."state" in ('CALCULATED','FROZEN','VALIDATED','APPROVED')),
	CONSTRAINT "payout_plans_counts_valid" CHECK ("payout_plans"."participant_count" >= 0 and "payout_plans"."nominal_winner_count" > 0 and "payout_plans"."actual_winner_count" >= 0),
	CONSTRAINT "payout_plans_amounts_valid" CHECK ("payout_plans"."prize_pool_lamports" >= 0 and "payout_plans"."total_allocated_lamports" >= 0),
	CONSTRAINT "payout_plans_conservation_exact" CHECK ("payout_plans"."conservation_holds" and "payout_plans"."prize_pool_lamports" = "payout_plans"."total_allocated_lamports")
);
--> statement-breakpoint
CREATE TABLE "payout_rank_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"payout_plan_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"weight_ppm" bigint NOT NULL,
	"floor_allocation_lamports" bigint NOT NULL,
	"remainder_basis" bigint NOT NULL,
	"final_allocation_lamports" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_rank_buckets_plan_ordinal_unique" UNIQUE("payout_plan_id","ordinal"),
	CONSTRAINT "payout_rank_buckets_ordinal_positive" CHECK ("payout_rank_buckets"."ordinal" > 0),
	CONSTRAINT "payout_rank_buckets_values_nonnegative" CHECK ("payout_rank_buckets"."weight_ppm" >= 0 and "payout_rank_buckets"."floor_allocation_lamports" >= 0 and "payout_rank_buckets"."remainder_basis" >= 0 and "payout_rank_buckets"."final_allocation_lamports" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_payout_plan_id_payout_plans_id_fk" FOREIGN KEY ("payout_plan_id") REFERENCES "public"."payout_plans"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payout_plans" ADD CONSTRAINT "payout_plans_hourly_round_id_hourly_rounds_id_fk" FOREIGN KEY ("hourly_round_id") REFERENCES "public"."hourly_rounds"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payout_plans" ADD CONSTRAINT "payout_plans_daily_competition_id_daily_competitions_id_fk" FOREIGN KEY ("daily_competition_id") REFERENCES "public"."daily_competitions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payout_rank_buckets" ADD CONSTRAINT "payout_rank_buckets_payout_plan_id_payout_plans_id_fk" FOREIGN KEY ("payout_plan_id") REFERENCES "public"."payout_plans"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "payout_allocations_user_idx" ON "payout_allocations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payout_plans_state_idx" ON "payout_plans" USING btree ("state","calculated_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_payout_detail_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payout_rank_buckets_immutable
BEFORE UPDATE OR DELETE ON payout_rank_buckets
FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
--> statement-breakpoint
CREATE TRIGGER payout_allocations_immutable
BEFORE UPDATE OR DELETE ON payout_allocations
FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
--> statement-breakpoint
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
  old_order := array_position(ARRAY['CALCULATED','FROZEN','VALIDATED','APPROVED'], OLD.state);
  new_order := array_position(ARRAY['CALCULATED','FROZEN','VALIDATED','APPROVED'], NEW.state);
  IF new_order < old_order THEN
    RAISE EXCEPTION 'payout plan lifecycle cannot move backward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payout_plans_lifecycle_guard
BEFORE UPDATE OR DELETE ON payout_plans
FOR EACH ROW EXECUTE FUNCTION enforce_payout_plan_lifecycle();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_payout_plan_totals() RETURNS trigger AS $$
DECLARE plan_id text;
DECLARE expected_total bigint;
DECLARE expected_count integer;
DECLARE allocation_total bigint;
DECLARE allocation_count integer;
DECLARE bucket_total bigint;
BEGIN
  plan_id := COALESCE(NEW.payout_plan_id, OLD.payout_plan_id);
  SELECT total_allocated_lamports, actual_winner_count
    INTO expected_total, expected_count FROM payout_plans WHERE id = plan_id;
  SELECT COALESCE(SUM(allocated_lamports),0), COUNT(*)::integer
    INTO allocation_total, allocation_count FROM payout_allocations WHERE payout_plan_id = plan_id;
  SELECT COALESCE(SUM(final_allocation_lamports),0)
    INTO bucket_total FROM payout_rank_buckets WHERE payout_plan_id = plan_id;
  IF allocation_total <> expected_total OR bucket_total <> expected_total OR allocation_count <> expected_count THEN
    RAISE EXCEPTION 'payout plan details do not conserve or match winner count' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payout_allocations_total_exact
AFTER INSERT OR UPDATE OR DELETE ON payout_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_payout_plan_totals();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION require_open_daily_reward_pool() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM daily_reward_pools
    WHERE id = NEW.daily_reward_pool_id AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'daily reward pool is frozen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER daily_reward_contributions_require_open_pool
BEFORE INSERT ON daily_reward_contributions
FOR EACH ROW EXECUTE FUNCTION require_open_daily_reward_pool();
