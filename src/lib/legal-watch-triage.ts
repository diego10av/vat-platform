// ════════════════════════════════════════════════════════════════════════
// Legal-watch auto-triage — Opus 4.7.
//
// Input: a row from legal_watch_queue (title + summary + matched_keywords)
// Output: severity assessment + affected rules + proposed action
//
// Runs automatically after each scanner pass (src/lib/legal-watch-scan.ts)
// on items with status='new' AND ai_triage_at IS NULL. Also callable
// on-demand via POST /api/legal-watch/queue/[id]/triage-with-ai for
// rerun / retroactive triage.
//
// Prompt caching: the set of cifra's current classification rules +
// key legal sources is stable across thousands of calls. We cache it
// as system context so each triage call pays ~€0.002 in cache-read
// instead of ~€0.03 fresh.
// ════════════════════════════════════════════════════════════════════════

import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { logger } from '@/lib/logger';
import { LU_LAW, EU_LAW, CIRCULARS, CASES_EU, CASES_LU, PRACTICE } from '@/config/legal-sources';

const log = logger.bind('legal-watch-triage');

const TRIAGE_MODEL = 'claude-opus-4-7';

export type TriageSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface TriageInput {
  title: string;
  summary?: string | null;
  url?: string | null;
  matched_keywords: string[];
  published_at?: string | null;
}

export interface TriageResult {
  relevant: boolean;
  severity: TriageSeverity | null;
  affected_rules: string[];
  summary: string;
  proposed_action: string;
  confidence: number;
  model: string;
}

/** Build the cached system prompt. This is called ONCE per process
 *  (memoised below) and reused across every triage call — large cache
 *  hit rate because the content doesn't change between calls. */
function buildSystemPrompt(): string {
  const rulesCatalogue = [
    { id: 'RULE 1-4',   when: 'LU supplier, rate match 17/14/8/3%',   code: 'LUX_17 / 14 / 08 / 03' },
    { id: 'RULE 5',     when: 'LU real-estate letting (no Art. 45 opt-in)', code: 'LUX_00' },
    { id: 'RULE 5C',    when: 'Real-estate carve-out (hotel, parking, hunting, safe-deposit)', code: 'LUX_17' },
    { id: 'RULE 5D',    when: 'Domiciliation / corporate services (AED Circ. 764)', code: 'LUX_17' },
    { id: 'RULE 7A/B/D', when: 'Extractor-captured Art. 44 reference (financial / real-estate / fund mgmt)', code: 'EXEMPT_44A_FIN / 44B_RE / 44' },
    { id: 'RULE 10',    when: 'EU fund-mgmt RC exempt (BlackRock C-231/19 gate)', code: 'RC_EU_EX' },
    { id: 'RULE 11',    when: 'EU supplier reverse-charge at 17%', code: 'RC_EU_TAX' },
    { id: 'RULE 11P/13P/15P', when: 'Passive holding receiving services (Polysar C-60/90)', code: 'flag / LUX_17_NONDED' },
    { id: 'RULE 12',    when: 'Non-EU fund-mgmt RC exempt', code: 'RC_NONEU_EX' },
    { id: 'RULE 13',    when: 'Non-EU supplier reverse-charge at 17%', code: 'RC_NONEU_TAX' },
    { id: 'RULE 17',    when: 'EU IC acquisition of goods (Art. 21 LTVA)', code: 'IC_ACQ_17/14/08/03' },
    { id: 'RULE 20',    when: 'VAT group intra-supply (Art. 60ter LTVA, Finanzamt T II C-184/23)', code: 'VAT_GROUP_OUT' },
    { id: 'RULE 22',    when: 'Platform deemed supplier (Fenix C-695/20)', code: 'PLATFORM_DEEMED' },
    { id: 'RULE 23',    when: 'LU Art. 57 franchise supplier', code: 'LUX_00' },
    { id: 'RULE 24',    when: 'Margin-scheme invoice (Art. 56bis)', code: 'MARGIN_NONDED' },
    { id: 'RULE 25',    when: 'Domestic RC on construction (Art. 61§2 c)', code: 'RC_LUX_CONSTR_17' },
    { id: 'RULE 26',    when: 'Domestic RC on scrap/emission (Art. 61§2 a-b, Art. 199a Directive)', code: 'RC_LUX_SPEC_17' },
    { id: 'RULE 27',    when: 'Bad-debt relief (Art. 62 LTVA)', code: 'BAD_DEBT_RELIEF' },
    { id: 'RULE 29',    when: 'Non-deductible LU input VAT (Art. 54 LTVA)', code: 'LUX_17_NONDED' },
    { id: 'RULE 32a/b', when: 'Director fees natural / legal person (C-288/22 TP, Circ. 781-2)', code: 'OUT_SCOPE / LUX_17' },
    { id: 'RULE 33',    when: 'Carry interest (Baštová / Tolsma direct-link test)', code: 'OUT_SCOPE (flag)' },
    { id: 'RULE 34',    when: 'Waterfall distributions (Kretztechnik)', code: 'OUT_SCOPE (flag)' },
    { id: 'RULE 35',    when: 'IGP / cost-sharing (Art. 44§1 y, Kaplan / DNB Banka / Aviva)', code: 'routes by country + entity' },
    { id: 'RULE 36',    when: 'Credit intermediation (Versãofast T-657/24, Ludwig C-453/05)', code: 'LUX_00 / RC_EU_EX / RC_NONEU_EX' },
    { id: 'RULE 37',    when: 'SV servicer agreements (Aspiro C-40/15 split)', code: 'null + flag for split' },
    { id: 'INFERENCE A-E', when: 'Pattern-based fallbacks (advisory magnitude, fund-mgmt keyword, taxable backstop)', code: 'various' },
    { id: 'TIER 4',     when: 'AI proposer — NO_MATCH fallback (Opus 4.7)', code: 'any' },
  ];

  const keyCases = Object.values(CASES_EU)
    .concat(Object.values(CASES_LU))
    .slice(0, 40)
    .map(s => `- ${s.id}: ${s.title} (${s.citation})`)
    .join('\n');

  const circulars = Object.values(CIRCULARS)
    .map(s => `- ${s.id}: ${s.title}`)
    .join('\n');

  const practice = Object.values(PRACTICE)
    .map(s => `- ${s.id}: ${s.title}`)
    .join('\n');

  return `You are cifra's legal-watch triage AI. cifra is a Luxembourg VAT compliance platform; you read freshly-fetched candidate items (CJEU judgments, AED circulars, Big-4 tax alerts, legilux publications) and decide whether they affect cifra's classification rules.

## cifra's current classification rule catalogue

${rulesCatalogue.map(r => `**${r.id}** — ${r.when} → ${r.code}`).join('\n')}

## Key legal sources cifra already tracks

CJEU / EU cases:
${keyCases}

AED circulars in force:
${circulars}

Market practice:
${practice}

## Your job

Given ONE candidate item from the public-feed scanner, return STRICT JSON with:

{
  "relevant": true | false,
  "severity": "critical" | "high" | "medium" | "low" | null,
  "affected_rules": ["RULE 36", "RULE 7A", ...],   // rule ids from the catalogue above; empty array if none directly affected
  "summary": "One short paragraph: why does this matter for cifra?",
  "proposed_action": "One short paragraph: what should the reviewer do?",
  "confidence": <float 0.0-1.0>
}

## Severity guide

- **critical** — item directly overrules a rule cifra applies today. Reviewer should escalate within 48h (e.g. CJEU judgment reversing post-C-288/22 legal-person director treatment).
- **high** — item changes how an existing rule should be applied (e.g. new AED circular refining Art. 44§1 d scope). Review within 2 weeks.
- **medium** — tangential; may affect edge cases or new categories. Review next quarter.
- **low** — informational; legal change in a jurisdiction cifra doesn't cover, or administrative note. File without action.

## When to return relevant=false

If the item is:
- Not about LU or EU VAT
- About a jurisdiction cifra doesn't cover (e.g. US sales tax)
- A duplicate of a case already in cifra's catalogue (match the case number)
- Marketing content / press release with no legal substance

Return STRICT JSON only. No markdown fences. No conversational preamble.`;
}

