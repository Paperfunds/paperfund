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
CREATE TABLE "competition_seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"initial_allocation_lamports" bigint NOT NULL,
	"rules_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "competition_seasons_time_order" CHECK ("competition_seasons"."starts_at" < "competition_seasons"."ends_at"),
	CONSTRAINT "competition_seasons_status_valid" CHECK ("competition_seasons"."status" in ('SCHEDULED', 'OPEN', 'FINALIZING', 'FINALIZED')),
	CONSTRAINT "competition_seasons_initial_allocation_positive" CHECK ("competition_seasons"."initial_allocation_lamports" > 0)
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
CREATE TABLE "idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_class" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"season_account_id" text,
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
	"season_account_id" text NOT NULL,
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
	"season_account_id" text NOT NULL,
	"account_code" text NOT NULL,
	"direction" text NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_account_code_valid" CHECK ("ledger_entries"."account_code" in ('CASH', 'POSITION_COST', 'STARTING_CAPITAL', 'TOP_UP_CAPITAL', 'TRADING_PNL', 'TRADING_FEES')),
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
	"season_account_id" text NOT NULL,
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
	"season_account_id" text NOT NULL,
	"market_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"remaining_base_units" bigint DEFAULT 0 NOT NULL,
	"cost_basis_lamports" bigint DEFAULT 0 NOT NULL,
	"realized_pnl_lamports" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "positions_account_market_unique" UNIQUE("season_account_id","market_id"),
	CONSTRAINT "positions_quantity_nonnegative" CHECK ("positions"."remaining_base_units" >= 0),
	CONSTRAINT "positions_cost_nonnegative" CHECK ("positions"."cost_basis_lamports" >= 0),
	CONSTRAINT "positions_status_valid" CHECK ("positions"."status" in ('OPEN', 'CLOSED')),
	CONSTRAINT "positions_state_consistent" CHECK (("positions"."status" = 'OPEN' and "positions"."remaining_base_units" > 0 and "positions"."cost_basis_lamports" > 0 and "positions"."closed_at" is null) or ("positions"."status" = 'CLOSED' and "positions"."remaining_base_units" = 0 and "positions"."cost_basis_lamports" = 0 and "positions"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "season_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"season_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"initial_allocation_lamports" bigint NOT NULL,
	"cumulative_top_up_lamports" bigint DEFAULT 0 NOT NULL,
	"cash_balance_lamports" bigint DEFAULT 0 NOT NULL,
	"realized_pnl_lamports" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "season_accounts_user_season_unique" UNIQUE("user_id","season_id"),
	CONSTRAINT "season_accounts_status_valid" CHECK ("season_accounts"."status" in ('ACTIVE', 'FINALIZED')),
	CONSTRAINT "season_accounts_initial_allocation_nonnegative" CHECK ("season_accounts"."initial_allocation_lamports" >= 0),
	CONSTRAINT "season_accounts_top_up_nonnegative" CHECK ("season_accounts"."cumulative_top_up_lamports" >= 0),
	CONSTRAINT "season_accounts_cash_nonnegative" CHECK ("season_accounts"."cash_balance_lamports" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_season_account_id_season_accounts_id_fk" FOREIGN KEY ("season_account_id") REFERENCES "public"."season_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_season_account_id_season_accounts_id_fk" FOREIGN KEY ("season_account_id") REFERENCES "public"."season_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_transaction_id_journal_transactions_id_fk" FOREIGN KEY ("journal_transaction_id") REFERENCES "public"."journal_transactions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_season_account_id_season_accounts_id_fk" FOREIGN KEY ("season_account_id") REFERENCES "public"."season_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_base_asset_id_assets_id_fk" FOREIGN KEY ("base_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_season_account_id_season_accounts_id_fk" FOREIGN KEY ("season_account_id") REFERENCES "public"."season_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_record_id_idempotency_records_id_fk" FOREIGN KEY ("idempotency_record_id") REFERENCES "public"."idempotency_records"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_season_account_id_season_accounts_id_fk" FOREIGN KEY ("season_account_id") REFERENCES "public"."season_accounts"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "season_accounts" ADD CONSTRAINT "season_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "season_accounts" ADD CONSTRAINT "season_accounts_season_id_competition_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."competition_seasons"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fills_order_time_idx" ON "fills" USING btree ("order_id","executed_at");--> statement-breakpoint
CREATE INDEX "journal_transactions_account_time_idx" ON "journal_transactions" USING btree ("season_account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_time_idx" ON "ledger_entries" USING btree ("season_account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "ledger_entries" USING btree ("journal_transaction_id");--> statement-breakpoint
CREATE INDEX "orders_account_time_idx" ON "orders" USING btree ("season_account_id","requested_at");--> statement-breakpoint
CREATE INDEX "season_accounts_season_idx" ON "season_accounts" USING btree ("season_id");--> statement-breakpoint
CREATE FUNCTION "reject_financial_history_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "journal_transactions_immutable"
BEFORE UPDATE OR DELETE ON "journal_transactions"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_immutable"
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "fills_immutable"
BEFORE UPDATE OR DELETE ON "fills"
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
	journal_id := COALESCE(NEW.journal_transaction_id, OLD.journal_transaction_id);

	SELECT
		jt.season_account_id,
		COUNT(le.id),
		COALESCE(SUM(le.amount_lamports) FILTER (WHERE le.direction = 'DEBIT'), 0),
		COALESCE(SUM(le.amount_lamports) FILTER (WHERE le.direction = 'CREDIT'), 0),
		COUNT(le.id) FILTER (WHERE le.season_account_id <> jt.season_account_id)
	INTO
		journal_account_id,
		entry_count,
		debit_total,
		credit_total,
		mismatched_account_count
	FROM "journal_transactions" jt
	LEFT JOIN "ledger_entries" le ON le.journal_transaction_id = jt.id
	WHERE jt.id = journal_id
	GROUP BY jt.season_account_id;

	IF journal_account_id IS NULL THEN
		RAISE EXCEPTION 'journal transaction % does not exist', journal_id
			USING ERRCODE = 'foreign_key_violation';
	END IF;

	IF mismatched_account_count <> 0 THEN
		RAISE EXCEPTION 'journal transaction % contains entries for another season account', journal_id
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
FOR EACH ROW EXECUTE FUNCTION "enforce_balanced_journal"();
