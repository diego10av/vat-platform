-- Migration 079 — drop dead crm_companies.entity_id column
--
-- Stint 66.A (2026-05-04) ripped out the only cross-module FK between
-- CRM and the legacy VAT entities table per Diego's strict-module-
-- independence rule (Rule §14). The column was kept as dead data with
-- a follow-up note (~2026-05-25) to drop after Diego confirmed he
-- hadn't missed the link.
--
-- Stint 67.E (2026-05-05): Diego asked for "todo lo obsoleto" cleared,
-- so we drop the column now. No application code reads or writes it
-- since stint 66.A — the GET /api/crm/companies SELECT, the POST
-- INSERT whitelist, the PATCH UPDATABLE_FIELDS list, and every
-- CrmFormModal schema all stopped referencing it.
--
-- Idempotent: IF EXISTS guard so a re-run is a no-op. Reversible via
-- `ALTER TABLE crm_companies ADD COLUMN entity_id text` (the column
-- was untyped FK; not a hard FK constraint).

BEGIN;

ALTER TABLE crm_companies
  DROP COLUMN IF EXISTS entity_id;

COMMIT;
