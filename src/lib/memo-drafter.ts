// ════════════════════════════════════════════════════════════════════════
// Memo Drafter — Opus 4.7 formal defense memo for a single invoice line.
//
// Purpose: when the reviewer overrides a classification, or wants to
// document a complex call in case of AED audit, this agent produces
// a formal markdown memo with:
//   • Facts (invoice details)
//   • Classification decision (treatment code + rule)
//   • Legal analysis (CJEU cases cited inline, LTVA articles anchored)
//   • Audit-trail considerations
//   • Conclusion
//
// Diego's ask 2026-04-21:
//   "Dame un memo defensible sobre esta posición con las citas
//    correctas."
//
// This agent delivers that. Output is markdown; the UI lets the
// reviewer download it, copy it, or attach it to the audit-trail
// PDF. No DB persistence in the MVP — if Diego uses it a lot, we
// add an invoice_memos table in a follow-up.
//
// Defensibility: the memo is always labelled "AI-drafted — reviewer
// is the final authority" in the footer. Cites specific legal sources
// by their structured id from legal-sources.ts so the reviewer can
// follow the audit chain.
// ════════════════════════════════════════════════════════════════════════

import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { TREATMENT_CODES } from '@/config/treatment-codes';
import { logger } from '@/lib/logger';

const log = logger.bind('memo-drafter');

const MEMO_MODEL = 'claude-opus-4-7';

export interface MemoInputLine {
  line_id: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  supplier?: string | null;
  supplier_country?: string | null;
  customer_country?: string | null;
  description?: string | null;
  amount_eur?: number | null;
  vat_rate?: number | null;
  vat_applied?: number | null;
  direction: 'incoming' | 'outgoing';
  treatment?: string | null;
  classification_rule?: string | null;
  classification_reason?: string | null;
  ai_suggested_treatment?: string | null;
  flag_reason?: string | null;
}

export interface MemoInputEntity {
  entity_name: string;
  entity_type: string | null;
  vat_number: string | null;
  regime: string;
  frequency: string;
}

export interface MemoInputOptional {
  declaration_year?: number;
  declaration_period?: string;
  reviewer_note?: string;
  override_reason?: string;
}

export interface MemoOpts {
  entityId?: string | null;
  declarationId?: string | null;
}

export interface MemoResult {
  markdown: string;
  model: string;
  cost_eur: number;
}

const SYSTEM_PROMPT = `You are cifra's Memo Drafter agent. You write formal Luxembourg VAT defense memos that a tax practitioner could attach to an AED audit file.

Your output is a complete markdown document with the following mandatory sections in this exact order:

## 1. Summary
One paragraph stating the treatment applied and the legal basis in one sentence.

## 2. Facts
Invoice-level facts: supplier, customer, direction, amounts, description, date, period.

## 3. Legal analysis
The meat. Cite:
- the precise LTVA article (e.g. "Art. 44§1 (a) LTVA")
- the corresponding EU VAT Directive article (e.g. "Art. 135(1)(b) Directive 2006/112/EC")
- every CJEU case that supports the conclusion, with format "<Case Name> (<Case number>, <date>)"
- any AED circular that codifies the position
- market-practice references when applicable

Explain the reasoning step by step: why this treatment applies, which facts are determinative, which alternatives were considered and rejected.

## 4. Classification decision
State the final treatment code (e.g. LUX_17, RC_EU_EX, OUT_SCOPE) and reference cifra's rule id (e.g. RULE 36 or TIER 4 · AI PROPOSER) that fired. If the reviewer overrode the AI/classifier proposal, quote the override reason and explain why it's defensible.

## 5. Audit-trail considerations
What evidence supports this position if AED challenges it within the 5-year statute of limitations. What documents should be retained.

## 6. Conclusion
One-sentence restatement.

---
FOOTER (mandatory, append verbatim at the end):

*Drafted by cifra's Memo Drafter (Opus 4.7). The reviewer is the final legal authority — this memo reflects the reviewer's documented position and must be reconciled with current AED practice before relying on it in front of an inspection.*

---

STYLE:
- Professional practitioner tone (Big-4 memorandum register).
- Use inline citations rather than footnotes.
- No speculation about CJEU cases you are not certain about. If an analogy is relevant but the case is uncertain, say "by analogy with" and flag the uncertainty.
- Cite Versãofast (T-657/24, 26 Nov 2025) when credit-intermediation is in play.
- Cite BlackRock C-231/19 when fund-management single-supply is in play.
- Cite Polysar C-60/90 + Cibo C-16/00 for holding-company VAT status.
- Cite Finanzamt T II C-184/23 (11 Jul 2024) for VAT-group intra-supplies.
- Always ground exemption claims in both the LTVA article AND the Directive article.

LENGTH: between 400 and 900 words. Never pad.

Return ONLY the markdown memo. No preamble, no "here is your memo:", no conversational framing.`;