// Memoise: build once per process.
let cachedSystemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (!cachedSystemPrompt) cachedSystemPrompt = buildSystemPrompt();
  return cachedSystemPrompt;
}

function buildUserPrompt(input: TriageInput): string {
  return [
    '### Candidate item',
    `title: ${input.title}`,
    input.url ? `url: ${input.url}` : null,
    input.published_at ? `published_at: ${input.published_at}` : null,
    input.matched_keywords.length > 0
      ? `matched_keywords: ${input.matched_keywords.join(', ')}`
      : null,
    '',
    'summary:',
    input.summary ?? '(no summary available)',
    '',
    'Triage this item and return STRICT JSON per the schema above.',
  ].filter(x => x !== null).join('\n');
}

export async function triageQueueItem(input: TriageInput): Promise<TriageResult | null> {
  try {
    const message = await anthropicCreate(
      {
        model: TRIAGE_MODEL,
        max_tokens: 600,
        system: [
          {
            type: 'text',
            text: getSystemPrompt(),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
      },
      {
        agent: 'other',
        label: 'legal-watch-triage',
      },
    );

    const text = message.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('')
      .trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('legal-watch-triage: no JSON in response', { raw_preview: text.slice(0, 200) });
      return null;
    }

    let parsed: Partial<TriageResult>;
    try {
      parsed = JSON.parse(jsonMatch[0]) as Partial<TriageResult>;
    } catch (e) {
      log.warn('legal-watch-triage: JSON parse failed', {
        err: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    const severityRaw = typeof parsed.severity === 'string' ? parsed.severity : null;
    const severity: TriageSeverity | null = (['critical', 'high', 'medium', 'low'] as const)
      .includes(severityRaw as TriageSeverity)
      ? (severityRaw as TriageSeverity)
      : null;

    const affectedRules = Array.isArray(parsed.affected_rules)
      ? parsed.affected_rules
          .filter((r: unknown): r is string => typeof r === 'string')
          .slice(0, 10)
      : [];

    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

    return {
      relevant: parsed.relevant !== false,
      severity: severity ?? (parsed.relevant === false ? 'low' : 'medium'),
      affected_rules: affectedRules,
      summary: (parsed.summary || '').trim() || 'No summary provided.',
      proposed_action: (parsed.proposed_action || '').trim() || 'Review manually.',
      confidence,
      model: TRIAGE_MODEL,
    };
  } catch (err) {
    log.warn('legal-watch-triage threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
