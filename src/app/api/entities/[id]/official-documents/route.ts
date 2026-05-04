// ════════════════════════════════════════════════════════════════════════
// Per-entity "official documents" endpoint.
//
//   POST /api/entities/:id/official-documents   — upload a file, run
//     the relevant extractor (today only VAT-registration letters),
//     store the file in Supabase Storage + a row in
//     entity_official_documents. Supersedes the previous document of
//     the same kind (so /entities/:id only shows the current one,
//     with the history still retrievable via ?history=true).
//   GET  /api/entities/:id/official-documents   — list (current + history).
//
// Stint 15 (2026-04-20). Per Diego: "esa carta se guardara… y
// también que se pudiese subir otra carta más tarde, porque a veces
// cambia la periodicidad".
// ════════════════════════════════════════════════════════════════════════
//
// Shape of the diff returned to the client when kind=vat_registration:
//   [{ field: 'frequency', before: 'quarterly', after: 'monthly', changed: true }, …]
// The client shows these in a modal and POSTs to
// /api/entities/:id/apply-vat-letter-diff with the per-field selection
// the user confirms. We do NOT auto-apply diffs — the reviewer is
// always the final authority (Gassner principle). See
// src/components/entity/OfficialDocumentsCard.tsx for the modal UI.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execute, query, queryOne, generateId, logAudit, initializeSchema } from '@/lib/db';
import { apiError, apiFail, apiOk } from '@/lib/api-errors';
import { requireBudget } from '@/lib/budget-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  extractVatLetterFields,
  fieldsToEntityPatch,
  resolveMediaType,
  type ExtractedVatLetterFields,
} from '@/lib/vat-letter-extract';
import { logger } from '@/lib/logger';

const log = logger.bind('entities/official-documents');

export const maxDuration = 90;

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

type DocKind = 'vat_registration' | 'articles_of_association' | 'engagement_letter' | 'other';

const KINDS: readonly DocKind[] = [
  'vat_registration',
  'articles_of_association',
  'engagement_letter',
  'other',
];

interface DocRow {
  id: string;
  entity_id: string;
  kind: DocKind;
  filename: string;
  content_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  extracted_fields: ExtractedVatLetterFields | null;
  effective_from: string | null;
  notes: string | null;
  superseded_by: string | null;
  uploaded_at: string;
}

// ────────────────────────────────────────────────────────────────────────
// GET  — list
// ────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await initializeSchema();
  const { id } = await params;
  const url = new URL(request.url);
  const includeHistory = url.searchParams.get('history') === 'true';
  const kindFilter = url.searchParams.get('kind') as DocKind | null;

  const entity = await queryOne<{ id: string }>(
    'SELECT id FROM entities WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (!entity) return apiError('entity_not_found', 'Entity not found.', { status: 404 });

  const where: string[] = ['entity_id = $1'];
  const vals: unknown[] = [id];
  if (!includeHistory) where.push('superseded_by IS NULL');
  if (kindFilter && KINDS.includes(kindFilter)) {
    vals.push(kindFilter);
    where.push(`kind = $${vals.length}`);
  }

  try {
    const rows = await query<DocRow>(
      `SELECT id, entity_id, kind, filename, content_type, storage_path,
              size_bytes, extracted_fields, effective_from, notes,
              superseded_by, uploaded_at
         FROM entity_official_documents
        WHERE ${where.join(' AND ')}
        ORDER BY uploaded_at DESC`,
      vals,
    );
    return apiOk({ documents: rows });
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message ?? '';
    if (/relation.*entity_official_documents.*does not exist/i.test(msg)) {
      return apiError(
        'migration_required',
        'Migration 017 has not been applied to this database.',
        { status: 501 },
      );
    }
    return apiFail(err, 'entities/official-documents GET');
  }
}

