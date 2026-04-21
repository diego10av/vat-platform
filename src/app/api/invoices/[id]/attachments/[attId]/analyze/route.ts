// ════════════════════════════════════════════════════════════════════════
// POST /api/invoices/[id]/attachments/[attId]/analyze
//
// L2 + L3 of the contract-attachment feature.
//
//   L2 — Claude reads the attached document (contract, engagement
//        letter, advisory email) and produces a structured analysis:
//        a short summary, a list of key clauses that bear on VAT
//        treatment, and a suggested treatment code.
//
//   L3 — the same call is prompted to cite specific legal sources
//        (LTVA articles, CJEU cases, AED circulars) from cifra's
//        internal legal map — so the reviewer sees not just "likely
//        exempt" but "likely exempt per [LTVA Art. 44§1 d] + [CJEU
//        C-169/04]".
//
// The output is stored on the attachment row (ai_analysis,
// ai_summary, ai_suggested_treatment, ai_citations, ai_analyzed_at,
// ai_model) and included in the audit-trail PDF at export time.
//
// Gate: disabled when the parent entity's ai_mode = 'classifier_only'.
//       The attachment + reviewer note (L1) still work in that mode,
//       only the AI analysis step is blocked.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { requireBudget } from '@/lib/budget-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { TREATMENT_CODES } from '@/config/treatment-codes';
import { LU_LAW, EU_LAW, CIRCULARS, CASES_EU, CASES_LU } from '@/config/legal-sources';

const log = logger.bind('attachments/analyze');

// Use Haiku by default — analysis is shortform reasoning and we want
// it to be cheap enough to run liberally. Opus is available later via
// a ?model=opus query param if we decide enterprise customers want
// deeper analyses.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// Opus 4.7 for the deep path (contracts, engagement letters, advisor
// emails with legal reasoning). The Haiku fallback is still used when
// ai_mode='classifier_only' or the per-user budget is exhausted.
const OPUS_MODEL = 'claude-opus-4-7';

export const maxDuration = 120;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// Shortlist of the most-cited LTVA / EU / CJEU / circular ids, formatted
// as "ID — short subject". Keeping the list ~40 items keeps the prompt
// small while covering the bulk of contract-decision cases.
function buildLegalShortlist(): string {
  const items: Array<[string, string]> = [];
  const push = (src: Record<string, { subject: string; id: string }>) => {
    for (const [key, val] of Object.entries(src)) {
      items.push([val.id ?? key, val.subject]);
    }
  };
  push(LU_LAW); push(EU_LAW); push(CIRCULARS); push(CASES_EU); push(CASES_LU);
  // Keep it short: the prompt budget is precious.
  return items.slice(0, 80).map(([id, subj]) => `- ${id}: ${subj}`).join('\n');
}

