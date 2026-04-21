// ════════════════════════════════════════════════════════════════════════
// Extract structured fields from a Luxembourg VAT registration letter.
//
// Shared by:
//   - POST /api/entities/extract-vat-letter (stateless preview during
//     entity creation, before the entity id exists)
//   - POST /api/entities/[id]/official-documents (after creation;
//     persists the PDF + stores the extracted fields as JSONB so we
//     can diff them against the live entity later)
//
// Stint 15 (2026-04-20). Per Diego: "esa carta se guardara, porque
// está bien tenerla a mano para poder verificar… y también que se
// pudiese subir otra carta más tarde, porque a veces cambia la
// periodicidad".
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { logger } from '@/lib/logger';

const log = logger.bind('vat-letter-extract');

export interface ExtractedVatLetterFields {
  name: string | null;
  legal_form: string | null;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  address: string | null;
  regime: 'simplified' | 'ordinary' | null;
  frequency: 'monthly' | 'quarterly' | 'yearly' | null;
  entity_type: string | null;
  effective_date: string | null;
  warnings: string[];
}

export type VatLetterMediaType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

const SYSTEM_PROMPT = `You are reading a Luxembourg VAT registration letter
("Attestation d'immatriculation à la TVA") issued by the Administration
de l'enregistrement, des domaines et de la TVA (AED). Extract the
structured fields below. Return STRICT JSON only — no prose, no code
fences.

JSON schema:
{
  "name":            string | null,   // entity legal name, no legal-form suffix stripped
  "legal_form":      string | null,   // "SARL" | "SA" | "SCSp" | "SCA" | "RAIF" | "SIF" | ...
  "vat_number":      string | null,   // "LU" + 8 digits, e.g. "LU12345678"
  "matricule":       string | null,   // 11-13 digit LU national identifier
  "rcs_number":      string | null,   // RCS Luxembourg, e.g. "B123456"
  "address":         string | null,   // full address as printed
  "regime":          "simplified" | "ordinary" | null,
  "frequency":       "monthly" | "quarterly" | "yearly" | null,
  "entity_type":     string | null,   // one of: fund, securitization_vehicle, active_holding, gp, manco, other
  "effective_date":  string | null,   // ISO "YYYY-MM-DD" when VAT registration becomes effective
  "warnings":        string[]         // things you could not read confidently; empty array when clean
}

Rules:
- NEVER invent a VAT number. If the letter doesn't show one clearly, set null and add a warning.
- Matricule starts "1999" or "2000+" for modern entities; if you see a number that doesn't match, return null + warning.
- If the letter is not an AED registration letter (e.g. it's an invoice), return all-null fields and a single warning "Document does not look like a VAT registration letter".
- entity_type mapping (6 canonical values only — 'passive_holding' REMOVED 2026-04-21 because a pure passive holding is not a VAT taxable person per Polysar C-60/90 and has no reason to be registered for VAT):
    * "fund", "UCITS", "UCI Part II", "SIF", "RAIF", "SICAR", "fonds d'investissement" → "fund"
    * "securitisation", "securitization", "véhicule de titrisation", "loi du 22 mars 2004", "compartment", "SV" with issuance of notes/securities → "securitization_vehicle"
    * "AIFM", "ManCo", "management company", "société de gestion" → "manco"
    * "general partner", "GP", "commandité" in an SCSp/SCS context → "gp"
    * "SOPARFI" with explicit services to subsidiaries (management, administration, financing-with-management) → "active_holding"
    * "SOPARFI" without clear activity — add a warning "This letter describes a passive holding which typically is not a VAT taxable person (Polysar C-60/90). Registration may be mistaken; confirm the entity actually provides taxable services before proceeding." and set entity_type to "other"
    * Everything else → "other"
`;

export type ExtractError =
  | { code: 'no_response'; message: string }
  | { code: 'parse_failed'; message: string; raw_text?: string };

export interface ExtractOk {
  ok: true;
  fields: ExtractedVatLetterFields;
}

export interface ExtractFail {
  ok: false;
  error: ExtractError;
}

