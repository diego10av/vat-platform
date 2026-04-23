-- ════════════════════════════════════════════════════════════════════════
-- Migration 044 — User-extensible taxonomies
--
-- Replaces the hardcoded dropdown arrays for countries, industries,
-- practice areas, fee types, role tags, lead sources, and loss
-- reasons. Values are stored as rows in a polymorphic `crm_taxonomies`
-- table keyed by (kind, value). UI dropdowns hydrate from this table
-- so users can add their own values without touching code.
--
-- System values (the ones we seed here) are flagged `is_system=true`
-- and can be renamed or archived but never permanently deleted —
-- keeps existing records that reference them from orphaning.
--
-- Rollback: DROP TABLE crm_taxonomies. Hardcoded arrays in
-- src/components/crm/schemas.ts remain as the fallback, so the UI
-- degrades gracefully.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_taxonomies (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,        -- country / industry / practice_area / fee_type / role_tag / source / loss_reason
  value        TEXT NOT NULL,        -- canonical slug stored on the entity row (e.g. 'LU', 'key_account')
  label        TEXT NOT NULL,        -- display label
  sort_order   INTEGER NOT NULL DEFAULT 100,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, value)
);

CREATE INDEX IF NOT EXISTS idx_crm_taxonomies_kind_active
  ON crm_taxonomies(kind, sort_order) WHERE archived = FALSE;

COMMENT ON TABLE crm_taxonomies IS 'User-extensible dropdown options. Kinds: country, industry, practice_area, fee_type, role_tag, source, loss_reason. is_system rows cannot be deleted (only archived/renamed) to protect referential integrity of records using the value.';

-- ─── Seed: countries ──────────────────────────────────────────────
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('ctry_lu',  'country', 'LU', 'Luxembourg',         1,  TRUE),
  ('ctry_fr',  'country', 'FR', 'France',              2,  TRUE),
  ('ctry_gb',  'country', 'GB', 'United Kingdom',      3,  TRUE),
  ('ctry_ie',  'country', 'IE', 'Ireland',             4,  TRUE),
  ('ctry_de',  'country', 'DE', 'Germany',             5,  TRUE),
  ('ctry_nl',  'country', 'NL', 'Netherlands',         6,  TRUE),
  ('ctry_be',  'country', 'BE', 'Belgium',             7,  TRUE),
  ('ctry_it',  'country', 'IT', 'Italy',               8,  TRUE),
  ('ctry_es',  'country', 'ES', 'Spain',               9,  TRUE),
  ('ctry_pt',  'country', 'PT', 'Portugal',            10, TRUE),
  ('ctry_ch',  'country', 'CH', 'Switzerland',         11, TRUE),
  ('ctry_fi',  'country', 'FI', 'Finland',             12, TRUE),
  ('ctry_se',  'country', 'SE', 'Sweden',              13, TRUE),
  ('ctry_dk',  'country', 'DK', 'Denmark',             14, TRUE),
  ('ctry_us',  'country', 'US', 'United States',       15, TRUE),
  ('ctry_ca',  'country', 'CA', 'Canada',              16, TRUE),
  ('ctry_br',  'country', 'BR', 'Brazil',              17, TRUE),
  ('ctry_hk',  'country', 'HK', 'Hong Kong',           18, TRUE),
  ('ctry_sg',  'country', 'SG', 'Singapore',           19, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- ─── Seed: practice areas ─────────────────────────────────────────
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('pa_re',    'practice_area', 'real_estate',     'Real Estate',      1, TRUE),
  ('pa_lit',   'practice_area', 'litigation',      'Litigation',       2, TRUE),
  ('pa_emp',   'practice_area', 'employment',      'Employment',       3, TRUE),
  ('pa_fund',  'practice_area', 'fund_regulatory', 'Fund / Regulatory', 4, TRUE),
  ('pa_tax',   'practice_area', 'tax',             'Tax',              5, TRUE),
  ('pa_ma',    'practice_area', 'm_a',             'M&A',              6, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- ─── Seed: fee types ──────────────────────────────────────────────
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('ft_ret',   'fee_type', 'retainer',    'Retainer',    1, TRUE),
  ('ft_suc',   'fee_type', 'success_fee', 'Success fee', 2, TRUE),
  ('ft_fix',   'fee_type', 'fixed_fee',   'Fixed fee',   3, TRUE),
  ('ft_hr',    'fee_type', 'hourly',      'Hourly',      4, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- ─── Seed: role tags (on contacts) ────────────────────────────────
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('rt_poc',   'role_tag', 'main_poc',        'Main POC',        1, TRUE),
  ('rt_dm',    'role_tag', 'decision_maker',  'Decision maker',  2, TRUE),
  ('rt_bill',  'role_tag', 'billing_contact', 'Billing contact', 3, TRUE),
  ('rt_ref',   'role_tag', 'referrer',        'Referrer',        4, TRUE),
  ('rt_int',   'role_tag', 'internal',        'Internal',        5, TRUE),
  ('rt_opp',   'role_tag', 'opposing_party',  'Opposing party',  6, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- ─── Seed: opportunity sources ────────────────────────────────────
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('src_ref',   'source', 'referral',         'Referral',            1, TRUE),
  ('src_li',    'source', 'linkedin',         'LinkedIn',            2, TRUE),
  ('src_ev',    'source', 'event',            'Event',               3, TRUE),
  ('src_web',   'source', 'website',          'Website',             4, TRUE),
  ('src_cold',  'source', 'cold_call',        'Cold call / email',   5, TRUE),
  ('src_svc',   'source', 'service_provider', 'Service provider',    6, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- ─── Seed: loss reasons ───────────────────────────────────────────
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('lr_nr',   'loss_reason', 'no_response',          'No response',          1, TRUE),
  ('lr_cw',   'loss_reason', 'competitor',           'Competitor won',       2, TRUE),
  ('lr_coi',  'loss_reason', 'conflict_of_interest', 'Conflict of interest', 3, TRUE),
  ('lr_pr',   'loss_reason', 'price',                'Price',                4, TRUE),
  ('lr_ot',   'loss_reason', 'other',                'Other',                5, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- ─── Seed: industries (placeholder — fill when Diego has real values) ───
INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system) VALUES
  ('ind_pe',    'industry', 'private_equity',  'Private Equity',     1, TRUE),
  ('ind_rw',    'industry', 'real_estate',     'Real Estate',        2, TRUE),
  ('ind_bnk',   'industry', 'banking',         'Banking',            3, TRUE),
  ('ind_ins',   'industry', 'insurance',       'Insurance',          4, TRUE),
  ('ind_hf',    'industry', 'hedge_fund',      'Hedge Fund',         5, TRUE),
  ('ind_vc',    'industry', 'venture_capital', 'Venture Capital',    6, TRUE),
  ('ind_fam',   'industry', 'family_office',   'Family Office',      7, TRUE),
  ('ind_corp',  'industry', 'corporate',       'Corporate',          8, TRUE),
  ('ind_gov',   'industry', 'government',      'Government',         9, TRUE),
  ('ind_svc',   'industry', 'service_provider', 'Service Provider', 10, TRUE),
  ('ind_oth',   'industry', 'other',           'Other',             99, TRUE)
ON CONFLICT (kind, value) DO NOTHING;

-- verification
--   SELECT kind, COUNT(*) FROM crm_taxonomies GROUP BY kind ORDER BY kind;
