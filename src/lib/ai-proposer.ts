// ════════════════════════════════════════════════════════════════════════
// Tier 4 · AI classification proposer
//
// Role in the classifier stack:
//
//   Tier 1 — Direct-evidence rules (rate match, Art. 44 ref, VAT group)
//   Tier 2 — Content-specific rules (directors, carry, IGP, credit-intermed.)
//   Tier 3 — Inference rules (magnitude match, fund-mgmt keyword gates)
//   Tier 4 — AI proposer (this file)
//
// When Tiers 1-3 all return UNCLASSIFIED / NO_MATCH, the classifier
// historically left the line with treatment=null and a flag for the
// reviewer to triage manually. Tier 4 runs Haiku with full entity
// context to propose the most likely treatment — still with a flag,
// and always clearly attributed as an AI proposal (source='ai_proposer')
// so the audit trail distinguishes deterministic rules from AI
// suggestions.
//
// Defensibility design:
//   • Tier 4 NEVER wins over a deterministic rule.
//   • Every proposal is flag=true — reviewer MUST confirm before filing.
//   • The source field 'ai_proposer' is visible in the audit log and
//     surfaced in the reviewer UI as a distinct "🔮 AI-proposed" badge
//     (separate colour from rule-based classifications).
//   • Big-4 compliance officer answer: "Tiers 1-3 are 0% AI, Tier 4
//     is AI but always flagged, always reviewer-confirmed, and the
//     log records exactly which tier proposed what."
//
// Budget:
//   Haiku ≈ €0.02-0.05 per call. At ~5% of lines falling through to
//   Tier 4, a 100-invoice declaration costs €0.10-0.25 extra. Negligible.
//
// Added 2026-04-21 per Diego's ask (he wanted "casi 10 técnicamente").
// ════════════════════════════════════════════════════════════════════════

import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { TREATMENT_CODES, type TreatmentCode } from '@/config/treatment-codes';
import type { ClassificationResult, EntityContext, InvoiceLineInput } from '@/config/classification-rules';
import { logger } from '@/lib/logger';

const log = logger.bind('ai-proposer');

// Upgraded 2026-04-22 — Haiku → Opus 4.7. Rationale:
// Tier 4 fires only when Tiers 1-3 (32+ deterministic rules + precedents
// + inference) all returned NO_MATCH — by definition these are the
// most legally ambiguous invoices in the declaration. Haiku would give
// a reasonable guess at the easy end of NO_MATCH; Opus 4.7 gives a
// defensible proposal at the hard end (novel cross-border structures,
// contested post-Versãofast intermediation patterns, substance-over-form
// carry interest cases). At ~5-15% of lines, cost impact is ~€4-6/mo
// for 10 clients — trivial given the quality lift for the reviewer.
const TIER_4_MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are cifra's Tier 4 classification AI proposer for Luxembourg VAT returns.

CONTEXT: A deterministic rules engine (Tiers 1-3, covering 32+ rules citing LTVA articles, EU Directive articles, CJEU cases, and AED circulars) has already run on this invoice line and did NOT match any rule. Your job is to propose the most likely treatment code so the reviewer has a starting point instead of a blank field. Your output is ALWAYS displayed to a human reviewer with a "🔮 AI-proposed" flag — you are a suggestion, not a decision.

LUXEMBOURG VAT PRACTICE ANCHORS you must respect:
- LTVA Art. 40 = 17% standard rate (LU). Art. 40-1 = 14/8/3% reduced rates.
- LTVA Art. 44 = exemptions (44§1 a financial, 44§1 b real-estate letting, 44§1 d fund management, 44§1 y cost-sharing/IGP).
- LTVA Art. 17§1 = reverse-charge on B2B services (customer reverse-charges at LU rate for EU + non-EU suppliers).
- LTVA Art. 21 = intra-Community acquisition of goods.
- LTVA Art. 27 = import of goods.
- LTVA Art. 60ter = VAT group (intra-group supplies out of scope).
- BlackRock C-231/19 = fund-management exemption requires "specific and essential" service.
- Polysar C-60/90 = passive holding is not a taxable person.
- Versãofast T-657/24 = credit intermediation exemption widened (Art. 44§1 a).

YOU MUST return valid JSON with this exact shape (no markdown, no commentary):
{
  "treatment": "<one of the valid treatment codes, or null if truly uncertain>",
  "reason": "<single sentence citing the LU VAT article or CJEU case that grounds the proposal>",
  "confidence": <float 0.0-1.0 — use 0.5 as default, raise to 0.8+ only when very confident>,
  "suggested_alternatives": [<0-2 alternative treatment codes a reviewer might also consider>]
}

