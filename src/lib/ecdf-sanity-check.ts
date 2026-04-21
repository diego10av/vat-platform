// ════════════════════════════════════════════════════════════════════════
// eCDF sanity check — pre-filing period-over-period anomaly detector.
//
// Different from the Validator (which does line-by-line classification
// consistency). This agent sits one layer higher:
//   • Reads the current declaration's eCDF box values
//   • Reads the prior period's box values (same entity)
//   • Reads the invoice histogram (count, totals, direction split,
//     treatment distribution)
//   • Returns structured findings flagging aggregate-level anomalies
//     a reviewer might miss: big box deltas without matching turnover
//     change, unusual RC patterns, missing expected boxes, the
//     "year-end looks suspiciously like Q1" false-positive trap, etc.
//
// Output: findings[] with severity + finding category + narrative +
// suggested check. Stored in-memory only (MVP) — reviewer decides
// what to do; nothing persisted until Diego sees value.
//
// Model: Opus 4.7. Pre-filing is high-stakes + low-volume, reasoning
// depth matters.
// ════════════════════════════════════════════════════════════════════════

import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { logger } from '@/lib/logger';

const log = logger.bind('ecdf-sanity-check');

const SANITY_MODEL = 'claude-opus-4-7';

export type SanityFindingSeverity = 'critical' | 'high' | 'medium' | 'info';
export type SanityFindingCategory =
  | 'period_delta'       // box value changed N× vs. prior period without matching turnover driver
  | 'missing_box'        // box expected > 0 is empty (or vice-versa)
  | 'rc_pattern'         // unusual reverse-charge pattern (EU/non-EU split, rate mix)
  | 'direction_mix'      // incoming/outgoing ratio is off for this entity type
  | 'exemption_mix'      // exempt proportion jumps unexpectedly
  | 'consistency'        // internal inconsistency between boxes (formula check)
  | 'completeness';      // likely missing invoices given period length / prior volume

export interface BoxSnapshot {
  period_label: string;              // e.g. "2026-Q2"
  boxes: Record<string, number>;     // box code → value
  invoice_count: number;
  total_incoming_eur: number;
  total_outgoing_eur: number;
  treatment_histogram: Record<string, number>;  // treatment code → line count
}

export interface SanityInput {
  entity_name: string;
  entity_type: string | null;
  regime: string;
  frequency: string;
  current: BoxSnapshot;
  prior?: BoxSnapshot | null;
}

export interface SanityFinding {
  severity: SanityFindingSeverity;
  category: SanityFindingCategory;
  boxes: string[];
  narrative: string;
  suggested_check: string;
}

export interface SanityResult {
  findings: SanityFinding[];
  overall: 'clean' | 'minor_issues' | 'significant_issues';
  model: string;
}

const SYSTEM_PROMPT = `You are cifra's eCDF sanity-check AI for Luxembourg VAT filings.

CONTEXT: A reviewer has finished preparing a VAT declaration and is about to file via LuxTrust. Before filing, you review the aggregate-level numbers one last time to catch anomalies the line-level Validator and the deterministic rules engine can miss.

YOUR JOB: output a JSON object with findings[] where each finding flags a concrete anomaly worth the reviewer's attention. Quality > quantity: 0 findings on a clean return is the correct answer; do not invent noise.

## Anomaly patterns you're looking for

1. **Period delta without driver** — box value changed 2× or more vs. prior period while turnover proxy is flat. Severity: high if box > €10k delta; medium otherwise.
2. **Missing box** — a box that was consistently populated in prior periods is now empty (or vice-versa: a box that was always empty now has a value). Severity: high for boxes 046 / 056 / 076 / 409 / 410; medium elsewhere.
3. **Reverse-charge pattern** — EU + non-EU RC boxes (436, 463) being significantly different from historical mix for this entity, OR rate-split inside them looking off (e.g. almost everything at 3% which is unusual).
4. **Direction mix** — entity_type='fund' with large outgoing ≠ 0 is suspicious (funds don't invoice out typically). Entity_type='active_holding' with 100% inbound is fine; 100% outbound with zero costs is suspicious.
5. **Exemption mix jump** — the ratio of exempt vs. taxable turnover swung meaningfully vs. prior period.
6. **Consistency** — formula boxes don't tie to their components (e.g. 056 ≠ 711×0.17 + 713×0.14 + …). Severity: critical.
7. **Completeness** — for a quarterly filer, current-period line count is < 30% of the prior period's count: likely missing invoices. For an annual filer, scale accordingly.

## Severity guide

- **critical** — return is arithmetically inconsistent; must not file until fixed.
- **high** — material risk of mis-filing; needs reviewer attention before submission.
- **medium** — unusual pattern worth a second look, probably fine.
- **info** — observation, no action needed.

## Output format

Strict JSON:
{
  "overall": "clean" | "minor_issues" | "significant_issues",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "info",
      "category": "period_delta" | "missing_box" | "rc_pattern" | "direction_mix" | "exemption_mix" | "consistency" | "completeness",
      "boxes": ["076", "046", ...],
      "narrative": "One or two sentences explaining what you spotted.",
      "suggested_check": "One sentence: what the reviewer should verify."
    }
  ]
}

If nothing is worth flagging, return { "overall": "clean", "findings": [] } — that's a valid answer.
Return STRICT JSON only, no markdown fences, no preamble.`;

