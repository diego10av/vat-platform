// ════════════════════════════════════════════════════════════════════════
// POST /api/entities/extract-vat-letter
//
// Stateless preview: reads a Luxembourg "Attestation d'immatriculation
// à la TVA" PDF and returns the structured fields so the New Entity
// form can pre-fill. Does NOT persist the file. Use
// POST /api/entities/[id]/official-documents once the entity exists.
//
// Stint 14 (2026-04-20). Stint 15 refactored the actual extraction
// into `lib/vat-letter-extract.ts` so the new persist endpoint shares
// the same parser.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { requireBudget } from '@/lib/budget-guard';
import { extractVatLetterFields, resolveMediaType } from '@/lib/vat-letter-extract';

export async function POST(request: NextRequest) {
  try {
    const budget = await requireBudget();
    if (!budget.ok) {
      return apiError(
        'budget_exhausted',
        budget.error?.message ?? 'Anthropic monthly budget exhausted.',
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return apiError('file_required', 'No file attached.', { status: 400 });
    if (file.size > 20 * 1024 * 1024) {
      return apiError('file_too_large', 'Max 20 MB.', { status: 400 });
    }

    const mediaType = resolveMediaType(file.type);
    if (!mediaType) {
      return apiError('bad_type', 'Only PDFs or images are accepted.', { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await extractVatLetterFields({
      buffer,
      mediaType,
      filename: file.name,
    });

    if (!result.ok) {
      if (result.error.code === 'parse_failed') {
        return apiError('analysis_parse_failed', result.error.message, { status: 422 });
      }
      return apiError(result.error.code, result.error.message, { status: 500 });
    }

    return apiOk({ fields: result.fields });
  } catch (err) {
    return apiFail(err, 'entities/extract-vat-letter');
  }
}
