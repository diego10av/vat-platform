-- 034_crm_tasks — to-dos and reminders (stint 25).
--
-- CRM task system NOT present in Notion. Diego was using a separate
-- Excel file for follow-ups. Tasks are distinct from Activities:
--   - Activity = something that HAPPENED (past-tense, immutable)
--   - Task     = something that NEEDS to happen (future-tense, has
--                open/done state, can be snoozed)
--
-- Polymorphic relation: a task can relate to any CRM/tax module
-- object via (related_type, related_id). Kept as loose TEXT pair
-- instead of FKs to every possible target — simpler indexing and
-- lets us reference cifra `entities` / `declarations` from the tax
-- module without adding a reverse FK chain.

CREATE TABLE IF NOT EXISTS crm_tasks (
  id                text PRIMARY KEY,

  title             text NOT NULL,
  description       text,

  status            text NOT NULL DEFAULT 'open',
    -- open | in_progress | done | snoozed | cancelled
  priority          text NOT NULL DEFAULT 'medium',
    -- low | medium | high | urgent

  due_date          date,
  reminder_at       timestamptz,
    -- when to notify (in-app + optional email, phase 3)

  assignee          text,  -- session user id

  -- Polymorphic relation. NULLable pair — a task can be free-standing.
  related_type      text,
    -- contact | company | opportunity | matter | entity | declaration | invoice | null
  related_id        text,

  -- Tasks cifra itself creates (e.g. "Key Account has a stale
  -- declaration; please follow up") get flagged so UI can group them.
  auto_generated    boolean NOT NULL DEFAULT false,

  completed_at      timestamptz,
  completed_by      text,

  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  created_by        text
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_related
  ON crm_tasks (related_type, related_id)
  WHERE related_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due_open
  ON crm_tasks (due_date)
  WHERE status IN ('open', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee_open
  ON crm_tasks (assignee, due_date)
  WHERE status IN ('open', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_crm_tasks_reminder
  ON crm_tasks (reminder_at)
  WHERE reminder_at IS NOT NULL AND status IN ('open', 'in_progress');

COMMENT ON TABLE crm_tasks IS
  'Open work items distinct from activities. Polymorphic related_type/related_id allow linking to any CRM or tax-module object.';
COMMENT ON COLUMN crm_tasks.auto_generated IS
  'True for tasks cifra creates automatically (e.g. Key Account stale-declaration follow-up). UI may group these separately.';
