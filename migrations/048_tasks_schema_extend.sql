-- ════════════════════════════════════════════════════════════════════════
-- Migration 048 — Tax-Ops tasks schema extension (stint 37.G)
--
-- Diego's audit: "lo de task también está muy mal — hay que poner cuál
-- es la familia del cliente, nombre de la entidad, qué hay que hacer,
-- estatus, si estamos esperando respuesta de quién, cuándo hay que
-- hacer follow-up. Doy aquí a new y me salen tres cosas: due date,
-- priority. Tiene que ser algo realmente útil para gestión de proyectos.
-- échate un vistazo a las mejores prácticas."
--
-- Fields added for proper project-management semantics:
--   entity_id         — optional FK to tax_entities (click to filter tasks
--                       by entity / show on entity detail pills)
--   task_kind         — enum distinguishing different action shapes:
--                         action | follow_up | clarification |
--                         approval_request | review | other
--   waiting_on_kind   — when status='awaiting_client_clarification' or
--                       'waiting_on_external/internal', who's the blocker:
--                         csp_contact | client | internal_team | aed | other
--                         (null when not waiting)
--   waiting_on_note   — free text: the specific person/email we're waiting on
--   follow_up_date    — when to chase if still no response. Separate from
--                       due_date which is the actual deadline.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE tax_ops_tasks
  ADD COLUMN IF NOT EXISTS entity_id         TEXT REFERENCES tax_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_kind         TEXT NOT NULL DEFAULT 'action',
  ADD COLUMN IF NOT EXISTS waiting_on_kind   TEXT,
  ADD COLUMN IF NOT EXISTS waiting_on_note   TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_date    DATE;

CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_entity   ON tax_ops_tasks(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tax_ops_tasks_follow   ON tax_ops_tasks(follow_up_date) WHERE follow_up_date IS NOT NULL AND status NOT IN ('done','cancelled');

COMMENT ON COLUMN tax_ops_tasks.task_kind IS
  'action | follow_up | clarification | approval_request | review | other';
COMMENT ON COLUMN tax_ops_tasks.waiting_on_kind IS
  'csp_contact | client | internal_team | aed | other — who blocks this task; null if not waiting';
COMMENT ON COLUMN tax_ops_tasks.waiting_on_note IS
  'Specific person / email / team we''re waiting on. Free text.';
COMMENT ON COLUMN tax_ops_tasks.follow_up_date IS
  'When to chase if no response yet. Distinct from due_date (final deadline).';

-- Audit trail
INSERT INTO audit_log
  (id, user_id, action, target_type, target_id, new_value)
VALUES (
  gen_random_uuid()::text,
  'migration_048',
  'tax_ops_tasks_schema_extend',
  'tax_ops_tasks', 'batch_048',
  jsonb_build_object(
    'migration', '048',
    'description', 'Added entity_id, task_kind, waiting_on_kind, waiting_on_note, follow_up_date columns + indexes.'
  )::text
);
