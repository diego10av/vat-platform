import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET  /api/tax-ops/client-groups  — list all families (active + archived)
//                                     with entity counts per group
// POST /api/tax-ops/client-groups  — create new family. Body: { name, notes? }
//
// Stint 37.E: Diego manages his own families now. CRUD with soft archive,
// name uniqueness, entity count surfaced for the Settings UI.

interface GroupListRow {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  entity_count: number;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const rows = await query<GroupListRow>(
    `SELECT g.id, g.name, g.is_active, g.notes,
            (SELECT COUNT(*)::int FROM tax_entities e
              WHERE e.client_group_id = g.id AND e.is_active = TRUE) AS entity_count,
            g.created_at::text, g.updated_at::text
       FROM tax_client_groups g
      ORDER BY g.is_active DESC, g.name ASC`,
  );
  return NextResponse.json({ groups: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { name?: string; notes?: string | null };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  const id = generateId();
  try {
    await execute(
      `INSERT INTO tax_client_groups (id, name, notes) VALUES ($1, $2, $3)`,
      [id, name, body.notes ?? null],
    );
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: 'name_exists' }, { status: 409 });
    }
    throw e;
  }

  await logAudit({
    userId: 'founder',
    action: 'tax_client_group_create',
    targetType: 'tax_client_group',
    targetId: id,
    newValue: JSON.stringify({ name }),
  });

  return NextResponse.json({ id, name });
}
