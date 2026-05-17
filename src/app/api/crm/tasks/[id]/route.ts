import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

const UPDATABLE_FIELDS = [
  'title', 'description', 'status', 'priority', 'due_date',
  'assignee', 'related_type', 'related_id',
] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = await queryOne(
    `SELECT * FROM crm_tasks WHERE id = $1`,
    [id],
  );
  if (!task) return apiError('not_found', 'Task not found.', { status: 404 });
  return NextResponse.json(task);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_tasks WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Task not found.', { status: 404 });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const changed: Array<{ field: UpdatableField; before: unknown; after: unknown }> = [];
  let idx = 1;
  let statusChanged = false;
  let nextStatus: string | null = null;

  for (const f of UPDATABLE_FIELDS) {
    if (!(f in body)) continue;
    let next = body[f];
    if (typeof next === 'string') next = next.trim() || null;
    if (f === 'title' && !next) return apiError('title_required', 'title cannot be empty.', { status: 400 });
    const before = existing[f] ?? null;
    const beforeStr = String(before ?? '');
    const afterStr = String(next ?? '');
    if (beforeStr === afterStr) continue;
    setClauses.push(`${f} = $${idx}`);
    values.push(next);
    idx += 1;
    changed.push({ field: f, before, after: next });
    if (f === 'status') { statusChanged = true; nextStatus = (next as string) ?? null; }
  }

  // Status → done means set completed_at.
  if (statusChanged && nextStatus === 'done') {
    setClauses.push(`completed_at = NOW()`);
  }
  // Reverting done → open clears completed_at.
  if (statusChanged && nextStatus !== 'done' && existing.status === 'done') {
    setClauses.push(`completed_at = NULL`);
  }

  if (changed.length === 0) return NextResponse.json({ id, changed: [] });

  setClauses.push(`updated_at = NOW()`);
  values.push(id);
  await execute(
    `UPDATE crm_tasks SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );

  for (const c of changed) {
    await logAudit({
      action: 'update',
      targetType: 'crm_task',
      targetId: id,
      field: c.field,
      oldValue: String(c.before ?? ''),
      newValue: String(c.after ?? ''),
    });
  }

  return NextResponse.json({ id, changed: changed.map(c => c.field) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; title: string }>(
    `SELECT id, title FROM crm_tasks WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Task not found.', { status: 404 });

  // Tasks: hard delete (no deleted_at column). "Cancelled" status is the
  // soft equivalent if the user wants to keep the record.
  await execute(`DELETE FROM crm_tasks WHERE id = $1`, [id]);
  await logAudit({
    action: 'delete',
    targetType: 'crm_task',
    targetId: id,
    oldValue: existing.title,
    reason: 'Permanent deletion',
  });
  return NextResponse.json({ id, deleted: true });
}
