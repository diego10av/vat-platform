// Deterministic VAT classification rules engine for Luxembourg.
//
// Classification priority (evaluated in this exact order, first match wins):
//   PRIORITY 1  user manual         → treatment_source='manual'  (NEVER touched here)
//   PRIORITY 2  direct-evidence     → Rules 1-7 and 9 (explicit rate, keyword match)
//   PRIORITY 3  precedent           → Prior year Excel match (blue)
//   PRIORITY 4  contextual inference→ Inference Rules A-D (light yellow, flagged)
//   PRIORITY 5  default catch-all   → Rules 8, 11, 13 (yellow/amber)
//   PRIORITY 6  no match            → UNCLASSIFIED, flag for manual review
//
// Legal refs encoded in reasons:
//   LTVA = Luxembourg VAT Law
//   EU VAT Directive 2006/112/EC

import { isEU, isLuxembourg } from './eu-countries';
import type { TreatmentCode } from './treatment-codes';
import {
  EXEMPTION_KEYWORDS,
  FUND_MGMT_KEYWORDS,
  REAL_ESTATE_KEYWORDS,
  OUT_OF_SCOPE_KEYWORDS,
  GOODS_KEYWORDS,
  containsAny,
} from './exemption-keywords';

export interface InvoiceLineInput {
  direction: 'incoming' | 'outgoing';
  country: string | null;
  vat_rate: number | null;
  vat_applied: number | null;
  amount_eur: number | null;
  description: string | null;
  // Optional full invoice text (extractor may capture). Falls back to description.
  invoice_text?: string | null;
  // Batch 4 extractor signals — when present, these take precedence over
  // text-based heuristics because they come from the extractor's direct
  // reading of the invoice.
  is_disbursement?: boolean | null;
  is_credit_note?: boolean | null;
  exemption_reference?: string | null;  // explicit Art. 44§1 b / 44§1 d / etc.
  customer_country?: string | null;     // ISO-2 of the invoice recipient (for outgoing)
}

export interface EntityContext {
  entity_type?: 'fund' | 'active_holding' | 'gp' | 'other' | null;
  // The total value of outgoing OUT_LUX_00 invoices on this declaration.
  // Used by inference rules A/B to compare orders of magnitude.
  exempt_outgoing_total?: number;
}

export interface PrecedentMatch {
  treatment: TreatmentCode;
  description: string | null;
  last_amount: number | null;
}

export interface ClassificationResult {
  treatment: TreatmentCode | null;
  rule: string;                // e.g. "RULE 11", "INFERENCE A", "PRECEDENT", "OVERRIDE · X", "NO_MATCH"
  reason: string;              // human/legal explanation
  source: 'rule' | 'precedent' | 'inference' | 'override';
  flag: boolean;
  flag_reason?: string;
}

const TOLERANCE = 0.005;
const rateEquals = (a: number | null | undefined, target: number): boolean =>
  a != null && Math.abs(Number(a) - target) < TOLERANCE;
const isZeroOrNull = (v: number | null | undefined): boolean =>
  v == null || Math.abs(Number(v)) < TOLERANCE;

const fullText = (line: InvoiceLineInput): string =>
  [line.description || '', line.invoice_text || ''].join(' ');

// ────────────────────────── Public entry point ──────────────────────────
export function classifyInvoiceLine(
  line: InvoiceLineInput,
  context: EntityContext = {},
  precedent: PrecedentMatch | null = null,
): ClassificationResult {

  // PRIORITY 2 — direct evidence rules (always take precedence over precedent
  //              and inference, because the invoice itself states the facts).
  const direct = applyDirectEvidenceRules(line);
  if (direct) return direct;

  // PRIORITY 3 — precedent match from prior year
  if (precedent) {
    return {
      treatment: precedent.treatment,
      rule: 'PRECEDENT',
      reason: `Matches prior-year treatment for this provider (${precedent.treatment}).`,
      source: 'precedent',
      flag: false,
    };
  }

  // PRIORITY 4 — contextual inference rules
  const inference = applyInferenceRules(line, context);
  if (inference) return inference;

  // PRIORITY 5 — default catch-all
  const fallback = applyFallbackRules(line);
  if (fallback) return fallback;

  // PRIORITY 6 — no match
  return {
    treatment: null,
    rule: 'NO_MATCH',
    reason: 'No classification rule matched.',
    source: 'rule',
    flag: true,
    flag_reason: 'No classification rule matched — manual review required.',
  };
}

