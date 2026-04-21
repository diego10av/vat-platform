// Option C — Validator agent helper.
//
// Runs an Opus second-opinion review over the classified lines of a
// declaration. Persists the model's findings to `validator_findings`
// keyed by `run_id`. The UI surfaces findings next to other review
// flags; each finding is resolved by the reviewer as
// accepted / rejected / deferred.
//
// Cost controls:
//  - Opus is expensive (~€0.05–0.15 per declaration). The endpoint is
//    opt-in — the UI exposes a button; no automatic trigger.
//  - We batch lines in groups of LINES_PER_BATCH so a single API call
//    stays within a few thousand output tokens.
//  - Extended-thinking budget is capped per batch.

import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { query, queryOne, execute, generateId, tx, execTx } from '@/lib/db';
import { readFile } from 'fs/promises';
import path from 'path';
import { ALL_LEGAL_SOURCES } from '@/config/legal-sources';
import { TREATMENT_CODES } from '@/config/treatment-codes';

// Upgraded 2026-04-22 to Opus 4.7. Validator is the pitch-killer
// agent — when it spots a contradictory classification or a missing
// exemption argument, that quality is what distinguishes cifra from
// a ChatGPT wrapper. 4.7 is strictly better at multi-hop LU-VAT
// reasoning on a prepared declaration.
const VALIDATOR_MODEL = 'claude-opus-4-7';
const LINES_PER_BATCH = 30;
const MAX_OUTPUT_TOKENS = 4000;

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'classification' | 'evidence' | 'completeness' | 'legal_risk' | 'reconciliation';

export interface ValidatorFinding {
  line_id: string | null;
  invoice_id: string | null;
  severity: FindingSeverity;
  category: FindingCategory;
  current_treatment: string | null;
  suggested_treatment: string | null;
  reasoning: string;
  legal_refs: string[];
}

export interface ValidatorRunResult {
  run_id: string;
  findings_count: number;
  by_severity: Record<FindingSeverity, number>;
  skipped_batches: number;
  model_errors: string[];
}

interface EntityCtx {
  name: string;
  vat_number: string | null;
  matricule: string | null;
  regime: string;
  entity_type: string | null;
  vat_group_id: string | null;
  has_art_45_option: boolean;
}

interface DeclCtx {
  year: number;
  period: string;
  frequency: 'annual' | 'quarterly' | 'monthly';
}

interface LineRow {
  line_id: string;
  invoice_id: string;
  provider: string | null;
  provider_vat: string | null;
  provider_country: string | null;
  customer_country: string | null;
  description: string | null;
  invoice_date: string | null;
  direction: string | null;
  direction_confidence: string | null;
  amount_eur: number | null;
  vat_rate: number | null;
  vat_applied: number | null;
  amount_incl: number | null;
  is_credit_note: boolean;
  is_disbursement: boolean;
  exemption_reference: string | null;
  reverse_charge_mentioned: boolean;
  self_billing_mentioned: boolean;
  triangulation_mentioned: boolean;
  margin_scheme_mentioned: boolean;
  self_supply_mentioned: boolean;
  current_treatment: string | null;
  treatment_source: string | null;
  classification_rule: string | null;
  flag: boolean;
  flag_reason: string | null;
  invoice_validity_missing_fields: string[] | null;
}

// ───────────────────────── Public entry point ─────────────────────────
export async function runValidator(declarationId: string): Promise<ValidatorRunResult> {
  const decl = await queryOne<EntityCtx & DeclCtx & { entity_id: string }>(
    `SELECT d.year, d.period, e.id AS entity_id, e.name, e.vat_number, e.matricule,
            e.regime, e.entity_type,
            NULL::text AS vat_group_id, false AS has_art_45_option,
            CASE WHEN d.period = 'Y1' THEN 'annual'
                 WHEN d.period ~ '^Q[1-4]$' THEN 'quarterly'
                 ELSE 'monthly' END AS frequency
       FROM declarations d
       JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId],
  );
  if (!decl) throw new Error(`Declaration ${declarationId} not found`);

  const lines = await query<LineRow>(
    `SELECT il.id AS line_id, il.invoice_id,
            i.provider, i.provider_vat, i.country AS provider_country,
            i.customer_country, il.description,
            i.invoice_date, i.direction, i.direction_confidence,
            il.amount_eur::float AS amount_eur,
            il.vat_rate::float AS vat_rate,
            il.vat_applied::float AS vat_applied,
            il.amount_incl::float AS amount_incl,
            i.is_credit_note, il.is_disbursement,
            il.exemption_reference,
            i.reverse_charge_mentioned, i.self_billing_mentioned,
            i.triangulation_mentioned, i.margin_scheme_mentioned,
            i.self_supply_mentioned,
            il.treatment AS current_treatment,
            il.treatment_source,
            il.classification_rule,
            il.flag, il.flag_reason,
            i.invoice_validity_missing_fields
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
      ORDER BY i.invoice_date NULLS LAST, il.sort_order`,
    [declarationId],
  );

  if (lines.length === 0) {
    return {
      run_id: generateId(),
      findings_count: 0,
      by_severity: emptySeverityCounts(),
      skipped_batches: 0,
      model_errors: [],
    };
  }

  const prompt = await readValidatorPrompt();
  const runId = generateId();
  const allFindings: ValidatorFinding[] = [];
  const modelErrors: string[] = [];
  let skipped = 0;

  // Batch lines into chunks so a single API call fits in output tokens.
  for (let i = 0; i < lines.length; i += LINES_PER_BATCH) {
    const batch = lines.slice(i, i + LINES_PER_BATCH);
    try {
      const findings = await callValidatorForBatch({
        promptSystem: prompt,
        entity: decl,
        declaration: decl,
        lines: batch,
        declarationId,
        entityId: decl.entity_id,
      });
      allFindings.push(...findings);
    } catch (e) {
      skipped += 1;
      const msg = e instanceof Error ? e.message : String(e);
      modelErrors.push(`batch ${Math.floor(i / LINES_PER_BATCH)}: ${msg}`);
    }
  }

  // Persist findings atomically.
  if (allFindings.length > 0) {
    await tx(async (txSql) => {
      for (const f of allFindings) {
        await execTx(txSql,
          `INSERT INTO validator_findings (
             id, declaration_id, run_id, line_id, invoice_id,
             severity, category, current_treatment, suggested_treatment,
             reasoning, legal_refs, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open')`,
          [
            generateId(), declarationId, runId,
            f.line_id, f.invoice_id,
            f.severity, f.category,
            f.current_treatment, f.suggested_treatment,
            f.reasoning, f.legal_refs,
          ],
        );
      }
    });
  }

  return {
    run_id: runId,
    findings_count: allFindings.length,
    by_severity: countBySeverity(allFindings),
    skipped_batches: skipped,
    model_errors: modelErrors,
  };
}

