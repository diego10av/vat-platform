import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET  /api/tax-ops/tasks
//   ?status=queued&status=in_progress&priority=high&assignee=Gab&
//    due_in_days=14&related_filing=<id>&related_entity=<id>&q=text&
//    parent=<id>&view=list|board
//
// POST /api/tax-ops/tasks  — create. Body carries all task fields
//    except id/timestamps. Supports subtasks (pass parent_task_id)
//    and dependencies (depends_on_task_id).

interface TaskListRow {
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
  created_at: string;
  updated_at: string;
  // Aggregates
  subtask_total: number;
  subtask_done: number;
  comment_count: number;
  related_entity_name: string | null;
  related_filing_label: string | null;
}

const VALID_STATUSES = ['queued', 'in_progress', 'waiting_on_external',
                        'waiting_on_internal', 'done', 'cancelled'];
const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low'];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const statusVals = url.searchParams.getAll('status');
  const priority = url.searchParams.get('priority');
  const assignee = url.searchParams.get('assignee');
  const dueIn = url.searchParams.get('due_in_days');
  const relatedFiling = url.searchParams.get('related_filing');
  const relatedEntity = url.searchParams.get('related_entity');
  const parentId = url.searchParams.get('parent');
  const q = url.searchParams.get('q')?.trim() ?? '';
  const onlyRoot = url.searchParams.get('only_root') === '1';

  const where: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  if (statusVals.length > 0) {
    where.push(`t.status = ANY($${pi}::text[])`);
    params.push(statusVals); pi += 1;
  }
  if (priority) { where.push(`t.priority = $${pi}`); params.push(priority); pi += 1; }
  if (assignee) { where.push(`t.assignee = $${pi}`); params.push(assignee); pi += 1; }
  if (dueIn) {
    const d = Number(dueIn);
    if (Number.isFinite(d)) {
      where.push(`t.due_date IS NOT NULL AND t.due_date <= CURRENT_DATE + ($${pi} || ' days')::interval`);
      params.push(String(d)); pi += 1;
    }
  }
  if (relatedFiling) { where.push(`t.related_filing_id = $${pi}`); params.push(relatedFiling); pi += 1; }
  if (relatedEntity) { where.push(`t.related_entity_id = $${pi}`); params.push(relatedEntity); pi += 1; }
  if (parentId) {
    where.push(`t.parent_task_id = $${pi}`); params.push(parentId); pi += 1;
  } else if (onlyRoot) {
    where.push(`t.parent_task_id IS NULL`);
  }
  if (q) {
    where.push(`(t.title ILIKE $${pi} OR t.description ILIKE $${pi} OR $${pi} = ANY(t.tags))`);
    params.push(`%${q}%`); pi += 1;
  }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query<TaskListRow>(
    `SELECT t.id, t.title, t.description, t.status, t.priority,
            t.due_date::text, t.remind_at::text,
            t.parent_task_id, t.depends_on_task_id, t.recurrence_rule, t.tags,
            t.related_filing_id, t.related_entity_id,
            t.assignee, t.auto_generated,
            t.entity_id, t.task_kind, t.waiting_on_kind,
            t.waiting_on_note, t.follow_up_date::text,
            t.completed_at::text, t.created_at::text, t.updated_at::text,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s WHERE s.parent_task_id = t.id) AS subtask_total,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s WHERE s.parent_task_id = t.id AND s.status = 'done') AS subtask_done,
            (SELECT COUNT(*)::int FROM tax_ops_task_comments c WHERE c.task_id = t.id) AS comment_count,
            -- Entity name via entity_id (new column) OR related_entity_id (legacy)
            COALESCE(
              (SELECT legal_name FROM tax_entities WHERE id = t.entity_id),
              (SELECT legal_name FROM tax_entities WHERE id = t.related_entity_id)
            ) AS entity_name,
            -- Family name when entity is set
            COALESCE(
              (SELECT g.name FROM tax_entities e2 LEFT JOIN tax_client_groups g ON g.id = e2.client_group_id WHERE e2.id = t.entity_id),
              (SELECT g.name FROM tax_entities e3 LEFT JOIN tax_client_groups g ON g.id = e3.client_group_id WHERE e3.id = t.related_entity_id)
            ) AS family_name,
            CASE WHEN f.id IS NOT NULL
                 THEN (SELECT ent.legal_name FROM tax_obligations o
                        JOIN tax_entities ent ON ent.id = o.entity_id
                        WHERE o.id = f.obligation_id) || ' · ' || f.period_label
                 ELSE NULL END AS related_filing_label
       FROM tax_ops_tasks t
       LEFT JOIN tax_filings f ON f.id = t.related_filing_id
       ${whereSQL}
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC`,
    params,
  );

  return NextResponse.json({ tasks: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    due_date?: string | null;
    remind_at?: string | null;
    parent_task_id?: string | null;
    depends_on_task_id?: string | null;
    recurrence_rule?: Record<string, unknown> | null;
    tags?: string[];
    related_filing_id?: string | null;
    related_entity_id?: string | null;
    assignee?: string | null;
    auto_generated?: boolean;
    // Stint 37.G
    entity_id?: string | null;
    task_kind?: string;
    waiting_on_kind?: string | null;
    waiting_on_note?: string | null;
    follow_up_date?: string | null;
  };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 });

  const status = VALID_STATUSES.includes(body.status ?? '') ? body.status! : 'queued';
  const priority = VALID_PRIORITIES.includes(body.priority ?? '') ? body.priority! : 'medium';
  const VALID_KINDS = ['action', 'follow_up', 'clarification', 'approval_request', 'review', 'other'];
  const task_kind = VALID_KINDS.includes(body.task_kind ?? '') ? body.task_kind! : 'action';

  const id = generateId();
  await execute(
    `INSERT INTO tax_ops_tasks
       (id, title, description, status, priority, due_date, remind_at,
        parent_task_id, depends_on_task_id, recurrence_rule, tags,
        related_filing_id, related_entity_id, assignee, auto_generated, created_by,
        entity_id, task_kind, waiting_on_kind, waiting_on_note, follow_up_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,'founder',
             $16,$17,$18,$19,$20)`,
    [
      id, title, body.description ?? null, status, priority,
      body.due_date ?? null, body.remind_at ?? null,
      body.parent_task_id ?? null, body.depends_on_task_id ?? null,
      body.recurrence_rule ? JSON.stringify(body.recurrence_rule) : null,
      body.tags ?? [],
      body.related_filing_id ?? null, body.related_entity_id ?? null,
      body.assignee ?? null, body.auto_generated ?? false,
      body.entity_id ?? null, task_kind,
      body.waiting_on_kind ?? null, body.waiting_on_note ?? null,
      body.follow_up_date ?? null,
    ],
  );
  await logAudit({
    userId: 'founder',
    action: 'tax_task_create',
    targetType: 'tax_ops_task',
    targetId: id,
    newValue: JSON.stringify({ title, status, priority }),
  });
  return NextResponse.json({ id });
}