function buildUserPrompt(
  line: MemoInputLine,
  entity: MemoInputEntity,
  extras: MemoInputOptional,
): string {
  const treatmentInfo = line.treatment && line.treatment in TREATMENT_CODES
    ? `${line.treatment} — ${TREATMENT_CODES[line.treatment as keyof typeof TREATMENT_CODES].label}`
    : line.treatment ?? 'UNCLASSIFIED';

  const parts: (string | null)[] = [
    '### Draft a defense memo for the following invoice line',
    '',
    '## Entity',
    `name: ${entity.entity_name}`,
    `entity_type: ${entity.entity_type ?? 'unknown'}`,
    `vat_number: ${entity.vat_number ?? 'n/a'}`,
    `regime: ${entity.regime} · ${entity.frequency}`,
    extras.declaration_year
      ? `declaration_period: ${extras.declaration_year} ${extras.declaration_period ?? ''}`
      : null,
    '',
    '## Invoice line',
    `direction: ${line.direction}`,
    line.supplier ? `supplier: ${line.supplier}` : null,
    line.supplier_country ? `supplier_country: ${line.supplier_country}` : null,
    line.customer_country ? `customer_country: ${line.customer_country}` : null,
    line.invoice_number ? `invoice_number: ${line.invoice_number}` : null,
    line.invoice_date ? `invoice_date: ${line.invoice_date}` : null,
    line.amount_eur != null ? `amount_eur: ${line.amount_eur}` : null,
    line.vat_rate != null ? `vat_rate: ${line.vat_rate}` : null,
    line.vat_applied != null ? `vat_applied: ${line.vat_applied}` : null,
    line.description ? `description: ${line.description}` : null,
    '',
    '## Current classification',
    `treatment: ${treatmentInfo}`,
    line.classification_rule ? `rule: ${line.classification_rule}` : null,
    line.classification_reason ? `reason: ${line.classification_reason}` : null,
    line.ai_suggested_treatment && line.ai_suggested_treatment !== line.treatment
      ? `original_ai_suggestion: ${line.ai_suggested_treatment} (reviewer overrode)`
      : null,
    line.flag_reason ? `flag_reason: ${line.flag_reason}` : null,
    '',
    extras.reviewer_note ? `## Reviewer note\n${extras.reviewer_note}` : null,
    extras.override_reason ? `## Override reason\n${extras.override_reason}` : null,
    '',
    'Draft the memo following the mandated structure. Cite only legal sources you are confident about.',
  ];

  return parts.filter(x => x !== null).join('\n');
}

export async function draftMemo(
  line: MemoInputLine,
  entity: MemoInputEntity,
  extras: MemoInputOptional = {},
  opts: MemoOpts = {},
): Promise<MemoResult> {
  const message = await anthropicCreate(
    {
      model: MEMO_MODEL,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(line, entity, extras) }],
    },
    {
      agent: 'drafter',
      entity_id: opts.entityId ?? null,
      declaration_id: opts.declarationId ?? null,
      label: 'memo-drafter',
    },
  );

  const markdown = message.content
    .filter(c => c.type === 'text')
    .map(c => (c as { text: string }).text)
    .join('')
    .trim();

  if (!markdown || markdown.length < 50) {
    log.warn('memo drafter: empty or suspiciously short output', {
      length: markdown.length,
      line_id: line.line_id,
    });
  }

  // The anthropic-wrapper already logged the call to api_calls with
  // cost_eur; we don't re-compute here. Return 0 as a placeholder for
  // cost — callers can look up api_calls by declaration_id if they
  // need the precise figure.
  return { markdown, model: MEMO_MODEL, cost_eur: 0 };
}
