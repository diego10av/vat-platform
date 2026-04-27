import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, buildUpdate } from '@/lib/db';

// GET  /api/tax-ops/tasks/[id]
//   Returns: { task, subtasks, blocker (the task we depend on),
//              blocked_by (tasks depending on us), related_entity,
//              related_filing }
//
// PATCH  /api/tax-ops/tasks/[id]  — partial update. Moving status
//                                   to 'done' sets completed_at.
// DELETE /api/tax-ops/tasks/[id]  — cascade via FK deletes subtasks/comments.

interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  remind_at: string | null;
  parent_task_id: string | null;
  depends_on_task_id: string | null;
  recurrence_rule: Record<string, unknown> | null;
  tags: string[];
  related_filing_id: string | null;
  related_entity_id: string | null;
  assignee: string | null;
  auto_generated: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  // Stint 53 — added to the GET payload so the detail page can edit them.
  entity_id: string | null;
  task_kind: string | null;
  waiting_on_kind: string | null;
  waiting_on_note: string | null;
  follow_up_date: string | null;
}

interface SubtaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string | null;
}

const ALLOWED = [
  'title', 'description', 'status', 'priority', 'due_date', 'remind_at',
  'parent_task_id', 'depends_on_task_id', 'recurrence_rule', 'tags',
  'related_filing_id', 'related_entity_id', 'assignee',
  'completed_at', 'completed_by',
  // Stint 37.G
  'entity_id', 'task_kind', 'waiting_on_kind', 'waiting_on_note', 'follow_up_date',
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const [taskRows, subtasks, blockedByUs, blockerTask] = await Promise.all([
    query<TaskDetail>(
      // Stint 53 — surface task_kind / waiting_on_* / follow_up_date /
      // entity_id so the detail page can edit them inline (Hito 1).
      `SELECT id, title, description, status, priority,
              due_date::text, remind_at::text,
              parent_task_id, depends_on_task_id, recurrence_rule, tags,
              related_filing_id, related_entity_id,
              assignee, auto_generated,
              completed_at::text, completed_by,
              created_at::text, updated_at::text,
              entity_id, task_kind,
              waiting_on_kind, waiting_on_note,
              follow_up_date::text AS follow_up_date
         FROM tax_ops_tasks WHERE id = $1`,
      [id],
    ),
    query<SubtaskRow>(
      `SELECT id, title, status, priority, due_date::text, assignee
         FROM tax_ops_tasks
        WHERE parent_task_id = $1
        ORDER BY
          CASE WHEN status = 'done' THEN 1 WHEN status = 'cancelled' THEN 2 ELSE 0 END,
          priority, due_date ASC NULLS LAST, created_at`,
      [id],
    ),
    query<SubtaskRow>(
      `SELECT id, title, status, priority, due_date::text, assignee
         FROM tax_ops_tasks
        WHERE depends_on_task_id = $1
          AND status NOT IN ('done','cancelled')
        ORDER BY due_date ASC NULLS LAST`,
      [id],
    ),
    query<SubtaskRow>(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date::text, t.assignee
         FROM tax_ops_tasks t
         JOIN tax_ops_tasks self ON self.depends_on_task_id = t.id
        WHERE self.id = $1`,
      [id],
    ),
  ]);

  if (!taskRows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const task = taskRows[0];

  // Enrich with related entity/filing labels
  let related_entity_name: string | null = null;
  let related_filing_label: string | null = null;
  if (task.related_entity_id) {
    const [e] = await query<{ legal_name: string }>(
      `SELECT legal_name FROM tax_entities WHERE id = $1`,
      [task.related_entity_id],
    );
    related_entity_name = e?.legal_name ?? null;
  }
  if (task.related_filing_id) {
    const [f] = await query<{ label: string }>(
      `SELECT ent.legal_name || ' · ' || o.tax_type || ' · ' || f.period_label AS label
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
         JOIN tax_entities ent  ON ent.id = o.entity_id
        WHERE f.id = $1`,
      [task.related_filing_id],
    );
    related_filing_label = f?.label ?? null;
  }

  return NextResponse.json({
    task,
    subtasks,
    blocked_by_us: blockedByUs,   // tasks waiting for us
    blocker: blockerTask[0] ?? null, // task we're waiting for
    related_entity_name,
    related_filing_label,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  // Auto-bump completed_at when status → done (unless explicitly set)
  if (body.status === 'done' && !('completed_at' in body)) {
    body.completed_at = new Date().toISOString();
    body.completed_by = 'founder';
  }
  if (body.status && body.status !== 'done' && !('completed_at' in body)) {
    // Clear completed_at if moving back out of done
    body.completed_at = null;
    body.completed_by = null;
  }

  // Serialize JSON fields
  if (body.recurrence_rule !== undefined && body.recurrence_rule !== null) {
    body.recurrence_rule = JSON.stringify(body.recurrence_rule);
  }

  const { sql, values, changes } = buildUpdate(
    'tax_ops_tasks', ALLOWED, body, 'id', id, ['updated_at = NOW()'],
  );
  if (!sql) return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  await execute(sql, values);
  await logAudit({
    userId: 'founder',
    action: 'tax_task_update',
    targetType: 'tax_ops_task',
    targetId: id,
    newValue: JSON.stringify(changes),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  await execute(`DELETE FROM tax_ops_tasks WHERE id = $1`, [id]);
  await logAudit({
    userId: 'founder',
    action: 'tax_task_delete',
    targetType: 'tax_ops_task',
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}
