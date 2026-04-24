-- ════════════════════════════════════════════════════════════════════════
-- Migration 055 — WHT quarterly deadline rule (stint 41)
--
-- Diego (stint 40 feedback, unactioned until now): "algunas empresas lo
-- hacen quarterly". We already covered monthly, semester, annual, ad-hoc.
-- Adding quarterly closes the common cadences and makes the 5-option
-- cadence switcher in stint 41 meaningful.
--
-- Semantics mirror wht_director_monthly: 10 days after period end.
-- sidebar_visible = FALSE — reached via the WHT tabs (or once the
-- unified /tax-ops/wht overview lands). No dedicated sidebar entry.
--
-- Idempotent: ON CONFLICT DO NOTHING. Applied via Supabase MCP
-- apply_migration the same turn this file ships.
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO tax_deadline_rules (
  id, tax_type, period_pattern, rule_kind, rule_params,
  admin_tolerance_days, statutory_description, market_practice_note,
  sidebar_visible, sidebar_order, sidebar_label, sidebar_icon
)
VALUES (
  gen_random_uuid()::text,
  'wht_director_quarterly',
  'quarterly',
  'days_after_period_end',
  '{"days_after": 10}'::jsonb,
  5,
  'Withholding tax on director fees — quarterly filings due 10 days after quarter end.',
  'Some entities pay director fees on a quarterly cadence. Rule mirrors the monthly variant (10 days post period end, 5d tolerance).',
  FALSE,
  44,
  'WHT quarterly',
  'WalletIcon'
)
ON CONFLICT DO NOTHING;
