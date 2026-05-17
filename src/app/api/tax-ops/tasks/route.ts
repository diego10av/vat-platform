import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET  /api/tax-ops/tasks
//   ?status=queued&status=in_progress&priority=high&assignee=Gab&
//    due_in_days=14&related_filing=<id>&related_entity=<id>&q=text&
//    parent=<id>&view=list|board
//   Stint 51.A — filter by entity_id (new column from mig 048) or
//   family_id (joins via tax_entities.client_group_id):
//   ?entity_id=<id>&family_id=<id>
//
// POST /api/tax-ops/tasks  — create. Body carries all task fields
//    except id/timestamps. Supports subtasks (pass parent_task_id)
//    and dependencies (depends_on_task_id).

interface TaskListRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  // Stint 84.B — what the list view shows to avoid the "engagement looks
  // done but workstreams are still open" lie. Equals `status` unless the
  // task is closed (done/cancelled) AND has open sub-tasks; then rolls
  // up to the most-urgent open child status.
  effective_status: string;
  is_status_rolled_up: boolean;
  priority: string;
  due_date: string | null;
  remind_at: string | null;
  parent_task_id: string | null;
  depends_on_task_id: string | null;
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
  subtask_open: number;
  comment_count: number;
  related_entity_name: string | null;
  related_filing_label: string | null;
  // Stint 55.B — blocker fields
  blocker_title: string | null;
  blocker_status: string | null;
  // Stint 56.A — sign-off snapshot for the chip in title cell.
  preparer: string | null;
  reviewer: string | null;
  partner_sign_off: string | null;
  // Stint 56.D — favourite.
  is_starred: boolean;
  // Stint 84.C — deliverables list (used for the "X/Y drafted" roll-up
  // chip on collapsed rows). Always returned; empty array when none.
  deliverables: Array<{
    id: string;
    label: string;
    status: 'pending' | 'drafted' | 'reviewed' | 'signed' | 'filed' | 'na';
    due_date: string | null;
    link_url: string | null;
    notes: string | null;
    sort_order: number;
  }>;
  // Stint 84.E — stale signal: TRUE when the task is in waiting_on_*
  // status AND no comment has been posted in the last 5 days. Surfaced
  // as a red chip on the row + drives the "Chase today" home dashboard
  // section.
  is_stale: boolean;
  stale_days: number | null;
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
  const entityId = url.searchParams.get('entity_id');     // Stint 51.A — new column
  const familyId = url.searchParams.get('family_id');     // Stint 51.A — via group join
  const parentId = url.searchParams.get('parent');
  const q = url.searchParams.get('q')?.trim() ?? '';
  const onlyRoot = url.searchParams.get('only_root') === '1';
  // Stint 55.B — "Ready to work on" filter: exclude tasks blocked by
  // a dependency that hasn't been completed.
  const onlyReady = url.searchParams.get('ready') === '1';
  // Stint 56.D — "Starred only" filter.
  const onlyStarred = url.searchParams.get('starred') === '1';
  // Stint 84.E — "Stale only" filter for the home dashboard "Chase today"
  // section. waiting_on_* + no comment in last 5d.
  const onlyStale = url.searchParams.get('stale') === '1';

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
  // Stint 51.A — match against entity_id (new) OR related_entity_id (legacy) so the
  //              entity detail "Tasks" widget surfaces tasks regardless of which
  //              column was populated when the task was created.
  if (entityId) {
    where.push(`(t.entity_id = $${pi} OR t.related_entity_id = $${pi})`);
    params.push(entityId); pi += 1;
  }
  if (familyId) {
    where.push(`COALESCE(t.entity_id, t.related_entity_id) IN
                  (SELECT id FROM tax_entities WHERE client_group_id = $${pi})`);
    params.push(familyId); pi += 1;
  }
  if (parentId) {
    where.push(`t.parent_task_id = $${pi}`); params.push(parentId); pi += 1;
  } else if (onlyRoot) {
    where.push(`t.parent_task_id IS NULL`);
  }
  if (q) {
    where.push(`(t.title ILIKE $${pi} OR t.description ILIKE $${pi} OR $${pi} = ANY(t.tags))`);
    params.push(`%${q}%`); pi += 1;
  }
  if (onlyReady) {
    where.push(
      `(t.depends_on_task_id IS NULL
        OR (SELECT b.status FROM tax_ops_tasks b WHERE b.id = t.depends_on_task_id) = 'done')`,
    );
  }
  if (onlyStarred) {
    where.push(`t.is_starred = TRUE`);
  }
  if (onlyStale) {
    where.push(
      `t.status IN ('waiting_on_external','waiting_on_internal')
        AND COALESCE(
              (SELECT MAX(c.created_at) FROM tax_ops_task_comments c WHERE c.task_id = t.id),
              t.updated_at
            ) < NOW() - INTERVAL '5 days'`,
    );
  }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query<TaskListRow>(
    `SELECT t.id, t.title, t.description, t.status, t.priority,
            t.due_date::text, t.remind_at::text,
            t.parent_task_id, t.depends_on_task_id, t.tags,
            t.related_filing_id, t.related_entity_id,
            t.assignee, t.auto_generated,
            t.entity_id, t.task_kind, t.waiting_on_kind,
            t.waiting_on_note, t.follow_up_date::text,
            t.completed_at::text, t.created_at::text, t.updated_at::text,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s WHERE s.parent_task_id = t.id) AS subtask_total,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s WHERE s.parent_task_id = t.id AND s.status = 'done') AS subtask_done,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s
              WHERE s.parent_task_id = t.id
                AND s.status NOT IN ('done','cancelled')) AS subtask_open,
            -- Stint 84.B — effective_status: roll up to the most-urgent
            -- open child when the parent is in a closed state but has
            -- workstreams still in flight. Otherwise == raw status.
            COALESCE(
              CASE WHEN t.status IN ('done','cancelled')
                THEN (SELECT s.status FROM tax_ops_tasks s
                       WHERE s.parent_task_id = t.id
                         AND s.status NOT IN ('done','cancelled')
                       ORDER BY CASE s.status
                                  WHEN 'waiting_on_external' THEN 0
                                  WHEN 'in_progress'         THEN 1
                                  WHEN 'waiting_on_internal' THEN 2
                                  WHEN 'queued'              THEN 3
                                  ELSE 4 END
                       LIMIT 1)
              END,
              t.status
            ) AS effective_status,
            (t.status IN ('done','cancelled')
             AND EXISTS (SELECT 1 FROM tax_ops_tasks s
                          WHERE s.parent_task_id = t.id
                            AND s.status NOT IN ('done','cancelled'))) AS is_status_rolled_up,
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
            -- Stint 53 — family_id surfaced so the list page can link
            -- the chip to /tax-ops/families/[id].
            COALESCE(
              (SELECT g.id FROM tax_entities e4 LEFT JOIN tax_client_groups g ON g.id = e4.client_group_id WHERE e4.id = t.entity_id),
              (SELECT g.id FROM tax_entities e5 LEFT JOIN tax_client_groups g ON g.id = e5.client_group_id WHERE e5.id = t.related_entity_id)
            ) AS family_id,
            CASE WHEN f.id IS NOT NULL
                 THEN (SELECT ent.legal_name FROM tax_obligations o
                        JOIN tax_entities ent ON ent.id = o.entity_id
                        WHERE o.id = f.obligation_id) || ' · ' || f.period_label
                 ELSE NULL END AS related_filing_label,
            -- Stint 55.B — blocker info so the list page can render
            -- "🔒 blocked by X" / "🔓 ready" indicators.
            (SELECT b.title FROM tax_ops_tasks b WHERE b.id = t.depends_on_task_id) AS blocker_title,
            (SELECT b.status FROM tax_ops_tasks b WHERE b.id = t.depends_on_task_id) AS blocker_status,
            -- Stint 56.A — sign-off snapshot for the chip in title cell.
            t.preparer, t.reviewer, t.partner_sign_off,
            -- Stint 56.D — favourite.
            t.is_starred,
            -- Stint 84.E — stale follow-up signal. The "anchor" date for
            -- staleness is the most recent of:
            --   (a) last comment on this task, OR
            --   (b) task.updated_at if no comment exists yet.
            -- A task is stale when status is waiting_on_external/internal
            -- AND that anchor is older than 5 days. The day-count is
            -- surfaced so the UI can render "8d stale" instead of just a
            -- boolean.
            CASE
              WHEN t.status IN ('waiting_on_external','waiting_on_internal')
               AND COALESCE(
                     (SELECT MAX(c.created_at) FROM tax_ops_task_comments c WHERE c.task_id = t.id),
                     t.updated_at
                   ) < NOW() - INTERVAL '5 days'
              THEN TRUE ELSE FALSE
            END AS is_stale,
            CASE
              WHEN t.status IN ('waiting_on_external','waiting_on_internal')
              THEN GREATEST(0, EXTRACT(EPOCH FROM (
                    NOW() - COALESCE(
                      (SELECT MAX(c.created_at) FROM tax_ops_task_comments c WHERE c.task_id = t.id),
                      t.updated_at
                    )
                  ))::int / 86400)
              ELSE NULL
            END AS stale_days
       FROM tax_ops_tasks t
       LEFT JOIN tax_filings f ON f.id = t.related_filing_id
       ${whereSQL}
      -- Stint 53 — Diego: "que las que la fecha de actuación sean las
      -- más próximas, aparezcan arriba". The "next action date" is the
      -- earliest of follow_up_date (chase reminder) and due_date. We
      -- rank by COALESCE(follow_up_date, due_date) ASC NULLS LAST so
      -- whatever's most imminent floats to the top, then break ties on
      -- priority then created_at. Done tasks always sink to the bottom
      -- regardless of their dates.
      ORDER BY
        CASE WHEN t.status IN ('done','cancelled') THEN 1 ELSE 0 END,
        -- Stint 56.D — starred bubbles to the top within each status bucket.
        CASE WHEN t.is_starred THEN 0 ELSE 1 END,
        COALESCE(t.follow_up_date, t.due_date) ASC NULLS LAST,
        CASE t.priority
          WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.created_at DESC`,
    params,
  );

  // Stint 84.D — fetch deliverables for every visible task in one
  // batch from the dedicated table and attach to each row. Roll-up
  // chip on the row needs status counts — full row data is light.
  const taskIds = rows.map(r => r.id);
  if (taskIds.length > 0) {
    const deliverables = await query<{
      id: string; task_id: string; label: string; status: string;
      due_date: string | null; link_url: string | null;
      notes: string | null; sort_order: number;
    }>(
      `SELECT id, task_id, label, status,
              due_date::text AS due_date,
              link_url, notes, sort_order
         FROM tax_ops_task_deliverables
        WHERE task_id = ANY($1::text[])
        ORDER BY sort_order ASC, created_at ASC`,
      [taskIds],
    );
    const byTask = new Map<string, typeof deliverables>();
    for (const d of deliverables) {
      const list = byTask.get(d.task_id) ?? [];
      list.push(d);
      byTask.set(d.task_id, list);
    }
    for (const r of rows) {
      (r as unknown as { deliverables: unknown }).deliverables =
        (byTask.get(r.id) ?? []).map(({ task_id: _, ...rest }) => rest);
    }
  } else {
    for (const r of rows) (r as unknown as { deliverables: unknown }).deliverables = [];
  }

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
        parent_task_id, depends_on_task_id, tags,
        related_filing_id, related_entity_id, assignee, auto_generated, created_by,
        entity_id, task_kind, waiting_on_kind, waiting_on_note, follow_up_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'founder',
             $15,$16,$17,$18,$19)`,
    [
      id, title, body.description ?? null, status, priority,
      body.due_date ?? null, body.remind_at ?? null,
      body.parent_task_id ?? null, body.depends_on_task_id ?? null,
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
