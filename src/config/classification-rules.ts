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
  FUND_MGMT_EXCLUSION_KEYWORDS,
  TAXABLE_PROFESSIONAL_KEYWORDS,
  REAL_ESTATE_KEYWORDS,
  REAL_ESTATE_TAXABLE_CARVEOUTS,
  DOMICILIATION_KEYWORDS,
  OUT_OF_SCOPE_KEYWORDS,
  GOODS_KEYWORDS,
  ART_44_PARA_A_REFS,
  ART_44_PARA_B_REFS,
  ART_44_PARA_D_REFS,
  ART_45_OPT_REFS,
  FRANCHISE_KEYWORDS,
  containsAny,
  findFirstMatch,
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
  customer_vat?: string | null;         // VIES VAT number of the recipient (for outgoing B2B evidence)
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
  const direct = applyDirectEvidenceRules(line, context);
  if (direct) return direct;

  // PRIORITY 2.5 — INFERENCE E taxable backstop. When a clearly-taxable
  // professional-services keyword is present (legal, tax, audit, M&A),
  // do NOT let the INFERENCE A/B/C/D rules auto-exempt. These services
  // are taxable regardless of entity type, so they reverse-charge at the
  // standard rate.
  if (line.direction === 'incoming') {
    const taxableBackstop = applyTaxableBackstop(line);
    if (taxableBackstop) return taxableBackstop;
  }

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
//
// Ordering inside this function matters. Higher-priority signals (explicit
// extractor flags, explicit legal citations) beat text-sweep heuristics.
// Every rule that fires on text alone carries a flag so the reviewer can
// override.
function applyDirectEvidenceRules(
  line: InvoiceLineInput,
  ctx: EntityContext = {},
): ClassificationResult | null {
  const country = (line.country || '').toUpperCase();
  const customerCountry = (line.customer_country || '').toUpperCase();
  const customerVat = (line.customer_vat || '').trim();
  const desc = line.description || '';
  const text = fullText(line);
  const exRef = line.exemption_reference || '';
  const isLu = isLuxembourg(country);
  const isEu = isEU(country) && !isLu;
  const entityType = ctx.entity_type;
  const isFundEntity = entityType === 'fund';

  // ═══════════════ RULE 16 — Extractor-flagged disbursement ═══════════════
  // Art. 28§3 c LTVA débours have four evidentiary conditions (expense
  // incurred in the name of the customer, booked in a suspense account,
  // no margin, supported by the original third-party invoice). The
  // extractor's single boolean is a starting signal; we classify as
  // DEBOURS but always flag so the reviewer confirms Art. 70 defensibility.
  if (line.is_disbursement === true) {
    return {
      treatment: 'DEBOURS',
      rule: 'RULE 16',
      reason: 'Pure pass-through disbursement (débours) at cost — Art. 28§3 c LTVA (outside the VAT scope).',
      source: 'rule',
      flag: true,
      flag_reason:
        'Extractor flagged this line as a disbursement. Art. 28§3 c LTVA requires four evidentiary conditions: '
        + '(a) expense incurred in the name and for the account of the customer, (b) booked in a suspense account, '
        + '(c) no margin (pure pass-through), (d) the original third-party invoice is transferred to the customer. '
        + 'Confirm all four before filing.',
    };
  }

  // ═══════════════ Consume extractor-captured Art. 44 reference ═══════════════
  // When the extractor captured an explicit paragraph reference, it beats
  // every text-sweep. We use the reference to pick the sub-paragraph so
  // Annexe B is categorised correctly.
  if (exRef) {
    if (line.direction === 'incoming') {
      if (containsAny(exRef, ART_44_PARA_A_REFS)) {
        return ruleMatch('RULE 7A', 'EXEMPT_44A_FIN',
          `Exempt under Art. 44§1 a LTVA (financial services) — extractor-captured reference "${exRef}".`);
      }
      if (containsAny(exRef, ART_44_PARA_B_REFS)) {
        return ruleMatch('RULE 7B', 'EXEMPT_44B_RE',
          `Exempt under Art. 44§1 b LTVA (real-estate letting) — extractor-captured reference "${exRef}".`);
      }
      if (containsAny(exRef, ART_44_PARA_D_REFS)) {
        return ruleMatch('RULE 7D', 'EXEMPT_44',
          `Exempt under Art. 44§1 d LTVA (fund management) — extractor-captured reference "${exRef}". Verify the recipient is a qualifying special investment fund (BlackRock C-231/19).`);
      }
    }
    if (line.direction === 'outgoing' && containsAny(exRef, ART_45_OPT_REFS)) {
      if (rateEquals(line.vat_rate, 0.17)) {
        return ruleMatch('RULE 15A', 'OUT_LUX_17_OPT',
          `Outgoing real-estate letting taxed by option under Art. 45 LTVA — extractor-captured reference "${exRef}".`);
      }
    }
  }

  if (line.direction === 'incoming') {
    // LU + explicit rate
    if (isLu && rateEquals(line.vat_rate, 0.17)) return ruleMatch('RULE 1', 'LUX_17', 'Luxembourg standard rate 17% (Art. 40 LTVA).');
    if (isLu && rateEquals(line.vat_rate, 0.14)) return ruleMatch('RULE 2', 'LUX_14', 'Luxembourg reduced rate 14% (Art. 40-1 LTVA).');
    if (isLu && rateEquals(line.vat_rate, 0.08)) return ruleMatch('RULE 3', 'LUX_08', 'Luxembourg reduced rate 8% (Art. 40-1 LTVA).');
    if (isLu && rateEquals(line.vat_rate, 0.03)) return ruleMatch('RULE 4', 'LUX_03', 'Luxembourg super-reduced rate 3% (Art. 40-1 LTVA).');

    // LU + no VAT + direct keywords
    if (isLu && isZeroOrNull(line.vat_rate)) {
      // Domiciliation — ALWAYS taxable at 17% under Circ. 764. This block
      // must run BEFORE any real-estate check because the old behaviour
      // of classifying "domiciliation" as LUX_00 was the most frequent
      // misclassification for SOPARFIs.
      if (containsAny(desc, DOMICILIATION_KEYWORDS)) {
        return {
          treatment: 'LUX_17',
          rule: 'RULE 5D',
          reason: 'Domiciliation / corporate services — taxable at 17% per AED Circ. 764 (Art. 28-5 LTVA). Not a real-estate letting.',
          source: 'rule',
          flag: true,
          flag_reason:
            'Domiciliation invoice with no VAT shown. AED Circ. 764 requires 17% on this service. '
            + 'Either the supplier forgot the VAT (ask for a corrected invoice) or this is not in fact '
            + 'a domiciliation. Do NOT treat as real-estate letting under Art. 44§1 b.',
        };
      }
      if (containsAny(desc, REAL_ESTATE_KEYWORDS)) {
        // Carve-out check: hotels, parking, hunting, machinery rental are
        // taxable per Art. 44§1 b points 1-4.
        const carveOut = findFirstMatch(desc, REAL_ESTATE_TAXABLE_CARVEOUTS);
        if (carveOut) {
          return {
            treatment: 'LUX_17', rule: 'RULE 5C',
            reason: `Real-estate supply (${carveOut}) — carve-out from Art. 44§1 b exemption; taxable at 17%. Verify rate on the invoice.`,
            source: 'rule', flag: true,
            flag_reason: `"${carveOut}" is one of the Art. 44§1 b points 1-4 carve-outs and is always taxable.`,
          };
        }
        return {
          treatment: 'LUX_00', rule: 'RULE 5',
          reason: 'Exempt letting of immovable property (Art. 44§1 b LTVA).',
          source: 'rule', flag: true,
          flag_reason:
            'Real-estate keyword matched. Confirm: (i) the landlord has NOT opted for taxation '
            + 'under Art. 45 (in which case VAT should be 17%); (ii) the property is not within '
            + 'the carve-outs (hotel, parking, hunting, safe-deposit, machinery rental).',
        };
      }
      if (containsAny(desc, OUT_OF_SCOPE_KEYWORDS)) {
        const matched = findFirstMatch(desc, OUT_OF_SCOPE_KEYWORDS);
        return ruleMatch('RULE 6', 'OUT_SCOPE',
          `Out of scope — "${matched ?? 'unrecognised'}" is outside the VAT scope (LTVA Art. 4§5 public-authority levy / Art. 2 no-consideration).`);
      }
      if (containsAny(text, FRANCHISE_KEYWORDS)) {
        return ruleMatch('RULE 23', 'LUX_00',
          'LU supplier under Art. 57 LTVA franchise threshold — no VAT charged and no deduction available to the recipient.');
      }
      if (containsAny(text, EXEMPTION_KEYWORDS)) {
        // Pick Art. 44 sub-paragraph from the matched keyword family.
        if (containsAny(text, FUND_MGMT_KEYWORDS)) {
          return ruleMatch('RULE 7', 'EXEMPT_44',
            'Exempt under Art. 44§1 d LTVA (fund management) — transposing Art. 135(1)(g) EU VAT Directive.');
        }
        return {
          treatment: 'EXEMPT_44', rule: 'RULE 7',
          reason: 'Exempt supply with an Art. 44 reference — specific sub-paragraph not determined.',
          source: 'rule', flag: true,
          flag_reason: 'Exemption keyword matched but sub-paragraph (44§1 a/b/c/d/e) could not be inferred. Select the correct code manually.',
        };
      }
      // RULE 8 is default catch-all — handled in applyFallbackRules
    }

    // ═══════════════ RULE 17 — IC acquisition of goods, by rate ═══════════════
    // Correct IC pattern: zero VAT on the supplier invoice (exempt IC supply
    // at origin per Art. 138 Directive). We classify at the applicable LU
    // rate. When the supplier erroneously charged foreign VAT, flag as
    // anomaly instead of silently reverse-charging at the foreign rate.
    if (isEu && containsAny(desc, GOODS_KEYWORDS)) {
      if (!isZeroOrNull(line.vat_applied)) {
        return {
          treatment: null, rule: 'RULE 17X',
          reason: 'EU supplier charged foreign VAT on a goods supply — anomaly.',
          source: 'rule', flag: true,
          flag_reason:
            'Intra-Community supplies of goods are normally exempt at origin (Art. 138 Directive) '
            + 'and the acquirer reverse-charges at the LU rate. This invoice shows supplier VAT — '
            + 'request a corrected invoice and seek refund in the origin Member State.',
        };
      }
      if (rateEquals(line.vat_rate, 0.17)) return ruleMatch('RULE 17', 'IC_ACQ_17', 'Intra-Community acquisition of goods, applicable LU rate 17% — Art. 21 LTVA.');
      if (rateEquals(line.vat_rate, 0.14)) return ruleMatch('RULE 17', 'IC_ACQ_14', 'Intra-Community acquisition of goods, applicable LU rate 14% — Art. 21 LTVA.');
      if (rateEquals(line.vat_rate, 0.08)) return ruleMatch('RULE 17', 'IC_ACQ_08', 'Intra-Community acquisition of goods, applicable LU rate 8% — Art. 21 LTVA.');
      if (rateEquals(line.vat_rate, 0.03)) return ruleMatch('RULE 17', 'IC_ACQ_03', 'Intra-Community acquisition of goods, applicable LU rate 3% — Art. 21 LTVA.');
      // No rate readable — fall back to the legacy generic code (RULE 9), flag.
      return {
        treatment: 'IC_ACQ', rule: 'RULE 9',
        reason: 'Intra-Community acquisition of goods (Art. 21 LTVA) — applicable LU rate not determined.',
        source: 'rule', flag: true,
        flag_reason: 'Applicable LU rate could not be inferred. Select IC_ACQ_17 / 14 / 08 / 03 manually before filing — box 051 = Σ(711..717) must reconcile.',
      };
    }

    // ═══════════════ RULE 10 — RC EU exempt (fund management) ═══════════════
    // Gated on entity_type === 'fund'. Per CJEU BlackRock (C-231/19) and
    // Fiscale Eenheid X (C-595/13), the Art. 44§1 d exemption applies only
    // when the recipient is a qualifying special investment fund. A
    // SOPARFI / active-holding / GP receiving management fees must
    // reverse-charge at 17% (RC_EU_TAX), not RC_EU_EX. The earlier rule
    // auto-exempted without entity-type guard — CRITICAL AED exposure.
    if (isEu && isZeroOrNull(line.vat_applied)
        && containsAny(text, FUND_MGMT_KEYWORDS)
        && containsAny(text, EXEMPTION_KEYWORDS)) {
      if (isFundEntity) {
        return ruleMatch('RULE 10', 'RC_EU_EX',
          'Reverse charge, exempt under Art. 44§1 d LTVA (fund management to a qualifying special investment fund) — eCDF box 435.');
      }
      // Non-fund entity — do NOT auto-exempt.
      return {
        treatment: 'RC_EU_TAX', rule: 'RULE 10X',
        reason: 'EU fund-management-style invoice received by a non-fund entity — reverse-charge at 17% (Art. 17§1 LTVA).',
        source: 'rule', flag: true,
        flag_reason:
          'Invoice cites Art. 44 but the recipient is not classified as a qualifying special investment fund '
          + '(per BlackRock C-231/19 / Fiscale Eenheid X C-595/13). Treated as taxable reverse-charge. '
          + 'If the entity IS a qualifying fund (UCITS, SIF, RAIF, SICAR, Part II UCI), change entity_type and re-run.',
      };
    }

    // ═══════════════ RULE 19 — Import VAT from non-EU goods (FLAG-ONLY) ═══════════════
    // Previous behaviour auto-classified the line as IMPORT_VAT and
    // promised deduction in box 077. That was fiscally WRONG — the VAT on
    // a foreign supplier's commercial invoice is foreign VAT, not LU
    // import VAT. LU import VAT arises from the customs declaration (DAU)
    // and is only deductible against that document. Auto-deducting the
    // commercial VAT overstates deductions and is exactly what triggers
    // Art. 70 LTVA penalties. We now FLAG without classifying.
    if (!isLu && !isEu && country !== ''
        && containsAny(desc, GOODS_KEYWORDS)
        && !isZeroOrNull(line.vat_applied)) {
      return {
        treatment: null, rule: 'RULE 19',
        reason: 'Non-EU goods supplier invoice with VAT-like amount — requires manual routing.',
        source: 'rule', flag: true,
        flag_reason:
          'VAT on a non-EU supplier invoice is FOREIGN VAT and is NOT deductible in Luxembourg. '
          + 'LU import VAT arises from the customs declaration (DAU / bordereau des douanes), not '
          + 'the commercial invoice. Route options: (a) if you hold the DAU, classify as IMPORT_VAT '
          + 'manually and book the customs VAT (not the commercial one) in box 077; (b) otherwise, '
          + 'the commercial-invoice VAT is unrecoverable foreign VAT — classify as LUX_00 and absorb.',
      };
    }

    // ═══════════════ RULE 12 — RC non-EU exempt (fund management) ═══════════════
    // Same entity-type guard as RULE 10.
    if (!isLu && !isEu && country !== ''
        && isZeroOrNull(line.vat_applied)
        && containsAny(text, FUND_MGMT_KEYWORDS)
        && containsAny(text, EXEMPTION_KEYWORDS)) {
      if (isFundEntity) {
        return ruleMatch('RULE 12', 'RC_NONEU_EX',
          'Reverse charge, exempt under Art. 44§1 d LTVA (fund management to a qualifying special investment fund, non-EU supplier) — eCDF box 445.');
      }
      return {
        treatment: 'RC_NONEU_TAX', rule: 'RULE 12X',
        reason: 'Non-EU fund-management-style invoice received by a non-fund entity — reverse-charge at 17% (Art. 17§1 LTVA).',
        source: 'rule', flag: true,
        flag_reason:
          'Invoice cites Art. 44 but the recipient is not classified as a qualifying special investment fund. '
          + 'Treated as taxable reverse-charge. Change entity_type to fund and re-run if this is a UCITS / SIF / RAIF / etc.',
      };
    }
  }

  if (line.direction === 'outgoing') {
    // ═══════════════ RULE 18 — Outgoing to non-EU customer ═══════════════
    // When the extractor captured customer_country and it is non-EU, the
    // supply is outside the LU VAT scope (place-of-supply rules). Requires
    // zero LU VAT actually charged AND evidence that the customer is a
    // taxable person (B2B) — either a captured VAT number or explicit
    // business-status evidence. Absent that evidence, flag: a B2C supply
    // to a non-EU individual can still be LU-taxable under Art. 17§2
    // LTVA / Art. 45 Directive.
    const isBilledWithoutVat =
      isZeroOrNull(line.vat_rate) && isZeroOrNull(line.vat_applied);
    if (isBilledWithoutVat && customerCountry &&
        !isLuxembourg(customerCountry) && !isEU(customerCountry)) {
      if (customerVat) {
        return ruleMatch('RULE 18', 'OUT_NONEU',
          `Supply to a non-EU business customer (VAT-ID ${customerVat}, ${customerCountry}) — outside the scope of LU VAT (place-of-supply: customer's country).`);
      }
      return {
        treatment: null, rule: 'RULE 18X',
        reason: 'Outgoing to non-EU customer without business-status evidence.',
        source: 'rule', flag: true,
        flag_reason:
          'Customer country is non-EU but no VAT-ID was captured. If the customer is a non-business '
          + '(B2C), the place of supply defaults to Luxembourg (Art. 17§2 LTVA / Art. 45 Directive) '
          + 'and 17% LU VAT applies. Capture the customer\'s tax-status evidence (VAT number or '
          + 'equivalent per Regulation 282/2011 Art. 18) before classifying.',
      };
    }

    // RULE 14 requires BOTH an exemption reference AND zero VAT, AND picks
    // the sub-paragraph based on the matched keyword family (real-estate
    // → 44§1 b, fund management → 44§1 d, financial → 44§1 a).
    if (isBilledWithoutVat && containsAny(text, EXEMPTION_KEYWORDS)) {
      let reason = 'Exempt outgoing supply with explicit legal reference (Art. 44 LTVA) and no VAT charged — eCDF box 012.';
      if (containsAny(text, FUND_MGMT_KEYWORDS)) {
        reason = 'Exempt outgoing supply under Art. 44§1 d LTVA (fund management to a qualifying fund) — eCDF box 012.';
      } else if (containsAny(text, REAL_ESTATE_KEYWORDS)) {
        reason = 'Exempt outgoing supply under Art. 44§1 b LTVA (real-estate letting without Art. 45 opt-in) — eCDF box 012.';
      }
      return ruleMatch('RULE 14', 'OUT_LUX_00', reason);
    }
    if (rateEquals(line.vat_rate, 0.17)) {
      return ruleMatch('RULE 15', 'OUT_LUX_17', 'Taxable outgoing supply at 17% — eCDF boxes 701/046.');
    }
    if (rateEquals(line.vat_rate, 0.14)) return ruleMatch('RULE 15B', 'OUT_LUX_14', 'Taxable outgoing supply at 14% (Art. 40-1 LTVA).');
    if (rateEquals(line.vat_rate, 0.08)) return ruleMatch('RULE 15C', 'OUT_LUX_08', 'Taxable outgoing supply at 8% (Art. 40-1 LTVA).');
    if (rateEquals(line.vat_rate, 0.03)) return ruleMatch('RULE 15D', 'OUT_LUX_03', 'Taxable outgoing supply at 3% (Art. 40-1 LTVA).');
  }

  return null;
}

