// ════════════════════════════════════════════════════════════════════════
// POST /api/entities/:id/apply-vat-letter-diff
//
// After a user re-uploads a VAT registration letter, the client shows
// a diff modal with the fields that changed. When the user confirms
// "apply these", this endpoint patches the entity row with the
// whitelisted fields. Audit log fires per changed column, same as a
// manual edit.
//
// Body shape:
//   {
//     document_id: string,      // the doc row we're applying from
//     apply: {
//       name?: string | null,
//       legal_form?: string | null,
//       vat_number?: string | null,
//       matricule?: string | null,
//       rcs_number?: string | null,
//       address?: string | null,
//       entity_type?: string | null,
//       regime?: 'simplified' | 'ordinary' | null,
//       frequency?: 'monthly' | 'quarterly' | 'annual' | null,
//     }
//   }
//
// Stint 15 (2026-04-20). Gassner principle — the reviewer is always
// the final authority; we never auto-apply even when the extractor
// is confident.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { execute, queryOne, logAudit, initializeSchema } from '@/lib/db';
import { apiError, apiFail, apiOk } from '@/lib/api-errors';
import { validateVatNumber } from '@/lib/validation';

const APPLICABLE_FIELDS = [
  'name', 'legal_form', 'vat_number', 'matricule', 'rcs_number',
  'address', 'entity_type', 'regime', 'frequency',
] as const;

type ApplicableField = typeof APPLICABLE_FIELDS[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: entityId } = await params;
    const body = await request.json();
    const documentId: string | undefined = body.document_id;
    const apply: Record<string, unknown> = (body.apply && typeof body.apply === 'object') ? body.apply : {};

    if (!documentId) return apiError('document_id_required', 'document_id is required.', { status: 400 });

    const entity = await queryOne<Record<string, unknown>>(
      `SELECT id, name, legal_form, vat_number, matricule, rcs_number,
              address, entity_type, regime, frequency
         FROM entities
        WHERE id = $1 AND deleted_at IS NULL`,
      [entityId],
    );
    if (!entity) return apiError('entity_not_found', 'Entity not found.', { status: 404 });

    const doc = await queryOne<{ id: string; kind: string }>(
      `SELECT id, kind FROM entity_official_documents WHERE id = $1 AND entity_id = $2`,
      [documentId, entityId],
    );
    if (!doc) return apiError('document_not_found', 'Document not found for this entity.', { status: 404 });
    if (doc.kind !== 'vat_registration') {
      return apiError('wrong_kind',
        `apply-vat-letter-diff only works on vat_registration documents; got "${doc.kind}".`,
        { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const changed: Array<{ field: ApplicableField; before: unknown; after: unknown }> = [];
    let paramIdx = 1;

    for (const f of APPLICABLE_FIELDS) {
      if (!(f in apply)) continue;
      let next = apply[f];

      // Normalise + validate per field. We're lenient — an invalid value
      // gets ignored rather than failing the whole batch, because the
      // diff flow is inherently opt-in per field.
      if (typeof next === 'string') {
        next = next.trim() || null;
      } else if (next !== null) {
        // Reject objects/numbers/etc for string-typed columns
        continue;
      }

      if (f === 'vat_number' && next) {
        const v = validateVatNumber(next as string);
        if (!v.ok) continue; // quietly skip invalid VAT numbers
        next = v.value;
      }
      if (f === 'regime' && next != null && next !== 'simplified' && next !== 'ordinary') {
        continue;
      }
      if (f === 'frequency' && next != null && !['monthly', 'quarterly', 'annual'].includes(next as string)) {
        continue;
      }

      const before = entity[f] ?? null;
      if (String(before ?? '') === String(next ?? '')) continue;

      updates.push(`${f} = $${paramIdx}`);
      values.push(next);
      paramIdx += 1;
      changed.push({ field: f, before, after: next });
    }

    if (updates.length === 0) {
      return apiOk({ applied: [], message: 'No changes to apply.' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(entityId);
    await execute(`UPDATE entities SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);

    for (const c of changed) {
      await logAudit({
        entityId,
        action: 'update',
        targetType: 'entity',
        targetId: entityId,
        field: c.field,
        oldValue: String(c.before ?? ''),
        newValue: String(c.after ?? ''),
      });
    }

    await logAudit({
      entityId,
      action: 'apply_vat_letter_diff',
      targetType: 'official_document',
      targetId: documentId,
      newValue: JSON.stringify(changed.map(c => c.field)),
    });

    return apiOk({ applied: changed.map(c => c.field), count: changed.length });
  } catch (err) {
    return apiFail(err, 'entities/apply-vat-letter-diff');
  }
}
