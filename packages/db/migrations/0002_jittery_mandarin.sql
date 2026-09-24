CREATE TABLE "market_state_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"protocol_id" text NOT NULL,
	"market_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"chain_slot" bigint,
	"chain_block_id" text,
	"adapter_version" text NOT NULL,
	"normalization_version" text NOT NULL,
	"normalized_state" jsonb NOT NULL,
	"raw_source" jsonb,
	"state_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_state_evidence_state_fingerprint_unique" UNIQUE("state_fingerprint"),
	CONSTRAINT "market_state_evidence_protocol_nonempty" CHECK (length("market_state_evidence"."protocol_id") > 0),
	CONSTRAINT "market_state_evidence_adapter_nonempty" CHECK (length("market_state_evidence"."adapter_version") > 0),
	CONSTRAINT "market_state_evidence_normalization_nonempty" CHECK (length("market_state_evidence"."normalization_version") > 0)
);
--> statement-breakpoint
CREATE TABLE "order_market_state_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"purpose" text NOT NULL,
	"position_id" text,
	"executable_value_lamports" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_market_state_evidence_usage_unique" UNIQUE("order_id","evidence_id","purpose","position_id"),
	CONSTRAINT "order_market_state_evidence_purpose_valid" CHECK ("order_market_state_evidence"."purpose" in ('BUY_EXECUTION', 'POSITION_EXIT_VALUATION')),
	CONSTRAINT "order_market_state_evidence_value_nonnegative" CHECK ("order_market_state_evidence"."executable_value_lamports" is null or "order_market_state_evidence"."executable_value_lamports" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "actual_input_lamports" bigint;--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "fee_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "protocol_id" text;--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "adapter_version" text;--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "market_state_evidence_id" text;--> statement-breakpoint
ALTER TABLE "market_state_evidence" ADD CONSTRAINT "market_state_evidence_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_market_state_evidence" ADD CONSTRAINT "order_market_state_evidence_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_market_state_evidence" ADD CONSTRAINT "order_market_state_evidence_evidence_id_market_state_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."market_state_evidence"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_market_state_evidence" ADD CONSTRAINT "order_market_state_evidence_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "market_state_evidence_market_time_idx" ON "market_state_evidence" USING btree ("market_id","observed_at");--> statement-breakpoint
CREATE INDEX "order_market_state_evidence_order_idx" ON "order_market_state_evidence" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_market_state_evidence_id_market_state_evidence_id_fk" FOREIGN KEY ("market_state_evidence_id") REFERENCES "public"."market_state_evidence"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_actual_input_positive" CHECK ("fills"."actual_input_lamports" is null or "fills"."actual_input_lamports" > 0);
--> statement-breakpoint
CREATE TRIGGER "market_state_evidence_immutable"
BEFORE UPDATE OR DELETE ON "market_state_evidence"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_market_state_evidence_immutable"
BEFORE UPDATE OR DELETE ON "order_market_state_evidence"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_mutation"();
