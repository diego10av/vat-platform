-- Stint 56.D — star / favorite tasks.
--
-- Diego asked for a way to "pin" tasks at the top. Boolean flag,
-- partial index over starred=TRUE so the "Starred first" sort and
-- the ?starred=1 filter stay cheap.

ALTER TABLE tax_ops_tasks
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_starred
  ON tax_ops_tasks (is_starred)
  WHERE is_starred = TRUE;
