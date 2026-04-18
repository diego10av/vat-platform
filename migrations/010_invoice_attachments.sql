-- ════════════════════════════════════════════════════════════════════════
-- 010_invoice_attachments.sql
--
-- Lets a reviewer attach supporting documents (contracts, engagement
-- letters, advisory emails) to a specific invoice. Each attachment
-- carries:
--
--   - The file itself (stored in Supabase storage, path recorded here)
--   - A reviewer-supplied note + legal basis reference (L1)
--   - Optional AI analysis of the document contents (L2)
--   - Optional AI-suggested treatment + legal citations (L3)
--
-- Why this matters: per Diego's customer discovery 2026-04-18, VAT
-- professionals often need to justify a specific treatment decision
-- based on a CONTRACT, not just the invoice. Today they keep the
-- contract in a folder and maybe an email from a VAT advisor — no
-- system. cifra closes that loop: the supporting doc + the reviewer's
-- rationale + any AI analysis are all linked to the invoice and
-- emitted in the audit-trail PDF exported at filing time.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS invoice_attachments (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- What kind of supporting doc this is. Drives labels in the UI
  -- and the audit PDF. Keep this whitelist small; "other" is the
  -- escape hatch.
  kind           TEXT NOT NULL DEFAULT 'contract'
                 CHECK (kind IN ('contract', 'engagement_letter', 'advisory_email', 'other')),

  -- File bits (file itself lives in Supabase storage at file_path).
  filename       TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  file_size      INTEGER NOT NULL DEFAULT 0,
  file_type      TEXT NOT NULL DEFAULT 'pdf',

  -- L1: reviewer-written explanation. Short markdown-friendly text.
  -- legal_basis is a separate short field (e.g. "Art. 44§1 d LTVA")
  -- so we can cite it crisply in the PDF without re-parsing user_note.
  user_note      TEXT,
  legal_basis    TEXT,

  -- L2 / L3: AI analysis of the attached document.
  ai_analysis              TEXT,         -- full analysis (markdown)
  ai_summary               TEXT,         -- 1-paragraph summary for the PDF
  ai_suggested_treatment   TEXT,         -- TREATMENT_CODES id
  ai_citations             JSONB,        -- [{ legal_id, quote, confidence }]
  ai_analyzed_at           TIMESTAMPTZ,
  ai_model                 TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- RLS — follows the project-wide posture from migration 006
-- (deny-all to anon/authenticated; service_role bypasses).
ALTER TABLE invoice_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice
  ON invoice_attachments (invoice_id)
  WHERE deleted_at IS NULL;

-- Touch trigger to keep updated_at in sync. The touch_updated_at()
-- function was added in migration 001 and hardened (search_path='')
-- in migration 006.
DROP TRIGGER IF EXISTS invoice_attachments_touch ON invoice_attachments;
CREATE TRIGGER invoice_attachments_touch
  BEFORE UPDATE ON invoice_attachments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
