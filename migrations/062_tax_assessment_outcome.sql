-- ════════════════════════════════════════════════════════════════════════
-- Migration 062 — tax_assessment_outcome on tax_filings (stint 44.F3)
--
-- Diego: "Assessment tiene que aparecer dos opciones: not received yet
-- (default), recibido y aligned. Y si no estuviese aligned, otra
-- opción tipo received under audit / clarifications."
--
-- Adds a tri-state outcome category to the prior-year CIT assessment
-- column on /tax-ops/cit. Backed by a new TEXT column with a CHECK
-- constraint. NULL = not yet received (no chip beyond "Not yet"); set
-- means we have an outcome category to display.
--
--   - 'aligned'      → AED assessment matches our return. ✓ green chip.
--   - 'under_audit'  → AED is auditing or asking clarifications. ⚠ amber chip.
--   - NULL           → either not received yet, or received but not yet
--                      categorised. The existing tax_assessment_received_at
--                      date stays the source of truth for "received yes/no".
--
-- Display in AssessmentInlineEditor:
--   - no date          → "Not yet" amber chip
--   - date + aligned   → "✓ Aligned · DATE" green chip
--   - date + under_audit → "⚠ Under audit · DATE" orange chip
--   - date + NULL outcome → fall back to "✓ Received · DATE" (legacy)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE tax_filings
  ADD COLUMN IF NOT EXISTS tax_assessment_outcome TEXT
  CHECK (tax_assessment_outcome IN ('aligned', 'under_audit') OR tax_assessment_outcome IS NULL);

COMMENT ON COLUMN tax_filings.tax_assessment_outcome IS
  'Outcome category for the prior-year tax assessment received. NULL when not yet received or pending. ''aligned'' = AED assessment matches our return; ''under_audit'' = AED is auditing or asking clarifications. New in stint 44.F3.';
