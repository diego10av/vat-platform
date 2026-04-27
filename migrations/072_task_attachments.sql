-- Stint 56.C — document attachments per task.
--
-- Diego: Big4-grade tasks need attachments (engagement letters,
-- drafts, evidences). Mirror of invoice_attachments (mig 010) but
-- scoped to tax_ops_tasks. Files live in Supabase Storage bucket
-- `documents` under prefix `task-attachments/<task_id>/`. The
-- table only stores metadata + the storage path.
--
-- ON DELETE CASCADE so deleting a task drops its attachment rows
-- (the storage objects need a separate sweep — out of scope).

CREATE TABLE IF NOT EXISTS tax_ops_task_attachments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tax_ops_tasks(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  file_path    TEXT NOT NULL,           -- storage key inside bucket
  file_size    INTEGER,                  -- bytes
  file_type    TEXT,                     -- MIME (e.g. "application/pdf")
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task
  ON tax_ops_task_attachments(task_id);

COMMENT ON TABLE tax_ops_task_attachments IS
  'Stint 56.C — files attached to a task. Storage in Supabase bucket "documents", prefix task-attachments/<task_id>/.';
