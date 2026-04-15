import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/audit?entity_id=&declaration_id=&action=&since=&limit=
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const entityId = sp.get('entity_id');
  const declarationId = sp.get('declaration_id');
  const action = sp.get('action');
  const since = sp.get('since');
  const limit = Math.min(parseInt(sp.get('limit') || '500', 10) || 500, 2000);

  const where: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (entityId) { where.push(`a.entity_id = $${i++}`); vals.push(entityId); }
  if (declarationId) { where.push(`a.declaration_id = $${i++}`); vals.push(declarationId); }
  if (action) { where.push(`a.action = $${i++}`); vals.push(action); }
  if (since) { where.push(`a.created_at >= $${i++}`); vals.push(since); }

  const sql = `
    SELECT a.id, a.user_id, a.entity_id, a.declaration_id, a.action, a.target_type,
           a.target_id, a.field, a.old_value, a.new_value, a.created_at,
           e.name AS entity_name, d.year, d.period
      FROM audit_log a
      LEFT JOIN entities e ON a.entity_id = e.id
      LEFT JOIN declarations d ON a.declaration_id = d.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.created_at DESC
     LIMIT $${i}
  `;
  vals.push(limit);

  const rows = await query(sql, vals);

  // Distinct values for filter dropdowns
  const actions = await query<{ action: string }>('SELECT DISTINCT action FROM audit_log ORDER BY action');
  const counts = await query<{ action: string; n: number }>(
    `SELECT action, COUNT(*)::int AS n FROM audit_log GROUP BY action ORDER BY n DESC`
  );

  return NextResponse.json({ rows, actions: actions.map(a => a.action), counts });
}