// ────────────────────────── Priority 2: direct evidence ──────────────────────────
function applyDirectEvidenceRules(line: InvoiceLineInput): ClassificationResult | null {
  const country = (line.country || '').toUpperCase();
  const customerCountry = (line.customer_country || '').toUpperCase();
  const desc = line.description || '';
  const text = fullText(line);
  const isLu = isLuxembourg(country);
  const isEu = isEU(country) && !isLu;

  // ═══════════════ RULE 16 — Extractor-flagged disbursement ═══════════════
  // When the extractor marks a line as is_disbursement (pure pass-through
  // débours), it beats every other signal. Disbursements are outside the
  // VAT scope per Art. 28§3 c LTVA and must go to DEBOURS, not LUX_00.
  if (line.is_disbursement === true) {
    return ruleMatch('RULE 16', 'DEBOURS',
      'Pure pass-through disbursement (débours) at cost — Art. 28§3 c LTVA (outside the VAT scope).');
  }

  if (line.direction === 'incoming') {
    // LU + explicit rate
    if (isLu && rateEquals(line.vat_rate, 0.17)) return ruleMatch('RULE 1', 'LUX_17', 'Luxembourg standard rate 17% (Art. 40 LTVA).');
    if (isLu && rateEquals(line.vat_rate, 0.14)) return ruleMatch('RULE 2', 'LUX_14', 'Luxembourg reduced rate 14% (Art. 40-1 LTVA).');
    if (isLu && rateEquals(line.vat_rate, 0.08)) return ruleMatch('RULE 3', 'LUX_08', 'Luxembourg reduced rate 8% (Art. 40-1 LTVA).');
    if (isLu && rateEquals(line.vat_rate, 0.03)) return ruleMatch('RULE 4', 'LUX_03', 'Luxembourg super-reduced rate 3% (Art. 40-1 LTVA).');

    // LU + no VAT + direct keywords
    if (isLu && isZeroOrNull(line.vat_rate)) {
      if (containsAny(desc, REAL_ESTATE_KEYWORDS)) {
        return ruleMatch('RULE 5', 'LUX_00', 'Exempt letting of immovable property (Art. 44§1 b LTVA).');
      }
      if (containsAny(desc, OUT_OF_SCOPE_KEYWORDS)) {
        return ruleMatch('RULE 6', 'OUT_SCOPE', 'Out of scope — not a supply of goods or services within VAT scope (Chamber of Commerce cotisation, CSSF subscription).');
      }
      if (containsAny(text, EXEMPTION_KEYWORDS)) {
        return ruleMatch('RULE 7', 'EXEMPT_44', 'Exempt under Art. 44§1 d LTVA (fund management) — transposing Art. 135(1)(g) EU VAT Directive.');
      }
      // RULE 8 is default catch-all — handled in applyFallbackRules
    }

    // ═══════════════ RULE 17 — IC acquisition of goods, by rate ═══════════════
    // Refines the legacy RULE 9 → IC_ACQ with rate-specific treatments so
    // boxes 711/713/715/717 can be filled accurately. Falls back to the
    // generic IC_ACQ when no rate is readable.
    if (isEu && containsAny(desc, GOODS_KEYWORDS)) {
      if (rateEquals(line.vat_rate, 0.17)) return ruleMatch('RULE 17', 'IC_ACQ_17', 'Intra-Community acquisition of goods, applicable LU rate 17% — Art. 21 LTVA.');
      if (rateEquals(line.vat_rate, 0.14)) return ruleMatch('RULE 17', 'IC_ACQ_14', 'Intra-Community acquisition of goods, applicable LU rate 14% — Art. 21 LTVA.');
      if (rateEquals(line.vat_rate, 0.08)) return ruleMatch('RULE 17', 'IC_ACQ_08', 'Intra-Community acquisition of goods, applicable LU rate 8% — Art. 21 LTVA.');
      if (rateEquals(line.vat_rate, 0.03)) return ruleMatch('RULE 17', 'IC_ACQ_03', 'Intra-Community acquisition of goods, applicable LU rate 3% — Art. 21 LTVA.');
      // No rate readable — fall back to the legacy generic code (RULE 9).
      return ruleMatch('RULE 9', 'IC_ACQ', 'Intra-Community acquisition of goods (Art. 21 LTVA) — rate not determined; reviewer may re-classify.');
    }

    // EU (non-LU) + no VAT + fund management + explicit exemption
    if (isEu && isZeroOrNull(line.vat_applied)
        && containsAny(text, FUND_MGMT_KEYWORDS)
        && containsAny(text, EXEMPTION_KEYWORDS)) {
      return ruleMatch('RULE 10', 'RC_EU_EX', 'Reverse charge, exempt under Art. 44§1 d LTVA (fund management) — eCDF box 435.');
    }

    // ═══════════════ RULE 19 — Import VAT from non-EU goods ═══════════════
    // Non-EU origin + goods keywords + some VAT actually paid (to customs)
    // on the invoice or extractor. Heuristic only — the reviewer confirms.
    if (!isLu && !isEu && country !== ''
        && containsAny(desc, GOODS_KEYWORDS)
        && !isZeroOrNull(line.vat_applied)) {
      return ruleMatch('RULE 19', 'IMPORT_VAT',
        'Goods imported from outside the EU with customs VAT paid (Art. 27 LTVA) — deductible in box 077 if used for taxable activity.');
    }

    // Non-EU + no VAT + fund management + explicit exemption
    if (!isLu && !isEu && country !== ''
        && isZeroOrNull(line.vat_applied)
        && containsAny(text, FUND_MGMT_KEYWORDS)
        && containsAny(text, EXEMPTION_KEYWORDS)) {
      return ruleMatch('RULE 12', 'RC_NONEU_EX', 'Reverse charge, exempt under Art. 44§1 d LTVA (fund management, non-EU supplier) — eCDF box 445.');
    }
  }

  if (line.direction === 'outgoing') {
    // ═══════════════ RULE 18 — Outgoing to non-EU customer ═══════════════
    // When the extractor captured customer_country and it is non-EU, the
    // supply is outside the LU VAT scope (place-of-supply rules). Requires
    // zero LU VAT actually charged.
    const isBilledWithoutVat =
      isZeroOrNull(line.vat_rate) && isZeroOrNull(line.vat_applied);
    if (isBilledWithoutVat && customerCountry &&
        !isLuxembourg(customerCountry) && !isEU(customerCountry)) {
      return ruleMatch('RULE 18', 'OUT_NONEU',
        'Supply to a non-EU customer — outside the scope of LU VAT (place-of-supply: customer\'s country).');
    }

    // RULE 14 used to match any outgoing with EXEMPTION_KEYWORDS *or* the bare
    // phrase "management fee(s)". An outgoing management fee billed WITH 17%
    // VAT (perfectly valid — SOPARFI issuing a taxable advisory invoice) was
    // then silently classified as exempt. We now require BOTH the exemption
    // reference AND the invoice to actually be billed without VAT.
    if (isBilledWithoutVat && containsAny(text, EXEMPTION_KEYWORDS)) {
      return ruleMatch('RULE 14', 'OUT_LUX_00',
        'Exempt outgoing supply with explicit legal reference (Art. 44§1 d LTVA) and no VAT charged — eCDF box 012.');
    }
    if (rateEquals(line.vat_rate, 0.17)) {
      return ruleMatch('RULE 15', 'OUT_LUX_17', 'Taxable outgoing supply at 17% — eCDF boxes 701/046.');
    }
  }

  return null;
}

