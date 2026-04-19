-- ═══════════════════════════════════════════════════════════════════════
-- Migration 011 · Entity pro-rata configuration (Art. 50 LTVA).
--
-- Supports the mixed-use fund-manager case (Diego 2026-04-19):
--
--   A SOPARFI that both provides exempt management fees to a LU fund
--   (Art. 44§1 d) AND makes loans — some inside LU / EU (exempt, no
--   deduction right) + some outside EU (Art. 49§2 exception, full
--   deduction right) — must apportion its input VAT per Art. 50 LTVA.
--
-- The table stores one row per (entity × period) × chosen methodology.
-- A declaration picks the row whose period overlaps the declaration
-- period; the UI shows the ratio + deductible / non-deductible breakdown.
--
-- Methodology:
--   - 'general'  → turnover-based fraction (Art. 50§1 LTVA)
--   - 'direct'   → direct attribution (Art. 50§2)
--   - 'sector'   → per-sector ratios (Art. 50§3, requires AED OK)
--
-- IDEMPOTENT. Safe to re-run.
--
-- Author: Claude, stint 11 (2026-04-19)
-- Required by: src/lib/prorata.ts, /declarations/[id] Pro-rata section
-- Refs:
--   - LTVA Art. 49§2 + Art. 50 (docs/classification-research.md §2)
--   - Directive 2006/112/EC Arts. 169(c), 173, 174, 175
--   - CJEU C-511/10 BLC Baumarkt (sector method)
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS entity_prorata (
  id                 TEXT PRIMARY KEY,
  entity_id          TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Period the ratio applies to. Declarations whose reporting period
  -- overlaps this range will pick this row. Convention: use calendar-
  -- year ranges (period_start = YYYY-01-01, period_end = YYYY-12-31)
  -- unless the entity has a non-calendar financial year.
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  CHECK (period_end >= period_start),

  -- 'general' = Art. 50§1 general ratio (turnover-based)
  -- 'direct'  = Art. 50§2 direct attribution (line-by-line)
  -- 'sector'  = Art. 50§3 per-sector ratios (AED authorisation required)
  method             TEXT NOT NULL
                       CHECK (method IN ('general', 'direct', 'sector')),

  -- Numerator / denominator in euros. Only populated when method='general'
  -- (for direct / sector methods the ratio is not the interesting
  -- primary artifact). Rounded-up percentage is stored separately for
  -- UI and audit.
  ratio_num          NUMERIC(14, 2),
  ratio_denom        NUMERIC(14, 2),

  -- Deduction ratio as a whole-number percent 0..100. Art. 174§1(b)
  -- Directive requires rounding UP to the next whole percentage.
  ratio_pct          NUMERIC(5, 2)
                       CHECK (ratio_pct IS NULL OR (ratio_pct >= 0 AND ratio_pct <= 100)),

  -- Free-text methodology justification (e.g. "Loans to non-EU subs:
  -- $820k. Loans to EU subs: $3.1m. Ratio: 820/(820+3100) = 21%").
  -- Surfaces in the audit-trail PDF alongside the computation.
  basis              TEXT,

  -- Reviewer notes (not shown on the client-facing PDF by default).
  notes              TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_prorata_period
  ON entity_prorata(entity_id, period_start, period_end);

-- Reuse the existing touch_updated_at() function from earlier migrations.
DROP TRIGGER IF EXISTS trg_entity_prorata_touch_updated_at ON entity_prorata;
CREATE TRIGGER trg_entity_prorata_touch_updated_at
  BEFORE UPDATE ON entity_prorata
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─────────────────────────── RLS ───────────────────────────
-- Follow migration 006 convention: service_role bypasses; anon +
-- authenticated deny.

ALTER TABLE entity_prorata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON entity_prorata;
CREATE POLICY "deny all anon" ON entity_prorata
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny all authenticated" ON entity_prorata;
CREATE POLICY "deny all authenticated" ON entity_prorata
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'entity_prorata';
--   SELECT policyname FROM pg_policies WHERE tablename = 'entity_prorata';
