import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// PUT /api/crm/taxonomies/[id] — rename, reorder, or archive/unarchive.
// Body accepts: { label?, sort_order?, archived? }
// Value is intentionally NOT editable — changing a value would orphan
// every existing record using it. Rename via label instead.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const row = await queryOne<{ id: string; kind: string; value: string; label: string; is_system: boolean }>(
    `SELECT id, kind, value, label, is_system FROM crm_taxonomies WHERE id = $1`,
    [id],
  );
  if (!row) return apiError('not_found', 'Taxonomy entry not found.', { status: 404 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const changes: string[] = [];

  if (typeof body.label === 'string' && body.label.trim() && body.label.trim() !== row.label) {
    sets.push(`label = $${i}`); vals.push(body.label.trim()); i += 1;
    changes.push(`label → ${body.label.trim()}`);
  }
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    sets.push(`sort_order = $${i}`); vals.push(body.sort_order); i += 1;
    changes.push(`sort_order → ${body.sort_order}`);
  }
  if (typeof body.archived === 'boolean') {
    sets.push(`archived = $${i}`); vals.push(body.archived); i += 1;
    changes.push(body.archived ? 'archived' : 'unarchived');
  }

  if (sets.length === 0) return NextResponse.json({ id, changed: [] });

  sets.push('updated_at = NOW()');
  vals.push(id);
  await execute(`UPDATE crm_taxonomies SET ${sets.join(', ')} WHERE id = $${i}`, vals);

  await logAudit({
    action: 'taxonomy_updated',
    targetType: 'crm_taxonomy',
    targetId: id,
    field: row.kind,
    newValue: changes.join(' · '),
    reason: `${row.kind} '${row.value}' updated: ${changes.join('; ')}`,
  });

  return NextResponse.json({ id, changed: changes });
}

// DELETE /api/crm/taxonomies/[id] — hard delete. Blocked if is_system
// (must archive instead to preserve values on existing records).
// User-added entries can be deleted freely; we warn but don't gate
// on existing-reference count (no cross-table FK — the value is a
// plain string on the entity row).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await queryOne<{ id: string; kind: string; value: string; is_system: boolean }>(
    `SELECT id, kind, value, is_system FROM crm_taxonomies WHERE id = $1`,
    [id],
  );
  if (!row) return apiError('not_found', 'Taxonomy entry not found.', { status: 404 });
  if (row.is_system) {
    return apiError(
      'system_protected',
      'System taxonomy values cannot be deleted — archive them instead to hide from new dropdowns.',
      { status: 400 },
    );
  }

  await execute(`DELETE FROM crm_taxonomies WHERE id = $1`, [id]);
  await logAudit({
    action: 'taxonomy_deleted',
    targetType: 'crm_taxonomy',
    targetId: id,
    field: row.kind,
    oldValue: row.value,
    reason: `${row.kind} '${row.value}' deleted`,
  });
  return NextResponse.json({ id, deleted: true });
}