// ────────────────────────── Priority 4: contextual inference ──────────────────────────
function applyInferenceRules(line: InvoiceLineInput, ctx: EntityContext): ClassificationResult | null {
  const country = (line.country || '').toUpperCase();
  const desc = line.description || '';
  const text = fullText(line);
  const isLu = isLuxembourg(country);
  const isEu = isEU(country) && !isLu;
  const hasExemptMgmtOutgoing = (ctx.exempt_outgoing_total ?? 0) > 0;

  // Advisory-style service descriptions (subset of FUND_MGMT_KEYWORDS)
  const ADVISORY_KEYWORDS = [
    'investment advisory', 'advisory fee', 'sub-advisory', 'sub advisory',
    'portfolio management', 'gestion de portefeuille', 'conseil en investissement',
    'anlageberatung', 'asesoramiento de inversiones', 'consulenza sugli investimenti',
  ];

  if (line.direction !== 'incoming') return null;
  if (!isZeroOrNull(line.vat_applied)) return null;

  // ─── INFERENCE A: EU advisory matching entity's outgoing exempt pattern ───
  if (isEu && hasExemptMgmtOutgoing && containsAny(desc, ADVISORY_KEYWORDS)) {
    const sameOrderOfMagnitude = sameMagnitude(line.amount_eur, ctx.exempt_outgoing_total);
    if (sameOrderOfMagnitude) {
      return {
        treatment: 'RC_EU_EX',
        rule: 'INFERENCE A',
        reason: 'Inferred as exempt by analogy with the entity\'s own outgoing exempt management fees.',
        source: 'inference',
        flag: true,
        flag_reason:
          'This entity issues exempt management fees (Art. 44) to its fund. This incoming advisory fee ' +
          'appears to be delegated fund management of similar nature and scale. Proposed as exempt. ' +
          'Confirm or change to RC_EU_TAX if this is general consulting.',
      };
    }
  }

  // ─── INFERENCE B: non-EU advisory matching entity's outgoing exempt pattern ───
  if (!isLu && !isEu && country !== '' && hasExemptMgmtOutgoing && containsAny(desc, ADVISORY_KEYWORDS)) {
    const sameOrderOfMagnitude = sameMagnitude(line.amount_eur, ctx.exempt_outgoing_total);
    if (sameOrderOfMagnitude) {
      return {
        treatment: 'RC_NONEU_EX',
        rule: 'INFERENCE B',
        reason: 'Inferred as exempt by analogy with the entity\'s own outgoing exempt management fees.',
        source: 'inference',
        flag: true,
        flag_reason:
          'This entity issues exempt management fees (Art. 44) to its fund. This incoming non-EU advisory ' +
          'fee appears to be delegated fund management of similar nature and scale. Proposed as exempt. ' +
          'Confirm or change to RC_NONEU_TAX if this is general consulting.',
      };
    }
  }

  // ─── INFERENCE C: fund-type entity, EU, fund mgmt keywords without explicit exemption ───
  const isFundEntity = ctx.entity_type === 'fund' || ctx.entity_type === 'gp';
  const hasFundMgmtKeywords = containsAny(text, FUND_MGMT_KEYWORDS);
  const hasExemptionReference = containsAny(text, EXEMPTION_KEYWORDS);

  if (isEu && isFundEntity && hasFundMgmtKeywords && !hasExemptionReference) {
    return {
      treatment: 'RC_EU_EX',
      rule: 'INFERENCE C',
      reason: 'Fund-type entity receiving a fund-management-like service — proposed exempt.',
      source: 'inference',
      flag: true,
      flag_reason:
        'Service description suggests fund management but invoice does not explicitly claim exemption. ' +
        'Please confirm.',
    };
  }

  // ─── INFERENCE D: same as C but non-EU ───
  if (!isLu && !isEu && country !== '' && isFundEntity && hasFundMgmtKeywords && !hasExemptionReference) {
    return {
      treatment: 'RC_NONEU_EX',
      rule: 'INFERENCE D',
      reason: 'Fund-type entity receiving a fund-management-like service (non-EU) — proposed exempt.',
      source: 'inference',
      flag: true,
      flag_reason:
        'Service description suggests fund management (non-EU supplier) but invoice does not explicitly ' +
        'claim exemption. Please confirm.',
    };
  }

  return null;
}

