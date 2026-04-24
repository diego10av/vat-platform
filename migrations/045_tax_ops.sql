-- ════════════════════════════════════════════════════════════════════════
-- Migration 045 — Tax-Ops module (stint 34)
--
-- A standalone compliance + follow-up tracker for Diego's tax practice.
-- Replaces the two Excels ("CIT (DGM)" and "VAT & Others (DGM)") he
-- rebuilds every year, plus his Notion "Tasks & Follow-ups" DB.
--
-- Independent of the CRM — Diego's Excel includes clients of other
-- firm partners that do not belong in his /crm book. No FKs cross
-- modules. The two can be bridged later if product signal calls for it.
--
-- Seven tables:
--   1. tax_client_groups        — fund families (CTR, Peninsula, …)
--   2. tax_entities             — legal entities (~180 after dedup)
--   3. tax_deadline_rules       — globally editable rules per tax_type
--   4. tax_obligations          — entity × tax_type recurring template
--   5. tax_filings              — obligation × period actual filing row
--   6. tax_team_members         — team roster (Gab, Andrew, …)
--   7. tax_ops_tasks            — state-of-art tasks (subtasks, deps,
--                                 recurring, related_filing, …)
--   8. tax_ops_task_comments    — thread per task
--
-- Plus seed: 13 deadline rules covering the 13 recurring tax types.
-- Ad-hoc types (vat_registration, vat_deregistration,
-- functional_currency_request) have no rule — deadline is manual.
--
-- All idempotent. No destructive changes to existing tables.
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. Client groups ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_client_groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_client_groups_active
  ON tax_client_groups(name) WHERE is_active = TRUE;

-- ─── 2. Entities ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_entities (
  id                TEXT PRIMARY KEY,
  client_group_id   TEXT REFERENCES tax_client_groups(id) ON DELETE SET NULL,
  legal_name        TEXT NOT NULL,
  vat_number        TEXT,
  matricule         TEXT,
  rcs_number        TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  liquidation_date  DATE,
  csp_contacts      JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_entities_group      ON tax_entities(client_group_id);
CREATE INDEX IF NOT EXISTS idx_tax_entities_active     ON tax_entities(legal_name) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_tax_entities_vat_number ON tax_entities(vat_number) WHERE vat_number IS NOT NULL;

COMMENT ON COLUMN tax_entities.is_active IS 'False = liquidated / left firm / excluded from year rollover. Historic filings stay visible.';
COMMENT ON COLUMN tax_entities.csp_contacts IS 'Array of {name, email, role} — Corporate Service Provider contacts asked for info. Filings can override.';

-- ─── 3. Deadline rules (globally editable) ─────────────────────────────

CREATE TABLE IF NOT EXISTS tax_deadline_rules (
  id                       TEXT PRIMARY KEY,
  tax_type                 TEXT NOT NULL,
  period_pattern           TEXT NOT NULL,     -- annual | quarterly | monthly | semester | adhoc
  rule_kind                TEXT NOT NULL,     -- days_after_period_end | fixed_md | fixed_md_with_extension
  rule_params              JSONB NOT NULL,
  statutory_description    TEXT,
  admin_tolerance_days     INTEGER NOT NULL DEFAULT 0,
  market_practice_note     TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               TEXT,
  UNIQUE (tax_type, period_pattern)
);

CREATE INDEX IF NOT EXISTS idx_tax_deadline_rules_type ON tax_deadline_rules(tax_type);

COMMENT ON TABLE tax_deadline_rules IS 'Editable per-tax-type deadline rules. Updating a rule propagates to all OPEN filings of that type (status NOT IN filed/paid/waived). Filed + paid rows keep their historic deadline for audit.';
COMMENT ON COLUMN tax_deadline_rules.rule_kind IS 'days_after_period_end: deadline = period_end + params.days_after. fixed_md: deadline = (year N+1, params.month, params.day). fixed_md_with_extension: same but extension_* params carry the administrative-tolerance extended deadline.';

-- ─── 4. Obligations (entity × tax_type "template") ─────────────────────

CREATE TABLE IF NOT EXISTS tax_obligations (
  id                 TEXT PRIMARY KEY,
  entity_id          TEXT NOT NULL REFERENCES tax_entities(id) ON DELETE CASCADE,
  tax_type           TEXT NOT NULL,
  period_pattern     TEXT NOT NULL,
  default_assignee   TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  csp_contacts       JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, tax_type, period_pattern)
);

