import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, buildUpdate } from '@/lib/db';

// PATCH  /api/tax-ops/client-groups/[id] — rename / archive / edit notes
// DELETE /api/tax-ops/client-groups/[id] — hard delete.
//        By default blocked when entities still reference the group.
//        With ?unassign=1 the endpoint first nulls out `client_group_id`
//        on every referencing entity, then deletes the group. Entities
//        and their filings/obligations are untouched — they just lose
//        the family label. (Stint 39.E: Diego wanted "CTR y CSR no es
//        familia de nada" — delete family without losing entities.)

const ALLOWED = ['name', 'is_active', 'notes'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const { sql, values, changes } = buildUpdate(
    'tax_client_groups', ALLOWED, body, 'id', id, ['updated_at = NOW()'],
  );
  if (!sql) return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  try {
    await execute(sql, values);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: 'name_exists' }, { status: 409 });
    }
    throw e;
  }
  await logAudit({
    userId: 'founder',
    action: 'tax_client_group_update',
    targetType: 'tax_client_group',
    targetId: id,
    newValue: JSON.stringify(changes),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const unassign = request.nextUrl.searchParams.get('unassign') === '1';

  const refs = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM tax_entities WHERE client_group_id = $1`,
    [id],
  );
  const refCount = Number(refs[0]?.n ?? 0);
  if (refCount > 0 && !unassign) {
    return NextResponse.json(
      { error: 'has_entities', entity_count: refCount },
      { status: 409 },
    );
  }
  if (refCount > 0 && unassign) {
    await execute(
      `UPDATE tax_entities SET client_group_id = NULL, updated_at = NOW() WHERE client_group_id = $1`,
      [id],
    );
  }
  await execute(`DELETE FROM tax_client_groups WHERE id = $1`, [id]);
  await logAudit({
    userId: 'founder',
    action: 'tax_client_group_delete',
    targetType: 'tax_client_group',
    targetId: id,
    newValue: JSON.stringify({ unassigned_entities: refCount }),
  });
  return NextResponse.json({ ok: true, unassigned_entities: refCount });
}