const TREATMENT_LIST = Object.entries(TREATMENT_CODES)
  .map(([code, cfg]) => `- ${code}: ${cfg.label} (${cfg.direction})`)
  .join('\n');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  try {
    const rl = checkRateLimit(request, { max: 15, windowMs: 60_000, scope: 'attachments/analyze' });
    if (!rl.ok) return rl.response;

    const { id: invoiceId, attId } = await params;
    const modelParam = request.nextUrl.searchParams.get('model');
    const model = modelParam === 'opus' ? OPUS_MODEL : HAIKU_MODEL;

    // Load attachment + invoice + entity context.
    const att = await queryOne<{
      id: string; invoice_id: string; kind: string; filename: string;
      file_path: string; file_type: string; user_note: string | null;
      legal_basis: string | null;
      invoice_provider: string | null; invoice_country: string | null;
      invoice_direction: string | null; invoice_amount: number | null;
      declaration_id: string; entity_id: string; entity_ai_mode: string;
    }>(
      `SELECT a.id, a.invoice_id, a.kind, a.filename, a.file_path, a.file_type,
              a.user_note, a.legal_basis,
              i.provider AS invoice_provider, i.country AS invoice_country,
              i.direction AS invoice_direction, i.total_ex_vat::float AS invoice_amount,
              i.declaration_id, d.entity_id,
              COALESCE(e.ai_mode, 'full') AS entity_ai_mode
         FROM invoice_attachments a
         JOIN invoices i ON a.invoice_id = i.id
         JOIN declarations d ON i.declaration_id = d.id
         JOIN entities e ON d.entity_id = e.id
        WHERE a.id = $1 AND a.invoice_id = $2 AND a.deleted_at IS NULL`,
      [attId, invoiceId],
    );
    if (!att) return apiError('attachment_not_found', 'Attachment not found.', { status: 404 });

    // AI-mode gate — classifier-only entity refuses the analysis.
    if (att.entity_ai_mode === 'classifier_only') {
      return apiError(
        'ai_mode_restricted',
        `The parent entity is in "classifier only" mode — AI analysis of attachments is disabled for it.`,
        { hint: 'Add your analysis manually in the attachment\u2019s note field.', status: 409 });
    }

    const budget = await requireBudget();
    if (!budget.ok) {
      return apiError(budget.error.code, budget.error.message, { hint: budget.error.hint, status: 429 });
    }

    // Download the file from Supabase storage + extract text.
    const sb = supabase();
    const { data: fileBlob, error: dlErr } = await sb.storage
      .from('documents')
      .download(att.file_path);
    if (dlErr || !fileBlob) {
      log.error('storage download failed', dlErr, { path: att.file_path });
      return apiError('download_failed', 'Could not load the file for analysis.', { status: 500 });
    }

    // For this first ship we send the file to Claude as a document
    // block (pdf) or plain text (txt/email). Word / image attachments
    // are not analysed in v1 — we return a polite error.
    const buf = Buffer.from(await fileBlob.arrayBuffer());
    const lower = att.filename.toLowerCase();

    let contentBlock: import('@anthropic-ai/sdk/resources').ContentBlockParam | null = null;
    if (lower.endsWith('.pdf')) {
      contentBlock = {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: buf.toString('base64'),
        },
      };
    } else if (lower.endsWith('.txt') || lower.endsWith('.eml')) {
      const text = buf.toString('utf8').slice(0, 50_000);
      contentBlock = { type: 'text', text };
    } else {
      return apiError(
        'unsupported_attachment',
        `Analysis supports PDF, TXT and EML attachments today. "${att.filename}" is ${att.file_type}.`,
        { hint: 'You can still add a manual note + legal basis without AI analysis.', status: 415 });
    }

    // Prompt
    const system = `You analyse supporting documents (contracts, engagement letters, advisor emails) to help a Luxembourg VAT reviewer decide how to classify a related invoice.

You MUST:
1. Read the document carefully and summarise its VAT-relevant content in 2-4 sentences ("ai_summary").
2. Produce a longer markdown analysis (4-8 bullet points or paragraphs) identifying the clauses, service descriptions, exclusivity, location of supply, or beneficial-ownership signals that matter for VAT.
3. Suggest ONE treatment code from the canonical list below that the invoice most likely deserves, based SOLELY on what the document says + the invoice context.
4. Cite 1-4 specific legal sources by id from the shortlist below. For each, include the exact id string, a 1-line reason, and (if available) a short quote from the document that justifies the citation.
5. If you cannot decide confidently, say so in "ai_summary" and return ai_suggested_treatment = null.

Never invent statute article numbers or case names. Only use ids from the shortlist. If the right source is not in the shortlist, omit the citation rather than guessing.

## Treatment codes (canonical):
${TREATMENT_LIST}

## Legal sources shortlist (cite only these ids):
${buildLegalShortlist()}

Return STRICT JSON with this exact shape:
{
  "ai_summary": "string, 2-4 sentences",
  "ai_analysis": "string, markdown",
  "ai_suggested_treatment": "CODE" | null,
  "ai_citations": [
    { "legal_id": "id-from-shortlist", "quote": "...", "reason": "..." }
  ]
}`;

    const userText = `Invoice context:
- Provider: ${att.invoice_provider ?? '(unknown)'}
- Provider country: ${att.invoice_country ?? '(unknown)'}
- Direction: ${att.invoice_direction ?? '(unknown)'}
- Net amount (EUR): ${att.invoice_amount ?? '(unknown)'}
- Attachment kind: ${att.kind}
- Reviewer's note so far: ${att.user_note || '(none)'}
- Reviewer's legal basis suggestion: ${att.legal_basis || '(none)'}

Analyse the attached ${att.kind.replace('_', ' ')} (filename: "${att.filename}") below. Return the JSON as specified.`;

    const response = await anthropicCreate(
      {
        model,
        max_tokens: 2500,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              contentBlock,
            ],
          },
        ],
      },
      {
        agent: 'other',
        label: `analyze attachment ${att.filename}`,
        entity_id: att.entity_id,
        declaration_id: att.declaration_id,
      },
    );

    const firstText = response.content.find(c => c.type === 'text');
    if (!firstText || firstText.type !== 'text') {
      return apiError('no_analysis', 'Model returned no analysis.', { status: 502 });
    }
    const jsonMatch = firstText.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return apiError('analysis_not_json', 'Analysis was not in expected JSON format.', { status: 502 });
    }
    let parsed: {
      ai_summary?: string; ai_analysis?: string;
      ai_suggested_treatment?: string | null;
      ai_citations?: Array<{ legal_id: string; quote?: string; reason?: string }>;
    };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      log.error('JSON parse failed', e as Error, { text: firstText.text.slice(0, 400) });
      return apiError('analysis_parse_failed', 'Could not parse analysis JSON.', { status: 502 });
    }

    // Validate treatment against canonical set; reject if hallucinated.
    const suggested = parsed.ai_suggested_treatment;
    const validTreatment = (suggested && suggested in TREATMENT_CODES) ? suggested : null;

    // Validate citations against known ids.
    const allKnown = new Set<string>([
      ...Object.keys(LU_LAW), ...Object.keys(EU_LAW),
      ...Object.keys(CIRCULARS), ...Object.keys(CASES_EU), ...Object.keys(CASES_LU),
      ...Object.values(LU_LAW).map(s => s.id),
      ...Object.values(EU_LAW).map(s => s.id),
      ...Object.values(CIRCULARS).map(s => s.id),
      ...Object.values(CASES_EU).map(s => s.id),
      ...Object.values(CASES_LU).map(s => s.id),
    ]);
    const validCitations = (parsed.ai_citations || [])
      .filter(c => c && typeof c.legal_id === 'string' && allKnown.has(c.legal_id))
      .slice(0, 6);

    await execute(
      `UPDATE invoice_attachments
          SET ai_summary = $1,
              ai_analysis = $2,
              ai_suggested_treatment = $3,
              ai_citations = $4::jsonb,
              ai_analyzed_at = NOW(),
              ai_model = $5
        WHERE id = $6`,
      [
        parsed.ai_summary ?? null,
        parsed.ai_analysis ?? null,
        validTreatment,
        JSON.stringify(validCitations),
        model,
        attId,
      ],
    );

    await logAudit({
      entityId: att.entity_id,
      declarationId: att.declaration_id,
      action: 'analyze', targetType: 'invoice_attachment', targetId: attId,
      field: 'ai_suggested_treatment', oldValue: '',
      newValue: validTreatment ?? '(none)',
      reason: parsed.ai_summary?.slice(0, 300),
    });

    return apiOk({
      ai_summary: parsed.ai_summary ?? null,
      ai_analysis: parsed.ai_analysis ?? null,
      ai_suggested_treatment: validTreatment,
      ai_citations: validCitations,
      ai_analyzed_at: new Date().toISOString(),
      ai_model: model,
    });
  } catch (err) {
    return apiFail(err, 'attachments/analyze');
  }
}
