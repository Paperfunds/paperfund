-- Candidate only. No automatic conversion or rewrite of historical approvals.
CREATE TABLE payout_approval_snapshots (
  approval_id text PRIMARY KEY REFERENCES payout_plan_approvals(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_version text NOT NULL CHECK (snapshot_version = 'paperfund-approved-payout-v2'),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payout_approval_snapshots_immutable BEFORE UPDATE OR DELETE
ON payout_approval_snapshots FOR EACH ROW EXECUTE FUNCTION reject_payout_detail_change();