// ────────────────────────── Priority 2.5: taxable backstop ──────────────────────────
// When the service description matches a clearly-taxable professional
// category (legal, tax, audit, M&A, generic consulting), do NOT let the
// inference chain promote the line into an Art. 44 exemption. These
// services are taxable regardless of the recipient's entity type.
// Only applies to incoming services with no VAT applied — taxable
// invoices with VAT are handled by the direct-evidence rate rules.
function applyTaxableBackstop(line: InvoiceLineInput): ClassificationResult | null {
  if (!isZeroOrNull(line.vat_applied)) return null;
  const text = fullText(line);
  const matched = findFirstMatch(text, TAXABLE_PROFESSIONAL_KEYWORDS);
  if (!matched) return null;
  const country = (line.country || '').toUpperCase();
  const isLu = isLuxembourg(country);
  const isEu = isEU(country) && !isLu;
  if (isLu || !country) return null; // LU handled by direct rate rules / RULE 8

  const treatment: TreatmentCode = isEu ? 'RC_EU_TAX' : 'RC_NONEU_TAX';
  return {
    treatment,
    rule: 'INFERENCE E',
    reason: `"${matched}" — taxable professional service, reverse-charge at 17% (Art. 17§1 LTVA). Art. 44 exemptions are narrow (Deutsche Bank C-44/11, BlackRock C-231/19) and do not cover legal / tax / audit / M&A services.`,
    source: 'inference',
    flag: true,
    flag_reason:
      `Detected taxable-backstop keyword "${matched}". This service is classified as taxable reverse-charge to prevent keyword collisions with Art. 44 fund-management exemption phrases. If the service is in fact within the exemption (rare for ${matched}), override manually.`,
  };
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

  // ─── INFERENCE C: fund entity, EU, fund mgmt keywords without explicit exemption ───
  // Narrowed to `entity_type === 'fund'` only. The earlier rule accepted
  // `gp` too, but a GP is not a qualifying fund under BlackRock
  // (C-231/19) — it USES management services, it does not RECEIVE them
  // as a special investment fund.
  //
  // Also cancels when an exclusion keyword (training, SaaS, IT consulting,
  // legal/tax/audit advisory, etc.) is present — BlackRock holds that
  // services outside "specific and essential to fund management" fall
  // outside Art. 44§1 d.
  const isFundEntity = ctx.entity_type === 'fund';
  const hasFundMgmtKeywords = containsAny(text, FUND_MGMT_KEYWORDS);
  const hasExemptionReference = containsAny(text, EXEMPTION_KEYWORDS);
  const hasExclusionKeyword = containsAny(text, FUND_MGMT_EXCLUSION_KEYWORDS);

  if (isEu && isFundEntity && hasFundMgmtKeywords && !hasExemptionReference && !hasExclusionKeyword) {
    return {
      treatment: 'RC_EU_EX',
      rule: 'INFERENCE C',
      reason: 'Fund-type entity receiving a fund-management-like service — proposed exempt under Art. 44§1 d LTVA (BlackRock C-231/19 "specific and essential" test).',
      source: 'inference',
      flag: true,
      flag_reason:
        'Service description suggests fund management but invoice does not explicitly claim exemption. ' +
        'Confirm the service is "specific and essential to fund management" per BlackRock (C-231/19) — ' +
        'otherwise downgrade to RC_EU_TAX.',
    };
  }

  // ─── INFERENCE D: same as C but non-EU ───
  if (!isLu && !isEu && country !== '' && isFundEntity && hasFundMgmtKeywords && !hasExemptionReference && !hasExclusionKeyword) {
    return {
      treatment: 'RC_NONEU_EX',
      rule: 'INFERENCE D',
      reason: 'Fund-type entity receiving a fund-management-like service (non-EU) — proposed exempt under Art. 44§1 d LTVA.',
      source: 'inference',
      flag: true,
      flag_reason:
        'Service description suggests fund management (non-EU supplier). Non-EU advisors rarely cite ' +
        'Art. 44 on invoices, but the BlackRock (C-231/19) "specific and essential" test is substantive, ' +
        'not formal. Confirm before filing.',
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

// Check whether two amounts are within the same order of magnitude.
// Tightened from the original ×10 tolerance to ×3: at ×10, an exempt
// outgoing total of €1m matched any incoming between €100k and €10m —
// too loose, produced many false-positive inferences.
function sameMagnitude(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return false;
  const ra = Math.abs(Number(a));
  const rb = Math.abs(Number(b));
  if (ra === 0 || rb === 0) return false;
  const ratio = ra > rb ? ra / rb : rb / ra;
  return ratio <= 3;
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
