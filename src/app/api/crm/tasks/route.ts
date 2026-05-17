import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// GET /api/crm/tasks — list with status + priority + due filters.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const relatedType = url.searchParams.get('related_type');
  const relatedId = url.searchParams.get('related_id');
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  } else {
    // Default: show only open / in_progress.
    conditions.push(`status IN ('open', 'in_progress', 'snoozed')`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`priority = $${params.length}`);
  }
  if (relatedType && relatedId) {
    params.push(relatedType);
    conditions.push(`related_type = $${params.length}`);
    params.push(relatedId);
    conditions.push(`related_id = $${params.length}`);
  }
  params.push(limit);

  const rows = await query(
    `SELECT id, title, description, status, priority, due_date,
            assignee, related_type, related_id, auto_generated,
            completed_at, created_at
       FROM crm_tasks
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
          ELSE 4
        END,
        due_date ASC NULLS LAST,
        created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json(rows);
}

// POST /api/crm/tasks — create a manual task.
export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.title || typeof body.title !== 'string') {
    return apiError('title_required', 'title is required.', { status: 400 });
  }
  const id = generateId();
  await execute(
    `INSERT INTO crm_tasks
       (id, title, description, status, priority, due_date,
        assignee, related_type, related_id, auto_generated, created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,NOW())`,
    [
      id, body.title, body.description ?? null,
      body.status ?? 'open',
      body.priority ?? 'medium',
      body.due_date ?? null,
      body.assignee ?? null,
      body.related_type ?? null,
      body.related_id ?? null,
      body.created_by ?? null,
    ],
  );
  return NextResponse.json({ id }, { status: 201 });
}
