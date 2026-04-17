import { NextRequest } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { runValidator } from '@/lib/validator';
import { requireBudget } from '@/lib/budget-guard';
import { checkRateLimit } from '@/lib/rate-limit';

// Opus second-opinion review. Opt-in (reviewer clicks a button in the
// UI); this endpoint is never called automatically. Expensive — ~€0.05
// to €0.15 per declaration depending on line count.
export const maxDuration = 300;

const LOCKED_STATUSES = new Set(['approved', 'filed', 'paid']);

// POST /api/agents/validate
// Body: { declaration_id }
// Returns: { run_id, findings_count, by_severity }
export async function POST(request: NextRequest) {
  try {
    // Rate limit: 10 Opus validations per minute per IP. Validator runs
    // take 30-120s each and cost €0.05-€0.15; limiting the burst rate
    // is a cheap hedge against UI double-click storms.
    const rl = checkRateLimit(request, { max: 10, windowMs: 60_000 });
    if (!rl.ok) return rl.response;

    const { declaration_id } = await request.json();
    if (!declaration_id || typeof declaration_id !== 'string') {
      return apiError('declaration_id_required', 'declaration_id is required.', { status: 400 });
    }

    const decl = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM declarations WHERE id = $1',
      [declaration_id],
    );
    if (!decl) return apiError('declaration_not_found', 'Declaration not found.', { status: 404 });
    if (LOCKED_STATUSES.has(decl.status)) {
      return apiError('declaration_locked',
        `Declaration is ${decl.status}. Reopen before running the validator so any accepted findings can still be applied.`,
        { status: 409 });
    }

    // Budget guard — refuse new expensive calls once monthly cap hit.
    const budget = await requireBudget();
    if (!budget.ok) {
      return apiError(budget.error.code, budget.error.message,
        { hint: budget.error.hint, status: 429 });
    }

    const result = await runValidator(declaration_id);
    return apiOk({ ...result });
  } catch (e) {
    return apiFail(e, 'agents/validate');
  }
}

// GET /api/agents/validate?declaration_id=xxx
// Returns the findings from the most recent run for this declaration,
// plus their resolution status. Cheap — no LLM call.
export async function GET(request: NextRequest) {
  try {
    const declarationId = request.nextUrl.searchParams.get('declaration_id');
    if (!declarationId) {
      return apiError('declaration_id_required', 'declaration_id query param is required.', { status: 400 });
    }

    const latestRun = await queryOne<{ run_id: string; created_at: string }>(
      `SELECT run_id, MAX(created_at) AS created_at
         FROM validator_findings
        WHERE declaration_id = $1
        GROUP BY run_id
        ORDER BY created_at DESC
        LIMIT 1`,
      [declarationId],
    );
    if (!latestRun) return apiOk({ run_id: null, findings: [], summary: null });

    const findings = await query<{
      id: string; severity: string; category: string;
      line_id: string | null; invoice_id: string | null;
      current_treatment: string | null; suggested_treatment: string | null;
      reasoning: string; legal_refs: string[];
      status: string; status_reason: string | null;
      resolved_by: string | null; resolved_at: string | null;
      created_at: string;
    }>(
      `SELECT id, severity, category, line_id, invoice_id,
              current_treatment, suggested_treatment,
              reasoning, legal_refs,
              status, status_reason, resolved_by, resolved_at, created_at
         FROM validator_findings
        WHERE declaration_id = $1 AND run_id = $2
        ORDER BY CASE severity
                   WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                   WHEN 'medium'   THEN 2 WHEN 'low'  THEN 3 ELSE 4 END,
                 created_at`,
      [declarationId, latestRun.run_id],
    );

    const summary = findings.reduce((acc, f) => {
      acc.total += 1;
      acc.by_severity[f.severity] = (acc.by_severity[f.severity] || 0) + 1;
      acc.by_status[f.status] = (acc.by_status[f.status] || 0) + 1;
      return acc;
    }, {
      total: 0,
      by_severity: {} as Record<string, number>,
      by_status: {} as Record<string, number>,
    });

    return apiOk({ run_id: latestRun.run_id, findings, summary });
  } catch (e) {
    return apiFail(e, 'agents/validate:GET');
  }
}