CREATE INDEX IF NOT EXISTS idx_tax_obligations_entity ON tax_obligations(entity_id);
CREATE INDEX IF NOT EXISTS idx_tax_obligations_type   ON tax_obligations(tax_type) WHERE is_active = TRUE;

COMMENT ON TABLE tax_obligations IS 'Recurring template — entity has this tax_type filing at this period_pattern. Year rollover replicates obligations × new-period → new filings.';

-- ─── 5. Filings (the actual rows Diego manipulates) ────────────────────

CREATE TABLE IF NOT EXISTS tax_filings (
  id                            TEXT PRIMARY KEY,
  obligation_id                 TEXT NOT NULL REFERENCES tax_obligations(id) ON DELETE CASCADE,
  period_year                   INTEGER NOT NULL,
  period_label                  TEXT NOT NULL,
  deadline_date                 DATE,
  status                        TEXT NOT NULL DEFAULT 'pending_info',
  assigned_to                   TEXT,
  prepared_with                 TEXT[] NOT NULL DEFAULT '{}',
  draft_sent_at                 DATE,
  client_approved_at            DATE,
  filed_at                      DATE,
  tax_assessment_received_at    DATE,
  tax_assessment_url            TEXT,
  amount_due                    NUMERIC(14,2),
  amount_paid                   NUMERIC(14,2),
  paid_at                       DATE,
  csp_contacts                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  comments                      TEXT,
  internal_matter_code          TEXT,
  import_source                 TEXT NOT NULL DEFAULT 'manual',  -- excel_import | manual | rollover
  last_alert_sent_at            TIMESTAMPTZ,
  last_alert_kind               TEXT,          -- 14d | 7d | 3d | overdue
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (obligation_id, period_label)
);

CREATE INDEX IF NOT EXISTS idx_tax_filings_status       ON tax_filings(status);
CREATE INDEX IF NOT EXISTS idx_tax_filings_deadline     ON tax_filings(deadline_date) WHERE status NOT IN ('filed','paid','waived');
CREATE INDEX IF NOT EXISTS idx_tax_filings_year         ON tax_filings(period_year);
CREATE INDEX IF NOT EXISTS idx_tax_filings_assignee     ON tax_filings(assigned_to) WHERE status NOT IN ('filed','paid','waived');
CREATE INDEX IF NOT EXISTS idx_tax_filings_obligation   ON tax_filings(obligation_id);

COMMENT ON COLUMN tax_filings.status IS 'pending_info | info_received | working | draft_sent | pending_client_approval | filed | assessment_received | paid | waived | blocked';