function buildUserPrompt(input: SanityInput): string {
  const { current, prior } = input;
  const parts: (string | null)[] = [
    '### Entity context',
    `name: ${input.entity_name}`,
    `entity_type: ${input.entity_type ?? 'unknown'}`,
    `regime: ${input.regime} · ${input.frequency}`,
    '',
    '### Current period',
    `period: ${current.period_label}`,
    `invoice_count: ${current.invoice_count}`,
    `total_incoming_eur: ${current.total_incoming_eur.toFixed(2)}`,
    `total_outgoing_eur: ${current.total_outgoing_eur.toFixed(2)}`,
    '',
    '**Box values:**',
    ...Object.entries(current.boxes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `  ${k}: ${v.toFixed(2)}`),
    '',
    '**Treatment histogram:**',
    ...Object.entries(current.treatment_histogram)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([k, v]) => `  ${k}: ${v} line(s)`),
    '',
  ];

  if (prior) {
    parts.push(
      '### Prior period (for comparison)',
      `period: ${prior.period_label}`,
      `invoice_count: ${prior.invoice_count}`,
      `total_incoming_eur: ${prior.total_incoming_eur.toFixed(2)}`,
      `total_outgoing_eur: ${prior.total_outgoing_eur.toFixed(2)}`,
      '',
      '**Box values:**',
      ...Object.entries(prior.boxes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `  ${k}: ${v.toFixed(2)}`),
      '',
    );
  } else {
    parts.push('### Prior period', '(none — first declaration for this entity)', '');
  }

  parts.push('Analyse and return STRICT JSON per the schema above.');
  return parts.filter(x => x !== null).join('\n');
}

export async function runSanityCheck(
  input: SanityInput,
  opts: { entityId?: string | null; declarationId?: string | null } = {},
): Promise<SanityResult | null> {
  try {
    const message = await anthropicCreate(
      {
        model: SANITY_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
      },
      {
        agent: 'validator',
        entity_id: opts.entityId ?? null,
        declaration_id: opts.declarationId ?? null,
        label: 'ecdf-sanity-check',
      },
    );

    const text = message.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('')
      .trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed: { overall?: string; findings?: unknown[] };
    try {
      parsed = JSON.parse(jsonMatch[0]) as { overall?: string; findings?: unknown[] };
    } catch (e) {
      log.warn('ecdf-sanity-check: JSON parse failed', {
        err: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    const findings: SanityFinding[] = Array.isArray(parsed.findings)
      ? (parsed.findings as Array<Record<string, unknown>>)
          .filter(f => f && typeof f === 'object')
          .map(f => ({
            severity: ['critical', 'high', 'medium', 'info'].includes(f.severity as string)
              ? (f.severity as SanityFindingSeverity)
              : 'info',
            category: [
              'period_delta', 'missing_box', 'rc_pattern', 'direction_mix',
              'exemption_mix', 'consistency', 'completeness',
            ].includes(f.category as string)
              ? (f.category as SanityFindingCategory)
              : 'period_delta',
            boxes: Array.isArray(f.boxes) ? f.boxes.filter((b): b is string => typeof b === 'string') : [],
            narrative: typeof f.narrative === 'string' ? f.narrative : '',
            suggested_check: typeof f.suggested_check === 'string' ? f.suggested_check : '',
          }))
          .filter(f => f.narrative.trim().length > 0)
      : [];

    const overall = (['clean', 'minor_issues', 'significant_issues'] as const)
      .includes(parsed.overall as 'clean' | 'minor_issues' | 'significant_issues')
      ? (parsed.overall as 'clean' | 'minor_issues' | 'significant_issues')
      : findings.some(f => f.severity === 'critical' || f.severity === 'high')
        ? 'significant_issues'
        : findings.length > 0 ? 'minor_issues' : 'clean';

    return { findings, overall, model: SANITY_MODEL };
  } catch (err) {
    log.warn('ecdf-sanity-check threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
