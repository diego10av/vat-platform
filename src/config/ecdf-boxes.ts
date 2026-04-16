// eCDF Box Mapping per PRD Section 5.2-5.3.
//
// Each treatment code defined in src/config/treatment-codes.ts must route
// to at least one box below. If you add a treatment and forget to wire it
// here, the amount silently disappears from the return — so every new
// treatment MUST be added to one of the "treatments" arrays below.
//
// The box numbers follow the canonical TVA001N (simplified) and TVA002NA
// (ordinary) AED form layouts. When the AED publishes a new form version,
// update the SUSPECT lines flagged with TODO(form-version).

export type BoxDefinition = {
  box: string;
  label: string;
  computation: 'sum' | 'formula' | 'manual';
  // For 'sum': filter criteria
  filter?: {
    direction?: 'incoming' | 'outgoing';
    treatments?: string[];
    field?: 'amount_eur' | 'vat_applied' | 'rc_amount';
  };
  // For 'formula': reference other boxes
  formula?: string;
  section: string;
};

// Simplified Return boxes (TVA001N)
export const SIMPLIFIED_BOXES: BoxDefinition[] = [
  // ──────────────── Section A — Turnover (outgoing) ────────────────
  { box: '012', label: 'Turnover exempt under Art. 44', section: 'A', computation: 'sum',
    filter: { direction: 'outgoing',
              // Any outgoing Art. 44-type exempt supply
              treatments: ['OUT_LUX_00'],
              field: 'amount_eur' } },
  // Box 014: non-EU customer supplies (outside LU VAT scope).
  // TODO(form-version): confirm box id on the latest TVA001N.
  { box: '014', label: 'Outgoing to non-EU (out of scope)', section: 'A', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_NONEU'], field: 'amount_eur' } },
  { box: '423', label: 'Supply of services to EU customers (B2B RC)', section: 'A', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_EU_RC'], field: 'amount_eur' } },
  // IC supply of goods (box 424 on TVA001N; keep labelled explicitly).
  { box: '424', label: 'Intra-Community supply of goods', section: 'A', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_IC_GOODS', 'OUT_LU_TRIANG'], field: 'amount_eur' } },
  { box: '450', label: 'Total supply to EU customers', section: 'A', computation: 'formula',
    formula: '423 + 424' },

  // ──────────────── Section B — Intra-Community acquisitions ────────────────
  { box: '051', label: 'IC acquisitions of goods (all rates)', section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ', 'IC_ACQ_17', 'IC_ACQ_14', 'IC_ACQ_08', 'IC_ACQ_03'], field: 'amount_eur' } },
  { box: '711', label: 'IC acquisitions at 17%', section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ_17'], field: 'amount_eur' } },
  { box: '713', label: 'IC acquisitions at 14%', section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ_14'], field: 'amount_eur' } },
  { box: '715', label: 'IC acquisitions at 8%',  section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ_08'], field: 'amount_eur' } },
  { box: '717', label: 'IC acquisitions at 3%',  section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ_03'], field: 'amount_eur' } },
  // Box 056: VAT on IC acquisitions — sum of the self-assessed rc_amount
  // rather than 051 × 0.17 so rates 3/8/14/17 all flow through.
  { box: '056', label: 'VAT on IC acquisitions', section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ', 'IC_ACQ_17', 'IC_ACQ_14', 'IC_ACQ_08', 'IC_ACQ_03'], field: 'rc_amount' } },
  { box: '712', label: 'VAT on IC acquisitions (breakdown)', section: 'B', computation: 'formula',
    formula: '056' },

  // ──────────────── Section C — Import VAT ────────────────
  // Box 075 = base of imported goods; box 077 = import VAT paid at customs.
  // TODO(form-version): confirm exact box ids and placement on TVA001N/TVA002NA.
  { box: '075', label: 'Import of goods (base)', section: 'C', computation: 'sum',
    filter: { treatments: ['IMPORT_VAT'], field: 'amount_eur' } },
  { box: '077', label: 'Import VAT paid at customs', section: 'C', computation: 'sum',
    filter: { treatments: ['IMPORT_VAT'], field: 'vat_applied' } },

  // ──────────────── Section D — Reverse charge on services ────────────────
  // D.1 — EU suppliers
  { box: '436', label: 'RC EU taxable services (base)', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_EU_TAX'], field: 'amount_eur' } },
  { box: '462', label: 'VAT on RC EU taxable (17%)', section: 'D', computation: 'formula',
    formula: '436 * 0.17' },
  { box: '741', label: 'RC EU taxable breakdown (17%)', section: 'D', computation: 'formula',
    formula: '436' },
  { box: '742', label: 'VAT on RC EU taxable breakdown', section: 'D', computation: 'formula',
    formula: '462' },
  { box: '435', label: 'RC EU exempt services (base)', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_EU_EX', 'EXEMPT_44', 'EXEMPT_44A_FIN'], field: 'amount_eur' } },

  // D.2 — Non-EU suppliers
  { box: '463', label: 'RC non-EU taxable services (base)', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_NONEU_TAX'], field: 'amount_eur' } },
  { box: '464', label: 'VAT on RC non-EU taxable (17%)', section: 'D', computation: 'formula',
    formula: '463 * 0.17' },
  { box: '751', label: 'RC non-EU taxable breakdown (17%)', section: 'D', computation: 'formula',
    formula: '463' },
  { box: '752', label: 'VAT on RC non-EU taxable breakdown', section: 'D', computation: 'formula',
    formula: '464' },
  { box: '445', label: 'RC non-EU exempt services (base)', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_NONEU_EX'], field: 'amount_eur' } },

  // D totals — taxable RC base and total RC VAT due
  { box: '409', label: 'Total RC taxable base', section: 'D', computation: 'formula',
    formula: '436 + 463' },
  { box: '410', label: 'Total RC VAT due', section: 'D', computation: 'formula',
    formula: '462 + 464' },

  // ──────────────── Section E — Autolivraison / self-supply ────────────────
  // Self-supply is declared as both output VAT (box 044) and deductible
  // input VAT (box 093 via the ordinary return); the amount_eur is the
  // base and vat_applied the VAT charged to self.
  // TODO(form-version): confirm box ids on TVA001N.
  { box: '044', label: 'Autolivraison base (17%)', section: 'E', computation: 'sum',
    filter: { treatments: ['AUTOLIV_17'], field: 'amount_eur' } },
  { box: '045', label: 'Autolivraison VAT (17%)', section: 'E', computation: 'formula',
    formula: '044 * 0.17' },

  // ──────────────── Section F — Total tax due ────────────────
  { box: '076', label: 'Total VAT due (simplified)', section: 'F', computation: 'formula',
    formula: '056 + 410 + 045 + 077' },
];

// Additional boxes for Ordinary Return (TVA002NA / NT / NM)
export const ORDINARY_ADDITIONAL_BOXES: BoxDefinition[] = [
  // ──────────────── Section I — Turnover and output VAT ────────────────
  { box: '701', label: 'Taxable turnover at 17%', section: 'I', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_LUX_17', 'OUT_LUX_17_OPT'], field: 'amount_eur' } },
  { box: '046', label: 'Output VAT (17%)', section: 'I', computation: 'formula',
    formula: '701 * 0.17' },
  { box: '016', label: 'Exempt turnover (Art. 44)', section: 'I', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_LUX_00'], field: 'amount_eur' } },
  { box: '022', label: 'Total turnover', section: 'I', computation: 'formula',
    formula: '701 + 016 + 014 + 423 + 424' },

  // ──────────────── Section III — Input VAT deduction ────────────────
  // Box 085 = LU VAT actually invoiced at 17/14/8/3 (excludes exempt and
  // non-deductible treatments — those go to box 086/087 on their own).
  { box: '085', label: 'Lux input VAT invoiced (deductible tier)', section: 'III', computation: 'sum',
    filter: { direction: 'incoming', treatments: ['LUX_17', 'LUX_14', 'LUX_08', 'LUX_03'], field: 'vat_applied' } },
  { box: '087', label: 'Lux input VAT invoiced (non-deductible tier)', section: 'III', computation: 'sum',
    filter: { direction: 'incoming', treatments: ['LUX_17_NONDED'], field: 'vat_applied' } },
  { box: '458', label: 'Total Lux VAT invoiced', section: 'III', computation: 'formula',
    formula: '085 + 087' },
  { box: '093', label: 'Deductible input VAT', section: 'III', computation: 'manual' },
  { box: '095', label: 'Pro-rata percentage', section: 'III', computation: 'manual' },

  // Bad-debt regularisation — negative or positive adjustment entered by
  // the reviewer. We sum the rc_amount (signed) of any BAD_DEBT_RELIEF
  // line so the tax professional can audit the figure in a single place.
  { box: '099', label: 'Bad-debt relief regularisation', section: 'III', computation: 'sum',
    filter: { treatments: ['BAD_DEBT_RELIEF'], field: 'rc_amount' } },

  // ──────────────── Section IV — Net position ────────────────
  { box: '097', label: 'Net VAT due', section: 'IV', computation: 'formula',
    formula: '046 + 056 + 410 + 045 + 077 - 093 - 099' },
  { box: '102', label: 'Payment due', section: 'IV', computation: 'formula',
    formula: 'MAX(097, 0)' },
  { box: '103', label: 'Credit', section: 'IV', computation: 'formula',
    formula: 'MAX(-097, 0)' },
];
