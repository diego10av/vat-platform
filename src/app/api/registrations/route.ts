import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit } from '@/lib/db';
import { defaultChecklistForRegime } from '@/config/registration-checklist';

// GET /api/registrations
// POST /api/registrations { entity_id, regime_requested, frequency_requested, ... }

export async function GET() {
  const rows = await query(
    `SELECT r.*, e.name AS entity_name
       FROM registrations r
       JOIN entities e ON r.entity_id = e.id
      WHERE e.deleted_at IS NULL
      ORDER BY r.created_at DESC`
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.entity_id) return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
  const regime = (body.regime_requested as 'simplified' | 'ordinary') || 'simplified';
  if (!['simplified', 'ordinary'].includes(regime)) {
    return NextResponse.json({ error: 'regime_requested must be simplified or ordinary' }, { status: 400 });
  }

  const entity = await queryOne('SELECT id, name FROM entities WHERE id = $1', [body.entity_id]);
  if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  const id = generateId();
  const checklist = defaultChecklistForRegime(regime);

  await execute(
    `INSERT INTO registrations (id, entity_id, status, regime_requested, frequency_requested,
                                 tax_office, triggered_by, expected_turnover, comments_field,
                                 docs_checklist, notes)
     VALUES ($1, $2, 'docs_requested', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, body.entity_id, regime,
      body.frequency_requested || null,
      body.tax_office || null,
      body.triggered_by || null,
      body.expected_turnover ?? null,
      body.comments_field || null,
      JSON.stringify(checklist),
      body.notes || null,
    ]
  );

  await logAudit({
    entityId: body.entity_id,
    action: 'create',
    targetType: 'registration',
    targetId: id,
    newValue: JSON.stringify({ regime, frequency: body.frequency_requested }),
  });

  return NextResponse.json({ id, success: true }, { status: 201 });
}
