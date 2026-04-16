import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit, initializeSchema } from '@/lib/db';

// GET /api/entities - list all entities
export async function GET() {
  await initializeSchema();
  const entities = await query('SELECT * FROM entities WHERE deleted_at IS NULL ORDER BY name ASC');
  return NextResponse.json(entities);
}

// POST /api/entities - create a new entity
export async function POST(request: NextRequest) {
  await initializeSchema();
  const body = await request.json();
  const id = generateId();

  // vat_status: the create form asks explicitly ("is this entity
  // already VAT-registered in Luxembourg?"). We accept the value
  // verbatim if it's one of the three legal states, otherwise we
  // let the column default ('registered') take over.
  const vatStatus = ['registered', 'pending_registration', 'not_applicable'].includes(body.vat_status)
    ? body.vat_status
    : 'registered';

  await execute(
    `INSERT INTO entities (id, name, vat_number, matricule, rcs_number, legal_form, entity_type,
      regime, frequency, address, bank_iban, bank_bic, tax_office,
      client_name, client_email, csp_name, csp_email,
      has_fx, has_outgoing, has_recharges, notes, vat_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      id, body.name,
      body.vat_number || null, body.matricule || null, body.rcs_number || null,
      body.legal_form || null, body.entity_type || null,
      body.regime || 'simplified', body.frequency || 'annual',
      body.address || null, body.bank_iban || null, body.bank_bic || null, body.tax_office || null,
      body.client_name || null, body.client_email || null,
      body.csp_name || null, body.csp_email || null,
      !!body.has_fx, !!body.has_outgoing, !!body.has_recharges,
      body.notes || null,
      vatStatus,
    ]
  );

  await logAudit({
    entityId: id, action: 'create', targetType: 'entity', targetId: id,
    newValue: JSON.stringify(body),
  });

  const entity = await queryOne('SELECT * FROM entities WHERE id = $1', [id]);
  return NextResponse.json(entity, { status: 201 });
}
