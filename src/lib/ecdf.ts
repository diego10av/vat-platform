// eCDF box computation engine.
// Given the classified invoice_lines of a declaration, produces the filled-in
// box values per PRD §5.2 (simplified) and §5.3 (ordinary). All amounts in EUR.

import { query, queryOne } from '@/lib/db';
import { SIMPLIFIED_BOXES, ORDINARY_ADDITIONAL_BOXES, type BoxDefinition } from '@/config/ecdf-boxes';

export interface BoxResult {
  box: string;
  label: string;
  section: string;
  value: number;
  computation: BoxDefinition['computation'];
  formula?: string;
  manual?: boolean;
}

export interface ECDFReport {
  regime: 'simplified' | 'ordinary';
  year: number;
  period: string;
  form_version: string; // e.g. "simplified_annual_2025"
  boxes: BoxResult[];
  box_values: Record<string, number>;  // flat map for convenience
  totals: {
    vat_due: number;        // box 076 for simplified, 097 for ordinary
    payable: number;        // box 076 or 102
    credit: number;         // 0 for simplified, 103 for ordinary
  };
  manual_boxes_pending: string[]; // boxes requiring user input (ordinary pro-rata)
  warnings: string[];
}

// ── Line shape used by the computer ──
interface LineRow {
  id: string;
  direction: 'incoming' | 'outgoing';
  treatment: string | null;
  amount_eur: number;
  vat_applied: number | null;
  rc_amount: number | null;
}

