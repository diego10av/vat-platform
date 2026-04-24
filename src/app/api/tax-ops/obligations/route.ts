import { NextRequest, NextResponse } from 'next/server';
import { execute, query, generateId, logAudit } from '@/lib/db';

// POST /api/tax-ops/obligations
//   Body: { entity_id, tax_type, period_pattern, service_kind? }
//   Creates a new obligation template on an entity. Used by the NWT
//   opt-in cell (creates service_kind='review') and the "+ Add
//   entity to family" flow (creates service_kind='filing').
//   Idempotent — ON CONFLICT DO NOTHING.

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    entity_id?: string;
    tax_type?: string;
    period_pattern?: string;
    service_kind?: 'filing' | 'review';
  };

  if (!body.entity_id || !body.tax_type || !body.period_pattern) {
    return NextResponse.json(
      { error: 'entity_id_tax_type_period_pattern_required' },
      { status: 400 },
    );
  }

  const id = generateId();
  const service_kind = body.service_kind ?? 'filing';

  await execute(
    `INSERT INTO tax_obligations
       (id, entity_id, tax_type, period_pattern, service_kind, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (entity_id, tax_type, period_pattern) DO UPDATE
       SET is_active = TRUE, service_kind = EXCLUDED.service_kind,
           updated_at = NOW()`,
    [id, body.entity_id, body.tax_type, body.period_pattern, service_kind],
  );

  // Read-back the canonical id (ON CONFLICT may have preserved an
  // earlier one).
  const rows = await query<{ id: string }>(
    `SELECT id FROM tax_obligations
      WHERE entity_id = $1 AND tax_type = $2 AND period_pattern = $3`,
    [body.entity_id, body.tax_type, body.period_pattern],
  );

  await logAudit({
    userId: 'founder',
    action: 'tax_obligation_create',
    targetType: 'tax_obligation',
    targetId: rows[0]?.id ?? id,
    newValue: JSON.stringify({
      entity_id: body.entity_id,
      tax_type: body.tax_type,
      period_pattern: body.period_pattern,
      service_kind,
    }),
  });

  return NextResponse.json({ id: rows[0]?.id ?? id });
}
