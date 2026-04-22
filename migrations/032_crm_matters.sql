-- 032_crm_matters — engagements (stint 25).
--
-- Matters are the canonical unit of client work for a law/tax firm.
-- A matter opens when an Opportunity is won (source_opportunity_id
-- FK) and closes when the engagement ends. Activities + invoices
-- attach to matters.
--
-- Mirrors Notion Matters + adds:
--   - `matter_reference` as a UNIQUE, auto-gen format MP-YYYY-NNNN
--     (Manso Partners + year + 4-digit sequence). Generation logic
--     lives in the app / a helper function in src/lib/invoice-number.ts.
--   - `conflict_check_date` (when the check happened, not just
--     whether). Audit-grade.
--   - `title` separate from `matter_reference` so reports can show a
--     human-readable description ("Real estate M&A for Client X")
--     without exposing the reference code inside every UI label.

CREATE TABLE IF NOT EXISTS crm_matters (
  id                    text PRIMARY KEY,
  notion_page_id        text UNIQUE,

  matter_reference      text UNIQUE NOT NULL,  -- MP-2025-0001 auto-gen
  title                 text NOT NULL,

  client_company_id     text REFERENCES crm_companies(id),
  primary_contact_id    text REFERENCES crm_contacts(id),
  source_opportunity_id text REFERENCES crm_opportunities(id),

  status                text NOT NULL,
    -- active | on_hold | closed | archived
  practice_areas        text[] NOT NULL DEFAULT '{}',

  fee_type              text,
    -- retainer | success_fee | fixed_fee | hourly
  hourly_rate_eur       numeric(10,2),

  opening_date          date,
  closing_date          date,

  conflict_check_done   boolean NOT NULL DEFAULT false,
  conflict_check_date   date,

  lead_counsel          text,
  team_members          text[] NOT NULL DEFAULT '{}',

  documents_link        text,
  notes                 text,
  tags                  text[] NOT NULL DEFAULT '{}',

  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_matters_client
  ON crm_matters (client_company_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_matters_status
  ON crm_matters (status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_matters_opening
  ON crm_matters (opening_date)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN crm_matters.matter_reference IS
  'Auto-gen format MP-YYYY-NNNN (Manso Partners prefix). Unique across years. Used on invoices + documents.';