// ── Public entry point ──
export async function computeECDF(declarationId: string): Promise<ECDFReport> {
  const decl = await queryOne<{
    year: number;
    period: string;
    regime: 'simplified' | 'ordinary';
    entity_id: string;
  }>(
    `SELECT d.year, d.period, e.regime, d.entity_id
       FROM declarations d
       JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId]
  );
  if (!decl) throw new Error('Declaration not found');

  // Load only non-deleted, non-unclassified lines.
  const rows = await query<{
    id: string;
    direction: string;
    treatment: string | null;
    amount_eur: number | null;
    vat_applied: number | null;
    rc_amount: number | null;
  }>(
    `SELECT il.id, i.direction, il.treatment,
            il.amount_eur::float as amount_eur,
            il.vat_applied::float as vat_applied,
            il.rc_amount::float as rc_amount
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND il.treatment IS NOT NULL`,
    [declarationId]
  );

  const lines: LineRow[] = rows.map(r => ({
    id: r.id,
    direction: r.direction as 'incoming' | 'outgoing',
    treatment: r.treatment,
    amount_eur: Number(r.amount_eur ?? 0),
    vat_applied: r.vat_applied == null ? null : Number(r.vat_applied),
    rc_amount: r.rc_amount == null ? null : Number(r.rc_amount),
  }));

  const boxDefs: BoxDefinition[] = decl.regime === 'ordinary'
    ? [...SIMPLIFIED_BOXES, ...ORDINARY_ADDITIONAL_BOXES]
    : SIMPLIFIED_BOXES;

  const boxValues: Record<string, number> = {};
  const boxes: BoxResult[] = [];
  const manualPending: string[] = [];
  const warnings: string[] = [];

  // First pass: sums only.
  for (const def of boxDefs) {
    if (def.computation !== 'sum') continue;
    boxValues[def.box] = computeSum(lines, def);
  }

  // Second pass: formulas, resolved in dependency order (iteratively until stable).
  const MAX_ITER = 10;
  let iter = 0;
  let changed = true;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter += 1;
    for (const def of boxDefs) {
      if (def.computation !== 'formula' || !def.formula) continue;
      const prev = boxValues[def.box];
      const val = evaluateFormula(def.formula, boxValues);
      if (val != null && prev !== val) {
        boxValues[def.box] = val;
        changed = true;
      }
    }
  }

  // Manual-entry boxes stay at 0 unless explicitly set later (pro-rata).
  for (const def of boxDefs) {
    if (def.computation === 'manual') {
      if (boxValues[def.box] == null) boxValues[def.box] = 0;
      manualPending.push(def.box);
    }
  }

  // Package
  for (const def of boxDefs) {
    boxes.push({
      box: def.box,
      label: def.label,
      section: def.section,
      value: round2(boxValues[def.box] ?? 0),
      computation: def.computation,
      formula: def.formula,
      manual: def.computation === 'manual',
    });
  }

  // Totals per regime
  const totals = computeTotals(decl.regime, boxValues);

  // Sanity checks
  if (totals.vat_due < 0) {
    warnings.push('Total VAT due is negative. Review classifications.');
  }

  return {
    regime: decl.regime,
    year: decl.year,
    period: decl.period,
    form_version: formVersion(decl.regime, decl.year, decl.period),
    boxes,
    box_values: Object.fromEntries(Object.entries(boxValues).map(([k, v]) => [k, round2(v)])),
    totals,
    manual_boxes_pending: manualPending,
    warnings,
  };
}

// ── Internals ──
function computeSum(lines: LineRow[], def: BoxDefinition): number {
  // All treatment filtering is now explicit in BoxDefinition.filter.treatments
  // (see Box 085, 056, etc). The previous implicit "startsWith('LUX_')"
  // special-case has been removed — every box that needs a treatment filter
  // must declare it in config.
  const filter = def.filter || {};
  const field = filter.field || 'amount_eur';
  let total = 0;
  for (const l of lines) {
    if (filter.direction && l.direction !== filter.direction) continue;
    if (filter.treatments && (!l.treatment || !filter.treatments.includes(l.treatment))) continue;
    const raw = l[field];
    if (raw == null) continue;
    total += Number(raw);
  }
  return total;
}

// Minimal and safe arithmetic evaluator for box formulas.
// Supports: box references (3-digit numbers), + - * /, parentheses, numbers, MAX(a,b).
//
// Fail-closed semantics: if any referenced box is not yet resolved, the
// evaluator returns null so the caller's iterative fixed-point loop can try
// again after later passes fill in the missing values. The previous version
// silently substituted `0` for missing refs, which produced wrong (lower)
// numbers in one-shot evaluation and masked formula typos.
//
// Order of operations is critical: resolve box references FIRST, then
// rewrite MAX(). An earlier draft did the opposite, which re-tokenised
// already-substituted 3-digit values (e.g. a box value of 120) as if they
// were box references — producing spurious "unresolved" failures whenever
// a real value happened to fall in the 100..999 range.
function evaluateFormula(expr: string, values: Record<string, number>): number | null {
  // Step 1 — resolve every 3-digit box reference exactly once. The
  // substitution is wrapped in parens so that `MAX(-097, 0)` with a
  // negative value resolves to `MAX(-(-42), 0)` instead of the unparsable
  // `MAX(--42, 0)`. This only matters for negated refs (credit formulas)
  // but is harmless otherwise.
  let unresolved = false;
  const resolved = expr.replace(/\b(\d{3})\b/g, (_m, ref) => {
    const v = values[ref];
    if (typeof v === 'number') return `(${v})`;
    unresolved = true;
    return '(0)';
  });
  if (unresolved) return null;

  // Step 2 — rewrite MAX(...) to the built-in Math.max. At this point the
  // arguments contain only numbers and operators, so a dumb textual rewrite
  // of the function token is safe.
  const e = resolved.replace(/MAX\s*\(/gi, 'Math.max(');

  // Step 3 — whitelist (after stripping the one allowed identifier
  // "Math.max"): digits, whitespace, + - * /, parens, dot, comma.
  const stripped = e.replace(/Math\.max/g, '');
  if (!/^[\d\s+\-*/().,]*$/.test(stripped)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function('Math', `return (${e});`);
    const v = fn(Math);
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeTotals(
  regime: 'simplified' | 'ordinary',
  values: Record<string, number>
): ECDFReport['totals'] {
  if (regime === 'simplified') {
    const due = round2(values['076'] ?? 0);
    return { vat_due: due, payable: due > 0 ? due : 0, credit: 0 };
  }
  // ordinary
  const net = round2(values['097'] ?? 0);
  return {
    vat_due: net,
    payable: Math.max(net, 0),
    credit: Math.max(-net, 0),
  };
}

function formVersion(regime: 'simplified' | 'ordinary', year: number, period: string): string {
  const frequency =
    period === 'Y1' ? 'annual' :
    period.startsWith('Q') ? 'quarterly' : 'monthly';
  return `${regime}_${frequency}_${year}`;
}
