import { NextRequest, NextResponse } from 'next/server';
import { execute, logAudit, buildUpdate } from '@/lib/db';

// PATCH /api/tax-ops/team/[id]   — update fields
// DELETE /api/tax-ops/team/[id]  — hard delete (audit-logged)

const ALLOWED = ['short_name', 'full_name', 'email', 'is_active'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const { sql, values, changes } = buildUpdate(
    'tax_team_members', ALLOWED, body, 'id', id, ['updated_at = NOW()'],
  );
  if (!sql) return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  try {
    await execute(sql, values);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: 'short_name_exists' }, { status: 409 });
    }
    throw e;
  }
  await logAudit({
    userId: 'founder',
    action: 'tax_team_update',
    targetType: 'tax_team_member',
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
  await execute(`DELETE FROM tax_team_members WHERE id = $1`, [id]);
  await logAudit({
    userId: 'founder',
    action: 'tax_team_delete',
    targetType: 'tax_team_member',
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}
