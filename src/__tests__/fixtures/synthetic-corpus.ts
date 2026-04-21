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
// Securitisation vehicle (Loi du 22 mars 2004 as amended 2022). SV IS a
// taxable person; management services received are exempt Art. 44§1 d
// via Fiscale Eenheid X C-595/13 extension. See classification-research §11.
const SV_CTX: Partial<EntityContext> = {
  entity_type: 'securitization_vehicle',
  exempt_outgoing_total: 2_000_000,
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

  // ═════════════════════ Group 8 — Content-specific PRIORITY 1.3 (directors, carry, waterfall, IGP) ═════════════════════
  // Added 2026-04-19 (stint 11) per docs/classification-research.md.
  {
    id: 'F061',
    title: 'Natural-person director fee — OUT_SCOPE per C-288/22 TP',
    archetype: 'director_fees',
    legal_ref: 'CJEU C-288/22 TP + AED Circ. 781-2',
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Jean-Marc Weber',
      description: 'Jetons de présence — conseil d\'administration Q1 2026',
      vat_rate: null, vat_applied: 0, amount_eur: 8000,
    },
    expected: { treatment: 'OUT_SCOPE', rule: 'RULE 32a', flag: false },
    notes: 'Natural-person director (no legal suffix in name). Settled post-2023-12-21. No flag.',
  },
  {
    id: 'F062',
    title: 'Legal-person director fee (LU SARL) — LUX_17 with CONTESTED flag',
    archetype: 'director_fees',
    legal_ref: 'AED Circ. 781-2 (contested)',
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Fiduciaire Alpha SARL',
      description: 'Tantièmes d\'administrateur — mandat année 2025',
      vat_rate: 0.17, vat_applied: 1700, amount_eur: 10000,
    },
    expected: {
      treatment: 'LUX_17', rule: 'RULE 32b', flag: true,
      flag_includes: 'contested',
    },
  },
  {
    id: 'F063',
    title: 'Legal-person director fee (FR SA) — RC_EU_TAX with CONTESTED flag',
    archetype: 'director_fees',
    legal_ref: 'AED Circ. 781-2 + Art. 17§1 LTVA',
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Paris Consulting SA',
      description: 'Board member fees — administrator of LU SICAV',
      vat_rate: null, vat_applied: 0, amount_eur: 12000,
    },
    expected: {
      treatment: 'RC_EU_TAX', rule: 'RULE 32b', flag: true,
      flag_includes: 'AED',
    },
  },
  {
    id: 'F064',
    title: 'Director keyword + ambiguous supplier name → RULE 32? flag',
    archetype: 'director_fees',
    legal_ref: 'CJEU C-288/22 TP (unknown supplier kind)',
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Board Services 24',
      description: 'Director fee — Q4 meeting',
      vat_rate: null, vat_applied: 0, amount_eur: 5000,
    },
    expected: {
      treatment: null, rule: 'RULE 32?', flag: true,
      flag_includes: 'supplier kind',
    },
    notes: 'Name has no suffix + no natural-name pattern (digit present) → unknown. '
      + 'Correct classifier behaviour: flag for manual review.',
  },
  {
    id: 'F065',
    title: 'Carry interest paid to GP — default OUT_SCOPE with confirm-substance flag',
    archetype: 'carry_interest',
    legal_ref: 'PRAC_CARRY_INTEREST + Baštová C-432/15',
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Fund GP SARL',
      description: 'Carried interest distribution — Q4 2025 waterfall',
      vat_rate: null, vat_applied: 0, amount_eur: 250000,
    },
    expected: {
      treatment: 'OUT_SCOPE', rule: 'RULE 33', flag: true,
      flag_includes: 'substance',
    },
  },
  {
    id: 'F066',
    title: 'Waterfall LP distribution — OUT_SCOPE',
    archetype: 'waterfall',
    legal_ref: 'Kretztechnik C-465/03',
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Limited Partnership Alpha SCSp',
      description: 'Limited partner distribution — preferred return step',
      vat_rate: null, vat_applied: 0, amount_eur: 500000,
    },
    expected: { treatment: 'OUT_SCOPE', rule: 'RULE 34', flag: true },
  },
  {
    id: 'F067',
    title: 'Waterfall distribution that ALSO mentions a structuring fee — mixed',
    archetype: 'waterfall_mixed',
    legal_ref: 'Kretztechnik + LUX_17',
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Fund Services SARL',
      description: 'Waterfall distribution + set-up fee on closing',
      vat_rate: null, vat_applied: 0, amount_eur: 75000,
    },
    expected: {
      treatment: null, rule: 'RULE 34/mixed', flag: true,
      flag_includes: 'split',
    },
  },
  {
    id: 'F068',
    title: 'Cross-border IGP cost-sharing invoice from FR → Kaplan, taxable',
    archetype: 'igp',
    legal_ref: 'CJEU Kaplan C-77/19',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Paris Shared Services GIE',
      description: 'Cost-sharing invoice (art. 132(1)(f)) — shared IT platform',
      vat_rate: null, vat_applied: 0, amount_eur: 25000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 35', flag: true, flag_includes: 'Kaplan' },
  },
  {
    id: 'F069',
    title: 'LU-to-LU IGP invoice to a fund entity → DNB Banka / Aviva, taxable',
    archetype: 'igp',
    legal_ref: 'DNB Banka C-326/15 + Aviva C-605/15',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LuxShared Services SCS',
      description: 'Independent Group of Persons — back-office allocation',
      vat_rate: 0.17, vat_applied: 4250, amount_eur: 25000,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 35-lu', flag: true, flag_includes: 'DNB' },
  },
  {
    id: 'F070',
    title: 'LU-to-LU IGP to a non-financial active holding — potentially exempt',
    archetype: 'igp',
    legal_ref: 'Art. 44§1 y LTVA (four conditions)',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LuxShared Services SCS',
      description: 'Cost-pooling allocation for IT infrastructure',
      vat_rate: null, vat_applied: 0, amount_eur: 12000,
    },
    expected: { treatment: 'LUX_00', rule: 'RULE 35-ok', flag: true, flag_includes: 'four conditions' },
  },
  {
    id: 'F071',
    title: 'Passive holding receives LU 17% invoice → non-deductible (RULE 15P)',
    archetype: 'passive_holding_lu',
    legal_ref: 'Polysar C-60/90 + Art. 49§1 LTVA',
    context: PASSIVE_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LUX Fiduciary SA',
      description: 'Corporate secretarial services Q1',
      vat_rate: 0.17, vat_applied: 850, amount_eur: 5000,
    },
    expected: { treatment: 'LUX_17_NONDED', rule: 'RULE 15P', flag: true, flag_includes: 'Polysar' },
    notes: 'Key Polysar domestic-leg case. Prior to 2026-04-19 this would have silently classified as LUX_17 (deductible).',
  },

  // ═════════════════════ Group 14 — Credit intermediation (RULE 36, Versãofast T-657/24) ═════════════════════
  // 26 November 2025 — GC materially widened the Art. 135(1)(b) /
  // Art. 44§1 (a) LTVA safe harbour for credit intermediaries. The
  // following fixtures exercise LU / EU / non-EU routing and the
  // Ludwig C-453/05 sub-agent chain extension.
  {
    id: 'F072',
    title: 'LU mortgage broker invoices a LU active holding (no VAT) → RULE 36 LUX_00',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24 + LTVA Art. 44§1 (a)',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LUX Mortgage Brokers SARL',
      description: 'Courtage de prêt immobilier — recherche client + dossier de crédit',
      vat_rate: 0, vat_applied: 0, amount_eur: 8500,
    },
    expected: { treatment: 'LUX_00', rule: 'RULE 36', flag: true, flag_includes: 'Versãofast' },
    notes: 'LU supplier, credit intermediation keyword matched. Exempt under Art. 44§1 (a) post-Versãofast.',
  },
  {
    id: 'F073',
    title: 'Portuguese loan broker to LU fund → RULE 36 RC_EU_EX',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24 (GC 2025-11-26)',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'PT',
      supplier_name: 'Versãofast Mediação de Crédito Lda',
      description: 'Mediação de crédito — angariação de clientes para contrato de mútuo',
      vat_rate: null, vat_applied: 0, amount_eur: 22000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 36', flag: true, flag_includes: 'Versãofast' },
    notes: 'The canonical Versãofast case — Portuguese credit intermediary, EU supplier.',
  },
  {
    id: 'F074',
    title: 'UK non-EU mortgage broker to LU fund → RULE 36 RC_NONEU_EX',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24; LTVA Art. 49§2 non-EU exception',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'GB',
      supplier_name: 'London Mortgage Brokers Ltd',
      description: 'Home loan broker — customer search and credit application assistance',
      vat_rate: null, vat_applied: 0, amount_eur: 35000,
    },
    expected: { treatment: 'RC_NONEU_EX', rule: 'RULE 36', flag: true, flag_includes: 'Versãofast' },
    notes: 'Art. 49§2 non-EU exception allows the LU recipient to deduct input VAT on related costs if it has Art. 44§1(a) outgoing.',
  },
  {
    id: 'F075',
    title: 'French courtier en crédit to LU active holding → RULE 36 RC_EU_EX',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Paris Courtage Financier SAS',
      description: 'Intermédiation de crédit immobilier — apporteur d\'affaires bancaire',
      vat_rate: null, vat_applied: 0, amount_eur: 15000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 36', flag: true },
  },
  {
    id: 'F076',
    title: 'German Kreditvermittler to LU SV → RULE 36 RC_EU_EX',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      supplier_name: 'München Kreditvermittlung GmbH',
      description: 'Kreditvermittlung für gewerbliche Finanzierung — Darlehensvermittlung',
      vat_rate: null, vat_applied: 0, amount_eur: 18000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 36', flag: true },
    notes: 'German credit intermediation to a LU securitisation vehicle — exempt via Versãofast.',
  },
  {
    id: 'F077',
    title: 'Sub-agent chain: placement agent for private debt → RULE 36 RC_EU_EX (Ludwig extension)',
    archetype: 'credit_intermediary',
    legal_ref: 'Ludwig C-453/05 sub-agent extension + Versãofast T-657/24',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'IE',
      supplier_name: 'Dublin Private Debt Placement DAC',
      description: 'Private-debt placement services — sourcing institutional lenders',
      vat_rate: null, vat_applied: 0, amount_eur: 45000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 36', flag: true, flag_includes: 'Ludwig' },
  },
  {
    id: 'F078',
    title: 'Pure marketing / advertising to a bank — NOT credit intermediation → falls through',
    archetype: 'marketing',
    legal_ref: 'CSC Financial C-235/00 — negotiation not mere information',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      supplier_name: 'Berlin Marketing GmbH',
      description: 'Marketing campaign — digital brand promotion for financial service providers',
      vat_rate: null, vat_applied: 0, amount_eur: 15000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 11' },
    notes: 'Counter-example: no credit-intermediation keyword in description, RULE 36 does not fire, falls to generic RC. Description avoids GOODS_KEYWORDS (e.g. German "waren" substring inside "awareness").',
  },
  {
    id: 'F079',
    title: 'Credit broker VAT mistakenly charged → RULE 36 does NOT fire, direct-evidence wins',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24 + RULE 36 guard on vat_applied',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LUX Credit Broker SARL',
      description: 'Mortgage broker fee for home-loan intermediation',
      vat_rate: 0.17, vat_applied: 1275, amount_eur: 7500,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 1' },
    notes: 'VAT was mistakenly charged — RULE 36 only fires when vat_applied is zero (exempt = zero-rated). Reviewer can override after obtaining a corrected invoice.',
  },

  // ═════════════════════ Group 15 — Securitisation vehicle (new entity_type) ═════════════════════
  // SVs are taxable persons; management services received are exempt
  // Art. 44§1 d via Fiscale Eenheid X C-595/13. Servicer agreements need
  // per-Aspiro-C-40/15 split review.
  {
    id: 'F080',
    title: 'SV receives EU management fee with Art. 44 → RULE 10 RC_EU_EX (SV-specific reason)',
    archetype: 'fund_admin',
    legal_ref: 'Fiscale Eenheid X C-595/13 + Loi du 22 mars 2004 modifiée 2022',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'NL',
      supplier_name: 'Amsterdam Asset Management BV',
      description: 'Fund management services Q1 — exempt under Article 44',
      vat_rate: null, vat_applied: 0, amount_eur: 40000,
    },
    expected: {
      treatment: 'RC_EU_EX', rule: 'RULE 10',
      reason_includes: 'securitisation vehicle',
    },
  },
  {
    id: 'F081',
    title: 'SV receives EU advisory without explicit Art. 44 → INFERENCE C RC_EU_EX',
    archetype: 'cross_border_advisor',
    legal_ref: 'BlackRock C-231/19 + Fiscale Eenheid X C-595/13',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'IE',
      supplier_name: 'Dublin Portfolio Advisors DAC',
      description: 'Portfolio management services — collateral management and investment decisions',
      vat_rate: null, vat_applied: 0, amount_eur: 55000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'INFERENCE C', flag: true },
    notes: 'SV qualifies alongside fund under isQualifyingForArt44D — INFERENCE C fires.',
  },
  {
    id: 'F082',
    title: 'SV servicer agreement (LU) → RULE 37 flag, no auto-classification',
    archetype: 'sv_servicer',
    legal_ref: 'Aspiro C-40/15 + PRAC_SV_SERVICER_SPLIT',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LUX Servicing Agent SA',
      description: 'Master servicer fee — collection services and delinquency management for underlying receivables',
      vat_rate: null, vat_applied: 0, amount_eur: 30000,
    },
    expected: { treatment: null, rule: 'RULE 37', flag: true, flag_includes: 'Aspiro' },
  },
  {
    id: 'F083',
    title: 'SV servicer agreement (EU) — debt collection component → RULE 37 flag',
    archetype: 'sv_servicer',
    legal_ref: 'Aspiro C-40/15',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Paris Recouvrement SA',
      description: 'Convention de servicing — recouvrement de créances et gestion des impayés',
      vat_rate: null, vat_applied: 0, amount_eur: 28000,
    },
    expected: { treatment: null, rule: 'RULE 37', flag: true, flag_includes: 'apportionment' },
  },
  {
    id: 'F084',
    title: 'SV receives "portfolio servicing" from non-EU → RULE 37 flag (mixed)',
    archetype: 'sv_servicer',
    legal_ref: 'Aspiro C-40/15',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'US',
      supplier_name: 'Delaware Portfolio Servicing LLC',
      description: 'Portfolio servicing and loan recovery services',
      vat_rate: null, vat_applied: 0, amount_eur: 42000,
    },
    expected: { treatment: null, rule: 'RULE 37', flag: true },
  },
  {
    id: 'F085',
    title: 'SV receives NAV calculation (pure admin, no servicer keyword) → RULE 10 RC_EU_EX',
    archetype: 'fund_admin',
    legal_ref: 'DBKAG C-58/20 + Fiscale Eenheid X C-595/13',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'IE',
      supplier_name: 'Dublin Fund Admin DAC',
      description: 'NAV calculation and calcul de la vni — monthly valuation; exempt Article 44 paragraphe 1er lettre d',
      vat_rate: null, vat_applied: 0, amount_eur: 15000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 10' },
  },

  // ═════════════════════ Group 16 — BlackRock single-supply rule ═════════════════════
  // Per BlackRock C-231/19, a single supply to an AIFM managing BOTH
  // qualifying funds AND non-qualifying entities (SOPARFIs) is ENTIRELY
  // taxable. The exemption is indivisible.
  {
    id: 'F086',
    title: 'ManCo (mixed book) receives SaaS platform → taxable, entity_type=manco (RULE 10X route)',
    archetype: 'platform',
    legal_ref: 'BlackRock C-231/19 — single supply not partially exempt',
    context: MANCO_CTX,
    input: {
      direction: 'incoming', country: 'US',
      supplier_name: 'BlackRock Solutions Inc',
      description: 'Aladdin platform licence — portfolio management services exempt under Article 135',
      vat_rate: null, vat_applied: 0, amount_eur: 250000,
    },
    expected: { treatment: 'RC_NONEU_TAX', rule: 'RULE 12X', flag: true, flag_includes: 'qualifying special investment fund' },
    notes: 'The canonical BlackRock scenario. ManCo is not a qualifying fund — the supply is entirely taxable even though it mentions Art. 135.',
  },
  {
    id: 'F087',
    title: 'Mixed-book AIFM (manco) receives EU management services → RULE 10X taxable',
    archetype: 'cross_border_advisor',
    legal_ref: 'BlackRock C-231/19',
    context: MANCO_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      supplier_name: 'Frankfurt AM GmbH',
      description: 'Delegated portfolio management under AIFMD — exempt Art. 44 d',
      vat_rate: null, vat_applied: 0, amount_eur: 85000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 10X', flag: true },
    notes: 'Manco is the AIFM itself, not a fund. Incoming management = taxable.',
  },

  // ═════════════════════ Group 17 — Art. 56bis explicit margin-scheme ═════════════════════
  {
    id: 'F088',
    title: 'Travel agency margin-scheme invoice → RULE 24 MARGIN_NONDED',
    archetype: 'travel',
    legal_ref: 'LTVA Art. 56bis + Dir. Art. 311-325',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Paris Travel Agency SAS',
      description: 'Voyage affaires — régime de la marge Art. 56bis',
      vat_rate: null, vat_applied: 0, amount_eur: 3200,
    },
    expected: { treatment: 'MARGIN_NONDED', rule: 'RULE 24', flag: true },
  },
  {
    id: 'F089',
    title: 'Second-hand dealer margin invoice (German) → RULE 24 MARGIN_NONDED',
    archetype: 'second_hand',
    legal_ref: 'LTVA Art. 56bis',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      supplier_name: 'Berlin Gebrauchtwagen GmbH',
      description: 'Used equipment purchase — Sonderregelung für Reisebüros — no VAT separated',
      vat_rate: null, vat_applied: 0, amount_eur: 18000,
    },
    expected: { treatment: 'MARGIN_NONDED', rule: 'RULE 24', flag: true },
  },

  // ═════════════════════ Group 18 — Passive holding + credit intermediation edge case ═════════════════════
  {
    id: 'F090',
    title: 'Passive holding receives mortgage broker fee (EU) → RULE 36 still exempt (zero-rated)',
    archetype: 'credit_intermediary',
    legal_ref: 'Versãofast T-657/24 — exempt regardless of recipient status',
    context: PASSIVE_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Paris Courtage SAS',
      description: 'Intermédiation de crédit — recherche de financement pour acquisition',
      vat_rate: null, vat_applied: 0, amount_eur: 12000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 36', flag: true },
    notes: 'A passive holding receiving an exempt intermediation service has no VAT impact either way (Polysar = non-taxable, Art. 44§1(a) = exempt). RULE 36 wins on content-specific priority; the economic result is the same as RULE 11P.',
  },

  // ═════════════════════ Group 19 — Wheels / DB pension fund non-qualifying ═════════════════════
  {
    id: 'F091',
    title: 'DB pension vehicle treated as entity_type=other → no fund exemption, taxable',
    archetype: 'pension',
    legal_ref: 'Wheels C-424/11 — DB pension not comparable to UCITS',
    context: { entity_type: 'other', exempt_outgoing_total: 0 },
    input: {
      direction: 'incoming', country: 'DE',
      supplier_name: 'Frankfurt Pension Consulting GmbH',
      description: 'Investment management services — fund management for DB scheme exempt under Art. 44',
      vat_rate: null, vat_applied: 0, amount_eur: 48000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 10X', flag: true },
    notes: 'A DB pension vehicle does NOT qualify (Wheels). Reviewer should classify as entity_type=other and the classifier refuses auto-exemption.',
  },

  // ═════════════════════ Group 20 — VAT group intra-supply (reinforcement) ═════════════════════
  {
    id: 'F092',
    title: 'VAT group LU intra-supply, no VAT → RULE 20 VAT_GROUP_OUT',
    archetype: 'vat_group_intra',
    legal_ref: 'LTVA Art. 60ter + Finanzamt T II C-184/23',
    context: { entity_type: 'active_holding', vat_group_id: 'LUGRP12345' },
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Lux Group Services SA',
      description: 'Intra-group administrative services Q2',
      vat_rate: null, vat_applied: 0, amount_eur: 95000,
    },
    expected: { treatment: 'VAT_GROUP_OUT', rule: 'RULE 20', flag: true },
  },

  // ═════════════════════ Group 21 — IGP extended to SV entity ═════════════════════
  {
    id: 'F093',
    title: 'LU-to-LU IGP to SV entity → RULE 35-lu (financial-sector exclusion extended to SV)',
    archetype: 'igp',
    legal_ref: 'DNB Banka C-326/15 + Aviva C-605/15 extended to SV',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LuxShared Services SCS',
      description: 'Cost-pooling allocation — IGP Art. 132(1)(f)',
      vat_rate: 0.17, vat_applied: 4250, amount_eur: 25000,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 35-lu', flag: true, flag_includes: 'DNB' },
    notes: 'SV is classified as financial-sector for the IGP exclusion per DNB Banka / Aviva logic.',
  },

  // ═════════════════════ Group 22 — Credit intermediation explicit LU with Art. 44 ═════════════════════
  {
    id: 'F094',
    title: 'Explicit Art. 44§1 a on an LU intermediation invoice → RULE 7A wins (direct evidence)',
    archetype: 'credit_intermediary',
    legal_ref: 'LTVA Art. 44§1 a (extractor-captured reference)',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LUX Mortgage Brokers SARL',
      description: 'Credit intermediation fee — exempt',
      exemption_reference: 'Art. 44 § 1 a LTVA',
      vat_rate: 0, vat_applied: 0, amount_eur: 6000,
    },
    expected: { treatment: 'EXEMPT_44A_FIN', rule: 'RULE 7A' },
    notes: 'When the extractor captures the explicit Art. 44§1 a reference, RULE 7A (direct evidence) wins over RULE 36 (content-specific keyword) because direct evidence has higher priority within the direct-evidence rules. The outcome is economically equivalent.',
  },

  // ═════════════════════ Group 23 — Platform deemed supplier (Fenix) clean-room test ═════════════════════
  {
    id: 'F095',
    title: 'Platform deemed supplier invoice → RULE 22 PLATFORM_DEEMED',
    archetype: 'platform',
    legal_ref: 'Fenix C-695/20 + Art. 9a Reg. 282/2011',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'IE',
      supplier_name: 'Dublin Marketplace DAC',
      description: 'Marketplace facilitator fee — Art. 9a deemed supplier for electronic services',
      vat_rate: null, vat_applied: 0, amount_eur: 5000,
    },
    expected: { treatment: 'PLATFORM_DEEMED', rule: 'RULE 22', flag: true, flag_includes: 'Art. 9a' },
    notes: 'Verifies RULE 22 still fires after the Versãofast misattribution fix — platform-economy keyword path, Fenix C-695/20.',
  },

  // ═════════════════════ Group 24 — Corpus expansion 2026-04-21 ═════════════════════
  // Borderline cases tightening coverage across rule boundaries where
  // the classifier has historically been silent. Each fixture was
  // added because a live reviewer call-out surfaced the gap.

  {
    id: 'F096',
    title: 'Construction subcontract mistakenly VAT-charged (LU domestic) → RULE 1 LUX_17 (not RC_LUX_CONSTR_17)',
    archetype: 'construction',
    legal_ref: 'Art. 61§2 c LTVA — domestic RC triggers only when VAT not applied',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LUX Construction SARL',
      description: 'Rénovation de bureaux — travaux de construction',
      vat_rate: 0.17, vat_applied: 4250, amount_eur: 25000,
    },
    expected: { treatment: 'LUX_17', rule: 'RULE 1' },
    notes: 'Regression guard: RULE 25 (domestic construction RC) must NOT fire when the supplier actually charged VAT — the reviewer has to seek a corrected invoice.',
  },
  {
    id: 'F097',
    title: 'Hotel accommodation 17% LU (Art. 54 non-deductible) → RULE 29 LUX_17_NONDED',
    archetype: 'travel',
    legal_ref: 'LTVA Art. 54 — restrictions on input VAT deduction',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Grand Hotel Luxembourg SA',
      description: 'Hotel accommodation for board meeting — overnight stays',
      vat_rate: 0.17, vat_applied: 170, amount_eur: 1000,
    },
    expected: { treatment: 'LUX_17_NONDED', rule: 'RULE 29', flag: true },
    notes: 'Input VAT on hotel stays is non-deductible per Art. 54 LTVA. Must land in box 087, not 085.',
  },
  {
    id: 'F098',
    title: 'Scrap metal domestic RC (Art. 61§2 a LTVA / Art. 199a Directive) → RULE 26',
    archetype: 'scrap',
    legal_ref: 'Art. 199a Directive quick-reaction mechanism',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'LuxScrap Récupération SA',
      description: 'Récupération de ferraille industrielle — livraison mensuelle',
      vat_rate: null, vat_applied: 0, amount_eur: 8500,
    },
    expected: { treatment: 'RC_LUX_SPEC_17', rule: 'RULE 26' },
  },
  {
    id: 'F099',
    title: 'Art. 57 LU franchise supplier → RULE 23 LUX_00 (no VAT, no deduction)',
    archetype: 'franchise',
    legal_ref: 'LTVA Art. 57 + Directive 2020/285',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Petit Artisan LU SARL-S',
      description: 'Consulting services — régime de la franchise Art. 57',
      vat_rate: 0, vat_applied: 0, amount_eur: 3500,
    },
    expected: { treatment: 'LUX_00', rule: 'RULE 23' },
    notes: 'Art. 57 franchise-threshold suppliers issue no VAT invoices; the recipient has no deduction right.',
  },
  {
    id: 'F100',
    title: 'Credit intermediation sub-agent chain (Ludwig) — FR sub-broker → LU master-broker',
    archetype: 'credit_intermediary',
    legal_ref: 'Ludwig C-453/05 + Versãofast T-657/24',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'FR',
      supplier_name: 'Sub-Agent Crédit Paris SAS',
      description: 'Sous-agent de crédit — apporteur d\'affaires pour un master-broker luxembourgeois',
      vat_rate: null, vat_applied: 0, amount_eur: 6200,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 36', flag: true, flag_includes: 'Ludwig' },
    notes: 'Ludwig C-453/05 sub-agent extension — exemption travels through the chain.',
  },
  {
    id: 'F101',
    title: 'VAT group branch outside the group (Danske Bank C-812/19) → reverse-charge taxable',
    archetype: 'vat_group_cross_border',
    legal_ref: 'Skandia C-7/13 + Danske Bank C-812/19',
    context: { entity_type: 'active_holding', vat_group_id: 'LUGRP12345' },
    input: {
      direction: 'incoming', country: 'SE',
      supplier_name: 'Stockholm HQ AB',
      description: 'Intra-group advisory services from parent HQ outside the LU VAT group',
      vat_rate: null, vat_applied: 0, amount_eur: 45000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 11' },
    notes: 'Classifier regression guard: RULE 20 (VAT group out-of-scope) must NOT fire when the supplier is on a different VAT-person side (Skandia / Danske Bank). Falls through to standard RC.',
  },
  {
    id: 'F102',
    title: 'Fund entity receives IT consulting (FUND_MGMT_EXCLUSION keyword) → taxable backstop',
    archetype: 'it',
    legal_ref: 'BlackRock C-231/19 — SaaS / consulting not specific-and-essential',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'DE',
      supplier_name: 'Berlin IT Consulting GmbH',
      description: 'IT support and hosting for the fund\'s back-office platform — cloud services',
      vat_rate: null, vat_applied: 0, amount_eur: 25000,
    },
    expected: { treatment: 'RC_EU_TAX', rule: 'RULE 11' },
    notes: 'Even for a qualifying fund, IT / hosting / SaaS are not within Art. 44§1 d (BlackRock). INFERENCE C is cancelled by FUND_MGMT_EXCLUSION_KEYWORDS; falls to generic RC.',
  },
  {
    id: 'F103',
    title: 'Outgoing real-estate 17% with Art. 45 opt-in reference → RULE 15A OUT_LUX_17_OPT',
    archetype: 'real_estate',
    legal_ref: 'LTVA Art. 45 — option to tax real-estate letting',
    context: HOLDING_CTX,
    input: {
      direction: 'outgoing', country: 'LU',
      customer_country: 'LU', customer_vat: 'LU87654321',
      description: 'Quarterly office rent with option to tax under Art. 45 LTVA',
      exemption_reference: 'Art. 45 LTVA — option pour la taxation',
      vat_rate: 0.17, vat_applied: 5100, amount_eur: 30000,
    },
    expected: { treatment: 'OUT_LUX_17_OPT', rule: 'RULE 15A' },
  },
  {
    id: 'F104',
    title: 'SV servicer with pure cash-flow admin (no debt-collection keyword) → RULE 10 RC_EU_EX',
    archetype: 'sv_admin',
    legal_ref: 'Fiscale Eenheid X C-595/13 — management exemption for SV',
    context: SV_CTX,
    input: {
      direction: 'incoming', country: 'NL',
      supplier_name: 'Amsterdam SV Admin BV',
      description: 'Cash-flow administration and reporting for compartment 1 — fund administration services exempt Art. 44§1 d',
      vat_rate: null, vat_applied: 0, amount_eur: 18000,
    },
    expected: { treatment: 'RC_EU_EX', rule: 'RULE 10' },
    notes: 'SV pure admin (no "debt collection" / "recovery" / "enforcement" / "servicing agreement" language) → exempt. Contrasts with F082-F084 which include the SECURITIZATION_SERVICER_KEYWORDS trigger and flag for split.',
  },
  {
    id: 'F105',
    title: 'EU supplier mistakenly charges foreign VAT on services → NO_MATCH, flag for reviewer',
    archetype: 'cross_border_advisor',
    legal_ref: 'Art. 44 / 196 Directive — customer reverse-charges, supplier should issue no VAT',
    context: HOLDING_CTX,
    input: {
      direction: 'incoming', country: 'BE',
      supplier_name: 'Brussels Advisory SPRL',
      description: 'Strategic consulting Q2 — generic business advisory',
      vat_rate: 0.21, vat_applied: 4200, amount_eur: 20000,
    },
    expected: { treatment: null, rule: 'NO_MATCH', flag: true },
    notes: 'Edge case: EU supplier erroneously charged 21% BE VAT on a reverse-charge service. The classifier correctly returns NO_MATCH — no direct-evidence rule fits (not LU rate, not IC goods, not RC at zero VAT, not Art. 44 reference). Reviewer must recognise the anomaly and either seek a corrected invoice (remove BE VAT, reverse-charge at LU 17%) or absorb the non-recoverable foreign VAT. Follow-up on backlog: add a dedicated RULE 11X for "EU supplier charged foreign VAT on a service" mirror of RULE 17X for goods.',
  },
  {
    id: 'F106',
    title: 'EU supplier mistakenly charged foreign VAT on fund mgmt → NO_MATCH, flag for reviewer',
    archetype: 'fund_admin',
    legal_ref: 'Art. 196 Directive — recipient reverse-charges; supplier must issue no VAT',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'IE',
      supplier_name: 'Dublin Fund Admin DAC',
      description: 'Fund administration services Q3 — exempt Article 44§1 d',
      vat_rate: 0.23, vat_applied: 11500, amount_eur: 50000,
    },
    expected: { treatment: null, rule: 'NO_MATCH', flag: true },
    notes: 'Same pattern as F105: IE supplier erroneously charged 23% IE VAT on a service for a LU fund. NO_MATCH is the safe behavior — none of the RC rules fire because vat_applied≠0. Reviewer seeks a corrected invoice or overrides manually.',
  },
  {
    id: 'F107',
    title: 'Carry payment to service-GP (nominal commitment) — flagged for reviewer reclassification',
    archetype: 'carry_service_gp',
    legal_ref: 'PRAC_CARRY_INTEREST Case B + BlackRock exclusion of performance-fee-as-management',
    context: FUND_CTX,
    input: {
      direction: 'incoming', country: 'LU',
      supplier_name: 'Service GP SARL',
      description: 'Carried interest tranche — performance allocation for Q4',
      vat_rate: null, vat_applied: 0, amount_eur: 180000,
    },
    expected: { treatment: 'OUT_SCOPE', rule: 'RULE 33', flag: true, flag_includes: 'substance' },
    notes: 'Classifier always defaults carry to OUT_SCOPE (investor-GP) and flags. The reviewer inspects the LPA: if the GP has nominal (e.g. €1) commitment — Case B — they re-classify as LUX_17 / EXEMPT_44 per the substance test.',
  },
];
