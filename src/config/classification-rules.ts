// Deterministic VAT classification rules engine for Luxembourg.
// Rules applied in order; the FIRST matching rule wins.
// Lines already classified manually (treatment_source = 'manual') are never overridden.
//
// Legal references encoded in descriptions:
//   - LTVA = Loi TVA (Luxembourg VAT Law)
//   - EU VAT Directive 2006/112/EC

import { isEU, isLuxembourg } from './eu-countries';
import type { TreatmentCode } from './treatment-codes';

export interface InvoiceLineInput {
  direction: 'incoming' | 'outgoing';
  country: string | null;
  vat_rate: number | null;
  vat_applied: number | null;
  description: string | null;
  // Free-text captured by extractor from the document body (invoice_text).
  // May be null until we add that field — falls back to description.
  invoice_text?: string | null;
}

export interface ClassificationResult {
  treatment: TreatmentCode | null;
  rule: string; // e.g. "RULE 11" or "NO_MATCH"
  reason: string; // short legal/human explanation shown on hover
  flag: boolean;
  flag_reason?: string;
}

const TOLERANCE = 0.005; // treat VAT rates as equal within 0.5pp

const rateEquals = (a: number | null | undefined, target: number): boolean => {
  if (a == null) return false;
  return Math.abs(Number(a) - target) < TOLERANCE;
};

const isZeroOrNull = (v: number | null | undefined): boolean => {
  if (v == null) return true;
  return Math.abs(Number(v)) < TOLERANCE;
};

const containsAny = (haystack: string | null | undefined, needles: string[]): boolean => {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return needles.some(n => lower.includes(n.toLowerCase()));
};

// Union of description and invoice_text for keyword matching.
const fullText = (line: InvoiceLineInput): string => {
  return [line.description || '', line.invoice_text || ''].join(' ');
};

// Keyword dictionaries
const REAL_ESTATE_KEYWORDS = ['rent', 'lease', 'loyer', 'bail', 'domiciliation'];
const OUT_OF_SCOPE_KEYWORDS = [
  'cotisation', 'subscription', 'membership',
  'chambre de commerce', 'cssf', 'contribution fee',
];
const ART_44_KEYWORDS = [
  'article 44', 'art. 44', 'art.44',
  'exonéré', 'exonere', 'exempt from vat', 'exoneration', 'exempt',
];
const FUND_MGMT_KEYWORDS = [
  'fund management', 'aifm', 'gestion de fonds',
  'management fee', 'management services',
];
const GOODS_KEYWORDS = [
  'goods', 'acquisition', 'marchandises', 'achat',
  'purchase', 'delivery', 'livraison', 'equipment', 'hardware',
];

export function classifyInvoiceLine(line: InvoiceLineInput): ClassificationResult {
  const country = (line.country || '').toUpperCase();
  const text = fullText(line);
  const desc = line.description || '';
  const isLu = isLuxembourg(country);
  const isEu = isEU(country) && !isLu;

  // ========== INCOMING ==========
  if (line.direction === 'incoming') {

    // --- Luxembourg suppliers with VAT charged ---
    if (isLu && rateEquals(line.vat_rate, 0.17)) {
      return rule('RULE 1', 'LUX_17', 'Luxembourg standard rate 17% (Art. 40 LTVA).');
    }
    if (isLu && rateEquals(line.vat_rate, 0.14)) {
      return rule('RULE 2', 'LUX_14', 'Luxembourg reduced rate 14% (Art. 40-1 LTVA).');
    }
    if (isLu && rateEquals(line.vat_rate, 0.08)) {
      return rule('RULE 3', 'LUX_08', 'Luxembourg reduced rate 8% (Art. 40-1 LTVA).');
    }
    if (isLu && rateEquals(line.vat_rate, 0.03)) {
      return rule('RULE 4', 'LUX_03', 'Luxembourg super-reduced rate 3% (Art. 40-1 LTVA).');
    }

    // --- Luxembourg without VAT: needs keyword disambiguation ---
    if (isLu && isZeroOrNull(line.vat_rate)) {
      if (containsAny(desc, REAL_ESTATE_KEYWORDS)) {
        return rule('RULE 5', 'LUX_00', 'Exempt letting of immovable property (Art. 44§1 b LTVA).');
      }
      if (containsAny(desc, OUT_OF_SCOPE_KEYWORDS)) {
        return rule('RULE 6', 'OUT_SCOPE', 'Out of scope — not a supply of goods or services within VAT scope (e.g. Chambre de Commerce cotisation, CSSF subscription).');
      }
      if (containsAny(text, ART_44_KEYWORDS)) {
        return rule('RULE 7', 'EXEMPT_44', 'Exempt under Art. 44§1 d LTVA (fund management — transposing Art. 135(1)(g) EU VAT Directive).');
      }
      return rule('RULE 8', 'LUX_00', 'Default: Luxembourg supplier with no VAT charged (Art. 44 LTVA exempt letting / similar).');
    }

    // --- EU suppliers (non-LU) ---
    if (isEu) {
      if (containsAny(desc, GOODS_KEYWORDS)) {
        return rule('RULE 9', 'IC_ACQ', 'Intra-Community acquisition of goods (Art. 21 LTVA) — eCDF boxes 051/056 + 711/712.');
      }
      if (isZeroOrNull(line.vat_applied)) {
        if (containsAny(text, FUND_MGMT_KEYWORDS) && containsAny(text, ART_44_KEYWORDS)) {
          return rule('RULE 10', 'RC_EU_EX', 'Reverse charge, exempt under Art. 44§1 d LTVA (fund management) — eCDF box 435.');
        }
        return rule('RULE 11', 'RC_EU_TAX', 'Reverse charge on services, Art. 17§1 LTVA transposing Art. 44 EU VAT Directive (general B2B rule) — eCDF boxes 436/462 at 17%.');
      }
    }

    // --- Non-EU suppliers ---
    if (!isLu && !isEu && country !== '') {
      if (isZeroOrNull(line.vat_applied)) {
        if (containsAny(text, FUND_MGMT_KEYWORDS) && containsAny(text, ART_44_KEYWORDS)) {
          return rule('RULE 12', 'RC_NONEU_EX', 'Reverse charge, exempt under Art. 44§1 d LTVA (fund management, non-EU supplier) — eCDF box 445.');
        }
        return rule('RULE 13', 'RC_NONEU_TAX', 'Reverse charge on services from third countries, Art. 17§1 LTVA — eCDF boxes 463/464 at 17%.');
      }
    }
  }

  // ========== OUTGOING ==========
  if (line.direction === 'outgoing') {
    if (containsAny(text, [...ART_44_KEYWORDS, 'management fee'])) {
      return rule('RULE 14', 'OUT_LUX_00', 'Exempt outgoing supply, Art. 44§1 d LTVA — eCDF box 012.');
    }
    if (rateEquals(line.vat_rate, 0.17)) {
      return rule('RULE 15', 'OUT_LUX_17', 'Taxable outgoing supply at 17% — eCDF boxes 701/046.');
    }
  }

  // ========== NO MATCH ==========
  return {
    treatment: null,
    rule: 'NO_MATCH',
    reason: 'No classification rule matched.',
    flag: true,
    flag_reason: 'No classification rule matched — manual review required.',
  };
}

function rule(ruleId: string, treatment: TreatmentCode, reason: string): ClassificationResult {
  return { treatment, rule: ruleId, reason, flag: false };
}
