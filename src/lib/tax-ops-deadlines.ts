// ════════════════════════════════════════════════════════════════════════
// tax-ops-deadlines.ts
//
// Pure helper that computes a filing's deadline_date from its rule +
// period_label. No DB access — callers load the rule row from
// `tax_deadline_rules` and pass it in. Makes testing trivial and
// avoids an extra SELECT from the importer / rollover paths.
//
// Rule kinds supported (seeded in migration 045):
//   - days_after_period_end: deadline = period_end + params.days_after
//     Example: VAT quarterly, 15 days after Q end.
//   - fixed_md:              deadline = (period_year+1, params.month, params.day)
//     Example: VAT annual, 1 March N+1.
//   - fixed_md_with_extension: statutory = fixed_md, extension = same params
//     with extension_month / extension_day.
//     Example: CIT Form 500, statutory 31 March, market 31 Dec.
//     We return BOTH — callers pick based on `use_extension` flag on
//     the filing.
//
// Period label parsing:
//   "2026"      → annual   → period_end = 2026-12-31
//   "2026-Q1"   → quarterly → period_end = 2026-03-31
//   "2026-Q2"   → quarterly → period_end = 2026-06-30
//   "2026-Q3"   → quarterly → period_end = 2026-09-30
//   "2026-Q4"   → quarterly → period_end = 2026-12-31
//   "2026-01"   → monthly   → period_end = 2026-01-31
//   …etc
//   "2026-S1"   → semester  → period_end = 2026-06-30
//   "2026-S2"   → semester  → period_end = 2026-12-31
// ════════════════════════════════════════════════════════════════════════

export interface DeadlineRule {
  tax_type: string;
  period_pattern: 'annual' | 'quarterly' | 'monthly' | 'semester' | 'adhoc';
  rule_kind: 'days_after_period_end' | 'fixed_md' | 'fixed_md_with_extension' | 'adhoc_no_deadline';
  rule_params: Record<string, unknown>;
  admin_tolerance_days?: number;
}

export interface ComputedDeadline {
  /** Statutory deadline (official, strict). */
  statutory: string;
  /** Extension deadline (market practice), if the rule carries one. */
  extension: string | null;
  /** Effective deadline — extension if present, else statutory. */
  effective: string;
}

/**
 * Compute a filing's deadline from its rule + period. Returns ISO
 * dates (YYYY-MM-DD). Throws on malformed input — callers catch and
 * fall back to `null` for display.
 */
export function computeDeadline(
  rule: DeadlineRule,
  periodYear: number,
  periodLabel: string,
): ComputedDeadline {
  if (!Number.isInteger(periodYear) || periodYear < 1900 || periodYear > 2100) {
    throw new Error(`Invalid period_year: ${periodYear}`);
  }

  if (rule.rule_kind === 'days_after_period_end') {
    const periodEnd = parsePeriodEnd(periodLabel);
    const days = Number((rule.rule_params as { days_after?: number }).days_after ?? 15);
    const deadline = addDays(periodEnd, days);
    const iso = toIso(deadline);
    return { statutory: iso, extension: null, effective: iso };
  }

  if (rule.rule_kind === 'fixed_md') {
    const month = Number((rule.rule_params as { month?: number }).month ?? 3);
    const day = Number((rule.rule_params as { day?: number }).day ?? 1);
    // Fixed month/day of the year FOLLOWING the period_year.
    const iso = toIso(new Date(Date.UTC(periodYear + 1, month - 1, day)));
    return { statutory: iso, extension: null, effective: iso };
  }

  if (rule.rule_kind === 'adhoc_no_deadline') {
    // "Sin cadencia fija" — typical for WHT director filings triggered
    // by actual payment events. Diego sets the deadline per-filing.
    // Return empty strings so callers can detect "no computed deadline".
    return { statutory: '', extension: null, effective: '' };
  }

  if (rule.rule_kind === 'fixed_md_with_extension') {
    // (Duplicate branch removed in 37.H — the earlier branch handles
    // this rule_kind already; this block is unreachable but kept for
    // the shape check.)
    const p = rule.rule_params as {
      month?: number; day?: number;
      extension_month?: number; extension_day?: number;
    };
    const statutoryIso = toIso(new Date(Date.UTC(periodYear + 1, (p.month ?? 3) - 1, p.day ?? 31)));
    const extensionIso = p.extension_month && p.extension_day
      ? toIso(new Date(Date.UTC(periodYear + 1, p.extension_month - 1, p.extension_day)))
      : null;
    return {
      statutory: statutoryIso,
      extension: extensionIso,
      effective: extensionIso ?? statutoryIso,
    };
  }

  throw new Error(`Unsupported rule_kind: ${rule.rule_kind}`);
}

/**
 * Parse a period_label into its end-of-period Date (UTC).
 * Supports: "YYYY", "YYYY-QN", "YYYY-MM", "YYYY-SN".
 */
export function parsePeriodEnd(label: string): Date {
  const annualMatch = /^(\d{4})$/.exec(label);
  if (annualMatch) {
    const year = Number(annualMatch[1]);
    return new Date(Date.UTC(year, 11, 31));
  }

  const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(label);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const q = Number(quarterMatch[2]);
    const endMonth = q * 3 - 1;                         // Q1 → Mar (2), Q2 → Jun (5), …
    const endDay = [2, 5, 8, 11].includes(endMonth)
      ? new Date(Date.UTC(year, endMonth + 1, 0)).getUTCDate()
      : 31;
    return new Date(Date.UTC(year, endMonth, endDay));
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(label);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const monthIdx = Number(monthMatch[2]) - 1;
    if (monthIdx < 0 || monthIdx > 11) throw new Error(`Invalid month: ${label}`);
    // Last day of month → day 0 of next month in UTC.
    const endDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, monthIdx, endDay));
  }

  const semesterMatch = /^(\d{4})-S([12])$/.exec(label);
  if (semesterMatch) {
    const year = Number(semesterMatch[1]);
    const s = Number(semesterMatch[2]);
    if (s === 1) return new Date(Date.UTC(year, 5, 30));     // 30 June
    return new Date(Date.UTC(year, 11, 31));                 // 31 Dec
  }

  throw new Error(`Unrecognized period_label: ${label}`);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Human-readable summary of a rule — used in the settings UI to
// display "1 Mar N+1 · tolerance 60d" without exposing the raw JSONB.
export function describeRule(rule: DeadlineRule): string {
  if (rule.rule_kind === 'days_after_period_end') {
    const days = (rule.rule_params as { days_after?: number }).days_after ?? 15;
    return `${days}d after period end`;
  }
  if (rule.rule_kind === 'fixed_md') {
    const { month, day } = rule.rule_params as { month?: number; day?: number };
    return `${day ?? '?'} ${monthName(month ?? 0)} N+1`;
  }
  if (rule.rule_kind === 'fixed_md_with_extension') {
    const p = rule.rule_params as {
      month?: number; day?: number; extension_month?: number; extension_day?: number;
    };
    const stat = `${p.day} ${monthName(p.month ?? 0)}`;
    const ext = p.extension_month && p.extension_day
      ? ` · extension ${p.extension_day} ${monthName(p.extension_month)}`
      : '';
    return `${stat} N+1${ext}`;
  }
  if (rule.rule_kind === 'adhoc_no_deadline') {
    return 'Ad-hoc (no fixed deadline — set per filing)';
  }
  return rule.rule_kind;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthName(m: number): string {
  return MONTHS[m - 1] ?? '?';
}
