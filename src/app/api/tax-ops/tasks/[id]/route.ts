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
  parent_task_id: string | null;
  depends_on_task_id: string | null;
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
  waiting_on_kind: string | null;
  waiting_on_note: string | null;
  follow_up_date: string | null;
  // Stint 84.C — deliverables list (manual-status doc tracker).
  deliverables: TaskDeliverable[];
}

interface TaskDeliverable {
  id: string;
  label: string;
  status: string;
  due_date: string | null;
  link_url: string | null;
  notes: string | null;
  sort_order: number;
}

interface SubtaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  follow_up_date: string | null;
  assignee: string | null;
  // Stint 55.A — only populated for the direct subtasks list (the
  // blocker / blocked_by_us queries leave it undefined).
  subtask_total?: number;
  // Stint 84 — engagement-aware detail page surfaces the latest activity
  // per sub-task inline, so reading "what's the status of the Swiss
  // counsel piece?" doesn't require navigating into the sub-task.
  comment_count?: number;
  last_comment_body?: string | null;
  last_comment_at?: string | null;
  last_comment_by?: string | null;
  // Stint 84 — counterparties responsible for / informed on this sub-task.
  counterparties?: TaskCounterparty[];
  // Stint 84.C — deliverables (used for roll-up chip + expanded panel).
  deliverables?: TaskDeliverable[];
}

interface TaskCounterparty {
  counterparty_id: string;
  display_name: string;
  side: string;            // 'internal' | 'external'
  role: string | null;
  jurisdiction: string | null;
  role_in_task: string | null;  // 'responsible' | 'reviewer' | 'informed'
}

