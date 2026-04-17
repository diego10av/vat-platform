-- ═══════════════════════════════════════════════════════════════════════
-- Migration 002 · In-product feedback table.
--
-- Backs the "Report issue" floating button. Every submission captures:
--   - who reported (user_id, optional — may be null for pre-auth pages)
--   - where (url at time of report)
--   - what (category + severity + message)
--   - context (user_agent, entity_id / declaration_id inferred from url)
--   - status (new → triaged → resolved)
--
-- IDEMPOTENT: guarded by IF NOT EXISTS. Safe to re-run.
-- Author: Claude (2026-04-18)
-- Required by: POST /api/feedback, /settings/feedback admin view.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  -- Null when the user is on a public page (portal) or pre-auth.
  user_id        TEXT,
  -- Where they were when they hit the button.
  url            TEXT NOT NULL,
  -- Context auto-inferred from url + app state.
  entity_id      TEXT REFERENCES entities(id) ON DELETE SET NULL,
  declaration_id TEXT REFERENCES declarations(id) ON DELETE SET NULL,
  user_agent     TEXT,
  -- What they said.
  category       TEXT NOT NULL CHECK (category IN ('bug', 'ux', 'feature', 'question', 'other')),
  severity       TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  message        TEXT NOT NULL,
  -- Optional free-form contact if submitter wants a reply (email or
  -- slack handle). Keeps the widget friendly for partner/customer
  -- testing without forcing them into a full support system.
  contact        TEXT,
  -- Triage state.
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'resolved', 'wontfix')),
  -- Admin response / note (shown on the admin page).
  resolution_note TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ
);

-- Hot path for the admin page: "what's new?" ordered by time desc.
CREATE INDEX IF NOT EXISTS idx_feedback_status_created
  ON feedback(status, created_at DESC);

-- Context lookups for the entity / declaration timeline pages.
CREATE INDEX IF NOT EXISTS idx_feedback_entity
  ON feedback(entity_id) WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_declaration
  ON feedback(declaration_id) WHERE declaration_id IS NOT NULL;

-- updated_at auto-touch — reuses touch_updated_at() from migration 001.
-- If migration 001 hasn't been applied yet, we recreate the helper
-- inline so 002 can stand alone too.
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_touch_updated_at ON feedback;
CREATE TRIGGER trg_feedback_touch_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
-- SELECT count(*) FROM feedback;
-- \d feedback