// ────────────────────────── Priority 5: fallback rules ──────────────────────────
function applyFallbackRules(line: InvoiceLineInput): ClassificationResult | null {
  const country = (line.country || '').toUpperCase();
  const isLu = isLuxembourg(country);
  const isEu = isEU(country) && !isLu;

  if (line.direction === 'incoming') {
    if (isLu && isZeroOrNull(line.vat_rate)) {
      // RULE 8 used to default to LUX_00 with the reason "Art. 44 exempt letting",
      // which silently mislabelled every LU invoice that happened to omit VAT —
      // franchise-threshold suppliers, out-of-scope fees, missing-VAT billing
      // errors, etc. We still default the treatment code to LUX_00 (so the
      // amount does land in an "exempt/no-VAT" bucket), but we FLAG the line
      // with a conservative reason and require manual confirmation of the
      // actual exemption basis.
      return {
        treatment: 'LUX_00',
        rule: 'RULE 8',
        reason: 'Luxembourg supplier with no VAT charged — specific exemption basis not detectable from the invoice.',
        source: 'rule',
        flag: true,
        flag_reason:
          'LU supplier issued the invoice without VAT but no recognised legal reference ' +
          '(Art. 44, Art. 43, franchise threshold, out-of-scope) was found in the document. ' +
          'Confirm the correct exemption basis before filing.',
      };
    }
    if (isEu && isZeroOrNull(line.vat_applied)) {
      return ruleMatch('RULE 11', 'RC_EU_TAX', 'Reverse charge on services, Art. 17§1 LTVA transposing Art. 44 EU VAT Directive (general B2B rule) — eCDF boxes 436/462 at 17%.');
    }
    if (!isLu && !isEu && country !== '' && isZeroOrNull(line.vat_applied)) {
      return ruleMatch('RULE 13', 'RC_NONEU_TAX', 'Reverse charge on services from third countries, Art. 17§1 LTVA — eCDF boxes 463/464 at 17%.');
    }
  }
  return null;
}

