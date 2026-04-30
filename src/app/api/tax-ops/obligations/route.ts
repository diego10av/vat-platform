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
  serviceKind: 'filing' | 'review' | 'provision',
): Promise<string> {
  const id = generateId();
  // Stint 64.X.1.c (mig 071) — UNIQUE is now on the 4-tuple including
  // service_kind, so the same entity can hold parallel filing +
  // provision + review obligations. ON CONFLICT idempotent re-activates
  // an existing match without overwriting the service_kind, which is
  // now correctly the disambiguator.
  await execute(
    `INSERT INTO tax_obligations
       (id, entity_id, tax_type, period_pattern, service_kind, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (entity_id, tax_type, period_pattern, service_kind) DO UPDATE
       SET is_active = TRUE, updated_at = NOW()`,
    [id, entityId, taxType, periodPattern, serviceKind],
  );
  const rows = await query<{ id: string }>(
    `SELECT id FROM tax_obligations
      WHERE entity_id = $1
        AND tax_type = $2
        AND period_pattern = $3
        AND service_kind = $4`,
    [entityId, taxType, periodPattern, serviceKind],
  );
  return rows[0]?.id ?? id;
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    entity_id?: string;
    tax_type?: string;
    period_pattern?: string;
    // Stint 64.J — 'provision' = interim CIT tax-provision calc
    // (Form 500). Diego: "a veces los clientes nos mandan un borrador
    // de los estados financieros para que calculemos las tax
    // provisions… normalmente ya no pasa nada más, ya lo siguiente
    // es que nos suele mandar los estados financieros finales y
    // hacemos la declaración del impuesto a sociedades final."
    service_kind?: 'filing' | 'review' | 'provision';
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
