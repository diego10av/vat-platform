import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne, logAudit } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET /api/aed/:id?action=url  → returns signed URL for the document
// PATCH /api/aed/:id  → update status / fields
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const action = request.nextUrl.searchParams.get('action');
  const rec = await queryOne<{ file_path: string; filename: string }>(
    'SELECT file_path, filename FROM aed_communications WHERE id = $1',
    [id]
  );
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'url') {
    const { data, error } = await supabase().storage.from('documents').createSignedUrl(rec.file_path, 600);
    if (error || !data) return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
    return NextResponse.json({ url: data.signedUrl, filename: rec.filename });
  }
  return NextResponse.json(rec);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const rec = await queryOne<{ entity_id: string | null; status: string }>(
    'SELECT entity_id, status FROM aed_communications WHERE id = $1',
    [id]
  );
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const f of ['status', 'type', 'urgency', 'summary', 'reference', 'amount', 'deadline_date']) {
    if (f in body) {
      sets.push(`${f} = $${i}`);
      vals.push(body[f]);
      i++;
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  await execute(`UPDATE aed_communications SET ${sets.join(', ')} WHERE id = $${i}`, vals);

  if (body.status && body.status !== rec.status && rec.entity_id) {
    await logAudit({
      entityId: rec.entity_id,
      action: 'update', targetType: 'aed_communication', targetId: id,
      field: 'status', oldValue: rec.status, newValue: body.status,
    });
  }
  return NextResponse.json({ success: true });
}
