-- 035_crm_billing — invoices + payments (stint 25).
--
-- Diego specifically asked for billing to be "muy bien" — this
-- migration layers 4 improvements over Notion Billing:
--
--  1. `invoice_number` UNIQUE NOT NULL with MP-YYYY-NNNN auto-gen
--     in the app layer. Notion has no invoice numbering at all.
--
--  2. Explicit `vat_rate` + `vat_amount` columns (Notion only stored
--     excl and incl, requiring back-calculation for VAT audits).
--
--  3. Partial payment support via a separate payments table
--     (crm_billing_payments). `amount_paid` on the invoice is a
--     sum rollup kept by the app; `outstanding` is a GENERATED
--     column. Status can be `partially_paid`.
--
--  4. `line_items` JSONB with [{description, qty, unit_price, total}]
--     so Excel export can optionally emit one row per line item
--     (Diego's flow: send partners a detailed breakdown).
--
-- `paid_date` is kept separately from `status='paid'` so we don't
-- overload the column (invoice can be fully paid with a known date
-- AND the state is immutable).

CREATE TABLE IF NOT EXISTS crm_billing_invoices (
  id                  text PRIMARY KEY,
  notion_page_id      text UNIQUE,

  invoice_number      text UNIQUE NOT NULL,  -- MP-YYYY-NNNN

  company_id          text REFERENCES crm_companies(id),
  matter_id           text REFERENCES crm_matters(id),
  primary_contact_id  text REFERENCES crm_contacts(id),

  issue_date          date,
  due_date            date,

  currency            text NOT NULL DEFAULT 'EUR',

  amount_excl_vat     numeric(14,2) NOT NULL,
  vat_rate            numeric(5,2),         -- 17.00 for LU standard; can be 0 for exempt
  vat_amount          numeric(14,2),
  amount_incl_vat     numeric(14,2) NOT NULL,
  amount_paid         numeric(14,2) NOT NULL DEFAULT 0,
  outstanding         numeric(14,2) GENERATED ALWAYS AS (amount_incl_vat - amount_paid) STORED,

  status              text NOT NULL,
    -- draft | sent | paid | partially_paid | overdue | cancelled

  payment_method      text,
    -- bank_transfer | direct_debit | other
  payment_reference   text,
  paid_date           date,

  line_items          jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{description: str, qty: number, unit_price: number, total: number}]

  notes               text,

  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_billing_invoices_company
  ON crm_billing_invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_crm_billing_invoices_matter
  ON crm_billing_invoices (matter_id);
CREATE INDEX IF NOT EXISTS idx_crm_billing_invoices_status
  ON crm_billing_invoices (status);
CREATE INDEX IF NOT EXISTS idx_crm_billing_invoices_issue_date
  ON crm_billing_invoices (issue_date);
CREATE INDEX IF NOT EXISTS idx_crm_billing_invoices_due_overdue
  ON crm_billing_invoices (due_date)
  WHERE status IN ('sent', 'overdue', 'partially_paid');

-- Payments journal — multiple rows per invoice for partial payments.
CREATE TABLE IF NOT EXISTS crm_billing_payments (
  id                text PRIMARY KEY,
  invoice_id        text NOT NULL REFERENCES crm_billing_invoices(id) ON DELETE CASCADE,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date      date NOT NULL,
  payment_method    text,
  payment_reference text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_billing_payments_invoice
  ON crm_billing_payments (invoice_id, payment_date DESC);

COMMENT ON TABLE crm_billing_invoices IS
  'Invoices issued to CRM companies. Supports partial payments via crm_billing_payments + outstanding GENERATED column.';
COMMENT ON COLUMN crm_billing_invoices.invoice_number IS
  'Auto-gen MP-YYYY-NNNN. Unique across all time. Logic in src/lib/invoice-number.ts.';
COMMENT ON COLUMN crm_billing_invoices.line_items IS
  'JSONB array of {description, qty, unit_price, total}. Used by Excel export "one row per line" mode.';