export async function extractVatLetterFields(params: {
  buffer: Buffer;
  mediaType: VatLetterMediaType;
  filename: string;
  /** Optional — threaded through anthropicCreate for cost attribution. */
  entityId?: string | null;
}): Promise<ExtractOk | ExtractFail> {
  const { buffer, mediaType, filename, entityId } = params;
  const base64 = buffer.toString('base64');

  let resp: Anthropic.Message;
  try {
    resp = await anthropicCreate(
      {
        // Upgraded 2026-04-22 Haiku → Opus 4.7 per Diego 2026-04-21:
        // the VAT registration letter extractor was "almost completely
        // wrong" on his first try. This is a once-per-entity call
        // (creating the full VAT profile: name, VAT no., matricule,
        // RCS, regime, frequency, entity_type, effective date) — high
        // stakes, low volume. Opus 4.7's OCR + reasoning accuracy on
        // LU legal documents justifies the cost for this specific path;
        // routine invoice extraction stays on Haiku.
        model: 'claude-opus-4-7',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              mediaType === 'application/pdf'
                ? ({ type: 'document',
                    source: { type: 'base64', media_type: mediaType, data: base64 } } as Anthropic.DocumentBlockParam)
                : ({ type: 'image',
                    source: { type: 'base64', media_type: mediaType, data: base64 } } as Anthropic.ImageBlockParam),
              { type: 'text', text: 'Extract the fields in the JSON schema from the system prompt. Return ONLY the JSON.' },
            ],
          },
        ],
      },
      {
        agent: 'extractor',
        label: `vat_letter:${filename}`,
        entity_id: entityId ?? undefined,
      },
    );
  } catch (err) {
    log.error('anthropic call failed', err);
    throw err;
  }

  const textBlock = resp.content.find(c => c.type === 'text') as Anthropic.TextBlock | undefined;
  if (!textBlock) {
    return { ok: false, error: { code: 'no_response', message: 'The AI returned no readable content.' } };
  }

  let parsed: ExtractedVatLetterFields;
  try {
    const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('JSON parse failure', { text: textBlock.text.slice(0, 500), err });
    return {
      ok: false,
      error: {
        code: 'parse_failed',
        message: 'The AI response could not be parsed. Try uploading a clearer scan / PDF.',
        raw_text: textBlock.text.slice(0, 500),
      },
    };
  }

  // Defensive normalisation: coerce unexpected shapes to null.
  const out: ExtractedVatLetterFields = {
    name: typeof parsed.name === 'string' ? parsed.name.trim() || null : null,
    legal_form: typeof parsed.legal_form === 'string' ? parsed.legal_form.trim() || null : null,
    vat_number: typeof parsed.vat_number === 'string' ? parsed.vat_number.trim().toUpperCase() || null : null,
    matricule: typeof parsed.matricule === 'string' ? parsed.matricule.trim() || null : null,
    rcs_number: typeof parsed.rcs_number === 'string' ? parsed.rcs_number.trim().toUpperCase() || null : null,
    address: typeof parsed.address === 'string' ? parsed.address.trim() || null : null,
    regime: (parsed.regime === 'simplified' || parsed.regime === 'ordinary') ? parsed.regime : null,
    frequency: (['monthly', 'quarterly', 'yearly'] as const).includes(parsed.frequency as 'monthly' | 'quarterly' | 'yearly')
      ? (parsed.frequency as 'monthly' | 'quarterly' | 'yearly')
      : null,
    entity_type: typeof parsed.entity_type === 'string' ? parsed.entity_type.trim() || null : null,
    effective_date: typeof parsed.effective_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.effective_date)
      ? parsed.effective_date
      : null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(w => typeof w === 'string').slice(0, 10) : [],
  };

  log.info('vat letter extracted', {
    file_bytes: buffer.byteLength,
    filename,
    has_vat: !!out.vat_number,
    has_matricule: !!out.matricule,
    warning_count: out.warnings.length,
  });

  return { ok: true, fields: out };
}

export function resolveMediaType(mime: string): VatLetterMediaType | null {
  const t = mime.toLowerCase();
  if (t.startsWith('application/pdf')) return 'application/pdf';
  if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
  if (t === 'image/png') return 'image/png';
  if (t === 'image/gif') return 'image/gif';
  if (t === 'image/webp') return 'image/webp';
  return null;
}

/**
 * Map extracted fields to the entity columns they'd update.
 * Used by the diff flow when re-uploading a letter.
 *
 * Note: `frequency` maps `yearly` → `annual` to match the existing
 * enum stored on `entities.frequency`.
 */
export function fieldsToEntityPatch(
  fields: ExtractedVatLetterFields,
): Record<string, string | null> {
  return {
    name: fields.name,
    legal_form: fields.legal_form,
    vat_number: fields.vat_number,
    matricule: fields.matricule,
    rcs_number: fields.rcs_number,
    address: fields.address,
    entity_type: fields.entity_type,
    regime: fields.regime,
    frequency: fields.frequency === 'yearly' ? 'annual' : fields.frequency,
  };
}
