import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, buildUpdate } from '@/lib/db';

// PATCH  /api/tax-ops/client-groups/[id] — rename / archive / edit notes
// DELETE /api/tax-ops/client-groups/[id] — hard delete (blocked if entities
//                                           still reference it; caller must
//                                           archive first, or reassign
//                                           entities, then delete).

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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // Block hard-delete when entities still reference this group — force the
  // user to reassign or archive first.
  const refs = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM tax_entities WHERE client_group_id = $1`,
    [id],
  );
  const refCount = Number(refs[0]?.n ?? 0);
  if (refCount > 0) {
    return NextResponse.json(
      { error: 'has_entities', entity_count: refCount },
      { status: 409 },
    );
  }
  await execute(`DELETE FROM tax_client_groups WHERE id = $1`, [id]);
  await logAudit({
    userId: 'founder',
    action: 'tax_client_group_delete',
    targetType: 'tax_client_group',
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}
