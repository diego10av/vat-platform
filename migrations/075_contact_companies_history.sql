-- Migration 075 — employment history on crm_contact_companies (stint 64.Q.5)
--
-- Diego: "si cambian de empresa tener la opción de cambiar el
-- nombre de la empresa pero de poder ver el historial y donde
-- estaban trabajando antes."
--
-- The junction was point-in-time only: when a contact moved firms
-- you'd overwrite the row, losing the previous employment. Adding
-- two date columns turns it into a true history table:
--
--   started_at   DATE  NOT NULL DEFAULT CURRENT_DATE
--   ended_at     DATE  NULL                  -- NULL = current employer
--
-- Backfill: every existing junction is treated as "current" — set
-- started_at = COALESCE(notes-derived, created_at::date), ended_at
-- IS NULL. Future moves: insert a NEW junction with started_at =
-- today, set ended_at = today on the previous one (logic in
-- POST /api/crm/contacts/[id]/companies, follow-up commit).
--
-- The unique key (contact_id, company_id, role) stays — but
-- partial-unique by ended_at IS NULL would be more correct (a
-- contact CAN return to a former firm). We don't enforce the
-- partial unique here to keep the migration purely additive;
-- application logic prevents duplicate "current" rows.

ALTER TABLE crm_contact_companies
  ADD COLUMN IF NOT EXISTS started_at DATE,
  ADD COLUMN IF NOT EXISTS ended_at   DATE;

-- Backfill started_at to the row's created_at::date; ended_at stays
-- NULL because every existing junction is the current employer (no
-- history was tracked before today).
UPDATE crm_contact_companies
   SET started_at = created_at::date
 WHERE started_at IS NULL;

ALTER TABLE crm_contact_companies
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN started_at SET DEFAULT CURRENT_DATE;

-- Index on (contact_id, ended_at) so the LATERAL look-up in the
-- contacts list (filter "ended_at IS NULL ORDER BY is_primary DESC,
-- started_at DESC") stays fast as history grows.
CREATE INDEX IF NOT EXISTS idx_crm_contact_companies_contact_current
  ON crm_contact_companies (contact_id, started_at DESC)
  WHERE ended_at IS NULL;

DO $$
DECLARE
  total_rows int;
  current_rows int;
  history_rows int;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM crm_contact_companies;
  SELECT COUNT(*) INTO current_rows FROM crm_contact_companies WHERE ended_at IS NULL;
  SELECT COUNT(*) INTO history_rows FROM crm_contact_companies WHERE ended_at IS NOT NULL;
  RAISE NOTICE 'mig 075: total=%, current=%, history=%', total_rows, current_rows, history_rows;
END $$;
