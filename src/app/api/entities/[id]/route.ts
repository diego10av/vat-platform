import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit, initializeSchema } from '@/lib/db';
import { validateVatNumber, validateIban } from '@/lib/validation';
import { apiError } from '@/lib/api-errors';
import { cascadeDeleteEntity, previewEntityDelete } from '@/lib/cascade-delete';
import { requireRole } from '@/lib/require-role';

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
    'requires_partner_review', // migration 023 — 2-step approval toggle
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
      const boolFields = ['has_fx', 'has_outgoing', 'has_recharges', 'requires_partner_review'];
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
/**
 * DELETE /api/entities/[id]
 *
 * Default: soft-archive (sets deleted_at + deleted_reason; keeps
 * children intact). Good for "moving to bin" on active workspaces.
 *
 * ?cascade=true: hard-delete the entity + all declarations under
 * it + all invoices + lines + documents + AED letters + precedents
 * + registrations + approvers + prorata. Atomic.
 *
 * ?confirm=<name> optional server-side guard against UI bugs.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const url = new URL(request.url);
  const cascade = url.searchParams.get('cascade') === 'true';
  const confirmName = url.searchParams.get('confirm');
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<{
    id: string; name: string; deleted_at: string | null;
  }>(
    'SELECT id, name, deleted_at FROM entities WHERE id = $1',
    [id],
  );
  if (!existing) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  if (cascade) {
    const roleFail = await requireRole(request, 'admin');
    if (roleFail) return roleFail;

    if (confirmName !== null && confirmName !== existing.name) {
      return apiError(
        'confirm_mismatch',
        `The typed name didn't match. To permanently delete, type "${existing.name}" exactly.`,
        { status: 400 },
      );
    }

    const ackFiled = url.searchParams.get('acknowledge_filed') === 'true';
    const preview = await previewEntityDelete(id);
    if (preview && preview.filed_declaration_count > 0 && !ackFiled) {
      const byStatus = Object.entries(preview.committed_statuses)
        .map(([s, n]) => `${n} ${s}`).join(', ');
      return apiError(
        'committed_declarations_present',
        `This entity has ${preview.filed_declaration_count} declaration${preview.filed_declaration_count === 1 ? '' : 's'} already committed (${byStatus}).`,
        {
          status: 409,
          hint: 'Per Art. 70 LTVA, filed/paid returns should be retained for 10 years. The UI must surface a second confirmation and add acknowledge_filed=true to proceed.',
        },
      );
    }

    await cascadeDeleteEntity(id);
    await logAudit({
      entityId: id,
      action: 'delete_cascade',
      targetType: 'entity',
      targetId: id,
      oldValue: JSON.stringify({
        name: existing.name,
        cascaded: preview?.counts,
        filed_declarations_deleted: preview?.filed_declaration_count ?? 0,
        committed_statuses: preview?.committed_statuses ?? {},
        acknowledged_filed: ackFiled,
      }),
    });
    return NextResponse.json({ ok: true, cascaded: preview?.counts });
  }

  // Soft-archive path (default).
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
  return NextResponse.json({ success: true, archived: true });
}
