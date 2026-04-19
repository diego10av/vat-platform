-- ═══════════════════════════════════════════════════════════════════════
-- Migration 012 · Client contacts + entity_approvers inheritance link.
--
-- Supports Diego's 2026-04-19 request: *"a un cliente final, pueden ser
-- varios contactos de esa misma empresa. haría falta tener una base
-- de datos de contactos para un mismo cliente — contacto principal + X
-- CCs, reusables al añadir los approvers de cada entidad"*.
--
-- Model:
--
--   A CLIENT has many CONTACTS (name, email, phone, role,
--   organisation, country, is_main). Exactly one contact per client
--   can be `is_main = TRUE` (enforced by partial unique index).
--
--   An ENTITY_APPROVER can optionally link to a CLIENT_CONTACT via
--   `client_contact_id`. The approver row still stores its own copy
--   of name/email/phone (source of truth for the portal share link),
--   but the FK lets the UI offer a "sync with client contact" action
--   and rememberwhere the info came from.
--
-- IDEMPOTENT. Safe to re-run.
--
-- Author: Claude, stint 11 (2026-04-19)
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS client_contacts (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  role            TEXT,        -- "CFO", "Head of Finance", "Compliance Officer"…
  organization    TEXT,        -- usually mirrors clients.name, but can differ (e.g. a director acting in personal capacity)
  country         TEXT,        -- ISO-2 where the contact is based
  is_main         BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_client
  ON client_contacts(client_id);

-- Exactly one main contact per client (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_contacts_main
  ON client_contacts(client_id)
  WHERE is_main = TRUE;

-- Reuse touch_updated_at() from earlier migrations.
DROP TRIGGER IF EXISTS trg_client_contacts_touch_updated_at ON client_contacts;
CREATE TRIGGER trg_client_contacts_touch_updated_at
  BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─────────────────── entity_approvers.client_contact_id FK ───────────────────

ALTER TABLE entity_approvers
  ADD COLUMN IF NOT EXISTS client_contact_id TEXT;

-- FK added as a separate step so the column can be added even if the
-- table was created without this constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_entity_approvers_client_contact'
      AND conrelid = 'entity_approvers'::regclass
  ) THEN
    ALTER TABLE entity_approvers
      ADD CONSTRAINT fk_entity_approvers_client_contact
      FOREIGN KEY (client_contact_id) REFERENCES client_contacts(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_entity_approvers_client_contact
  ON entity_approvers(client_contact_id)
  WHERE client_contact_id IS NOT NULL;

-- ────────────────────────── Backfill ──────────────────────────
-- For each client, create a "main contact" row from the primary
-- approver's contact info across that client's entities. This
-- deduplicates the legacy inline data into proper client_contacts.
-- Deterministic id = 'cc-main-' + first 12 chars of md5(client_id) so
-- re-running the migration is idempotent.

INSERT INTO client_contacts (id, client_id, name, email, phone, role, is_main)
SELECT
  'cc-main-' || substring(md5(c.id), 1, 12) AS id,
  c.id AS client_id,
  COALESCE(c.vat_contact_name, 'Main contact') AS name,
  c.vat_contact_email AS email,
  c.vat_contact_phone AS phone,
  c.vat_contact_role AS role,
  TRUE AS is_main
FROM clients c
WHERE c.vat_contact_name IS NOT NULL OR c.vat_contact_email IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────── RLS ───────────────────────────
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all anon" ON client_contacts;
CREATE POLICY "deny all anon" ON client_contacts
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "deny all authenticated" ON client_contacts;
CREATE POLICY "deny all authenticated" ON client_contacts
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
--   SELECT COUNT(*) FROM client_contacts;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'entity_approvers' AND column_name = 'client_contact_id';
