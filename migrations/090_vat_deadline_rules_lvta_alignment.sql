-- ════════════════════════════════════════════════════════════════════════
-- Migration 090 — LTVA-aligned VAT deadlines + statutory column.
--
-- Applied via Supabase MCP on 2026-05-07. This file mirrors the
-- migration for repo trackability. See docs/ltva-procedural-rules.md §3
-- for the statutory + administrative-tolerance model.
--
-- BEFORE this migration the seed had:
--   rule_vat_annual            = fixed_md (1 March), tolerance 60d  ❌ wrong: ordinaria is 1 May
--   rule_vat_simplified_annual = fixed_md (1 March), tolerance 60d  (statutory ok)
--   rule_vat_quarterly         = days_after_period_end(15), tolerance 15d
--   rule_vat_monthly           = days_after_period_end(15), tolerance 15d
--
-- Diego's correction (LU VAT expert):
--   • Annual ordinaire (Art. 64bis):        statutory 1 May  N+1, AED tolerance until 30 Oct N+1
--   • Annual simplified (Art. 67bis):       statutory 1 March N+1, AED tolerance until 30 Oct N+1
--   • Quarterly  (Art. 64):                 statutory period_end + 15d, AED tolerance +60 days
--   • Monthly    (Art. 64):                 statutory period_end + 15d, AED tolerance +60 days
--
-- Schema change: tax_filings gets `statutory_deadline_date DATE` so the
-- legal deadline stays visible alongside the effective one (deadline_date
-- now holds the AED-tolerated effective deadline — what alerts fire on).
--
-- Applies to OPEN filings only (status NOT IN filed/paid/waived) so
-- audit-trail history of closed filings is preserved.
-- ════════════════════════════════════════════════════════════════════════

-- 1 · New column
ALTER TABLE tax_filings
  ADD COLUMN IF NOT EXISTS statutory_deadline_date DATE;

COMMENT ON COLUMN tax_filings.statutory_deadline_date IS
  'Statutory (legal) deadline per LTVA/LIR. The effective deadline (after AED administrative tolerance) is stored in deadline_date. Alerts/badges fire when deadline_date approaches; statutory_deadline_date is informational/audit.';

-- 2 · Update VAT deadline rules

UPDATE tax_deadline_rules
SET rule_kind   = 'fixed_md_with_extension',
    rule_params = '{"month":5,"day":1,"extension_month":10,"extension_day":30}'::jsonb,
    statutory_description = 'VAT annual return (régime ordinaire) — statutory 1 May N+1 (LTVA Art. 64bis); AED tolerates filing until 30 October N+1 without penalty.',
    admin_tolerance_days  = 0,
    market_practice_note  = 'Statutory: 1 May. Effective: 30 Oct. Use the effective in alerts; show statutory as legal reference.',
    updated_at = NOW(),
    updated_by = 'system_migration_090'
WHERE id = 'rule_vat_annual';

UPDATE tax_deadline_rules
SET rule_kind   = 'fixed_md_with_extension',
    rule_params = '{"month":3,"day":1,"extension_month":10,"extension_day":30}'::jsonb,
    statutory_description = 'VAT simplified annual (régime simplifié) — statutory 1 March N+1 (LTVA Art. 67bis); AED tolerates filing until 30 October N+1 without penalty.',
    admin_tolerance_days  = 0,
    market_practice_note  = 'Statutory: 1 March. Effective: 30 Oct. Same AED tolerance as régime ordinaire.',
    updated_at = NOW(),
    updated_by = 'system_migration_090'
WHERE id = 'rule_vat_simplified_annual';

UPDATE tax_deadline_rules
SET admin_tolerance_days  = 60,
    statutory_description = 'VAT quarterly — statutory 15th day of month following quarter end (LTVA Art. 64); AED tolerance +60 days (~2 months).',
    market_practice_note  = 'Statutory: 15th of month after period. Effective: +60d. Diego (LU VAT expert): admin tolerance is roughly 2 months past the legal deadline.',
    updated_at = NOW(),
    updated_by = 'system_migration_090'
