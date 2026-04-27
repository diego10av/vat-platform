-- Stint 56.A — multi-stakeholder sign-off on tasks.
--
-- Diego: "yo le encomiende a alguien que esté encima pero aun así
-- yo tengo que estar encima de esa persona". Big4 standard cascade:
--
--   Preparer  →  Reviewer  →  Partner sign-off
--
-- The `assignee` column (text, who is doing it day-to-day) stays as
-- it was. The three new fields capture the formal sign-off chain
-- with timestamps, mirroring the pattern already in tax_filings
-- (draft_sent_at / client_approved_at / filed_at). Each role has a
-- `<role>` (signer name) and `<role>_at` (timestamp).
--
-- API enforces the cascade — see /api/tax-ops/tasks/[id]/sign:
--   - reviewer requires preparer signed
--   - partner requires reviewer signed
--   - re-firmar de un mismo signer = unsign (toggle)
--   - cada firma escribe audit_log row task_signed_<role>

ALTER TABLE tax_ops_tasks
  ADD COLUMN IF NOT EXISTS preparer            TEXT,
  ADD COLUMN IF NOT EXISTS preparer_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewer            TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_sign_off    TEXT,
  ADD COLUMN IF NOT EXISTS partner_sign_off_at TIMESTAMPTZ;

COMMENT ON COLUMN tax_ops_tasks.preparer IS
  'Stint 56.A — name (text) of the preparer who signed the task. NULL = not signed yet.';
COMMENT ON COLUMN tax_ops_tasks.reviewer IS
  'Stint 56.A — name of the reviewer. Cannot be set until preparer is set.';
COMMENT ON COLUMN tax_ops_tasks.partner_sign_off IS
  'Stint 56.A — partner sign-off name. Final stage; cannot be set until reviewer is set.';
