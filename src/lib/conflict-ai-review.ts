// ════════════════════════════════════════════════════════════════════════
// conflict-ai-review.ts
//
// Opus 4.7 pass over raw ILIKE hits from /api/crm/matters/conflict-check.
// Takes each hit + matter context and classifies as true_conflict vs
// false_positive, with reasoning + confidence.
//
// Why Opus (not Haiku)? Conflict calls are defensibility-critical. If
// the model over-dismisses a real conflict, the firm could have a
// disciplinary exposure. The marginal cost of Opus (~€0.03 per matter
// intake) is negligible next to the risk of a false-negative.
//
// Budget discipline:
//   - Single batch call per invocation (all hits together), not one
//     call per hit. Typical intake = 1-8 hits = one Opus call.
//   - Output JSON parsed strictly. Anything that fails parse → UI
//     shows the raw hit with no AI verdict (no silent dismissal).
//   - Caller (the conflict-check endpoint) decides when to invoke.
// ════════════════════════════════════════════════════════════════════════

import { anthropicCreate } from '@/lib/anthropic-wrapper';

const MODEL = 'claude-opus-4-7';

export interface RawHit {
  matter_id: string;
  matter_reference: string;
  status: string;
  field: 'client' | 'counterparty' | 'related';
  party: string;
  match_value: string;
  client_name: string | null;
}

export interface AIReviewContext {
  client_name: string | null;
  counterparty_name: string | null;
  related_parties: string[];
}

export interface AIReviewVerdict {
  verdict: 'true_conflict' | 'false_positive' | 'uncertain';
  confidence: number;     // 0-1
  reasoning: string;      // one sentence, <= 200 chars
}

export type ReviewedHit = RawHit & Partial<AIReviewVerdict>;

const SYSTEM_PROMPT = `You are reviewing potential conflicts of interest for a Luxembourg private-equity law firm.

Your job: for each raw ILIKE-match between parties in a new matter and parties in existing matters, decide whether it is a genuine conflict or a false positive.

Decision framework:
- TRUE_CONFLICT: same legal person (individual or entity). E.g. "Acme Holdings SARL" matching "Acme Holdings SARL". Or the same individual with obvious identifying context (same role, same company).
- FALSE_POSITIVE: different legal person who happens to share a name/substring. Examples: common surname (Dupont, García), generic company name ("Group", "Holdings"), substring coincidence ("Fund" matching "Alpha Fund" vs "Beta Fund"), different legal form (SA vs SARL of distinct entities), different jurisdictions with similar names.
- UNCERTAIN: ambiguous — needs human review. Use when you can't tell without more context.

Default to UNCERTAIN when in doubt. Never mark as false_positive unless you are confident.

Output: JSON array only, no prose, no markdown fences. One object per hit in input order:
[{"verdict":"true_conflict|false_positive|uncertain","confidence":0.0-1.0,"reasoning":"one sentence <=200 chars"}]
`;

/**
 * Batch-reviews an array of hits. Returns the same array with AI
 * verdict fields appended. Hits whose review fails stay un-annotated
 * — the UI falls back to manual review for those.
 */
export async function reviewConflictHits(
  hits: RawHit[],
  context: AIReviewContext,
): Promise<ReviewedHit[]> {
  if (hits.length === 0) return [];

  const prompt = buildPrompt(hits, context);

  try {
    const message = await anthropicCreate(
      {
        model: MODEL,
        max_tokens: Math.min(4000, 200 + hits.length * 150),
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      },
      { agent: 'other', label: `conflict-review:${hits.length}-hits` },
    );

    const text = message.content
      .filter((b): b is { type: 'text'; text: string; citations: null } => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    const verdicts = parseVerdicts(text, hits.length);
    if (!verdicts) return hits;   // parse failed — return un-annotated

    return hits.map((h, i) => {
      const v = verdicts[i];
      if (!v) return h;
      return { ...h, verdict: v.verdict, confidence: v.confidence, reasoning: v.reasoning };
    });
  } catch {
    // Network / budget error — UI falls back to manual review.
    return hits;
  }
}

function buildPrompt(hits: RawHit[], ctx: AIReviewContext): string {
  const lines = [
    'Review these potential conflict hits from our ILIKE scan.',
    '',
    '## New matter parties (what we are opening)',
    `- Client: ${ctx.client_name ?? '(none)'}`,
    `- Counterparty: ${ctx.counterparty_name ?? '(none)'}`,
    `- Related: ${ctx.related_parties.length === 0 ? '(none)' : ctx.related_parties.join(' · ')}`,
    '',
    '## Raw hits to classify',
  ];
  hits.forEach((h, i) => {
    lines.push(
      `${i + 1}. In matter ${h.matter_reference} (${h.status})`,
    );
    lines.push(`   field=${h.field} · searched="${h.party}" · matched existing value="${h.match_value}"`);
    if (h.client_name) lines.push(`   existing client: ${h.client_name}`);
  });
  lines.push('');
  lines.push('Return a JSON array with one verdict per hit, in the same order.');
  return lines.join('\n');
}

function parseVerdicts(raw: string, expectedCount: number): AIReviewVerdict[] | null {
  // Strip accidental fences.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    if (parsed.length !== expectedCount) return null;
    const out: AIReviewVerdict[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') return null;
      const v = (item as { verdict?: unknown }).verdict;
      const c = Number((item as { confidence?: unknown }).confidence);
      const r = (item as { reasoning?: unknown }).reasoning;
      if (v !== 'true_conflict' && v !== 'false_positive' && v !== 'uncertain') return null;
      if (!Number.isFinite(c) || c < 0 || c > 1) return null;
      if (typeof r !== 'string') return null;
      out.push({
        verdict: v,
        confidence: c,
        reasoning: r.slice(0, 200),
      });
    }
    return out;
  } catch {
    return null;
  }
}