WHERE id = 'rule_vat_quarterly';

UPDATE tax_deadline_rules
SET admin_tolerance_days  = 60,
    statutory_description = 'VAT monthly — statutory 15th day of month following period (LTVA Art. 64); AED tolerance +60 days (~2 months).',
    market_practice_note  = 'Statutory: 15th of month after period. Effective: +60d. Same tolerance as quarterly.',
    updated_at = NOW(),
    updated_by = 'system_migration_090'
WHERE id = 'rule_vat_monthly';

-- 3 · Recompute deadline_date + populate statutory_deadline_date for OPEN filings

-- 3a · vat_annual: statutory = 1 May N+1, effective = 30 Oct N+1
UPDATE tax_filings f
SET statutory_deadline_date = make_date(f.period_year + 1, 5, 1),
    deadline_date           = make_date(f.period_year + 1, 10, 30)
FROM tax_obligations o
WHERE f.obligation_id = o.id
  AND o.tax_type = 'vat_annual'
  AND f.status NOT IN ('filed', 'paid', 'waived');

-- 3b · vat_simplified_annual: statutory = 1 March N+1, effective = 30 Oct N+1
UPDATE tax_filings f
SET statutory_deadline_date = make_date(f.period_year + 1, 3, 1),
    deadline_date           = make_date(f.period_year + 1, 10, 30)
FROM tax_obligations o
WHERE f.obligation_id = o.id
  AND o.tax_type = 'vat_simplified_annual'
  AND f.status NOT IN ('filed', 'paid', 'waived');

-- 3c · vat_quarterly: statutory = period_end + 15d, effective = statutory + 60d.
-- period_end derived from period_label: '2026-Q1' → 2026-03-31, etc.
UPDATE tax_filings f
SET statutory_deadline_date = (
      CASE substring(f.period_label from '-Q(\d)$')
        WHEN '1' THEN make_date(f.period_year, 3, 31)  + INTERVAL '15 days'
        WHEN '2' THEN make_date(f.period_year, 6, 30)  + INTERVAL '15 days'
        WHEN '3' THEN make_date(f.period_year, 9, 30)  + INTERVAL '15 days'
        WHEN '4' THEN make_date(f.period_year, 12, 31) + INTERVAL '15 days'
      END
    )::date,
    deadline_date = (
      CASE substring(f.period_label from '-Q(\d)$')
        WHEN '1' THEN make_date(f.period_year, 3, 31)  + INTERVAL '15 days' + INTERVAL '60 days'
        WHEN '2' THEN make_date(f.period_year, 6, 30)  + INTERVAL '15 days' + INTERVAL '60 days'
        WHEN '3' THEN make_date(f.period_year, 9, 30)  + INTERVAL '15 days' + INTERVAL '60 days'
        WHEN '4' THEN make_date(f.period_year, 12, 31) + INTERVAL '15 days' + INTERVAL '60 days'
      END
    )::date
FROM tax_obligations o
WHERE f.obligation_id = o.id
  AND o.tax_type = 'vat_quarterly'
  AND f.status NOT IN ('filed', 'paid', 'waived')
  AND f.period_label ~ '-Q[1-4]$';

-- 3d · vat_monthly: statutory = period_end + 15d, effective = +60d.
-- period_label: '2026-01' → period_end = 2026-01-31.
UPDATE tax_filings f
SET statutory_deadline_date = (
      (make_date(f.period_year, substring(f.period_label from '-(\d{2})$')::int, 1)
        + INTERVAL '1 month - 1 day')
        + INTERVAL '15 days'
    )::date,
    deadline_date = (
      (make_date(f.period_year, substring(f.period_label from '-(\d{2})$')::int, 1)
        + INTERVAL '1 month - 1 day')
        + INTERVAL '15 days'
        + INTERVAL '60 days'
    )::date
FROM tax_obligations o
WHERE f.obligation_id = o.id
  AND o.tax_type = 'vat_monthly'
  AND f.status NOT IN ('filed', 'paid', 'waived')
  AND f.period_label ~ '-(0[1-9]|1[0-2])$';
