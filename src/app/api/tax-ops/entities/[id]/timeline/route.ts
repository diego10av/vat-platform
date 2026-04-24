import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/tax-ops/entities/[id]/timeline
//
// Stint 42.A — returns the entity's full activity history from
// audit_log, covering:
//   - the entity itself (target_type = 'tax_entity')
//   - any of its obligations (target_type = 'tax_obligation')
//   - any of its filings (target_type = 'tax_filing')
//   - bulk actions that mention this entity in their newValue JSON
//     (covered implicitly by the 3 above because bulk endpoints also
//      emit per-target rows via logAuditTx).
//
// Ordered newest first. Capped at 200 rows today; pagination can
// come later if Diego asks.

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

  const rows = await query<TimelineRow>(`
    SELECT a.id, a.action, a.target_type, a.target_id,
           a.field, a.old_value, a.new_value, a.user_id,
           a.created_at::text AS created_at
      FROM audit_log a
     WHERE
       (a.target_type = 'tax_entity' AND a.target_id = $1)
       OR (a.target_type = 'tax_obligation' AND a.target_id IN (
         SELECT id FROM tax_obligations WHERE entity_id = $1
       ))
       OR (a.target_type = 'tax_filing' AND a.target_id IN (
         SELECT f.id FROM tax_filings f
           JOIN tax_obligations o ON o.id = f.obligation_id
          WHERE o.entity_id = $1
       ))
     ORDER BY a.created_at DESC
     LIMIT 200
  `, [id]);

  return NextResponse.json({ rows, limit: 200 });
}
