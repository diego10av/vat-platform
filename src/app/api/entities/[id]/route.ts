import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit, initializeSchema } from '@/lib/db';

// GET /api/entities/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const entity = await queryOne('SELECT * FROM entities WHERE id = $1', [id]);
  if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  return NextResponse.json(entity);
}

// PUT /api/entities/:id - update entity
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const body = await request.json();

  const existing = await queryOne('SELECT * FROM entities WHERE id = $1', [id]);
  if (!existing) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  const fields = [
    'name', 'vat_number', 'matricule', 'rcs_number', 'legal_form', 'entity_type',
    'regime', 'frequency', 'address', 'bank_iban', 'bank_bic', 'tax_office',
    'client_name', 'client_email', 'csp_name', 'csp_email',
    'has_fx', 'has_outgoing', 'has_recharges', 'notes'
  ];

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const field of fields) {
    if (field in body) {
      const boolFields = ['has_fx', 'has_outgoing', 'has_recharges'];
      const newVal = boolFields.includes(field) ? !!body[field] : (body[field] || null);
      updates.push(`${field} = $${paramIdx}`);
      values.push(newVal);
      paramIdx++;

      const oldVal = existing[field];
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        await logAudit({
          entityId: id, action: 'update', targetType: 'entity', targetId: id,
          field, oldValue: String(oldVal ?? ''), newValue: String(newVal ?? ''),
        });
      }
    }
  }

  if (updates.length > 0) {
    updates.push(`updated_at = NOW()`);
    values.push(id);
    await execute(`UPDATE entities SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
  }

  const entity = await queryOne('SELECT * FROM entities WHERE id = $1', [id]);
  return NextResponse.json(entity);
}
