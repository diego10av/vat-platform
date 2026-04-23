import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; matter_id: string; hours: string; entry_date: string }>(
    `SELECT id, matter_id, hours::text, entry_date::text FROM crm_time_entries WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Time entry not found.', { status: 404 });

  await execute(`DELETE FROM crm_time_entries WHERE id = $1`, [id]);
  await logAudit({
    action: 'time_deleted',
    targetType: 'crm_matter',
    targetId: existing.matter_id,
    oldValue: `${existing.hours}h on ${existing.entry_date}`,
    reason: 'Time entry removed',
  });
  return NextResponse.json({ id, deleted: true });
}