-- ─── 6. Team members ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_team_members (
  id          TEXT PRIMARY KEY,
  short_name  TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  email       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN tax_team_members.short_name IS 'Matches the abbreviation used in Excel "Prepared with" cells (Gab, Andrew, Ruben, Diego, Raf, ...).';

-- ─── 7. Tasks (state-of-art) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_ops_tasks (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT,               -- markdown
  status               TEXT NOT NULL DEFAULT 'queued',
  priority             TEXT NOT NULL DEFAULT 'medium',
  due_date             DATE,
  remind_at            TIMESTAMPTZ,
  parent_task_id       TEXT REFERENCES tax_ops_tasks(id) ON DELETE CASCADE,
  depends_on_task_id   TEXT REFERENCES tax_ops_tasks(id) ON DELETE SET NULL,
  recurrence_rule      JSONB,              -- { type: 'weekly'|'monthly'|'quarterly'|'yearly'|'custom', params }
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  related_filing_id    TEXT REFERENCES tax_filings(id) ON DELETE SET NULL,
  related_entity_id    TEXT REFERENCES tax_entities(id) ON DELETE SET NULL,
  assignee             TEXT,
  auto_generated       BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at         TIMESTAMPTZ,
  completed_by         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT
);

CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_status    ON tax_ops_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_due       ON tax_ops_tasks(due_date) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_assignee  ON tax_ops_tasks(assignee) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_parent    ON tax_ops_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_recurring ON tax_ops_tasks(id) WHERE recurrence_rule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_filing    ON tax_ops_tasks(related_filing_id) WHERE related_filing_id IS NOT NULL;

COMMENT ON COLUMN tax_ops_tasks.status IS 'queued | in_progress | waiting_on_external | waiting_on_internal | done | cancelled';
COMMENT ON COLUMN tax_ops_tasks.priority IS 'urgent | high | medium | low';

-- ─── 8. Task comments (thread) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_ops_task_comments (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tax_ops_tasks(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,          -- markdown
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_ops_task_comments_task ON tax_ops_task_comments(task_id, created_at DESC);

-- ─── 9. Deadline rules seed ────────────────────────────────────────────
-- Diego can edit any of these via /tax-ops/settings/deadlines.
-- Extension of CIT/NWT = 31 Dec reflects the AED standard practice
-- (prorogation by simple request) — not statutory but market default.

INSERT INTO tax_deadline_rules
  (id, tax_type, period_pattern, rule_kind, rule_params, statutory_description, admin_tolerance_days, market_practice_note)
VALUES
  ('rule_cit_annual', 'cit_annual', 'annual', 'fixed_md_with_extension',
   '{"month":3,"day":31,"extension_month":12,"extension_day":31}'::jsonb,
   'Form 500 — statutory 31 March N+1 (LIR Art. 170).',
   270,
   'AED concede extensión estándar hasta 31 Dec sin penalty si se solicita. Market: filing entre Sep y Dec.'),

  ('rule_nwt_annual', 'nwt_annual', 'annual', 'fixed_md_with_extension',
   '{"month":3,"day":31,"extension_month":12,"extension_day":31}'::jsonb,
   'Reported on Form 500 — same deadline as CIT.',
   270,
   'Idéntica mecánica que CIT. NWT 2026 check aplica a balance al 1 enero.'),

  ('rule_vat_annual', 'vat_annual', 'annual', 'fixed_md',
   '{"month":3,"day":1}'::jsonb,
   'VAT annual return — 1 March N+1.',
   60,
   'Tolerance hasta ~1 May sin multa. Market: filing entre Mar y Jul.'),

  ('rule_vat_simplified_annual', 'vat_simplified_annual', 'annual', 'fixed_md',
   '{"month":3,"day":1}'::jsonb,
   'VAT simplified annual — same deadline as annual.',
   60,
   'Mismo que vat_annual.'),

  ('rule_vat_quarterly', 'vat_quarterly', 'quarterly', 'days_after_period_end',
   '{"days_after":15}'::jsonb,
   'VAT quarterly — 15th day of month following quarter end.',
   15,
   'AED no penaliza durante las primeras ~2 semanas post-deadline.'),

  ('rule_vat_monthly', 'vat_monthly', 'monthly', 'days_after_period_end',
   '{"days_after":15}'::jsonb,
   'VAT monthly — 15th day of month following period.',
   15,
   'Misma tolerance corta que vat_quarterly.'),

  ('rule_subscription_tax_quarterly', 'subscription_tax_quarterly', 'quarterly', 'days_after_period_end',
   '{"days_after":15}'::jsonb,
   'Subscription tax — 15 days after quarter end. Filing + payment simultaneous.',
   0,
   'UCI / AIF. Strict deadline.'),

  ('rule_wht_director_monthly', 'wht_director_monthly', 'monthly', 'days_after_period_end',
   '{"days_after":10}'::jsonb,
   'WHT on director fees — 10th day of month following.',
   5,
   'Strict — penalty rápida en caso de retraso.'),

  ('rule_wht_director_semester', 'wht_director_semester', 'semester', 'days_after_period_end',
   '{"days_after":10}'::jsonb,
   'WHT director — 10 days after semester end (S1 = Jan-Jun, S2 = Jul-Dec).',
   10,
   ''),

  ('rule_wht_director_annual', 'wht_director_annual', 'annual', 'fixed_md',
   '{"month":3,"day":1}'::jsonb,
   'WHT director annual summary — 1 March N+1.',
   60,
   'Tolerance similar a CIT.'),

  ('rule_fatca_crs_annual', 'fatca_crs_annual', 'annual', 'fixed_md',
   '{"month":6,"day":30}'::jsonb,
   'FATCA / CRS reporting — 30 June N+1.',
   0,
   'Strict. Fines después del deadline sin extensión.'),

  ('rule_bcl_sbs_quarterly', 'bcl_sbs_quarterly', 'quarterly', 'days_after_period_end',
   '{"days_after":15}'::jsonb,
   'BCL SBS — 15 days after quarter end.',
   10,
   ''),

  ('rule_bcl_216_monthly', 'bcl_216_monthly', 'monthly', 'days_after_period_end',
   '{"days_after":10}'::jsonb,
   'BCL 2.16 simplified monthly — 10 days after period.',
   5,
   '')
ON CONFLICT (tax_type, period_pattern) DO NOTHING;


-- verification
--   SELECT COUNT(*) FROM tax_deadline_rules;  -- expect 13
--   \dt tax_*                                 -- expect 8 tables
