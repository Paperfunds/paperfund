ALTER TABLE chart_fill_fx_evidence DROP CONSTRAINT chart_fill_fx_evidence_check;
--> statement-breakpoint
ALTER TABLE chart_fill_fx_evidence ADD CONSTRAINT chart_fill_fx_evidence_timestamp_policy CHECK (
  (version = 'CAPTURED_EXECUTION_FX_V1' AND abs(extract(epoch from (fx_at-executed_at))) <= 5)
  OR (version <> 'CAPTURED_EXECUTION_FX_V1' AND fx_at >= date_trunc('second',executed_at)
    AND fx_at <= date_trunc('second',executed_at)+interval '5 seconds')
);
--> statement-breakpoint
CREATE TABLE chart_fill_fx_capture_failures (
  fill_id text NOT NULL REFERENCES fills(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version text NOT NULL,
  status text NOT NULL CHECK (status = 'UNAVAILABLE'),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fill_id,version)
);
--> statement-breakpoint
CREATE TRIGGER chart_fill_fx_capture_failures_immutable
BEFORE UPDATE OR DELETE ON chart_fill_fx_capture_failures
FOR EACH ROW EXECUTE FUNCTION reject_financial_history_mutation();
