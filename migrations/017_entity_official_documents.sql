-- ════════════════════════════════════════════════════════════════════════
-- 017 — Entity official documents (VAT registration letters + friends).
--
-- Stint 15 (2026-04-20). Diego asked for two things:
--   1. Persist the VAT registration letter a user uploads during entity
--      creation — not just extract the fields and throw the file away.
--      He wants to re-read it later ("to verify the periodicity") and
--      know WHICH version was in force when a filing went out.
--   2. Let the user re-upload a newer letter when periodicity changes
--      (e.g. annual → quarterly because turnover crossed a threshold).
--      The old letter must not be lost — we keep history via
--      `superseded_by` so the timeline is preserved.
--
-- Same pattern works for future document kinds — articles of association,
-- engagement letters, generic "other" PDFs. Extraction today only runs
-- on kind='vat_registration' (the only one with structured fields we
-- care to propagate to the entity).
--
-- Storage bucket convention: path `entity-docs/<entity_id>/
--   <timestamp>_<kind>_<safe_filename>` in the existing `documents`
--   Supabase Storage bucket (shared with invoices + AED uploads).
--
-- NOTE: this was originally applied via the Supabase MCP on 2026-04-20;
-- this file lands in the repo so fresh databases stay reproducible.
-- The SQL is idempotent — re-applying is a no-op.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS entity_official_documents (
  id              TEXT PRIMARY KEY,
  entity_id       TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
    'vat_registration',
    'articles_of_association',
    'engagement_letter',
    'other'
  )),
  filename        TEXT NOT NULL,
  content_type    TEXT,
  storage_path    TEXT NOT NULL,
  size_bytes      INTEGER,
  -- Structured fields the extractor pulled off the document (only
  -- populated for kind='vat_registration' today). JSONB because we
  -- don't want to couple schema migrations to Haiku's output shape.
  extracted_fields JSONB,
  -- When this document is the "source of truth" (AED effective date,
  -- engagement letter signature date, etc.). Optional — many uploads
  -- won't carry one.
  effective_from  DATE,
  notes           TEXT,
  -- Self-referential FK: when the user uploads a newer letter of the
  -- same kind, the previous one's `superseded_by` points at the new
  -- row. The current doc has NULL here. Filtering `WHERE superseded_by
  -- IS NULL` surfaces the "live" set; `history=true` shows everything.
  superseded_by   TEXT REFERENCES entity_official_documents(id) ON DELETE SET NULL,
  uploaded_by     TEXT, -- user id (optional, for future multi-user)
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot paths:
--   - "give me the current docs for this entity"    → (entity_id, uploaded_at DESC)
--   - "give me current VAT letter for this entity"  → (entity_id, kind, uploaded_at DESC)
CREATE INDEX IF NOT EXISTS idx_entity_official_documents_entity
  ON entity_official_documents(entity_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_official_documents_kind
  ON entity_official_documents(entity_id, kind, uploaded_at DESC);

-- RLS: same deny-all posture as every other table in cifra. The app
-- reaches the table via the service-role key in server routes only.
ALTER TABLE entity_official_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON entity_official_documents;
CREATE POLICY "deny all anon"
  ON entity_official_documents
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny all authenticated" ON entity_official_documents;
CREATE POLICY "deny all authenticated"
  ON entity_official_documents
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Verification (run after applying):
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'entity_official_documents' ORDER BY ordinal_position;
-- SELECT polname, polcmd FROM pg_policies WHERE tablename = 'entity_official_documents';
