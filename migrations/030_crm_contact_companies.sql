-- 030_crm_contact_companies — M:N junction (stint 25).
--
-- Replaces the awkward dualidad in Notion Contacts where there were
-- TWO distinct relations to Companies ("Company" + "Companies linked").
-- Salesforce standard: a single junction table with a role column,
-- letting a contact belong to N companies with different roles per
-- relationship.
--
-- Common roles:
--   - main_poc         = principal point of contact
--   - decision_maker   = signs off
--   - billing_contact  = receives invoices
--   - assistant        = helper / secretary
--   - former           = no longer works there (kept for audit)

CREATE TABLE IF NOT EXISTS crm_contact_companies (
  id              text PRIMARY KEY,
  contact_id      text NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  company_id      text NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
  role            text NOT NULL,
  is_primary      boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, company_id, role)
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_companies_contact
  ON crm_contact_companies (contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_contact_companies_company
  ON crm_contact_companies (company_id);

COMMENT ON TABLE crm_contact_companies IS
  'M:N junction: contacts ↔ companies with role. Reemplaza la dualidad Notion "Company" + "Companies (linked)".';
