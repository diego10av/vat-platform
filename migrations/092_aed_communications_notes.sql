-- ════════════════════════════════════════════════════════════════════════
-- Migration 092 — aed_communications.notes
--
-- Applied via Supabase MCP on 2026-05-17. This file mirrors the migration
-- for repo trackability.
--
-- Diego's dogfood reality: when an AED letter arrives, cifra extracts
-- a summary + next_action via Haiku, but neither is editable. Diego
-- has zero place to write running notes ("emailed client 17/5,
-- waiting reply", "Maria forwarded the invoices, draft response
-- pending"). Today that information lives in a sticky note or
-- another app, breaking cifra as source of truth.
--
-- Fix: a single nullable notes column. The PATCH whitelist (see
-- src/app/api/aed/[id]/route.ts) gains `notes` + `next_action` so
-- Diego can also override Haiku's suggested next step when he
-- disagrees.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE aed_communications
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN aed_communications.notes IS
  'Free-text notes from Diego about chasing / responding to this letter. Distinct from `next_action` which is Haiku''s extracted suggestion. Updated via inline-edit on /aed-letters.';