const ALLOWED = [
  'title', 'description', 'status', 'priority', 'due_date',
  'parent_task_id', 'depends_on_task_id', 'tags',
  'related_filing_id', 'related_entity_id', 'assignee',
  'completed_at', 'completed_by',
  // Stint 37.G
  'entity_id', 'waiting_on_kind', 'waiting_on_note', 'follow_up_date',
  // Stint 103 — task_kind / is_starred / remind_at / sign-off columns
  // dropped in mig 095. /sign route also deleted.
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
              due_date::text,
              parent_task_id, depends_on_task_id, tags,
              related_filing_id, related_entity_id,
              assignee, auto_generated,
              completed_at::text, completed_by,
              created_at::text, updated_at::text,
              entity_id,
              waiting_on_kind, waiting_on_note,
              follow_up_date::text AS follow_up_date
         FROM tax_ops_tasks WHERE id = $1`,
      [id],
    ),
    query<SubtaskRow>(
      // Stint 55.A — surface subtask_total per child so the detail page
      // can show a chevron and recursively expand the tree.
      // Stint 84 — also surface the latest comment per sub-task so the
      // engagement view can preview "last update" + lets reviewers tell
      // at a glance whether a workstream has gone stale.
      `SELECT t.id, t.title, t.status, t.priority, t.due_date::text,
              t.follow_up_date::text AS follow_up_date,
              t.assignee,
              (SELECT COUNT(*)::int FROM tax_ops_tasks gc WHERE gc.parent_task_id = t.id) AS subtask_total,
              (SELECT COUNT(*)::int FROM tax_ops_task_comments c WHERE c.task_id = t.id) AS comment_count,
              (SELECT body         FROM tax_ops_task_comments c WHERE c.task_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_comment_body,
              (SELECT created_at::text FROM tax_ops_task_comments c WHERE c.task_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_comment_at,
              (SELECT created_by   FROM tax_ops_task_comments c WHERE c.task_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_comment_by
         FROM tax_ops_tasks t
        WHERE t.parent_task_id = $1
        ORDER BY
          CASE WHEN t.status = 'done' THEN 1 WHEN t.status = 'cancelled' THEN 2 ELSE 0 END,
          t.priority, t.due_date ASC NULLS LAST, t.created_at`,
      [id],
    ),
    query<SubtaskRow>(
      // Stint 84.F — multi-blocker: things WAITING on this task. Read
      // from the link table; ignore done/cancelled.
      `SELECT t.id, t.title, t.status, t.priority, t.due_date::text, t.assignee
         FROM tax_ops_tasks t
         JOIN tax_ops_task_blockers b ON b.task_id = t.id
        WHERE b.blocker_id = $1
          AND t.status NOT IN ('done','cancelled')
        ORDER BY t.due_date ASC NULLS LAST`,
      [id],
    ),
    query<SubtaskRow>(
      // Stint 84.F — multi-blocker: things THIS task is blocked by.
      `SELECT t.id, t.title, t.status, t.priority, t.due_date::text, t.assignee
         FROM tax_ops_tasks t
         JOIN tax_ops_task_blockers b ON b.blocker_id = t.id
        WHERE b.task_id = $1`,
      [id],
    ),
  ]);

  if (!taskRows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const task = taskRows[0];

  // Stint 84.D — fetch deliverables from the dedicated table for the
  // parent + every sub-task in a single round-trip; group client-side.
  const taskIdsForDeliverables = [task.id, ...subtasks.map(s => s.id)];
  const deliverableRows = taskIdsForDeliverables.length > 0
    ? await query<TaskDeliverable & { task_id: string }>(
        `SELECT id, task_id, label, status,
                due_date::text AS due_date,
                link_url, notes, sort_order
           FROM tax_ops_task_deliverables
          WHERE task_id = ANY($1::text[])
          ORDER BY sort_order ASC, created_at ASC`,
        [taskIdsForDeliverables],
      )
    : [];
  const deliverablesByTask = new Map<string, TaskDeliverable[]>();
  for (const d of deliverableRows) {
    const list = deliverablesByTask.get(d.task_id) ?? [];
    list.push({
      id: d.id,
      label: d.label,
      status: d.status,
      due_date: d.due_date,
      link_url: d.link_url,
      notes: d.notes,
      sort_order: d.sort_order,
    });
    deliverablesByTask.set(d.task_id, list);
  }
  task.deliverables = deliverablesByTask.get(task.id) ?? [];
  for (const sub of subtasks) {
    sub.deliverables = deliverablesByTask.get(sub.id) ?? [];
  }

  // Stint 84 — counterparties for the parent task itself + every sub-task in
  // a single round-trip; client-side groups them by task_id.
  const taskIdsForCounterparties = [task.id, ...subtasks.map(s => s.id)];
  const counterpartyLinks = taskIdsForCounterparties.length > 0
    ? await query<TaskCounterparty & { task_id: string }>(
        `SELECT l.task_id, l.counterparty_id, l.role_in_task,
                c.display_name, c.side, c.role, c.jurisdiction
           FROM tax_ops_task_counterparties l
           JOIN tax_ops_counterparties c ON c.id = l.counterparty_id
          WHERE l.task_id = ANY($1::text[])
            AND c.archived_at IS NULL
          ORDER BY
            CASE l.role_in_task WHEN 'responsible' THEN 0 WHEN 'reviewer' THEN 1 ELSE 2 END,
            c.display_name`,
        [taskIdsForCounterparties],
      )
    : [];
  const counterpartiesByTask = new Map<string, TaskCounterparty[]>();
  for (const link of counterpartyLinks) {
    const list = counterpartiesByTask.get(link.task_id) ?? [];
    list.push({
      counterparty_id: link.counterparty_id,
      display_name: link.display_name,
      side: link.side,
      role: link.role,
      jurisdiction: link.jurisdiction,
      role_in_task: link.role_in_task,
    });
    counterpartiesByTask.set(link.task_id, list);
  }
  for (const sub of subtasks) {
    sub.counterparties = counterpartiesByTask.get(sub.id) ?? [];
  }
  const taskCounterparties = counterpartiesByTask.get(task.id) ?? [];

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
    // Stint 84.F — multi-blocker: array of every task this one waits on.
    // The legacy `blocker` field stays populated with the first item for
    // back-compat with any consumer still reading it.
    blockers: blockerTask,
    blocker: blockerTask[0] ?? null,
    related_entity_name,
    related_filing_label,
    // Stint 84 — counterparties on the parent task itself (engagement-level
    // stakeholders such as the client CFO who applies to the whole deal).
    counterparties: taskCounterparties,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  // Stint 84.B — refuse to mark an engagement done while workstreams
  // are still in flight. Diego: "no me puedes dejar marcar Done si hay
  // sub-tasks sin completar, queda engañoso en la lista." Caller may
  // pass `force_close: true` to override (used when the user explicitly
  // chose "close anyway" in the future override flow).
  if (body.status === 'done' && body.force_close !== true) {
    const [openCount] = await query<{ open: number }>(
      `SELECT COUNT(*)::int AS open
         FROM tax_ops_tasks
        WHERE parent_task_id = $1
          AND status NOT IN ('done','cancelled')`,
      [id],
    );
    if ((openCount?.open ?? 0) > 0) {
      return NextResponse.json({
        error: 'open_subtasks',
        message: `${openCount.open} workstream${openCount.open === 1 ? '' : 's'} still open — close or cancel them before marking the parent done.`,
        open_subtasks: openCount.open,
      }, { status: 409 });
    }
  }
  // Don't persist the override flag itself.
  if ('force_close' in body) delete body.force_close;

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