If the fact pattern is genuinely ambiguous or outside your knowledge, return treatment=null and explain briefly why. Never invent an obscure code; stick to the canonical list.`;

interface ProposerResponse {
  treatment: string | null;
  reason: string;
  confidence: number;
  suggested_alternatives?: string[];
}

function buildUserPrompt(line: InvoiceLineInput, ctx: EntityContext): string {
  const validCodes = Object.keys(TREATMENT_CODES).sort();
  const parts: (string | null)[] = [
    '### Invoice line',
    `direction: ${line.direction}`,
    `country: ${line.country ?? '(not captured)'}`,
    `vat_rate: ${line.vat_rate ?? 'null'}`,
    `vat_applied: ${line.vat_applied ?? 'null'}`,
    `amount_eur: ${line.amount_eur ?? 'null'}`,
    `description: ${line.description ?? '(none)'}`,
    line.supplier_name ? `supplier_name: ${line.supplier_name}` : null,
    line.exemption_reference ? `exemption_reference: ${line.exemption_reference}` : null,
    line.customer_country ? `customer_country: ${line.customer_country}` : null,
    line.customer_vat ? `customer_vat: ${line.customer_vat}` : null,
    line.is_disbursement ? 'is_disbursement: true' : null,
    line.is_credit_note ? 'is_credit_note: true' : null,
    '',
    '### Entity context',
    `entity_type: ${ctx.entity_type ?? 'unknown'}`,
    ctx.vat_group_id ? `vat_group_id: ${ctx.vat_group_id}` : null,
    typeof ctx.exempt_outgoing_total === 'number'
      ? `exempt_outgoing_total_eur: ${ctx.exempt_outgoing_total}`
      : null,
    '',
    '### Valid treatment codes (use EXACTLY one for `treatment`, or null)',
    validCodes.join(', '),
    '',
    'Return JSON only.',
  ];
  return parts.filter(Boolean).join('\n');
}

export interface ProposerOpts {
  entityId?: string | null;
  declarationId?: string | null;
}

/**
 * Call Haiku to propose a classification for a line the deterministic
 * rules engine could not match. Always returns a flagged result with
 * source='ai_proposer', or null if the AI itself couldn't produce a
 * confident answer.
 *
 * Non-throwing: any error (API failure, malformed JSON, budget exhausted,
 * rate limit) swallows the exception and returns null, so the caller
 * can simply fall through to NO_MATCH without aborting the whole
 * classification pass.
 */
export async function proposeClassification(
  line: InvoiceLineInput,
  ctx: EntityContext,
  opts: ProposerOpts = {},
): Promise<ClassificationResult | null> {
  try {
    const message = await anthropicCreate(
      {
        model: TIER_4_MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(line, ctx) }],
      },
      {
        agent: 'classifier',
        entity_id: opts.entityId ?? null,
        declaration_id: opts.declarationId ?? null,
        label: 'tier-4-proposer',
      },
    );

    const text = message.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('')
      .trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('tier4 proposer: no JSON in response', { raw_preview: text.slice(0, 200) });
      return null;
    }

    let parsed: ProposerResponse;
    try {
      parsed = JSON.parse(jsonMatch[0]) as ProposerResponse;
    } catch (e) {
      log.warn('tier4 proposer: JSON parse failed', {
        err: e instanceof Error ? e.message : String(e),
        raw_preview: jsonMatch[0].slice(0, 200),
      });
      return null;
    }

    // Defensive: treatment must be a string that matches the canonical
    // whitelist. Anything else → return null (reviewer sees NO_MATCH).
    if (!parsed.treatment || typeof parsed.treatment !== 'string') return null;
    if (!(parsed.treatment in TREATMENT_CODES)) {
      log.warn('tier4 proposer: hallucinated treatment code', {
        proposed: parsed.treatment,
      });
      return null;
    }

    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
    const pct = Math.round(confidence * 100);
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'AI-proposed treatment; no rationale provided.';
    const alts = Array.isArray(parsed.suggested_alternatives)
      ? parsed.suggested_alternatives
          .filter((a): a is string => typeof a === 'string' && a in TREATMENT_CODES)
          .slice(0, 2)
      : [];

    return {
      treatment: parsed.treatment as TreatmentCode,
      rule: 'TIER 4 · AI PROPOSER',
      reason,
      source: 'ai_proposer',
      flag: true,
      flag_reason:
        `🔮 AI-proposed treatment (confidence ${pct}%). No Tier 1-3 deterministic rule matched this line — cifra's Haiku tier-4 proposer produced this suggestion based on the invoice + entity context. The reviewer is the final authority; confirm or override before filing. `
        + (alts.length > 0
          ? `Alternatives the AI also considered: ${alts.join(', ')}.`
          : 'No alternatives proposed.'),
    };
  } catch (err) {
    // Non-fatal — anthropic call failed (budget exhausted, rate limit,
    // network). Silent fallback to NO_MATCH preserves the UX: reviewer
    // sees an unclassified line instead of an error banner.
    log.warn('tier4 proposer threw', {
      err: err instanceof Error ? err.message : String(err),
      entity_id: opts.entityId ?? null,
      declaration_id: opts.declarationId ?? null,
    });
    return null;
  }
}
