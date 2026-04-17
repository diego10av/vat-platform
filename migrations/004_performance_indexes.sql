-- ═══════════════════════════════════════════════════════════════════════
-- Migration 004 · Performance indexes for hot-path queries.
--
-- Adds indexes the code already assumes exist on the most-hit columns.
-- Without these, every declaration detail page + entity timeline page
-- does a seq-scan proportional to total line count in the DB. One
-- customer with 10k lines → every page load reads 10k rows.
--
-- All indexes CREATE IF NOT EXISTS — idempotent + safe to re-run.
-- Adding indexes on a live table can take a few seconds; negligible at
-- our current scale.
--
-- Context: audit from 2026-04-18 (see docs/PERFORMANCE.md) identified
-- 8 hotspots. The 6 below are pure-index fixes (zero code change).
-- The 2 N+1 fixes require query rewrites, documented separately.
--
-- NOT using CREATE INDEX CONCURRENTLY — that requires being outside a
-- transaction which the Supabase SQL Editor doesn't do by default.
-- At our current row counts a brief lock is fine. Switch to
-- CONCURRENTLY in a follow-up when table size demands.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── invoice_lines: declaration_id is the primary filter on every
-- detail page query. Also filter by state='deleted' when rendering.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_declaration_state
  ON invoice_lines(declaration_id, state);

-- ── invoice_lines.treatment used in precedent lookups + classifier
-- replay. Index on treatment alone is too broad; compound with declaration.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_declaration_treatment
  ON invoice_lines(declaration_id, treatment)
  WHERE treatment IS NOT NULL;

-- ── invoices.declaration_id — every invoice query filters on it.
CREATE INDEX IF NOT EXISTS idx_invoices_declaration
  ON invoices(declaration_id);

-- ── invoices.provider filtered by entity (via declaration JOIN) on
-- the entity timeline page. Direct index on the FK is enough with
-- planner's merge join.
CREATE INDEX IF NOT EXISTS idx_invoices_direction
  ON invoices(direction);

-- ── declarations.entity_id — every entity page + deadlines loop.
CREATE INDEX IF NOT EXISTS idx_declarations_entity
  ON declarations(entity_id);

-- ── declarations status filter (home dashboard, /declarations list).
CREATE INDEX IF NOT EXISTS idx_declarations_status_updated
  ON declarations(status, updated_at DESC);

-- ── documents.declaration_id — documents tab + stats aggregation.
CREATE INDEX IF NOT EXISTS idx_documents_declaration
  ON documents(declaration_id);

-- ── audit_log target lookups (entity / declaration timeline + audit page).
CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON audit_log(target_type, target_id, created_at DESC);

-- ── audit_log action filter (audit page).
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log(action, created_at DESC);

-- ── aed_letters by entity + status (inbox + entity page).
CREATE INDEX IF NOT EXISTS idx_aed_letters_entity_status
  ON aed_letters(entity_id, status);

-- ── aed_letters urgency filter (home dashboard, inbox).
CREATE INDEX IF NOT EXISTS idx_aed_letters_urgency
  ON aed_letters(urgency, status)
  WHERE urgency IN ('high', 'medium');

-- ── precedents by (entity_id, provider, country) — the exact lookup
-- shape in upsertPrecedentsFromDeclaration. Table already has a UNIQUE
-- constraint on this tuple per earlier setup; this makes the lookup
-- path explicit. CREATE IF NOT EXISTS is a no-op if the unique already
-- provides this index, so safe.
CREATE INDEX IF NOT EXISTS idx_precedents_entity_provider_country
  ON precedents(entity_id, provider, country);

-- ── api_calls cumulative-spend query (budget guard runs this on every
-- agent call). Scan needs to be on (created_at) month boundary with
-- status filter. Partial index excludes error rows (the guard does the
-- same in WHERE).
CREATE INDEX IF NOT EXISTS idx_api_calls_month_status
  ON api_calls(created_at DESC)
  WHERE status != 'error';

-- ── api_calls by-agent aggregation on /metrics (cost by agent).
CREATE INDEX IF NOT EXISTS idx_api_calls_agent_created
  ON api_calls(agent, created_at DESC);

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
-- After running, check planner uses the new indexes:
--   EXPLAIN SELECT * FROM invoice_lines WHERE declaration_id = 'x';
--   EXPLAIN SELECT * FROM declarations WHERE entity_id = 'y' ORDER BY year DESC;
--
-- List all indexes on a table:
--   \d+ invoice_lines
