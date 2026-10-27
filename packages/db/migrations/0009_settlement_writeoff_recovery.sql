-- Append-only evidence for legacy write-offs whose immutable journal omitted quantity metadata.
-- No cash, position, fill or original journal is rewritten.
CREATE TABLE settlement_writeoff_metadata_repairs (
  journal_transaction_id text PRIMARY KEY REFERENCES journal_transactions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  token_quantity numeric(38,0) NOT NULL CHECK (token_quantity > 0),
  cost_basis_lamports bigint NOT NULL CHECK (cost_basis_lamports >= 0),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TRIGGER settlement_writeoff_metadata_repairs_immutable
BEFORE UPDATE OR DELETE ON settlement_writeoff_metadata_repairs
FOR EACH ROW EXECUTE FUNCTION reject_financial_history_mutation();
