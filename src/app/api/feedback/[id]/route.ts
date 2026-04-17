// ════════════════════════════════════════════════════════════════════════
// PATCH  /api/feedback/[id] — update status / add resolution note
// DELETE /api/feedback/[id] — hard delete (rare; triage can set
//                             status='wontfix' instead)
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const STATUSES = ['new', 'triaged', 'resolved', 'wontfix'] as const;

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?feedback["']? does not exist/i.test(msg);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      resolution_note?: string;
    };

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM feedback WHERE id = $1',
      [id],
    );
    if (!existing) return apiError('not_found', 'Feedback item not found.', { status: 404 });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (typeof body.status === 'string') {
      if (!STATUSES.includes(body.status as typeof STATUSES[number])) {
        return apiError('bad_status', `status must be one of: ${STATUSES.join(', ')}`, { status: 400 });
      }
      sets.push(`status = $${i++}`);
      vals.push(body.status);
      if (body.status === 'resolved' || body.status === 'wontfix') {
        sets.push(`resolved_at = NOW()`);
      }
    }
    if (typeof body.resolution_note === 'string') {
      sets.push(`resolution_note = $${i++}`);
      vals.push(body.resolution_note.slice(0, 2000));
    }

    if (sets.length === 0) {
      return apiError('no_changes', 'Nothing to update.', { status: 400 });
    }

    vals.push(id);
    await execute(`UPDATE feedback SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    await logAudit({
      action: 'triage_feedback',
      targetType: 'feedback',
      targetId: id,
      newValue: JSON.stringify(body),
    });

    return apiOk({ ok: true });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Run migration 002 first.', { status: 501 });
    }
    return apiFail(err, 'feedback/patch');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM feedback WHERE id = $1',
      [id],
    );
    if (!existing) return apiError('not_found', 'Feedback item not found.', { status: 404 });

    await execute('DELETE FROM feedback WHERE id = $1', [id]);
    await logAudit({
      action: 'delete_feedback',
      targetType: 'feedback',
      targetId: id,
    });
    return apiOk({ ok: true });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Run migration 002 first.', { status: 501 });
    }
    return apiFail(err, 'feedback/delete');
  }
}
