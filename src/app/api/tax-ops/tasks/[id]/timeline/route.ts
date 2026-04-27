import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/tax-ops/tasks/[id]/timeline — stint 56.B
//
// Returns the audit_log rows for a task: every status change, sign-off,
// reassignment, attachment add/remove, comment posted, etc. Anything the
// PATCH / sign / attachments endpoints have called logAudit on.
//
// Capped at 200 rows newest-first. Pagination later if needed.

interface TimelineRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const rows = await query<TimelineRow>(
    `SELECT a.id, a.action, a.target_type, a.target_id,
            a.field, a.old_value, a.new_value, a.user_id,
            a.created_at::text AS created_at
       FROM audit_log a
      WHERE a.target_type IN ('tax_ops_task', 'tax_task')
        AND a.target_id = $1
      ORDER BY a.created_at DESC
      LIMIT 200`,
    [id],
  );

  return NextResponse.json({ rows, limit: 200 });
}
