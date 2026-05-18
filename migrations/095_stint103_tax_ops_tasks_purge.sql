-- 095_stint103_tax_ops_tasks_purge.sql
--
-- Stint 103 — Tax-Ops tasks /tax-ops/tasks audit + purge.
--
-- Diego: "lo que yo quiero es pragmatismo y ganar tiempo a todo."
-- Auditamos el módulo entero y matamos 4 surfaces que pesaban sin
-- aportar:
--
--   1. task_kind (6 valores: action/follow_up/clarification/
--      approval_request/review/other). No se filtraba, no cambiaba
--      comportamiento. QuickCaptureModal lo pedía obligatorio.
--
--   2. is_starred (Diego no usa la feature). Mata col en list,
--      bulk-star button, context menu item, filter chip "Starred",
--      ordering tiebreaker.
--
--   3. Sign-off cascade columnas. CLAUDE.md §4 decía "removed in
--      stint 96" pero el backend seguía vivo: /sign route, ALLOWED
--      fields, SELECTs, hover preview render "Sign-off N/3". Purga
--      real ahora.
--
--   4. remind_at. Equivalente al crm_tasks.reminder_at matado en
--      mig 094 — cero canal de delivery (cifra no tiene email), API
--      lo aceptaba sin consumer UI.
--
-- Idempotente.

ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS task_kind;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS is_starred;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS preparer;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS preparer_at;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS reviewer;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS reviewer_at;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS partner_sign_off;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS partner_sign_off_at;
ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS remind_at;