// Check whether two amounts are within the same order of magnitude (×10 range).
function sameMagnitude(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return false;
  const ra = Math.abs(Number(a));
  const rb = Math.abs(Number(b));
  if (ra === 0 || rb === 0) return false;
  const ratio = ra > rb ? ra / rb : rb / ra;
  return ratio <= 10;
}

function ruleMatch(ruleId: string, treatment: TreatmentCode, reason: string): ClassificationResult {
  return { treatment, rule: ruleId, reason, source: 'rule', flag: false };
}

// ────────────────────────── Provider-name normalisation ──────────────────────────
// Used for fuzzy-matching precedents by provider + country.
const LEGAL_SUFFIXES = [
  'sarl', 's.a.r.l.', 's.à.r.l.', 's.à r.l.', 's.a r.l.', 'sàrl',
  'sa', 's.a.', 'scs', 'sca', 's.c.a.', 'scsp', 'sicav', 'sicaf',
  'gmbh', 'ag', 'ltd', 'llp', 'lp', 'plc', 'inc', 'llc',
  'sas', 'sarl', 'sprl', 'bvba', 'nv',
  'sp. z o.o.', 'sp z o o', 'spzoo',
];

const COMMON_WORDS = ['luxembourg', 'the', 'and', 'de', 'des', 'du', 'la', 'le', 'les'];

export function normaliseProviderName(name: string | null | undefined): string {
  if (!name) return '';
  let s = name.toLowerCase();
  // strip diacritics
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // remove punctuation (keep letters, digits, whitespace)
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  // remove legal suffixes (as whole-word tokens)
  const tokens = s.split(/\s+/).filter(Boolean);
  const cleaned = tokens.filter(t => !LEGAL_SUFFIXES.includes(t) && !COMMON_WORDS.includes(t));
  return cleaned.join(' ').trim();
}

// Levenshtein distance (iterative DP). Used for precedent matching tolerance.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j] + 1,       // insertion
        prev[j + 1] + 1,   // deletion
        prev[j] + cost,    // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
