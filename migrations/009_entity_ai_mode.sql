-- ════════════════════════════════════════════════════════════════════════
-- 009_entity_ai_mode.sql
--
-- Adds a per-entity AI mode toggle. This is the product-visible answer
-- to the "compliance officer says we can't use Claude" objection that
-- Diego surfaced in his first customer discovery meeting (2026-04-18).
--
-- Values:
--
--   'full' (default)  — cifra runs the full stack: PDF extraction via
--                       Claude Haiku, deterministic classifier, optional
--                       Opus second-opinion validator, chat assistant.
--                       Recommended for most boutique tax/fiduciary firms.
--
--   'classifier_only' — cifra only runs the deterministic rules-based
--                       classifier (32+ LTVA/CJEU rules). No Anthropic
--                       calls. PDF extraction and validator become
--                       "manual entry" flows. Entity-level kill-switch
--                       for organisations with strict AI policies.
--
-- Code gates this flag:
--   - /api/agents/extract   refuses with explanatory 409 if ai_mode = 'classifier_only'
--   - /api/agents/validate  same
--   - /api/chat/stream      same
--   - classify.ts           always runs (no AI in it)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS ai_mode TEXT NOT NULL DEFAULT 'full';

-- Hygiene: a CHECK constraint so the column only holds known modes.
-- Idempotent: drop-if-exists then add.
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_ai_mode_check;
ALTER TABLE entities
  ADD CONSTRAINT entities_ai_mode_check
  CHECK (ai_mode IN ('full', 'classifier_only'));
