CREATE TABLE "creator_fee_ingestion_checkpoints" (
  "source_id" text PRIMARY KEY NOT NULL,
  "network" text NOT NULL,
  "token_mint" text NOT NULL,
  "creator_wallet" text NOT NULL,
  "latest_signature" text,
  "latest_slot" bigint,
  "last_finalized_slot" bigint,
  "last_success_at" timestamptz,
  "last_error_category" text,
  "last_error_detail" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "creator_fee_ingestion_checkpoint_slot_nonnegative" CHECK (
    ("latest_slot" IS NULL OR "latest_slot" >= 0)
    AND ("last_finalized_slot" IS NULL OR "last_finalized_slot" >= 0)
  )
);

CREATE TABLE "creator_fee_observations" (
  "id" text PRIMARY KEY NOT NULL,
  "transaction_signature" text NOT NULL,
  "event_index" integer NOT NULL CHECK ("event_index" >= 0),
  "slot" bigint NOT NULL CHECK ("slot" >= 0),
  "block_time" timestamptz NOT NULL,
  "source_program" text NOT NULL,
  "token_mint" text NOT NULL,
  "creator_wallet" text NOT NULL,
  "creator_fee_lamports" bigint NOT NULL CHECK ("creator_fee_lamports" > 0),
  "confirmation_status" text NOT NULL CHECK (
    "confirmation_status" IN ('OBSERVED','CONFIRMED','FINALIZED','ROLLED_BACK','RECONCILIATION_REQUIRED')
  ),
  "missing_status_checks" integer DEFAULT 0 NOT NULL CHECK ("missing_status_checks" >= 0),
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "first_observed_at" timestamptz NOT NULL,
  "last_checked_at" timestamptz NOT NULL,
  "finalized_at" timestamptz,
  "canonical_creator_fee_event_id" text UNIQUE REFERENCES "creator_fee_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "creator_fee_observations_chain_identity_unique" UNIQUE("transaction_signature","event_index")
);
CREATE INDEX "creator_fee_observations_status_slot_idx"
  ON "creator_fee_observations" ("confirmation_status","slot");

CREATE TABLE "creator_fee_reconciliation_findings" (
  "id" text PRIMARY KEY NOT NULL,
  "creator_fee_observation_id" text NOT NULL REFERENCES "creator_fee_observations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "category" text NOT NULL CHECK (
    "category" IN ('FINALIZED_TRANSACTION_MISSING','FINALIZED_EVIDENCE_CHANGED','CANONICAL_EVENT_MISSING','CANONICAL_EVENT_MISMATCH')
  ),
  "detail" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL CHECK ("status" IN ('OPEN','RESOLVED')),
  "detected_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "resolution_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "creator_fee_reconciliation_finding_unique" UNIQUE("creator_fee_observation_id","category")
);