// ────────────────────────────────────────────────────────────────────────
// POST — upload a file, extract (if VAT letter), persist
// ────────────────────────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: entityId } = await params;

    // Uploads run an Anthropic extractor when kind=vat_registration;
    // rate-limit to prevent runaway form wizards.
    const rl = checkRateLimit(request, { max: 10, windowMs: 60_000 });
    if (!rl.ok) return rl.response;

    const entity = await queryOne<{
      id: string; name: string;
      vat_number: string | null; matricule: string | null; rcs_number: string | null;
      legal_form: string | null; entity_type: string | null;
      address: string | null;
      regime: string; frequency: string;
    }>(
      `SELECT id, name, vat_number, matricule, rcs_number, legal_form,
              entity_type, address, regime, frequency
         FROM entities
        WHERE id = $1 AND deleted_at IS NULL`,
      [entityId],
    );
    if (!entity) return apiError('entity_not_found', 'Entity not found.', { status: 404 });
    // Narrow once so the nested closure below keeps the non-null type.
    const entityRow = entity;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kindRaw = (formData.get('kind') as string | null) || 'vat_registration';
    const notes = (formData.get('notes') as string | null) || null;
    const effectiveFrom = (formData.get('effective_from') as string | null) || null;
    const skipExtract = (formData.get('skip_extract') as string | null) === 'true';
    // When the caller has already run extract-vat-letter client-side
    // (entity creation flow), they can pass the cached fields so we
    // don't pay the extractor cost twice.
    const precomputedFieldsRaw = formData.get('extracted_fields') as string | null;
    let precomputedFields: ExtractedVatLetterFields | null = null;
    if (precomputedFieldsRaw) {
      try {
        const parsed = JSON.parse(precomputedFieldsRaw);
        if (parsed && typeof parsed === 'object') {
          precomputedFields = parsed as ExtractedVatLetterFields;
        }
      } catch {
        // bad JSON → ignore, fall back to re-extraction if kind is VAT
      }
    }

    if (!file) return apiError('file_required', 'No file attached.', { status: 400 });
    if (file.size > 25 * 1024 * 1024) {
      return apiError('file_too_large', 'Max 25 MB.', { status: 400 });
    }
    if (!KINDS.includes(kindRaw as DocKind)) {
      return apiError('bad_kind', `kind must be one of ${KINDS.join(', ')}.`, { status: 400 });
    }
    const kind = kindRaw as DocKind;

    const mediaType = resolveMediaType(file.type);
    // Non-VAT-letter docs (engagement letter, articles, other) don't need
    // to be PDFs; accept any content type up to size cap. VAT letters
    // must be image/PDF because we run Haiku on them.
    if (kind === 'vat_registration' && !skipExtract && !mediaType) {
      return apiError(
        'bad_type',
        'VAT registration letters must be a PDF or image so they can be parsed.',
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1) Upload to Supabase Storage.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `entity-docs/${entityId}/${Date.now()}_${kind}_${safeName}`;
    const sb = supabase();
    const { error: upErr } = await sb.storage.from('documents').upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (upErr) {
      log.error('supabase storage upload failed', upErr, { entityId, kind });
      return apiError('storage_failed', `Could not upload the file: ${upErr.message}`, { status: 500 });
    }

    // 2) Run extractor for VAT letters (unless caller pre-supplied the fields).
    let extracted: ExtractedVatLetterFields | null = precomputedFields;
    let diff: Array<{ field: string; before: string | null; after: string | null; changed: boolean }> = [];

    function computeDiffAgainstEntity(fields: ExtractedVatLetterFields) {
      const patch = fieldsToEntityPatch(fields);
      const currentByField: Record<string, string | null> = {
        name: entityRow.name,
        legal_form: entityRow.legal_form,
        vat_number: entityRow.vat_number,
        matricule: entityRow.matricule,
        rcs_number: entityRow.rcs_number,
        address: entityRow.address,
        entity_type: entityRow.entity_type,
        regime: entityRow.regime,
        frequency: entityRow.frequency,
      };
      const out: typeof diff = [];
      for (const [field, after] of Object.entries(patch)) {
        const before = currentByField[field] ?? null;
        const normBefore = (before ?? '').trim().toLowerCase();
        const normAfter = (after ?? '').trim().toLowerCase();
        const changed = after != null && normAfter !== '' && normAfter !== normBefore;
        out.push({ field, before, after: after ?? null, changed });
      }
      return out;
    }

    if (kind === 'vat_registration' && !skipExtract && !extracted && mediaType) {
      const budget = await requireBudget();
      if (!budget.ok) {
        // Clean up the storage object so we don't leave a dangling file
        // if we can't extract. We'll still allow saving by retry later.
        await sb.storage.from('documents').remove([storagePath]).catch(() => {});
        return apiError(
          'budget_exhausted',
          budget.error?.message ?? 'Anthropic monthly budget exhausted.',
          { status: 429 },
        );
      }
      try {
        const result = await extractVatLetterFields({
          buffer,
          mediaType,
          filename: file.name,
          entityId,
        });
        if (result.ok) {
          extracted = result.fields;
          diff = computeDiffAgainstEntity(result.fields);
        } else {
          // Extraction failed — still keep the file; user can re-extract
          // via a future endpoint. Flag in notes.
          log.warn('VAT letter extraction failed after upload', { entityId, err: result.error });
        }
      } catch (err) {
        log.error('extractor threw after upload', err, { entityId });
      }
    }

    // If we received pre-extracted fields from the client (creation flow),
    // still compute the diff so the caller can surface any discrepancies.
    if (kind === 'vat_registration' && extracted && diff.length === 0) {
      diff = computeDiffAgainstEntity(extracted);
    }

    // 3) Persist row + mark prior doc of same kind as superseded.
    const id = `doc-${generateId().slice(0, 10)}`;
    const prior = await queryOne<{ id: string }>(
      `SELECT id FROM entity_official_documents
        WHERE entity_id = $1 AND kind = $2 AND superseded_by IS NULL
        ORDER BY uploaded_at DESC
        LIMIT 1`,
      [entityId, kind],
    );

    await execute(
      `INSERT INTO entity_official_documents
         (id, entity_id, kind, filename, content_type, storage_path,
          size_bytes, extracted_fields, effective_from, notes, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        id,
        entityId,
        kind,
        file.name,
        file.type || null,
        storagePath,
        file.size,
        extracted ? JSON.stringify(extracted) : null,
        effectiveFrom,
        notes,
      ],
    );

    if (prior) {
      await execute(
        `UPDATE entity_official_documents SET superseded_by = $1 WHERE id = $2`,
        [id, prior.id],
      );
    }

    await logAudit({
      entityId,
      action: 'create',
      targetType: 'official_document',
      targetId: id,
      newValue: `${kind}:${file.name}`,
    });

    return apiOk({
      document_id: id,
      kind,
      filename: file.name,
      extracted_fields: extracted,
      diff: diff.filter(d => d.changed),
      superseded_doc_id: prior?.id ?? null,
    });
  } catch (err) {
    return apiFail(err, 'entities/official-documents POST');
  }
}
