// ══════════════════════════════════════════════════════════════════════
// Synthetic invoice corpus — Option D regression benchmark.
//
// Each fixture is the shape the EXTRACTOR would produce for a realistic
// invoice. The classifier is then run end-to-end and we assert
// treatment + rule. Any change to the rules engine that breaks one of
// these cases fails the test — forcing an explicit decision about
// whether the behaviour change is intended.
//
// Fixture archetypes (the classes that actually show up in fund files):
//   - Notary              — mixed 17% + 0% débours + 0% droits d'enregistrement
//   - Fund administrator  — management 0% + depositary 14% + transfer agency 17%
//   - Depositary bank     — fees mostly 17% (NOT 14% — common misconception)
//   - Audit firm          — professional fee 17% + out-of-pocket 0%
//   - Law firm            — professional fee 17% + court disbursements 0%
//   - Landlord            — rent 0% (or 17% with Art. 45 opt-in) + charges
//   - Domiciliation provider — 17% (Circ. 764, NOT a real-estate letting)
//   - IT / SaaS           — 17% LU or reverse-charge at 17%
//   - Cross-border advisor — taxable RC unless qualifying fund (BlackRock)
//   - Non-EU goods        — commercial VAT ≠ deductible LU import VAT
//   - Referral / placement agent — market-practice default taxable
//
// To add a fixture: append to the `FIXTURES` array. The corpus test runs
// `classifyInvoiceLine(input, context)` and asserts treatment + rule
// (and optionally flag / flag_reason substring). The coverage sanity
// test also verifies that every RULE id that fires in the codebase is
// exercised by at least one fixture.
// ══════════════════════════════════════════════════════════════════════

import type { InvoiceLineInput, EntityContext } from '@/config/classification-rules';

export interface InvoiceFixture {
  id: string;                 // "F001", "F002", ... — stable ordering
  title: string;              // human description
  archetype: string;          // provider archetype (notary, fund_admin, …)
  legal_ref: string;          // short legal / market-practice reference
  context?: Partial<EntityContext>;
  input: InvoiceLineInput;
  expected: {
    treatment: string | null;
    rule: string;
    source?: 'rule' | 'precedent' | 'inference' | 'override';
    flag?: boolean;
    flag_includes?: string;   // substring match on flag_reason (case-insensitive)
    reason_includes?: string; // substring match on the main reason
  };
  notes?: string;             // free commentary for the reader
}

const FUND_CTX: Partial<EntityContext> = {
  entity_type: 'fund',
  exempt_outgoing_total: 1_500_000,
};
const HOLDING_CTX: Partial<EntityContext> = {
  entity_type: 'active_holding',
  exempt_outgoing_total: 0,
};
const PASSIVE_CTX: Partial<EntityContext> = {
  entity_type: 'passive_holding',
  exempt_outgoing_total: 0,
};
const MANCO_CTX: Partial<EntityContext> = {
  entity_type: 'manco',
  exempt_outgoing_total: 3_000_000,
};

