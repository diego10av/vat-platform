import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/aed?entity_id=
export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get('entity_id');
  let rows;
  if (entityId) {
    rows = await query(
      `SELECT a.*, e.name AS entity_name FROM aed_communications a
         LEFT JOIN entities e ON a.entity_id = e.id
        WHERE a.entity_id = $1
        ORDER BY a.uploaded_at DESC`,
      [entityId]
    );
  } else {
    rows = await query(
      `SELECT a.*, e.name AS entity_name FROM aed_communications a
         LEFT JOIN entities e ON a.entity_id = e.id
        ORDER BY a.uploaded_at DESC LIMIT 200`
    );
  }
  return NextResponse.json(rows);
}
