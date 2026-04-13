// eCDF Box Mapping per PRD Section 5.2-5.3
// Defines how each eCDF box is computed from invoice_lines

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

// Simplified Return boxes
export const SIMPLIFIED_BOXES: BoxDefinition[] = [
  // Section A - Overall turnover
  { box: '012', label: 'Turnover exempt under Art. 44', section: 'A', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_LUX_00'], field: 'amount_eur' } },
  { box: '423', label: 'Supply of services to EU customers', section: 'A', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_EU_RC'], field: 'amount_eur' } },
  { box: '450', label: 'Total supply to EU customers', section: 'A', computation: 'formula',
    formula: '423' },

  // Section B - Intra-Community acquisitions
  { box: '051', label: 'IC acquisitions of goods', section: 'B', computation: 'sum',
    filter: { treatments: ['IC_ACQ'], field: 'amount_eur' } },
  { box: '056', label: 'VAT on IC acquisitions (17%)', section: 'B', computation: 'formula',
    formula: '051 * 0.17' },
  { box: '711', label: 'IC acquisitions breakdown (17%)', section: 'B', computation: 'formula',
    formula: '051' },
  { box: '712', label: 'VAT on IC acquisitions breakdown', section: 'B', computation: 'formula',
    formula: '056' },

  // Section D - Reverse charge
  // D.1 EU suppliers
  { box: '436', label: 'RC EU taxable services', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_EU_TAX'], field: 'amount_eur' } },
  { box: '462', label: 'VAT on RC EU taxable (17%)', section: 'D', computation: 'formula',
    formula: '436 * 0.17' },
  { box: '741', label: 'RC EU taxable breakdown (17%)', section: 'D', computation: 'formula',
    formula: '436' },
  { box: '742', label: 'VAT on RC EU taxable breakdown', section: 'D', computation: 'formula',
    formula: '462' },
  { box: '435', label: 'RC EU exempt services', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_EU_EX', 'EXEMPT_44'], field: 'amount_eur' } },

  // D.2 Non-EU suppliers
  { box: '463', label: 'RC non-EU taxable services', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_NONEU_TAX'], field: 'amount_eur' } },
  { box: '464', label: 'VAT on RC non-EU taxable (17%)', section: 'D', computation: 'formula',
    formula: '463 * 0.17' },
  { box: '751', label: 'RC non-EU taxable breakdown (17%)', section: 'D', computation: 'formula',
    formula: '463' },
  { box: '752', label: 'VAT on RC non-EU taxable breakdown', section: 'D', computation: 'formula',
    formula: '464' },
  { box: '445', label: 'RC non-EU exempt services', section: 'D', computation: 'sum',
    filter: { treatments: ['RC_NONEU_EX'], field: 'amount_eur' } },

  // D totals
  { box: '409', label: 'Total RC taxable base', section: 'D', computation: 'formula',
    formula: '436 + 435 + 463 + 445' },
  { box: '410', label: 'Total RC VAT due', section: 'D', computation: 'formula',
    formula: '462 + 464' },

  // Section F - Total tax due
  { box: '076', label: 'Total VAT due (simplified)', section: 'F', computation: 'formula',
    formula: '056 + 410' },
];

// Additional boxes for Ordinary Return
export const ORDINARY_ADDITIONAL_BOXES: BoxDefinition[] = [
  // Section I - Turnover and output VAT
  { box: '701', label: 'Taxable turnover at 17%', section: 'I', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_LUX_17'], field: 'amount_eur' } },
  { box: '046', label: 'Output VAT (17%)', section: 'I', computation: 'formula',
    formula: '701 * 0.17' },
  { box: '016', label: 'Exempt turnover', section: 'I', computation: 'sum',
    filter: { direction: 'outgoing', treatments: ['OUT_LUX_00'], field: 'amount_eur' } },
  { box: '022', label: 'Total turnover', section: 'I', computation: 'formula',
    formula: '701 + 016' },

  // Section III - Input VAT deduction
  { box: '085', label: 'Lux input VAT invoiced', section: 'III', computation: 'sum',
    filter: { direction: 'incoming', field: 'vat_applied' } },
  { box: '458', label: 'Total Lux VAT invoiced', section: 'III', computation: 'formula',
    formula: '085' },
  { box: '093', label: 'Deductible input VAT', section: 'III', computation: 'manual' },
  { box: '095', label: 'Pro-rata percentage', section: 'III', computation: 'manual' },

  // Section IV - Net position
  { box: '097', label: 'Net VAT due', section: 'IV', computation: 'formula',
    formula: '046 + 056 + 410 - 093' },
  { box: '102', label: 'Payment due', section: 'IV', computation: 'formula',
    formula: 'MAX(097, 0)' },
  { box: '103', label: 'Credit', section: 'IV', computation: 'formula',
    formula: 'MAX(-097, 0)' },
];
