// ════════════════════════════════════════════════════════════════════════
// Pro-rata helpers — compute deductible / non-deductible input VAT for
// a declaration, given the entity's entity_prorata configuration.
//
// Legal scaffolding (see docs/classification-research.md §2):
//
//   Art. 50§1 LTVA — general ratio:
//     deduction_ratio = turnover_with_deduction / total_eligible_turnover
//     rounded UP to the next whole percentage (Directive Art. 174§1(b)).
//
//   Art. 50§2 — direct attribution alternative.
//
//   Art. 50§3 — sector ratios (AED authorisation required).
//
//   Art. 49§2 — non-EU exception: Art. 44§1 a / d supplies to
//     non-EU recipients count as "with-deduction" turnover.
//
// The UI section under /declarations/[id] shows the ratio + deductible /
// non-deductible breakdown. The reviewer provides the numerator +
// denominator (or just the ratio when method='direct' / 'sector').
// This module is kept pure — no DB, no Next.js — so it's easily
// unit-testable and re-usable from the PDF generator.
// ════════════════════════════════════════════════════════════════════════

export type ProrataMethod = 'general' | 'direct' | 'sector';

export interface ProrataRecord {
  id: string;
  entity_id: string;
  period_start: string;   // ISO yyyy-mm-dd
  period_end: string;     // ISO yyyy-mm-dd
  method: ProrataMethod;
  ratio_num: number | null;    // euros — only populated for 'general'
  ratio_denom: number | null;  // euros — only populated for 'general'
  ratio_pct: number | null;    // whole percentage 0..100
  basis: string | null;
  notes: string | null;
}

export interface ProrataBreakdown {
  method: ProrataMethod;
  ratio_pct: number;            // effective percentage applied
  total_input_vat_eur: number;  // starting input VAT before apportionment
  deductible_eur: number;       // input VAT that enters box 093
  non_deductible_eur: number;   // input VAT parked in box 087
  formula_text: string;         // human-readable computation trail
  legal_refs: readonly string[];
}

const EPSILON = 0.005;

/**
 * Round a percentage UP to the next whole percent (Directive Art. 174§1(b)).
 * The LU AED accepts either rounding up or to the nearest — up is safer
 * for the reviewer (slightly more deductible → AED rarely objects).
 */
export function roundPercentUp(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return Math.ceil(pct - EPSILON);
}

/**
 * Compute the deductible / non-deductible split of a given input VAT
 * amount against a pro-rata record. Used by the declaration detail
 * page and by the audit-trail PDF.
 *
 * If `record` is null the caller is telling us there's no pro-rata
 * config for the period — we default to 100% deductible and flag
 * via `formula_text`.
 */
export function computeProrataBreakdown(
  totalInputVatEur: number,
  record: ProrataRecord | null,
): ProrataBreakdown {
  const total = Math.max(0, Number.isFinite(totalInputVatEur) ? totalInputVatEur : 0);

  if (!record) {
    return {
      method: 'general',
      ratio_pct: 100,
      total_input_vat_eur: total,
      deductible_eur: total,
      non_deductible_eur: 0,
      formula_text: 'No pro-rata configured for this period — treating as 100% deductible. Review the entity\'s activity profile; if it has any exempt-without-deduction supplies (Art. 44), add a pro-rata configuration for this period.',
      legal_refs: ['LTVA_ART_50'],
    };
  }

  // General ratio: use num/denom when provided; fall back to ratio_pct.
  let effectivePct: number;
  if (record.method === 'general' && record.ratio_num != null && record.ratio_denom != null) {
    const num = Math.max(0, record.ratio_num);
    const denom = Math.max(0, record.ratio_denom);
    effectivePct = denom > 0 ? roundPercentUp((num / denom) * 100) : 0;
  } else if (record.ratio_pct != null) {
    effectivePct = Math.max(0, Math.min(100, record.ratio_pct));
  } else {
    effectivePct = 0;
  }

  const ratio = effectivePct / 100;
  const deductible = Math.round(total * ratio * 100) / 100;
  const nonDeductible = Math.round((total - deductible) * 100) / 100;

  const formula = buildFormulaText(record, effectivePct);
  const legalRefs: readonly string[] = (() => {
    if (record.method === 'general') return ['LTVA_ART_50', 'DIR_2006_112_ART_173'];
    if (record.method === 'direct') return ['LTVA_ART_50', 'DIR_2006_112_ART_174'];
    return ['LTVA_ART_50', 'DIR_2006_112_ART_174', 'BLC_BAUMARKT'];
  })();

  return {
    method: record.method,
    ratio_pct: effectivePct,
    total_input_vat_eur: total,
    deductible_eur: deductible,
    non_deductible_eur: nonDeductible,
    formula_text: formula,
    legal_refs: legalRefs,
  };
}

function buildFormulaText(record: ProrataRecord, effectivePct: number): string {
  if (record.method === 'direct') {
    return `Direct attribution (Art. 50§2 LTVA). ${effectivePct}% of input VAT directly linked to with-deduction supplies.${
      record.basis ? '\n\nBasis: ' + record.basis : ''
    }`;
  }
  if (record.method === 'sector') {
    return `Sector-specific ratios (Art. 50§3 LTVA, CJEU C-511/10 BLC Baumarkt). Weighted average: ${effectivePct}%.${
      record.basis ? '\n\nBasis: ' + record.basis : ''
    }`;
  }
  // general
  if (record.ratio_num != null && record.ratio_denom != null) {
    const num = record.ratio_num;
    const denom = record.ratio_denom;
    return `General ratio (Art. 50§1 LTVA).\n`
      + `  Turnover with deduction: €${fmtMoney(num)}\n`
      + `  Total eligible turnover: €${fmtMoney(denom)}\n`
      + `  Ratio: ${num.toFixed(2)} / ${denom.toFixed(2)} = ${((num / Math.max(denom, 1)) * 100).toFixed(2)}% → rounded UP to ${effectivePct}%.`
      + (record.basis ? `\n\nBasis: ${record.basis}` : '');
  }
  return `General ratio (Art. 50§1 LTVA). Ratio: ${effectivePct}%.${
    record.basis ? '\n\nBasis: ' + record.basis : ''
  }`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Pick the entity_prorata row whose period overlaps the declaration
 * period. Returns the first match or null. The caller is responsible
 * for loading rows — we keep this helper DB-free for testability.
 */
export function pickProrataForPeriod(
  records: readonly ProrataRecord[],
  declarationPeriodStart: string,
  declarationPeriodEnd: string,
): ProrataRecord | null {
  const dStart = declarationPeriodStart;
  const dEnd = declarationPeriodEnd;
  for (const r of records) {
    // Overlap: declaration.end >= record.start AND declaration.start <= record.end
    if (dEnd >= r.period_start && dStart <= r.period_end) return r;
  }
  return null;
}
