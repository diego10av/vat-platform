import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, logAudit } from '@/lib/db';

// GET /api/registrations/:id
// PATCH /api/registrations/:id  — update status, checklist, fields
// On status transition to 'vat_received', auto-populate the entity with the
// AED-issued vat_number / matricule / regime / frequency.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await queryOne(
    `SELECT r.*, e.name AS entity_name, e.client_name, e.legal_form, e.address
       FROM registrations r
       JOIN entities e ON r.entity_id = e.id
      WHERE r.id = $1`,
    [id]
  );
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Recent audit on this registration's entity, scoped to registration-related events
  const audit = await query(
    `SELECT a.action, a.field, a.old_value, a.new_value, a.created_at
       FROM audit_log a
      WHERE a.target_type = 'registration' AND a.target_id = $1
      ORDER BY a.created_at DESC LIMIT 30`,
    [id]
  );

  return NextResponse.json({ ...(r as object), audit });
}

const VALID_STATUS = ['docs_requested', 'docs_received', 'form_prepared', 'filed', 'vat_received'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await queryOne<{
    entity_id: string; status: string; issued_vat_number: string | null;
    issued_matricule: string | null; regime_requested: string | null;
    frequency_requested: string | null;
  }>(
    'SELECT entity_id, status, issued_vat_number, issued_matricule, regime_requested, frequency_requested FROM registrations WHERE id = $1',
    [id]
  );
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const fields = [
    'status', 'regime_requested', 'frequency_requested', 'tax_office',
    'triggered_by', 'expected_turnover', 'comments_field',
    'filing_ref', 'filed_at', 'vat_received_at',
    'issued_vat_number', 'issued_matricule', 'notes',
  ];
  for (const f of fields) {
    if (f in body) {
      sets.push(`${f} = $${i++}`);
      vals.push(body[f]);
    }
  }
  if (body.docs_checklist !== undefined) {
    sets.push(`docs_checklist = $${i++}`);
    vals.push(JSON.stringify(body.docs_checklist));
  }

  if (body.status && !VALID_STATUS.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  await execute(`UPDATE registrations SET ${sets.join(', ')} WHERE id = $${i}`, vals);

  // Audit status changes
  if (body.status && body.status !== existing.status) {
    await logAudit({
      entityId: existing.entity_id,
      action: 'update', targetType: 'registration', targetId: id,
      field: 'status', oldValue: existing.status, newValue: body.status,
    });

    // Side effect: when VAT number is received, sync onto the entity record.
    if (body.status === 'vat_received') {
      const reg = await queryOne<{
        issued_vat_number: string | null; issued_matricule: string | null;
        regime_requested: string | null; frequency_requested: string | null;
      }>(
        'SELECT issued_vat_number, issued_matricule, regime_requested, frequency_requested FROM registrations WHERE id = $1',
        [id]
      );
      if (reg) {
        const updates: string[] = [];
        const updateVals: unknown[] = [];
        let j = 1;
        if (reg.issued_vat_number) { updates.push(`vat_number = $${j++}`); updateVals.push(reg.issued_vat_number); }
        if (reg.issued_matricule) { updates.push(`matricule = $${j++}`); updateVals.push(reg.issued_matricule); }
        if (reg.regime_requested) { updates.push(`regime = $${j++}`); updateVals.push(reg.regime_requested); }
        if (reg.frequency_requested) { updates.push(`frequency = $${j++}`); updateVals.push(reg.frequency_requested); }
        if (updates.length > 0) {
          updateVals.push(existing.entity_id);
          await execute(
            `UPDATE entities SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${j}`,
            updateVals
          );
          await logAudit({
            entityId: existing.entity_id,
            action: 'update', targetType: 'entity', targetId: existing.entity_id,
            field: 'vat_registered',
            newValue: `vat=${reg.issued_vat_number} matricule=${reg.issued_matricule}`,
          });
        }
      }
    }
  }

  return NextResponse.json({ success: true });
}
