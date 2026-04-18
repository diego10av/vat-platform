// ════════════════════════════════════════════════════════════════════════
// Single-attachment endpoints.
//
// PATCH  /api/invoices/[id]/attachments/[attId]  — update note / legal_basis / kind
// DELETE /api/invoices/[id]/attachments/[attId]  — soft delete (file stays in storage,
//                                                  row marked deleted_at)
// GET    .../download                            — signed URL for the file
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const ALLOWED_KINDS = ['contract', 'engagement_letter', 'advisory_email', 'other'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  try {
    const { id: invoiceId, attId } = await params;
    const body = await request.json().catch(() => ({}));

    const existing = await queryOne<{
      id: string; invoice_id: string; kind: string;
      user_note: string | null; legal_basis: string | null;
      declaration_id: string; entity_id: string;
    }>(
      `SELECT a.id, a.invoice_id, a.kind, a.user_note, a.legal_basis,
              i.declaration_id, d.entity_id
         FROM invoice_attachments a
         JOIN invoices i ON a.invoice_id = i.id
         JOIN declarations d ON i.declaration_id = d.id
        WHERE a.id = $1 AND a.invoice_id = $2 AND a.deleted_at IS NULL`,
      [attId, invoiceId],
    );
    if (!existing) return apiError('attachment_not_found', 'Attachment not found.', { status: 404 });

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if ('kind' in body) {
      if (!(ALLOWED_KINDS as readonly string[]).includes(String(body.kind))) {
        return apiError('kind_invalid', `kind must be one of: ${ALLOWED_KINDS.join(', ')}.`, { status: 400 });
      }
      updates.push(`kind = $${idx++}`); values.push(body.kind);
    }
    if ('user_note' in body) {
      const v = typeof body.user_note === 'string' ? body.user_note.trim().slice(0, 5000) : null;
      updates.push(`user_note = $${idx++}`); values.push(v);
    }
    if ('legal_basis' in body) {
      const v = typeof body.legal_basis === 'string' ? body.legal_basis.trim().slice(0, 500) : null;
      updates.push(`legal_basis = $${idx++}`); values.push(v);
    }
    if (updates.length === 0) return apiError('empty_patch', 'Send kind / user_note / legal_basis.', { status: 400 });

    values.push(attId);
    await execute(
      `UPDATE invoice_attachments SET ${updates.join(', ')} WHERE id = $${idx}`,
      values,
    );

    await logAudit({
      entityId: existing.entity_id,
      declarationId: existing.declaration_id,
      action: 'update', targetType: 'invoice_attachment', targetId: attId,
      field: 'meta', oldValue: '', newValue: JSON.stringify(body),
    });

    return apiOk({ ok: true });
  } catch (err) {
    return apiFail(err, 'invoice-attachments/patch');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  try {
    const { id: invoiceId, attId } = await params;
    const existing = await queryOne<{
      id: string; invoice_id: string; kind: string; filename: string;
      declaration_id: string; entity_id: string;
    }>(
      `SELECT a.id, a.invoice_id, a.kind, a.filename,
              i.declaration_id, d.entity_id
         FROM invoice_attachments a
         JOIN invoices i ON a.invoice_id = i.id
         JOIN declarations d ON i.declaration_id = d.id
        WHERE a.id = $1 AND a.invoice_id = $2 AND a.deleted_at IS NULL`,
      [attId, invoiceId],
    );
    if (!existing) return apiError('attachment_not_found', 'Attachment not found.', { status: 404 });

    await execute(
      `UPDATE invoice_attachments SET deleted_at = NOW() WHERE id = $1`,
      [attId],
    );
    await logAudit({
      entityId: existing.entity_id,
      declarationId: existing.declaration_id,
      action: 'delete', targetType: 'invoice_attachment', targetId: attId,
      field: 'filename', oldValue: existing.filename, newValue: '(deleted)',
    });
    return apiOk({ ok: true });
  } catch (err) {
    return apiFail(err, 'invoice-attachments/delete');
  }
}
