import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne, logAudit } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await queryOne('SELECT * FROM legal_overrides WHERE id = $1', [id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const fields = ['rule_changed', 'new_treatment', 'legal_basis', 'effective_date',
    'provider_match', 'description_match', 'justification'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const f of fields) {
    if (f in body) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  vals.push(id);
  await execute(`UPDATE legal_overrides SET ${sets.join(', ')} WHERE id = $${i}`, vals);

  await logAudit({
    action: 'update', targetType: 'legal_override', targetId: id,
    newValue: JSON.stringify(body),
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await execute('DELETE FROM legal_overrides WHERE id = $1', [id]);
  await logAudit({
    action: 'delete', targetType: 'legal_override', targetId: id,
    newValue: 'removed',
  });
  return NextResponse.json({ success: true });
}
