import { NextRequest, NextResponse } from 'next/server';
import { execute, query, generateId, logAudit } from '@/lib/db';

// POST /api/tax-ops/obligations
//   Body: { entity_id, tax_type, period_pattern, service_kind? }
//   Creates a new obligation template on an entity. Used by the NWT
//   opt-in cell (creates service_kind='review') and the "+ Add
//   entity to family" flow (creates service_kind='filing').
//   Idempotent — ON CONFLICT DO NOTHING.
//
// Stint 51.H — LTVA enforcement at the API boundary.
//   When a vat_quarterly or vat_monthly obligation is created, the
//   annual recapitulative (vat_annual) is auto-created on the same
//   entity if it doesn't already exist. See docs/ltva-procedural-
//   rules.md §1 for the legal basis (Art. 64bis + AED Circ. 765bis).
//   This guards every entry point — UI flows already enforce the
//   rule visually, but a script or future feature hitting the API
//   directly is now also covered.

const VAT_PERIODIC_TAX_TYPES = new Set(['vat_quarterly', 'vat_monthly']);

async function insertObligation(
  entityId: string,
  taxType: string,
  periodPattern: string,
  serviceKind: 'filing' | 'review',
): Promise<string> {
  const id = generateId();
  await execute(
    `INSERT INTO tax_obligations
       (id, entity_id, tax_type, period_pattern, service_kind, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (entity_id, tax_type, period_pattern) DO UPDATE
       SET is_active = TRUE, service_kind = EXCLUDED.service_kind,
           updated_at = NOW()`,
    [id, entityId, taxType, periodPattern, serviceKind],
  );
  const rows = await query<{ id: string }>(
    `SELECT id FROM tax_obligations
      WHERE entity_id = $1 AND tax_type = $2 AND period_pattern = $3`,
    [entityId, taxType, periodPattern],
  );
  return rows[0]?.id ?? id;
}

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

  const service_kind = body.service_kind ?? 'filing';
  const obligationId = await insertObligation(
    body.entity_id, body.tax_type, body.period_pattern, service_kind,
  );

  await logAudit({
    userId: 'founder',
    action: 'tax_obligation_create',
    targetType: 'tax_obligation',
    targetId: obligationId,
    newValue: JSON.stringify({
      entity_id: body.entity_id,
      tax_type: body.tax_type,
      period_pattern: body.period_pattern,
      service_kind,
    }),
  });

  // LTVA companion rule — auto-create vat_annual when periodic VAT
  // lands. Idempotent (the INSERT uses ON CONFLICT, so calling this
  // when the entity already has vat_annual is a no-op except for the
  // updated_at bump). The audit_log carries the `auto_companion: true`
  // flag so it's clear in history that the row wasn't user-typed.
  if (
    VAT_PERIODIC_TAX_TYPES.has(body.tax_type)
    && service_kind === 'filing'
  ) {
    const companionId = await insertObligation(
      body.entity_id, 'vat_annual', 'annual', 'filing',
    );
    await logAudit({
      userId: 'founder',
      action: 'tax_obligation_create',
      targetType: 'tax_obligation',
      targetId: companionId,
      newValue: JSON.stringify({
        entity_id: body.entity_id,
        tax_type: 'vat_annual',
        period_pattern: 'annual',
        service_kind: 'filing',
        auto_companion: true,
        triggered_by: body.tax_type,
        ltva_basis: 'Art. 64bis + AED Circ. 765bis',
      }),
    });
  }

  return NextResponse.json({ id: obligationId });
}
