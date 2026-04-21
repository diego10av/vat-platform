-- Migration 022 — AI triage columns on legal_watch_queue
--
-- Context (Diego, 2026-04-22): the legal-watch scanner currently
-- surfaces candidate jurisprudence / AED notices and the reviewer
-- triages manually (flag / dismiss / escalate). An Opus 4.7
-- auto-triage agent can now pre-read each item, decide severity,
-- propose which existing RULE(s) are affected, and explain why.
-- The reviewer goes from "triage every item from scratch" to
-- "confirm or adjust the AI's proposal" — minutes → seconds.
--
-- Columns added:
--   ai_triage_severity         — one of 'critical'|'high'|'medium'|'low'|null
--   ai_triage_affected_rules   — text[] of rule ids like 'RULE 36' that the
--                                item potentially affects
--   ai_triage_summary          — 1-2 sentence summary of why it matters
--   ai_triage_proposed_action  — free-text proposed reviewer action
--   ai_triage_confidence       — 0.0-1.0 Opus-reported confidence
--   ai_triage_model            — model id (e.g. 'claude-opus-4-7')
--   ai_triage_at               — when the AI triage ran
--
-- The reviewer-facing 'status' field (new/flagged/dismissed/escalated)
-- remains the source of truth. AI triage is advisory: a reviewer can
-- accept the AI's severity by just clicking the matching triage
-- button, or override it. The combination (AI suggestion + human
-- confirmation) is the defensibility story — same as the classifier.
--
-- Idempotent.

BEGIN;

ALTER TABLE legal_watch_queue
  ADD COLUMN IF NOT EXISTS ai_triage_severity       TEXT,
  ADD COLUMN IF NOT EXISTS ai_triage_affected_rules TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_triage_summary        TEXT,
  ADD COLUMN IF NOT EXISTS ai_triage_proposed_action TEXT,
  ADD COLUMN IF NOT EXISTS ai_triage_confidence     NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS ai_triage_model          TEXT,
  ADD COLUMN IF NOT EXISTS ai_triage_at             TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'legal_watch_queue_ai_triage_severity_valid'
  ) THEN
    ALTER TABLE legal_watch_queue
      ADD CONSTRAINT legal_watch_queue_ai_triage_severity_valid
      CHECK (ai_triage_severity IS NULL
          OR ai_triage_severity IN ('critical', 'high', 'medium', 'low'));
  END IF;
END $$;

-- Index on the severity so the reviewer UI can sort "critical first"
-- without scanning the whole queue.
CREATE INDEX IF NOT EXISTS legal_watch_queue_severity_idx
  ON legal_watch_queue(ai_triage_severity)
  WHERE ai_triage_severity IS NOT NULL;

COMMIT;
