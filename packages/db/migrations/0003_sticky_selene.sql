ALTER TABLE "order_market_state_evidence" DROP CONSTRAINT "order_market_state_evidence_purpose_valid";--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "actual_output_lamports" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "execution_context" text DEFAULT 'NORMAL_USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_actual_output_positive" CHECK ("fills"."actual_output_lamports" is null or "fills"."actual_output_lamports" > 0);--> statement-breakpoint
ALTER TABLE "order_market_state_evidence" ADD CONSTRAINT "order_market_state_evidence_purpose_valid" CHECK ("order_market_state_evidence"."purpose" in ('BUY_EXECUTION', 'SELL_EXECUTION', 'POSITION_EXIT_VALUATION'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_execution_context_valid" CHECK ("orders"."execution_context" in ('NORMAL_USER', 'FORCED_HOURLY_SETTLEMENT'));