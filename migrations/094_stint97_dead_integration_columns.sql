-- 094_stint97_dead_integration_columns.sql
--
-- Stint 97 — Diego: "no tengo cifracompliance conectado a nada. ni
-- email, ni outlook, ni linkedin. con lo cual cosas de ese estilo
-- también están ahí para nada."
--
-- This migration drops 4 columns whose only writers were scheduled
-- jobs deleted in the 2026-05-05 reset. Without those jobs the columns
-- were never populated, so the surfaces that read them rendered
-- nothing — but the dead UI promised behaviour cifra cannot deliver
-- (payment-reminder emails, task nudges, recurring tasks). Removing
-- the columns removes the temptation to wire the surfaces back up.
--
--   1. crm_billing_invoices.last_reminder_kind
--   2. crm_billing_invoices.last_reminder_sent_at
--      Written by the daily payment-reminder cron (deleted). The
--      "Last reminder: friendly on YYYY-MM-DD" banner is removed in
--      the same stint.
--
--   3. crm_tasks.reminder_at
--      Form field "When cifra should nudge you about this task" had
--      no delivery channel — cifra has no email integration. Schema
--      + API accept + Excel export column all removed in stint 97.
--
--   4. tax_ops_tasks.recurrence_rule
--      JSONB column edited by RecurrenceEditor in /tax-ops/tasks/[id].
--      UI promised "When marked done, a new instance will be created
--      on the next occurrence" — the recurrence-expand scheduled job
--      that would have done that was never built (or was deleted with
--      the cron infrastructure). Editor component + API field removed.

ALTER TABLE crm_billing_invoices DROP COLUMN IF EXISTS last_reminder_kind;
ALTER TABLE crm_billing_invoices DROP COLUMN IF EXISTS last_reminder_sent_at;

ALTER TABLE crm_tasks DROP COLUMN IF EXISTS reminder_at;

ALTER TABLE tax_ops_tasks DROP COLUMN IF EXISTS recurrence_rule;
