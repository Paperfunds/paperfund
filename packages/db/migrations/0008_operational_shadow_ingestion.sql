ALTER TABLE "creator_fee_observations"
  ADD COLUMN "shadow_mode" boolean DEFAULT false NOT NULL;

ALTER TABLE "creator_fee_ingestion_checkpoints"
  ADD COLUMN "shadow_mode" boolean DEFAULT false NOT NULL,
  ADD COLUMN "poll_count" bigint DEFAULT 0 NOT NULL CHECK ("poll_count" >= 0),
  ADD COLUMN "candidate_count" bigint DEFAULT 0 NOT NULL CHECK ("candidate_count" >= 0),
  ADD COLUMN "verified_count" bigint DEFAULT 0 NOT NULL CHECK ("verified_count" >= 0),
  ADD COLUMN "rejected_count" bigint DEFAULT 0 NOT NULL CHECK ("rejected_count" >= 0),
  ADD COLUMN "retry_error_count" bigint DEFAULT 0 NOT NULL CHECK ("retry_error_count" >= 0),
  ADD COLUMN "max_observed_lag_slots" bigint DEFAULT 0 NOT NULL CHECK ("max_observed_lag_slots" >= 0);
