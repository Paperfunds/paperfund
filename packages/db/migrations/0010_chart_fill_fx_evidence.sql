CREATE TABLE chart_fill_fx_evidence (
  fill_id text NOT NULL REFERENCES fills(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version text NOT NULL,
  executed_at timestamptz NOT NULL,
  source text NOT NULL,
  fx_at timestamptz NOT NULL,
  rate numeric(38,18) NOT NULL CHECK (rate > 0),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fill_id,version),
  CHECK (fx_at >= date_trunc('second',executed_at) AND fx_at <= date_trunc('second',executed_at)+interval '5 seconds')
);
--> statement-breakpoint
CREATE TRIGGER chart_fill_fx_evidence_immutable
BEFORE UPDATE OR DELETE ON chart_fill_fx_evidence
FOR EACH ROW EXECUTE FUNCTION reject_financial_history_mutation();
