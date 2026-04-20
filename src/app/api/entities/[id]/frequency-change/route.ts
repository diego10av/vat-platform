// ════════════════════════════════════════════════════════════════════════
// POST /api/entities/:id/frequency-change
//
// Manual path to update `entities.frequency` + optionally `entities.regime`
// with a paper-trail link to the document that triggered the change
// (typically an AED letter: "changement de régime" / new VAT letter /
// turnover-threshold notification).
//
// This complements the automatic path exposed by the VAT-letter diff
// modal. When the triggering letter isn't a VAT registration letter
// (engagement letter revision, AED "changement" letter, etc.), the
// extractor doesn't run — so the user needs a manual way to capture
// the change AND link it to the supporting document.
//
// Body shape:
//   {
//     frequency:  'monthly' | 'quarterly' | 'annual',   // required
//     regime?:    'simplified' | 'ordinary',             // optional
//     effective_from?: 'YYYY-MM-DD',                     // optional
//     source_document_id?: string,                        // optional — must exist for this entity
//     notes?: string,
//   }
//
// Stint 15 follow-up (2026-04-20). Per Diego: "si cambia la
// periodicidad, se debería actualizar… y quiero que se pueda hacer
// también cuando la carta no es la VAT registration letter".
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { execute, queryOne, logAudit, initializeSchema } from '@/lib/db';
import { apiError, apiFail, apiOk } from '@/lib/api-errors';

const VALID_FREQUENCIES = ['monthly', 'quarterly', 'annual'] as const;
const VALID_REGIMES = ['simplified', 'ordinary'] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: entityId } = await params;
    const body = await request.json();

    const entity = await queryOne<{
      id: string; name: string; frequency: string; regime: string;
    }>(
      `SELECT id, name, frequency, regime
         FROM entities
        WHERE id = $1 AND deleted_at IS NULL`,
      [entityId],
    );
    if (!entity) return apiError('entity_not_found', 'Entity not found.', { status: 404 });

    const newFrequency: string = body.frequency;
    if (!VALID_FREQUENCIES.includes(newFrequency as typeof VALID_FREQUENCIES[number])) {
      return apiError('bad_frequency',
        `frequency must be one of ${VALID_FREQUENCIES.join(', ')}.`,
        { status: 400 });
    }

    let newRegime: string | null = null;
    if ('regime' in body && body.regime != null) {
      if (!VALID_REGIMES.includes(body.regime)) {
        return apiError('bad_regime',
          `regime must be one of ${VALID_REGIMES.join(', ')} or omitted.`,
          { status: 400 });
      }
      newRegime = body.regime;
    }

    const effectiveFrom: string | null =
      (typeof body.effective_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.effective_from))
        ? body.effective_from
        : null;

    const notes: string | null = (typeof body.notes === 'string' && body.notes.trim())
      ? body.notes.trim().slice(0, 2000) : null;

    // Validate source_document_id (if provided) belongs to this entity.
    let sourceDocumentId: string | null = null;
    if ('source_document_id' in body && body.source_document_id) {
      try {
        const doc = await queryOne<{ id: string; kind: string; filename: string }>(
          `SELECT id, kind, filename FROM entity_official_documents
            WHERE id = $1 AND entity_id = $2`,
          [body.source_document_id, entityId],
        );
        if (!doc) {
          return apiError('source_document_not_found',
            'The linked document does not exist for this entity.',
            { status: 400 });
        }
        sourceDocumentId = doc.id;
      } catch (err) {
        const msg = (err as { message?: string } | null)?.message ?? '';
        if (/relation.*entity_official_documents.*does not exist/i.test(msg)) {
          // Migration 017 missing — can still change the frequency, just
          // no document link. Don't fail the whole op.
          sourceDocumentId = null;
        } else {
          throw err;
        }
      }
    }

    const changed: string[] = [];

    if (entity.frequency !== newFrequency) {
      await execute(
        'UPDATE entities SET frequency = $1, updated_at = NOW() WHERE id = $2',
        [newFrequency, entityId],
      );
      await logAudit({
        entityId,
        action: 'update',
        targetType: 'entity',
        targetId: entityId,
        field: 'frequency',
        oldValue: entity.frequency,
        newValue: newFrequency,
      });
      changed.push('frequency');
    }

    if (newRegime && entity.regime !== newRegime) {
      await execute(
        'UPDATE entities SET regime = $1, updated_at = NOW() WHERE id = $2',
        [newRegime, entityId],
      );
      await logAudit({
        entityId,
        action: 'update',
        targetType: 'entity',
        targetId: entityId,
        field: 'regime',
        oldValue: entity.regime,
        newValue: newRegime,
      });
      changed.push('regime');
    }

    if (changed.length === 0) {
      return apiOk({
        changed: [],
        message: 'No change to apply — the entity already matches.',
      });
    }

    // One high-level audit entry recording the full context (source
    // document + effective date + notes). Separate from the per-column
    // entries above so audit-trail PDFs can both (a) list every column
    // change with a "triggered by letter X on date Y" flavor and (b)
    // render a clean timeline of periodicity changes.
    await logAudit({
      entityId,
      action: 'frequency_change',
      targetType: 'entity',
      targetId: entityId,
      newValue: JSON.stringify({
        changed,
        from_frequency: entity.frequency,
        to_frequency: newFrequency,
        from_regime: entity.regime,
        to_regime: newRegime,
        effective_from: effectiveFrom,
        source_document_id: sourceDocumentId,
        notes,
      }),
    });

    return apiOk({
      changed,
      from_frequency: entity.frequency,
      to_frequency: newFrequency,
      source_document_id: sourceDocumentId,
    });
  } catch (err) {
    return apiFail(err, 'entities/frequency-change');
  }
}
