// Stint 56.C — DELETE single attachment. Removes the row + the storage
// object. Audit-logged.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execute, queryOne, logAudit } from '@/lib/db';

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachId: string }> },
): Promise<NextResponse> {
  const { id: taskId, attachId } = await params;
  const row = await queryOne<{ id: string; file_path: string; filename: string }>(
    `SELECT id, file_path, filename FROM tax_ops_task_attachments
      WHERE id = $1 AND task_id = $2`,
    [attachId, taskId],
  );
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sb = supabase();
  await sb.storage.from('documents').remove([row.file_path]);

  await execute(
    `DELETE FROM tax_ops_task_attachments WHERE id = $1`,
    [attachId],
  );

  await logAudit({
    userId: 'founder',
    action: 'task_attachment_removed',
    targetType: 'tax_ops_task',
    targetId: taskId,
    newValue: JSON.stringify({ attachment_id: attachId, filename: row.filename }),
  });

  return NextResponse.json({ ok: true });
}
