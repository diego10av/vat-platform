-- Migration 023 — partner review toggle + lifecycle stamps
--
-- Diego 2026-04-22: "si es que lo hace es el trabajador último,
-- perfecto. Si lo hace un associate y luego lo tiene que revisar el
-- partner, habría que meter algo para que se pudiese revisar bien."
--
-- Feature-flagged per entity. When `requires_partner_review` is true,
-- the lifecycle gains an intermediate `pending_review` state between
-- `review` and `approved`:
--
--   review  → (associate submits)  → pending_review
--   pending_review → (partner approves) → approved
--   pending_review → (associate recalls) → review
--
-- The two-person rule is enforced in the PATCH handler:
-- `partner_approved_by` must differ from `submitted_by` (you cannot
-- approve your own preparation).
--
-- Default false → zero impact on existing declarations / entities.
-- Idempotent.

BEGIN;

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS requires_partner_review boolean NOT NULL DEFAULT false;

ALTER TABLE declarations
  ADD COLUMN IF NOT EXISTS submitted_for_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by text,
  ADD COLUMN IF NOT EXISTS partner_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_approved_by text;

-- Index for queries that want to surface "my submissions awaiting
-- partner" on an admin dashboard later.
CREATE INDEX IF NOT EXISTS declarations_pending_review_idx
  ON declarations(submitted_by, submitted_for_review_at DESC)
  WHERE status = 'pending_review';

COMMIT;
