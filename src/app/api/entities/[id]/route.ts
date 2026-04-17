import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit, initializeSchema } from '@/lib/db';
import { validateVatNumber, validateIban } from '@/lib/validation';
import { apiError } from '@/lib/api-errors';

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
  if (!existing) return apiError('entity_not_found', 'Entity not found.', { status: 404 });

  // Validate
  if ('vat_number' in body && body.vat_number) {
    const v = validateVatNumber(body.vat_number);
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });
    body.vat_number = v.value;
  }
  if ('bank_iban' in body && body.bank_iban) {
    const v = validateIban(body.bank_iban);
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });
    body.bank_iban = v.value;
  }

  const fields = [
    'name', 'vat_number', 'matricule', 'rcs_number', 'legal_form', 'entity_type',
    'regime', 'frequency', 'address', 'bank_iban', 'bank_bic', 'tax_office',
    'client_name', 'client_email', 'csp_name', 'csp_email',
    'has_fx', 'has_outgoing', 'has_recharges', 'notes',
    'ai_mode', // 'full' | 'classifier_only' (CHECK constraint in migration 009)
  ];

  // Defensive validation for ai_mode — the DB CHECK will catch bad values
  // but we surface a clean error message instead of a raw constraint fail.
  if ('ai_mode' in body && body.ai_mode != null && body.ai_mode !== 'full' && body.ai_mode !== 'classifier_only') {
    return apiError('ai_mode_invalid',
      `ai_mode must be "full" or "classifier_only"; got "${String(body.ai_mode)}".`,
      { status: 400 });
  }

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

// DELETE /api/entities/:id - soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne('SELECT * FROM entities WHERE id = $1', [id]);
  if (!existing) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  if (existing.deleted_at) return NextResponse.json({ error: 'Entity already deleted' }, { status: 409 });

  const reason = body.reason || 'user_deleted';

  await execute(
    "UPDATE entities SET deleted_at = NOW(), deleted_reason = $1, updated_at = NOW() WHERE id = $2",
    [reason, id]
  );

  await logAudit({
    entityId: id, action: 'delete', targetType: 'entity', targetId: id,
    oldValue: JSON.stringify({ name: existing.name }),
    newValue: reason,
  });

  return NextResponse.json({ success: true });
}