export const FIXTURES: InvoiceFixture[] = [
  // ═════════════════════ Group 1 — LU standard / reduced rates (RULES 1-4) ═════════════════════
  {
    id: 'F001',
    title: 'Notary honoraires billed at 17% LU VAT',
    archetype: 'notary',
    legal_ref: 'LTVA Art. 40',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0.17, vat_applied: 1700,
      amount_eur: 10000, description: 'Honoraires notariaux — acte de constitution',
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 1' },
  },
  {
    id: 'F002',
    title: 'Depositary fee at 14% LU VAT (intermediate rate)',
    archetype: 'depositary',
    legal_ref: 'LTVA Art. 40-1',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0.14, vat_applied: 14000,
      amount_eur: 100000, description: 'Depositary fee Q1 2025 — intermediate rate',
    },
    expected: { treatment: 'LUX_14', rule: 'RULE 2' },
  },
  {
    id: 'F003',
    title: 'LU 8% district heating service',
    archetype: 'utility',
    legal_ref: 'LTVA Art. 40-1',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0.08, vat_applied: 160,
      amount_eur: 2000, description: 'District heating — office building Q1',
    },
    expected: { treatment: 'LUX_08', rule: 'RULE 3' },
  },
  {
    id: 'F004',
    title: 'LU 3% super-reduced — printed investor publication',
    archetype: 'publishing',
    legal_ref: 'LTVA Art. 40-1',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0.03, vat_applied: 30,
      amount_eur: 1000, description: 'Printing of annual investor report',
    },
    expected: { treatment: 'LUX_03', rule: 'RULE 4' },
  },

  // ═════════════════════ Group 2 — LU no-VAT + carve-outs (RULES 5, 5C, 5D, 6, 7, 8, 23) ═════════════════════
  {
    id: 'F005',
    title: 'Office rental — default exempt Art. 44§1 b, flagged',
    archetype: 'landlord',
    legal_ref: 'LTVA Art. 44§1 b + Circ. 810',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 5000, description: 'Loyer bureau — 2ème trimestre',
    },
    expected: {
      treatment: 'LUX_00', rule: 'RULE 5',
      flag: true,
      flag_includes: 'Art. 45',
    },
  },
  {
    id: 'F006',
    title: 'Parking space rental — TAXABLE carve-out (Art. 44§1 b point 2)',
    archetype: 'landlord',
    legal_ref: 'LTVA Art. 44§1 b carve-out',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 150, description: 'Parking space rental — underground garage — monthly rent',
    },
    expected: {
      treatment: 'LUX_17', rule: 'RULE 5C',
      flag: true,
      flag_includes: 'carve-outs',
    },
    notes: 'The supplier forgot the VAT — a corrected invoice should be requested.',
  },
  {
    id: 'F007',
    title: 'Domiciliation service — always TAXABLE 17% per Circ. 764',
    archetype: 'corporate_services',
    legal_ref: 'Circ. 764 + LTVA Art. 28-5',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 2500, description: 'Domiciliation service — annual fee 2025',
    },
    expected: {
      treatment: 'LUX_17', rule: 'RULE 5D',
      flag: true,
      flag_includes: 'Circ. 764',
    },
    notes: 'Critical trap — the earlier codebase routed this to LUX_00.',
  },
  {
    id: 'F008',
    title: 'Chamber of Commerce cotisation — OUT_SCOPE',
    archetype: 'regulator_fee',
    legal_ref: 'LTVA Art. 4§5',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 450, description: 'Bulletin de cotisation — Chambre de commerce',
    },
    expected: { treatment: 'OUT_SCOPE', rule: 'RULE 6' },
  },
  {
    id: 'F009',
    title: 'CSSF supervisory fee — OUT_SCOPE (public-authority levy)',
    archetype: 'regulator_fee',
    legal_ref: 'LTVA Art. 4§5',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 18000, description: 'CSSF supervisory fee 2025',
    },
    expected: { treatment: 'OUT_SCOPE', rule: 'RULE 6' },
  },
  {
    id: 'F010',
    title: '"CSSF filing assistance" law-firm invoice — NOT out-of-scope',
    archetype: 'law_firm',
    legal_ref: 'Trap case — CSSF keyword must not over-match',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 6500, description: 'Legal fees — CSSF filing assistance and follow-up',
    },
    expected: {
      treatment: 'LUX_00', rule: 'RULE 8',
      flag: true, flag_includes: 'no recognised legal reference',
    },
    notes: 'Lawyer invoice about the CSSF — taxable service, not a regulator fee. '
      + 'Rules 6 must not fire. Falls to RULE 8 default flagged.',
  },
  {
    id: 'F011',
    title: 'LU AIFM — explicit Art. 44 exemption → EXEMPT_44',
    archetype: 'fund_admin',
    legal_ref: 'LTVA Art. 44§1 d + Circ. 723',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'AIFM management fee — exonéré de TVA Art. 44 LTVA',
      vat_rate: 0, vat_applied: 0, amount_eur: 25000,
    },
    expected: { treatment: 'EXEMPT_44', rule: 'RULE 7' },
  },
  {
    id: 'F012',
    title: 'LU small-business supplier — Art. 57 franchise',
    archetype: 'small_supplier',
    legal_ref: 'LTVA Art. 57 (€50k post-Dir 2020/285)',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 320, description: 'Freelance design — régime de la franchise Art. 57',
    },
    expected: { treatment: 'LUX_00', rule: 'RULE 23' },
  },
  {
    id: 'F013',
    title: 'LU no-VAT with no recognised basis → RULE 8 flagged',
    archetype: 'unknown',
    legal_ref: 'LTVA Art. 44 / franchise / out-of-scope to confirm',
    input: {
      direction: 'incoming', country: 'LU', vat_rate: 0, vat_applied: 0,
      amount_eur: 1200, description: 'Annual maintenance contract — FY 2025',
    },
    expected: {
      treatment: 'LUX_00', rule: 'RULE 8',
      flag: true, flag_includes: 'no recognised legal reference',
    },
  },

  // ═════════════════════ Group 3 — IC acquisitions (RULES 9, 17, 17X) ═════════════════════
  {
    id: 'F014',
    title: 'BE goods supplier, LU 17% applies → IC_ACQ_17',
    archetype: 'ic_goods',
    legal_ref: 'LTVA Art. 21',
    input: {
      direction: 'incoming', country: 'BE',
      description: 'Office equipment goods — hardware purchase',
      vat_rate: 0.17, vat_applied: 0, amount_eur: 5000,
    },
    expected: { treatment: 'IC_ACQ_17', rule: 'RULE 17' },
  },
  {
    id: 'F015',
    title: 'FR books supplier, LU 3% applies → IC_ACQ_03',
    archetype: 'ic_goods',
    legal_ref: 'LTVA Art. 21 + Art. 40-1',
    input: {
      direction: 'incoming', country: 'FR',
      description: 'Purchase of books (livres) goods — printed matter',
      vat_rate: 0.03, vat_applied: 0, amount_eur: 800,
    },
    expected: { treatment: 'IC_ACQ_03', rule: 'RULE 17' },
  },
  {
    id: 'F016',
    title: 'EU goods, rate not determined → legacy IC_ACQ flagged',
    archetype: 'ic_goods',
    legal_ref: 'LTVA Art. 21 — requires rate migration',
    input: {
      direction: 'incoming', country: 'NL',
      description: 'Supply of goods — intra-Community, rate not stated',
      vat_rate: null, vat_applied: 0, amount_eur: 1500,
    },
    expected: {
      treatment: 'IC_ACQ', rule: 'RULE 9',
      flag: true, flag_includes: '711..717',
    },
  },
  {
    id: 'F017',
    title: 'EU goods with erroneous foreign VAT → anomaly flag',
    archetype: 'ic_goods',
    legal_ref: 'Art. 138 Directive — should be exempt at origin',
    input: {
      direction: 'incoming', country: 'DE',
      description: 'Supply of goods — purchase of equipment',
      vat_rate: 0.19, vat_applied: 190, amount_eur: 1000,
    },
    expected: {
      treatment: null, rule: 'RULE 17X',
      flag: true, flag_includes: 'supplier VAT',
    },
  },

  // ═════════════════════ Group 4 — Cross-border reverse-charge (RULES 10, 11/B/C/D, 12, 13/B/C/D) ═════════════════════
  {
    id: 'F018',
    title: 'EU AIFM delegation to qualifying fund — RULE 10 RC_EU_EX',
    archetype: 'cross_border_advisor',
    legal_ref: 'LTVA Art. 44§1 d + BlackRock C-231/19 (qualifying fund)',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      description: 'AIFM management services Q1 — fund management',
      invoice_text: 'Exempt from VAT under Article 44 (special investment fund)',
      vat_rate: null, vat_applied: 0, amount_eur: 40000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 10' },
  },
  {
    id: 'F019',
    title: 'Same invoice received by a SOPARFI → RULE 10X RC_EU_TAX (flagged)',
    archetype: 'cross_border_advisor',
    legal_ref: 'BlackRock C-231/19 — non-fund entity loses the exemption',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      description: 'AIFM management services Q1 — fund management',
      invoice_text: 'Exempt from VAT under Article 44 (special investment fund)',
      vat_rate: null, vat_applied: 0, amount_eur: 40000,
    },
    expected: {
      treatment: 'RC_EU_TAX', rule: 'RULE 10X',
      flag: true, flag_includes: 'BlackRock',
    },
  },
  {
    id: 'F020',
    title: 'Non-EU fund-mgmt + Art 44 + fund entity → RULE 12 RC_NONEU_EX',
    archetype: 'cross_border_advisor',
    legal_ref: 'LTVA Art. 44§1 d + Fiscale Eenheid X C-595/13',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'CH',
      description: 'AIFM portfolio management services — exempt under Art 44',
      vat_rate: null, vat_applied: 0, amount_eur: 55000,
    },
    expected: { treatment: 'RC_NONEU_EX', rule: 'RULE 12' },
  },
  {
    id: 'F021',
    title: 'Generic EU cloud service, no VAT → RULE 11 RC_EU_TAX 17%',
    archetype: 'it',
    legal_ref: 'LTVA Art. 17§1',
    input: {
      direction: 'incoming', country: 'IE',
      description: 'Cloud hosting monthly subscription',
      vat_rate: null, vat_applied: 0, amount_eur: 1200,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 11' },
  },
  {
    id: 'F022',
    title: 'EU e-book licence, reduced 3% applies → RULE 11D',
    archetype: 'publishing',
    legal_ref: 'LTVA Art. 40-1 (3%) + Art. 17§1',
    input: {
      direction: 'incoming', country: 'IE',
      description: 'E-book annual licence — research library',
      vat_rate: null, vat_applied: 0, amount_eur: 600,
    },
    expected: { treatment: 'RC_EU_TAX_03', rule: 'RULE 11D' },
  },
  {
    id: 'F023',
    title: 'EU district-heating supply, reduced 8% → RULE 11C',
    archetype: 'utility',
    legal_ref: 'LTVA Art. 40-1 (8%)',
    input: {
      direction: 'incoming', country: 'DE',
      description: 'District heating supply Q1 2026',
      vat_rate: null, vat_applied: 0, amount_eur: 3500,
    },
    expected: { treatment: 'RC_EU_TAX_08', rule: 'RULE 11C' },
  },
  {
    id: 'F024',
    title: 'Non-EU e-book licence → RULE 13D RC_NONEU_TAX_03',
    archetype: 'publishing',
    legal_ref: 'LTVA Art. 40-1 (3%) + Art. 17§1',
    input: {
      direction: 'incoming', country: 'US',
      description: 'E-book annual subscription',
      vat_rate: null, vat_applied: 0, amount_eur: 950,
    },
    expected: { treatment: 'RC_NONEU_TAX_03', rule: 'RULE 13D' },
  },
  {
    id: 'F025',
    title: 'Non-EU generic consulting, no VAT → RULE 13 RC_NONEU_TAX',
    archetype: 'cross_border_advisor',
    legal_ref: 'LTVA Art. 17§1',
    input: {
      direction: 'incoming', country: 'GB',
      description: 'Tax-compliance software platform fee',
      vat_rate: null, vat_applied: 0, amount_eur: 2400,
    },
    expected: { treatment: 'RC_NONEU_TAX', rule: 'RULE 13' },
  },

  // ═════════════════════ Group 5 — Passive-holding gate (RULES 11P / 13P) ═════════════════════
  {
    id: 'F026',
    title: 'Passive SOPARFI receives EU legal advisory → RULE 11P (flag, null)',
    archetype: 'cross_border_advisor',
    legal_ref: 'Polysar C-60/90 / Cibo C-16/00 — not a taxable person',
    context: PASSIVE_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      description: 'Legal advisory on M&A due diligence',
      vat_rate: null, vat_applied: 0, amount_eur: 15000,
    },
    expected: {
      treatment: null, rule: 'RULE 11P',
      flag: true, flag_includes: 'PASSIVE',
    },
  },
  {
    id: 'F027',
    title: 'Passive SOPARFI receives non-EU consulting → RULE 13P',
    archetype: 'cross_border_advisor',
    legal_ref: 'Polysar C-60/90 / Cibo C-16/00',
    context: PASSIVE_CTX,
    input: {
      direction: 'incoming', country: 'CH',
      description: 'Swiss consulting on corporate governance',
      vat_rate: null, vat_applied: 0, amount_eur: 8000,
    },
    expected: { treatment: null, rule: 'RULE 13P' },
  },

  // ═════════════════════ Group 6 — Outgoing (RULES 14, 15, 15B/C/D, 15A, 18, 18X) ═════════════════════
  {
    id: 'F028',
    title: 'Outgoing exempt management fee to a fund — RULE 14 OUT_LUX_00',
    archetype: 'fund_admin',
    legal_ref: 'LTVA Art. 44§1 d',
    context: MANCO_CTX,
    input: {
      direction: 'outgoing', country: 'LU',
      description: 'Fund management fee — exonéré Art. 44 LTVA',
      vat_rate: 0, vat_applied: 0, amount_eur: 500000,
    },
    expected: { treatment: 'OUT_LUX_00', rule: 'RULE 14' },
  },
  {
    id: 'F029',
    title: 'Outgoing 17% consulting — RULE 15 OUT_LUX_17',
    archetype: 'active_holding',
    legal_ref: 'LTVA Art. 40',
    context: HOLDING_CTX,
    input: {
      direction: 'outgoing', country: 'LU',
      description: 'Consulting services Q1',
      vat_rate: 0.17, vat_applied: 8500, amount_eur: 50000,
    },
    expected: { treatment: 'OUT_LUX_17', rule: 'RULE 15' },
  },
  {
    id: 'F030',
    title: 'Outgoing 14% — RULE 15B OUT_LUX_14',
    archetype: 'active_holding',
    legal_ref: 'LTVA Art. 40-1',
    input: {
      direction: 'outgoing', country: 'LU',
      description: 'Depositary-adjacent service — intermediate rate',
      vat_rate: 0.14, vat_applied: 1400, amount_eur: 10000,
    },
    expected: { treatment: 'OUT_LUX_14', rule: 'RULE 15B' },
  },
  {
    id: 'F031',
    title: 'Outgoing real-estate letting with Art. 45 opt-in at 17% — RULE 15A',
    archetype: 'propco',
    legal_ref: 'LTVA Art. 45 opt-in',
    input: {
      direction: 'outgoing', country: 'LU',
      description: 'Office rental — Art. 45 LTVA option pour la taxation',
      exemption_reference: 'Art. 45 LTVA — option pour la taxation',
      vat_rate: 0.17, vat_applied: 2500, amount_eur: 14705.88,
    },
    expected: { treatment: 'OUT_LUX_17_OPT', rule: 'RULE 15A' },
  },
  {
    id: 'F032',
    title: 'Outgoing to US customer WITH VAT-ID → RULE 18 OUT_NONEU',
    archetype: 'cross_border_outgoing',
    legal_ref: 'Place-of-supply — customer country',
    input: {
      direction: 'outgoing', country: 'LU',
      customer_country: 'US', customer_vat: 'US EIN 12-3456789',
      description: 'Advisory services Q4 2025',
      vat_rate: 0, vat_applied: 0, amount_eur: 75000,
    },
    expected: { treatment: 'OUT_NONEU', rule: 'RULE 18' },
  },
  {
    id: 'F033',
    title: 'Outgoing to US customer WITHOUT VAT-ID → RULE 18X flag',
    archetype: 'cross_border_outgoing',
    legal_ref: 'Art. 17§2 LTVA — B2C may still be LU-taxable',
    input: {
      direction: 'outgoing', country: 'LU',
      customer_country: 'US',
      description: 'Advisory services — individual US client',
      vat_rate: 0, vat_applied: 0, amount_eur: 3500,
    },
    expected: {
      treatment: null, rule: 'RULE 18X',
      flag: true, flag_includes: 'tax-status',
    },
  },
  {
    id: 'F034',
    title: 'Outgoing management fee billed at 17% — RULE 15 wins over RULE 14',
    archetype: 'active_holding',
    legal_ref: 'Trap case — exemption keyword without zero VAT',
    input: {
      direction: 'outgoing', country: 'LU',
      description: 'Management fee Q1 2025 — exonéré Art. 44 d',
      vat_rate: 0.17, vat_applied: 8500, amount_eur: 50000,
    },
    expected: { treatment: 'OUT_LUX_17', rule: 'RULE 15' },
    notes: 'Regression guard: the earlier loose RULE 14 used to exempt this.',
  },

  // ═════════════════════ Group 7 — Option B new rules (20-32) ═════════════════════
  {
    id: 'F035',
    title: 'Intra-VAT-group LU incoming — RULE 20 VAT_GROUP_OUT',
    archetype: 'vat_group',
    legal_ref: 'LTVA Art. 60ter + Finanzamt T II C-184/23',
    context: { entity_type: 'active_holding', vat_group_id: 'LUGRP12345' },
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Intra-group accounting support — same VAT group',
      vat_rate: 0, vat_applied: 0, amount_eur: 8000,
    },
    expected: { treatment: 'VAT_GROUP_OUT', rule: 'RULE 20' },
  },
  {
    id: 'F036',
    title: 'Platform deemed-supplier invoice — RULE 22 PLATFORM_DEEMED',
    archetype: 'platform',
    legal_ref: 'Art. 9a Reg. 282/2011 + Fenix C-695/20',
    input: {
      direction: 'incoming', country: 'IE',
      description: 'Platform facilitation fee — marketplace facilitator Art. 9a',
      vat_rate: null, vat_applied: 0, amount_eur: 1800,
    },
    expected: { treatment: 'PLATFORM_DEEMED', rule: 'RULE 22' },
  },
  {
    id: 'F037',
    title: 'Margin-scheme invoice — RULE 24 MARGIN_NONDED (buyer no deduction)',
    archetype: 'margin_scheme',
    legal_ref: 'LTVA Art. 56bis + Directive Arts. 311-325',
    input: {
      direction: 'incoming', country: 'FR',
      description: 'Purchase of second-hand art — régime de la marge',
      vat_rate: null, vat_applied: 0, amount_eur: 12000,
    },
    expected: { treatment: 'MARGIN_NONDED', rule: 'RULE 24' },
  },
  {
    id: 'F038',
    title: 'LU construction work no VAT — RULE 25 domestic RC',
    archetype: 'construction',
    legal_ref: 'LTVA Art. 61§2 c + RGD 1991-12-21',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Travaux de construction — gros œuvre immeuble siège',
      vat_rate: 0, vat_applied: 0, amount_eur: 80000,
    },
    expected: { treatment: 'RC_LUX_CONSTR_17', rule: 'RULE 25' },
  },
  {
    id: 'F039',
    title: 'LU CO2 emission allowance supply — RULE 26 domestic RC',
    archetype: 'specific_rc',
    legal_ref: 'LTVA Art. 61§2 a-b',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Sale of CO2 emission allowance — quota vers acquéreur LU',
      vat_rate: 0, vat_applied: 0, amount_eur: 45000,
    },
    expected: { treatment: 'RC_LUX_SPEC_17', rule: 'RULE 26' },
  },
  {
    id: 'F040',
    title: 'Bad-debt regularisation — RULE 27 BAD_DEBT_RELIEF',
    archetype: 'regularisation',
    legal_ref: 'LTVA Art. 62 + Di Maura C-246/16',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Régularisation — créance irrécouvrable suite à faillite',
      vat_rate: null, vat_applied: null, amount_eur: 4000,
    },
    expected: { treatment: 'BAD_DEBT_RELIEF', rule: 'RULE 27' },
  },
  {
    id: 'F041',
    title: 'LU restaurant bill 17% → RULE 29 LUX_17_NONDED',
    archetype: 'non_deductible',
    legal_ref: 'LTVA Art. 54 — entertainment non-deductible',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Restaurant — repas d\'affaires avec prospect',
      vat_rate: 0.17, vat_applied: 34, amount_eur: 200,
    },
    expected: { treatment: 'LUX_17_NONDED', rule: 'RULE 29' },
  },
  {
    id: 'F042',
    title: 'LU hotel at 17% — RULE 29 LUX_17_NONDED',
    archetype: 'non_deductible',
    legal_ref: 'LTVA Art. 54',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Hotel accommodation — client entertainment stay',
      vat_rate: 0.17, vat_applied: 51, amount_eur: 300,
    },
    expected: { treatment: 'LUX_17_NONDED', rule: 'RULE 29' },
  },
  {
    id: 'F043',
    title: 'Autolivraison outgoing — RULE 31 AUTOLIV_17',
    archetype: 'self_supply',
    legal_ref: 'LTVA Art. 12',
    input: {
      direction: 'outgoing', country: 'LU',
      description: 'Self-supply for private use of business asset',
      vat_rate: 0, vat_applied: 0, amount_eur: 1500,
      self_supply_mentioned: true,
    } as InvoiceLineInput,
    expected: { treatment: 'AUTOLIV_17', rule: 'RULE 31' },
  },

  // ═════════════════════ Group 8 — Import VAT + anomaly (RULE 19 / 19X) ═════════════════════
  {
    id: 'F044',
    title: 'Non-EU goods with commercial VAT on supplier invoice — RULE 19 FLAG ONLY',
    archetype: 'non_eu_goods',
    legal_ref: 'LTVA Art. 27 + Art. 70 LTVA exposure if auto-deducted',
    input: {
      direction: 'incoming', country: 'CN',
      description: 'Purchase of industrial equipment — goods from Shenzhen',
      vat_rate: null, vat_applied: 170, amount_eur: 1000,
    },
    expected: {
      treatment: null, rule: 'RULE 19',
      flag: true, flag_includes: 'customs',
    },
    notes: 'CRITICAL regression guard — foreign commercial VAT is NOT LU import VAT.',
  },
  {
    id: 'F045',
    title: 'Non-EU telecom service, no VAT → RULE 13 RC_NONEU_TAX',
    archetype: 'telecom',
    legal_ref: 'LTVA Art. 17§1',
    input: {
      direction: 'incoming', country: 'CH',
      description: 'Swiss telecom network services — Q4 subscription',
      vat_rate: null, vat_applied: 0, amount_eur: 12000,
    },
    expected: { treatment: 'RC_NONEU_TAX', rule: 'RULE 13' },
    notes: 'Description intentionally avoids TAXABLE_PROFESSIONAL_KEYWORDS so INFERENCE E does not fire — RULE 13 is the generic fallback.',
  },

  // ═════════════════════ Group 9 — Extractor-captured Art. 44 references ═════════════════════
  {
    id: 'F046',
    title: 'Art. 44§1 a explicit → RULE 7A EXEMPT_44A_FIN',
    archetype: 'financial',
    legal_ref: 'LTVA Art. 44§1 a + Art. 135(1)(a)-(f) Directive',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Securities custody fees',
      exemption_reference: 'Art. 44 § 1 a LTVA',
      vat_rate: 0, vat_applied: 0, amount_eur: 3500,
    },
    expected: { treatment: 'EXEMPT_44A_FIN', rule: 'RULE 7A' },
  },
  {
    id: 'F047',
    title: 'Art. 44§1 b explicit → RULE 7B EXEMPT_44B_RE',
    archetype: 'real_estate',
    legal_ref: 'LTVA Art. 44§1 b',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Quarterly office rent',
      exemption_reference: 'Art. 44(1)(b) LTVA',
      vat_rate: 0, vat_applied: 0, amount_eur: 12000,
    },
    expected: { treatment: 'EXEMPT_44B_RE', rule: 'RULE 7B' },
  },
  {
    id: 'F048',
    title: 'Art. 44§1 d explicit → RULE 7D EXEMPT_44',
    archetype: 'fund_admin',
    legal_ref: 'LTVA Art. 44§1 d + Circ. 723',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Fund administration services Q2',
      exemption_reference: 'Article 44, paragraphe 1er, lettre d',
      vat_rate: 0, vat_applied: 0, amount_eur: 18000,
    },
    expected: { treatment: 'EXEMPT_44', rule: 'RULE 7D' },
  },

  // ═════════════════════ Group 10 — Market practice / CJEU ═════════════════════
  {
    id: 'F049',
    title: 'INFERENCE E — EU legal advisory to fund entity → RC_EU_TAX (backstop)',
    archetype: 'cross_border_advisor',
    legal_ref: 'Deutsche Bank C-44/11 / BlackRock C-231/19 narrow reading',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      description: 'Legal advisory on fund structuring',
      vat_rate: null, vat_applied: 0, amount_eur: 18000,
    },
    expected: {
      treatment: 'RC_EU_TAX', rule: 'INFERENCE E',
      source: 'inference', flag: true,
    },
    notes: 'Without the backstop, INFERENCE C would have exempted this.',
  },
  {
    id: 'F050',
    title: 'INFERENCE C cancelled by SaaS exclusion — fund-type entity',
    archetype: 'it',
    legal_ref: 'BlackRock C-231/19 — SaaS not "specific and essential"',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'IE',
      description: 'Portfolio management SaaS licence — cloud platform',
      vat_rate: null, vat_applied: 0, amount_eur: 20000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 11' },
    notes: 'BlackRock: pure IT licence is not within Art. 44§1 d — must be taxable.',
  },
  {
    id: 'F051',
    title: 'INFERENCE A — EU advisory fee matches outgoing exempt magnitude (fund)',
    archetype: 'cross_border_advisor',
    legal_ref: 'PRAC_AIFM_DELEGATION + BlackRock C-231/19 + Circ. 723',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'PL',
      description: 'Investment advisory fee III Q 2025',
      vat_rate: null, vat_applied: 0, amount_eur: 800000,
    },
    expected: {
      treatment: 'RC_EU_EX', rule: 'INFERENCE A',
      source: 'inference', flag: true,
    },
  },
  {
    id: 'F052',
    title: 'INFERENCE D — non-EU advisory to fund with fund-mgmt keywords',
    archetype: 'cross_border_advisor',
    legal_ref: 'Fiscale Eenheid X C-595/13 + PRAC_AIFM_DELEGATION',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'CH',
      description: 'AIFM portfolio management services — collective portfolio management',
      vat_rate: null, vat_applied: 0, amount_eur: 60000,
    },
    expected: {
      treatment: 'RC_NONEU_EX', rule: 'INFERENCE D',
      source: 'inference', flag: true,
    },
  },
  {
    id: 'F053',
    title: 'Depositary custody fee — taxable 17% default (market practice)',
    archetype: 'depositary',
    legal_ref: 'PRAC_DEPOSITARY_SPLIT — NOT a 14% item',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Depositary safekeeping Q3 — securities custody',
      vat_rate: 0.17, vat_applied: 3400, amount_eur: 20000,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 1' },
  },
  {
    id: 'F054',
    title: 'Transfer-agency fee for qualifying fund — exempt',
    archetype: 'fund_admin',
    legal_ref: 'PRAC_TRANSFER_AGENCY + ATP Pension C-464/12',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Registrar and transfer agency services — exempt under Art. 44 LTVA',
      vat_rate: 0, vat_applied: 0, amount_eur: 9000,
    },
    expected: { treatment: 'EXEMPT_44', rule: 'RULE 7' },
  },
  {
    id: 'F055',
    title: 'Débours — disbursement flag → RULE 16 DEBOURS',
    archetype: 'notary',
    legal_ref: 'LTVA Art. 28§3 c',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Notary — droits d\'enregistrement transmitted to client',
      vat_rate: 0, vat_applied: 0, amount_eur: 2400,
      is_disbursement: true,
    },
    expected: { treatment: 'DEBOURS', rule: 'RULE 16' },
  },
  {
    id: 'F056',
    title: 'Disbursement flag beats a 17% rate hint (extractor wins)',
    archetype: 'notary',
    legal_ref: 'LTVA Art. 28§3 c',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Débours — refacturation au client',
      vat_rate: 0.17, vat_applied: 170, amount_eur: 1000,
      is_disbursement: true,
    },
    expected: { treatment: 'DEBOURS', rule: 'RULE 16' },
    notes: 'Extractor-flagged is_disbursement is the strongest signal.',
  },

  // ═════════════════════ Group 11 — Additional realism / regressions ═════════════════════
  {
    id: 'F057',
    title: 'Non-EU financial intermediary — INFERENCE E taxable backstop',
    archetype: 'cross_border_advisor',
    legal_ref: 'Deutsche Bank C-44/11',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'US',
      description: 'M&A advisory and due diligence services',
      vat_rate: null, vat_applied: 0, amount_eur: 45000,
    },
    expected: {
      treatment: 'RC_NONEU_TAX', rule: 'INFERENCE E',
      source: 'inference', flag: true,
    },
  },
  {
    id: 'F058',
    title: 'LU audit fee 17% (ordinary) → RULE 1 LUX_17',
    archetype: 'audit_firm',
    legal_ref: 'LTVA Art. 40',
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Audit of annual accounts FY 2025',
      vat_rate: 0.17, vat_applied: 5100, amount_eur: 30000,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 1' },
  },
  {
    id: 'F059',
    title: 'LU training course 17% (excluded from exemption inference)',
    archetype: 'training',
    legal_ref: 'Market practice — training is not fund management',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      description: 'Annual fund-management training course',
      vat_rate: 0.17, vat_applied: 340, amount_eur: 2000,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 1' },
  },
  {
    id: 'F060',
    title: 'Credit note on EU RC service — negative amount, same treatment path',
    archetype: 'cross_border_advisor',
    legal_ref: 'LTVA Art. 65 + Art. 17§1',
    input: {
      direction: 'incoming', country: 'DE',
      description: 'Credit note — refund of Q1 hosting platform overbilling',
      vat_rate: null, vat_applied: 0, amount_eur: -3000,
      is_credit_note: true,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 11' },
    notes: 'Credit-note sign is preserved; treatment follows the underlying service. '
      + 'Description avoids consulting / advisory to bypass INFERENCE E backstop.',
  },
];
