// POST /api/entities/[id]/restore — un-archive a soft-deleted entity.

import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { requireSession } from '@/lib/require-role';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const roleFail = await requireSession(request);
  if (roleFail) return roleFail;

  const existing = await queryOne<{ id: string; name: string; deleted_at: string | null }>(
    'SELECT id, name, deleted_at FROM entities WHERE id = $1',
    [id],
  );
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!existing.deleted_at) return NextResponse.json({ ok: true, already_active: true });

  await execute(
    `UPDATE entities SET deleted_at = NULL, deleted_reason = NULL, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await logAudit({
    entityId: id,
    action: 'restore',
    targetType: 'entity',
    targetId: id,
    newValue: JSON.stringify({ name: existing.name }),
  });
  return NextResponse.json({ ok: true, restored: true });
}