// ───────────────────────── Single-batch call ─────────────────────────
async function callValidatorForBatch(args: {
  promptSystem: string;
  entity: EntityCtx;
  declaration: DeclCtx;
  lines: LineRow[];
  declarationId: string;
  entityId: string;
}): Promise<ValidatorFinding[]> {
  const legalIds = Object.keys(ALL_LEGAL_SOURCES);
  const payload = {
    entity: {
      name: args.entity.name,
      vat_number: args.entity.vat_number,
      matricule: args.entity.matricule,
      regime: args.entity.regime,
      entity_type: args.entity.entity_type,
      vat_group_id: args.entity.vat_group_id,
      has_art_45_option: args.entity.has_art_45_option,
    },
    declaration: {
      year: args.declaration.year,
      period: args.declaration.period,
      frequency: args.declaration.frequency,
    },
    lines: args.lines,
    legal_source_ids: legalIds,
  };

  const response = await anthropicCreate({
    model: VALIDATOR_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: args.promptSystem,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Review the classified lines below and return a JSON array of findings per the schema in the system prompt. '
              + 'Remember: empty array `[]` is correct when the classifier looks right.\n\n```json\n'
              + JSON.stringify(payload, null, 2)
              + '\n```',
          },
        ],
      },
    ],
  }, {
    agent: 'validator',
    declaration_id: args.declarationId,
    entity_id: args.entityId,
    label: `batch of ${args.lines.length} lines`,
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  return parseAndValidateFindings(text);
}

// ───────────────────────── Response parsing ─────────────────────────
// The model is instructed to return a JSON array. We extract the first
// well-formed array even if the model accidentally prefixes it with
// text, and we filter out malformed items rather than bailing the
// whole batch.
export function parseAndValidateFindings(raw: string): ValidatorFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to locate the first JSON array in the string.
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];

  const TREATMENT_SET = new Set(Object.keys(TREATMENT_CODES));
  const LEGAL_SET = new Set(Object.keys(ALL_LEGAL_SOURCES));

  const out: ValidatorFinding[] = [];
  for (const raw_f of parsed) {
    if (!raw_f || typeof raw_f !== 'object') continue;
    const f = raw_f as Record<string, unknown>;
    const severity = f.severity as string;
    const category = f.category as string;
    if (!['critical', 'high', 'medium', 'low', 'info'].includes(severity)) continue;
    if (!['classification', 'evidence', 'completeness', 'legal_risk', 'reconciliation'].includes(category)) continue;
    const reasoning = typeof f.reasoning === 'string' ? f.reasoning.trim() : '';
    if (!reasoning) continue;
    const legalRefsIn = Array.isArray(f.legal_refs) ? f.legal_refs : [];
    const legal_refs = legalRefsIn
      .filter((x): x is string => typeof x === 'string')
      .filter(x => LEGAL_SET.has(x));
    if (legal_refs.length === 0) continue;

    const current_treatment =
      typeof f.current_treatment === 'string' && f.current_treatment ? f.current_treatment : null;
    const suggested_treatment =
      typeof f.suggested_treatment === 'string' && f.suggested_treatment
        ? (TREATMENT_SET.has(f.suggested_treatment) ? f.suggested_treatment : null)
        : null;
    const line_id = typeof f.line_id === 'string' && f.line_id ? f.line_id : null;
    const invoice_id = typeof f.invoice_id === 'string' && f.invoice_id ? f.invoice_id : null;

    out.push({
      line_id, invoice_id,
      severity: severity as FindingSeverity,
      category: category as FindingCategory,
      current_treatment, suggested_treatment,
      reasoning, legal_refs,
    });
  }
  // Sort by severity so the UI renders the most important first.
  const order: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  out.sort((a, b) => order[a.severity] - order[b.severity]);
  return out;
}

// ───────────────────────── Reviewer resolution ─────────────────────────
export async function resolveFinding(findingId: string, decision: {
  status: 'accepted' | 'rejected' | 'deferred';
  status_reason?: string;
  resolved_by?: string;
}): Promise<void> {
  await execute(
    `UPDATE validator_findings
        SET status = $1, status_reason = $2, resolved_by = $3, resolved_at = NOW()
      WHERE id = $4`,
    [decision.status, decision.status_reason ?? null, decision.resolved_by ?? null, findingId],
  );
}

// ───────────────────────── Helpers ─────────────────────────
async function readValidatorPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), 'prompts', 'validator.md');
  return readFile(promptPath, 'utf-8');
}
function emptySeverityCounts(): Record<FindingSeverity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}
function countBySeverity(findings: ValidatorFinding[]): Record<FindingSeverity, number> {
  const counts = emptySeverityCounts();
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
