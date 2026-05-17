-- 093_stint96_cleanup.sql
--
-- Stint 96 — dogfood-first cleanup. Diego's instruction:
-- "como si empezáramos de cero a iterar con el producto. teniendo
--  claro que el roadmap a día de hoy es dogfooding."
--
-- Three groups of changes consolidated into one migration:
--
-- 1. DROP TABLE tax_team_members
--    Built for a multi-person tax practice (8 short_names: DIE, IGA,
--    DAR, ...). cifra is single-user. The /tax-ops/settings/team UI
--    + /api/tax-ops/team endpoint are deleted in the same stint;
--    free-text `assigned_to` columns on tax_filings / tax_ops_tasks
--    survive untouched.
--
-- 2. DROP TABLE crm_automation_rules
--    Three hard-coded rules (proposal_sent → follow-up task, opp won →
--    open matter, invoice sent → confirm-receipt) that surfaced tasks
--    Diego didn't want. The /crm/settings/automations UI + API + the
--    runAutomations() runner are deleted in the same stint. Stage and
--    invoice-status transitions still log to audit_log; the rule
--    table is no longer referenced.
--
-- 3. DROP COLUMN deleted_at on four CRM tables (companies, contacts,
--    matters, opportunities).
--    Soft-delete + a /crm/trash bin + 30-day-purge plumbing is overkill
--    for single-user dogfood. DELETE handlers now hard-delete; the
--    audit_log row remains as the historical record. UI gates the
--    destructive call behind a confirmation modal.
--
--    Tables that KEEP deleted_at (intentionally):
--    - tax_entities             — Tax-Ops "archived" workflow
--    - entities                 — VAT, audit defensibility
--    - clients                  — VAT
--    - invoice_lines            — VAT, audit defensibility
--    - invoice_attachments      — VAT, audit defensibility
--
-- Idempotent: every statement is IF EXISTS so re-running is safe.

-- ─── 1. Drop tax_team_members ──────────────────────────────────────
DROP TABLE IF EXISTS tax_team_members CASCADE;

-- ─── 2. Drop crm_automation_rules ──────────────────────────────────
DROP TABLE IF EXISTS crm_automation_rules CASCADE;

-- ─── 3. Drop deleted_at on four CRM tables ─────────────────────────
ALTER TABLE crm_companies     DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE crm_contacts      DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE crm_matters       DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS deleted_at;

-- ─── Note ──────────────────────────────────────────────────────────
-- Sign-off DB columns on tax_ops_tasks (preparer, preparer_at, reviewer,
-- reviewer_at, partner_sign_off, partner_sign_off_at) are kept on
-- purpose. The TaskSignoffCard UI was removed (3-person cascade is
-- ceremony for solo work), but the columns can host a simpler
-- timestamp-only "signed off" flag later without another migration.
