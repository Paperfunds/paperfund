CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"mint_address" text NOT NULL,
	"symbol" text,
	"name" text,
	"decimals" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_mint_address_unique" UNIQUE("mint_address"),
	CONSTRAINT "assets_decimals_valid" CHECK ("assets"."decimals" between 0 and 255)
);
--> statement-breakpoint
CREATE TABLE "competition_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"hourly_round_id" text NOT NULL,
	"starting_paper_sol_lamports" bigint NOT NULL,
	"paper_sol_balance_lamports" bigint NOT NULL,
	"realized_pnl_lamports" bigint DEFAULT 0 NOT NULL,
	"final_settled_balance_lamports" bigint,
	"hourly_pnl_lamports" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "competition_accounts_user_round_unique" UNIQUE("user_id","hourly_round_id"),
	CONSTRAINT "competition_accounts_starting_balance_positive" CHECK ("competition_accounts"."starting_paper_sol_lamports" > 0),
	CONSTRAINT "competition_accounts_balance_nonnegative" CHECK ("competition_accounts"."paper_sol_balance_lamports" >= 0),
	CONSTRAINT "competition_accounts_finalization_consistent" CHECK (("competition_accounts"."final_settled_balance_lamports" is null and "competition_accounts"."hourly_pnl_lamports" is null and "competition_accounts"."finalized_at" is null) or ("competition_accounts"."final_settled_balance_lamports" is not null and "competition_accounts"."hourly_pnl_lamports" = "competition_accounts"."final_settled_balance_lamports" - "competition_accounts"."starting_paper_sol_lamports" and "competition_accounts"."finalized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "competition_token_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_account_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"first_successful_buy_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_token_slots_account_asset_unique" UNIQUE("competition_account_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "daily_competitions" (
	"id" text PRIMARY KEY NOT NULL,
	"utc_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at_exclusive" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "daily_competitions_utc_date_unique" UNIQUE("utc_date"),
	CONSTRAINT "daily_competitions_starts_at_unique" UNIQUE("starts_at"),
	CONSTRAINT "daily_competitions_ends_at_exclusive_unique" UNIQUE("ends_at_exclusive"),
	CONSTRAINT "daily_competitions_exact_utc_window" CHECK ("daily_competitions"."starts_at" = date_trunc('day', "daily_competitions"."starts_at" at time zone 'UTC') at time zone 'UTC' and "daily_competitions"."ends_at_exclusive" = "daily_competitions"."starts_at" + interval '1 day' and "daily_competitions"."utc_date" = ("daily_competitions"."starts_at" at time zone 'UTC')::date),
	CONSTRAINT "daily_competitions_state_valid" CHECK ("daily_competitions"."state" in ('OPEN', 'CLOSING', 'FINALIZING', 'FINALIZED', 'PAYING', 'PAID'))
);
--> statement-breakpoint
CREATE TABLE "daily_result_hourly_results" (
	"id" text PRIMARY KEY NOT NULL,
	"daily_result_id" text NOT NULL,
	"hourly_result_id" text NOT NULL,
	"idempotency_record_id" text NOT NULL,
	"contributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_result_hourly_results_hourly_result_id_unique" UNIQUE("hourly_result_id"),
	CONSTRAINT "daily_result_hourly_results_idempotency_record_id_unique" UNIQUE("idempotency_record_id"),
	CONSTRAINT "daily_result_hourly_results_pair_unique" UNIQUE("daily_result_id","hourly_result_id")
);
--> statement-breakpoint
CREATE TABLE "daily_results" (
	"id" text PRIMARY KEY NOT NULL,
	"daily_competition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"cumulative_pnl_lamports" bigint DEFAULT 0 NOT NULL,
	"completed_hourly_round_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_results_competition_user_unique" UNIQUE("daily_competition_id","user_id"),
	CONSTRAINT "daily_results_completed_count_nonnegative" CHECK ("daily_results"."completed_hourly_round_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"market_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"side" text NOT NULL,
	"base_quantity" bigint NOT NULL,
	"quote_lamports" bigint NOT NULL,
	"execution_price" numeric(38, 18) NOT NULL,
	"fee_lamports" bigint DEFAULT 0 NOT NULL,
	"cost_basis_lamports_removed" bigint DEFAULT 0 NOT NULL,
	"realized_pnl_lamports" bigint DEFAULT 0 NOT NULL,
	"idempotency_record_id" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fills_execution_id_unique" UNIQUE("execution_id"),
	CONSTRAINT "fills_idempotency_record_id_unique" UNIQUE("idempotency_record_id"),
	CONSTRAINT "fills_side_valid" CHECK ("fills"."side" in ('BUY', 'SELL')),
	CONSTRAINT "fills_base_positive" CHECK ("fills"."base_quantity" > 0),
	CONSTRAINT "fills_quote_positive" CHECK ("fills"."quote_lamports" > 0),
	CONSTRAINT "fills_price_positive" CHECK ("fills"."execution_price" > 0),
	CONSTRAINT "fills_fee_nonnegative" CHECK ("fills"."fee_lamports" >= 0),
	CONSTRAINT "fills_cost_removed_nonnegative" CHECK ("fills"."cost_basis_lamports_removed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hourly_results" (
	"id" text PRIMARY KEY NOT NULL,
	"hourly_round_id" text NOT NULL,
	"competition_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"final_settled_balance_lamports" bigint NOT NULL,
	"starting_paper_sol_lamports" bigint NOT NULL,
	"hourly_pnl_lamports" bigint NOT NULL,
	"idempotency_record_id" text NOT NULL,
	"finalized_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hourly_results_competition_account_id_unique" UNIQUE("competition_account_id"),
	CONSTRAINT "hourly_results_idempotency_record_id_unique" UNIQUE("idempotency_record_id"),
	CONSTRAINT "hourly_results_round_account_unique" UNIQUE("hourly_round_id","competition_account_id"),
	CONSTRAINT "hourly_results_pnl_exact" CHECK ("hourly_results"."hourly_pnl_lamports" = "hourly_results"."final_settled_balance_lamports" - "hourly_results"."starting_paper_sol_lamports"),
	CONSTRAINT "hourly_results_final_balance_nonnegative" CHECK ("hourly_results"."final_settled_balance_lamports" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hourly_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at_exclusive" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'SCHEDULED' NOT NULL,
	"starting_paper_sol_lamports" bigint NOT NULL,
	"max_unique_tokens" integer NOT NULL,
	"max_buy_ratio_bps" integer NOT NULL,
	"reward_finalization_grace_period_seconds" integer NOT NULL,
	"rules_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "hourly_rounds_starts_at_unique" UNIQUE("starts_at"),
	CONSTRAINT "hourly_rounds_ends_at_exclusive_unique" UNIQUE("ends_at_exclusive"),
	CONSTRAINT "hourly_rounds_exact_window" CHECK ("hourly_rounds"."starts_at" = date_trunc('hour', "hourly_rounds"."starts_at") and "hourly_rounds"."ends_at_exclusive" = "hourly_rounds"."starts_at" + interval '1 hour'),
	CONSTRAINT "hourly_rounds_state_valid" CHECK ("hourly_rounds"."state" in ('SCHEDULED', 'OPEN', 'CLOSING', 'SETTLING', 'FINALIZED', 'PAYING', 'PAID')),
	CONSTRAINT "hourly_rounds_starting_balance_positive" CHECK ("hourly_rounds"."starting_paper_sol_lamports" > 0),
	CONSTRAINT "hourly_rounds_token_limit_positive" CHECK ("hourly_rounds"."max_unique_tokens" > 0),
	CONSTRAINT "hourly_rounds_buy_ratio_valid" CHECK ("hourly_rounds"."max_buy_ratio_bps" > 0 and "hourly_rounds"."max_buy_ratio_bps" <= 10000),
	CONSTRAINT "hourly_rounds_grace_period_nonnegative" CHECK ("hourly_rounds"."reward_finalization_grace_period_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_class" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"competition_account_id" text,
	"result_entity_type" text,
	"result_entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_operation_key_unique" UNIQUE("operation_class","idempotency_key"),
	CONSTRAINT "idempotency_status_valid" CHECK ("idempotency_records"."status" in ('PENDING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "idempotency_completion_consistent" CHECK (("idempotency_records"."status" = 'PENDING' and "idempotency_records"."completed_at" is null) or ("idempotency_records"."status" <> 'PENDING' and "idempotency_records"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "journal_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_account_id" text NOT NULL,
	"operation_type" text NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" text NOT NULL,
	"idempotency_record_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_transactions_idempotency_record_id_unique" UNIQUE("idempotency_record_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_transaction_id" text NOT NULL,
	"competition_account_id" text NOT NULL,
	"account_code" text NOT NULL,
	"direction" text NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_account_code_valid" CHECK ("ledger_entries"."account_code" in ('CASH', 'POSITION_COST', 'HOURLY_STARTING_CAPITAL', 'TRADING_PNL', 'TRADING_FEES')),
	CONSTRAINT "ledger_entries_direction_valid" CHECK ("ledger_entries"."direction" in ('DEBIT', 'CREDIT')),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_lamports" > 0)
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"base_asset_id" text NOT NULL,
	"quote_asset_id" text NOT NULL,
	"venue" text NOT NULL,
	"provider_market_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_venue_provider_unique" UNIQUE("venue","provider_market_id"),
	CONSTRAINT "markets_distinct_assets" CHECK ("markets"."base_asset_id" <> "markets"."quote_asset_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_account_id" text NOT NULL,
	"market_id" text NOT NULL,
	"side" text NOT NULL,
	"requested_base_units" bigint,
	"requested_quote_lamports" bigint,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"idempotency_record_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	CONSTRAINT "orders_idempotency_record_id_unique" UNIQUE("idempotency_record_id"),
	CONSTRAINT "orders_side_valid" CHECK ("orders"."side" in ('BUY', 'SELL')),
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('PENDING', 'PARTIALLY_FILLED', 'COMPLETED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "orders_request_valid" CHECK (("orders"."side" = 'BUY' and "orders"."requested_quote_lamports" > 0 and "orders"."requested_base_units" is null) or ("orders"."side" = 'SELL' and "orders"."requested_base_units" > 0 and "orders"."requested_quote_lamports" is null))
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_account_id" text NOT NULL,
	"market_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"remaining_base_units" bigint DEFAULT 0 NOT NULL,
	"cost_basis_lamports" bigint DEFAULT 0 NOT NULL,
	"realized_pnl_lamports" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "positions_account_market_unique" UNIQUE("competition_account_id","market_id"),
	CONSTRAINT "positions_quantity_nonnegative" CHECK ("positions"."remaining_base_units" >= 0),
	CONSTRAINT "positions_cost_nonnegative" CHECK ("positions"."cost_basis_lamports" >= 0),
	CONSTRAINT "positions_status_valid" CHECK ("positions"."status" in ('OPEN', 'CLOSED')),
	CONSTRAINT "positions_state_consistent" CHECK (("positions"."status" = 'OPEN' and "positions"."remaining_base_units" > 0 and "positions"."cost_basis_lamports" > 0 and "positions"."closed_at" is null) or ("positions"."status" = 'CLOSED' and "positions"."remaining_base_units" = 0 and "positions"."cost_basis_lamports" = 0 and "positions"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "competition_accounts" ADD CONSTRAINT "competition_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "competition_accounts" ADD CONSTRAINT "competition_accounts_hourly_round_id_hourly_rounds_id_fk" FOREIGN KEY ("hourly_round_id") REFERENCES "public"."hourly_rounds"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "competition_token_slots" ADD CONSTRAINT "competition_token_slots_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "competition_token_slots" ADD CONSTRAINT "competition_token_slots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "daily_result_hourly_results" ADD CONSTRAINT "daily_result_hourly_results_daily_result_id_daily_results_id_fk" FOREIGN KEY ("daily_result_id") REFERENCES "public"."daily_results"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "daily_result_hourly_results" ADD CONSTRAINT "daily_result_hourly_results_hourly_result_id_hourly_results_id_fk" FOREIGN KEY ("hourly_result_id") REFERENCES "public"."hourly_results"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "daily_result_hourly_results" ADD CONSTRAINT "daily_result_hourly_results_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "daily_results" ADD CONSTRAINT "daily_results_daily_competition_id_daily_competitions_id_fk" FOREIGN KEY ("daily_competition_id") REFERENCES "public"."daily_competitions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "daily_results" ADD CONSTRAINT "daily_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "hourly_results" ADD CONSTRAINT "hourly_results_hourly_round_id_hourly_rounds_id_fk" FOREIGN KEY ("hourly_round_id") REFERENCES "public"."hourly_rounds"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "hourly_results" ADD CONSTRAINT "hourly_results_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "hourly_results" ADD CONSTRAINT "hourly_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "hourly_results" ADD CONSTRAINT "hourly_results_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_transaction_id_journal_transactions_id_fk" FOREIGN KEY ("journal_transaction_id") REFERENCES "public"."journal_transactions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_base_asset_id_assets_id_fk" FOREIGN KEY ("base_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_competition_account_id_competition_accounts_id_fk" FOREIGN KEY ("competition_account_id") REFERENCES "public"."competition_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "competition_accounts_round_idx" ON "competition_accounts" USING btree ("hourly_round_id");--> statement-breakpoint
CREATE INDEX "competition_token_slots_account_idx" ON "competition_token_slots" USING btree ("competition_account_id");--> statement-breakpoint
CREATE INDEX "fills_order_time_idx" ON "fills" USING btree ("order_id","executed_at");--> statement-breakpoint
CREATE INDEX "hourly_results_round_idx" ON "hourly_results" USING btree ("hourly_round_id");--> statement-breakpoint
CREATE INDEX "journal_transactions_account_time_idx" ON "journal_transactions" USING btree ("competition_account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_time_idx" ON "ledger_entries" USING btree ("competition_account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "ledger_entries" USING btree ("journal_transaction_id");--> statement-breakpoint
CREATE INDEX "orders_account_time_idx" ON "orders" USING btree ("competition_account_id","requested_at");--> statement-breakpoint
ALTER TABLE "hourly_rounds" ADD CONSTRAINT "hourly_rounds_no_overlap"
EXCLUDE USING gist (tstzrange("starts_at", "ends_at_exclusive", '[)') WITH &&);--> statement-breakpoint
CREATE FUNCTION "enforce_competition_account_round_snapshot"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	round_starting_balance bigint;
BEGIN
	SELECT starting_paper_sol_lamports INTO round_starting_balance
	FROM "hourly_rounds" WHERE id = NEW.hourly_round_id;
	IF NEW.starting_paper_sol_lamports <> round_starting_balance
		OR NEW.paper_sol_balance_lamports <> round_starting_balance THEN
		RAISE EXCEPTION 'competition account must start with its hourly round balance snapshot'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "competition_accounts_round_snapshot"
BEFORE INSERT ON "competition_accounts"
FOR EACH ROW EXECUTE FUNCTION "enforce_competition_account_round_snapshot"();--> statement-breakpoint
CREATE FUNCTION "enforce_position_market_asset"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	market_base_asset_id text;
BEGIN
	SELECT base_asset_id INTO market_base_asset_id FROM "markets" WHERE id = NEW.market_id;
	IF NEW.asset_id <> market_base_asset_id THEN
		RAISE EXCEPTION 'position asset must match its market base asset'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "positions_market_asset_identity"
BEFORE INSERT OR UPDATE ON "positions"
FOR EACH ROW EXECUTE FUNCTION "enforce_position_market_asset"();--> statement-breakpoint
CREATE FUNCTION "enforce_fill_order_identity"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	order_market_id text;
	order_side text;
BEGIN
	SELECT market_id, side INTO order_market_id, order_side FROM "orders" WHERE id = NEW.order_id;
	IF NEW.market_id <> order_market_id OR NEW.side <> order_side THEN
		RAISE EXCEPTION 'fill market and side must match its order'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "fills_order_identity"
BEFORE INSERT ON "fills"
FOR EACH ROW EXECUTE FUNCTION "enforce_fill_order_identity"();--> statement-breakpoint
CREATE FUNCTION "reject_financial_history_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "competition_token_slots_immutable"
BEFORE UPDATE OR DELETE ON "competition_token_slots"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "fills_immutable"
BEFORE UPDATE OR DELETE ON "fills"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "hourly_results_immutable"
BEFORE UPDATE OR DELETE ON "hourly_results"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "daily_result_hourly_results_immutable"
BEFORE UPDATE OR DELETE ON "daily_result_hourly_results"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "journal_transactions_immutable"
BEFORE UPDATE OR DELETE ON "journal_transactions"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_immutable"
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE FUNCTION "enforce_balanced_journal"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	journal_id text;
	journal_account_id text;
	entry_count bigint;
	debit_total numeric;
	credit_total numeric;
	mismatched_account_count bigint;
BEGIN
	journal_id := NEW.journal_transaction_id;
	SELECT
		jt.competition_account_id,
		COUNT(le.id),
		COALESCE(SUM(le.amount_lamports) FILTER (WHERE le.direction = 'DEBIT'), 0),
		COALESCE(SUM(le.amount_lamports) FILTER (WHERE le.direction = 'CREDIT'), 0),
		COUNT(le.id) FILTER (WHERE le.competition_account_id <> jt.competition_account_id)
	INTO
		journal_account_id,
		entry_count,
		debit_total,
		credit_total,
		mismatched_account_count
	FROM "journal_transactions" jt
	LEFT JOIN "ledger_entries" le ON le.journal_transaction_id = jt.id
	WHERE jt.id = journal_id
	GROUP BY jt.competition_account_id;

	IF journal_account_id IS NULL THEN
		RAISE EXCEPTION 'journal transaction % does not exist', journal_id
			USING ERRCODE = 'foreign_key_violation';
	END IF;
	IF mismatched_account_count <> 0 THEN
		RAISE EXCEPTION 'journal transaction % contains entries for another competition account', journal_id
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	IF entry_count < 2 OR debit_total <= 0 OR debit_total <> credit_total THEN
		RAISE EXCEPTION 'journal transaction % is not balanced (entries %, debits %, credits %)',
			journal_id, entry_count, debit_total, credit_total
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_balanced_journal"
AFTER INSERT ON "ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_balanced_journal"();--> statement-breakpoint
CREATE FUNCTION "enforce_hourly_result_identity"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_row "competition_accounts"%ROWTYPE;
BEGIN
	SELECT * INTO account_row FROM "competition_accounts" WHERE id = NEW.competition_account_id;
	IF account_row.hourly_round_id <> NEW.hourly_round_id
		OR account_row.user_id <> NEW.user_id
		OR account_row.starting_paper_sol_lamports <> NEW.starting_paper_sol_lamports
		OR account_row.final_settled_balance_lamports <> NEW.final_settled_balance_lamports
		OR account_row.hourly_pnl_lamports <> NEW.hourly_pnl_lamports THEN
		RAISE EXCEPTION 'hourly result does not match its competition account'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "hourly_results_identity"
BEFORE INSERT ON "hourly_results"
FOR EACH ROW EXECUTE FUNCTION "enforce_hourly_result_identity"();--> statement-breakpoint
CREATE FUNCTION "enforce_daily_contribution_identity"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	daily_user_id text;
	daily_starts_at timestamptz;
	daily_ends_at timestamptz;
	hourly_user_id text;
	hourly_starts_at timestamptz;
BEGIN
	SELECT dr.user_id, dc.starts_at, dc.ends_at_exclusive
	INTO daily_user_id, daily_starts_at, daily_ends_at
	FROM "daily_results" dr
	JOIN "daily_competitions" dc ON dc.id = dr.daily_competition_id
	WHERE dr.id = NEW.daily_result_id;

	SELECT hr.user_id, r.starts_at
	INTO hourly_user_id, hourly_starts_at
	FROM "hourly_results" hr
	JOIN "hourly_rounds" r ON r.id = hr.hourly_round_id
	WHERE hr.id = NEW.hourly_result_id;

	IF daily_user_id <> hourly_user_id
		OR hourly_starts_at < daily_starts_at
		OR hourly_starts_at >= daily_ends_at THEN
		RAISE EXCEPTION 'hourly result does not belong to the daily result UTC window'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "daily_result_hourly_results_identity"
BEFORE INSERT ON "daily_result_hourly_results"
FOR EACH ROW EXECUTE FUNCTION "enforce_daily_contribution_identity"();
