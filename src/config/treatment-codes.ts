// Treatment codes per PRD Section 5.1
export const TREATMENT_CODES = {
  // Incoming - Luxembourg suppliers
  LUX_17: { label: 'Luxembourg VAT 17%', direction: 'incoming', vatRate: 0.17, description: 'Luxembourg supplier, VAT at 17%' },
  LUX_14: { label: 'Luxembourg VAT 14%', direction: 'incoming', vatRate: 0.14, description: 'Luxembourg supplier, VAT at 14% (depositary)' },
  LUX_08: { label: 'Luxembourg VAT 8%', direction: 'incoming', vatRate: 0.08, description: 'Luxembourg supplier, VAT at 8% (certain services)' },
  LUX_03: { label: 'Luxembourg VAT 3%', direction: 'incoming', vatRate: 0.03, description: 'Luxembourg supplier, VAT at 3%' },
  LUX_00: { label: 'Luxembourg no VAT', direction: 'incoming', vatRate: 0, description: 'Luxembourg supplier, no VAT (rent, CSSF fee, notary duties)' },

  // Incoming - Reverse charge EU
  RC_EU_TAX: { label: 'RC EU Taxable', direction: 'incoming', vatRate: null, description: 'Reverse charge, EU supplier, taxable in Luxembourg' },
  RC_EU_EX: { label: 'RC EU Exempt', direction: 'incoming', vatRate: null, description: 'Reverse charge, EU supplier, exempt under Art. 44' },

  // Incoming - Reverse charge Non-EU
  RC_NONEU_TAX: { label: 'RC Non-EU Taxable', direction: 'incoming', vatRate: null, description: 'Reverse charge, non-EU supplier, taxable in Luxembourg' },
  RC_NONEU_EX: { label: 'RC Non-EU Exempt', direction: 'incoming', vatRate: null, description: 'Reverse charge, non-EU supplier, exempt under Art. 44' },

  // Incoming - Other
  IC_ACQ: { label: 'Intra-Community Acquisition', direction: 'incoming', vatRate: null, description: 'Intra-Community acquisition of goods (EU supplier)' },
  EXEMPT_44: { label: 'Exempt Art. 44', direction: 'incoming', vatRate: 0, description: 'Exempt under Art. 44(1)(d) fund management' },
  OUT_SCOPE: { label: 'Out of Scope', direction: 'incoming', vatRate: 0, description: 'Out of scope (CSSF subscription fee, stamp duty)' },

  // Outgoing
  OUT_LUX_00: { label: 'Outgoing Art. 44 Exempt', direction: 'outgoing', vatRate: 0, description: 'Outgoing, Art. 44 exempt (management fee to Lux fund)' },
  OUT_EU_RC: { label: 'Outgoing EU RC', direction: 'outgoing', vatRate: null, description: 'Outgoing, B2B to EU customer (customer accounts for VAT)' },
  OUT_LUX_17: { label: 'Outgoing Lux VAT 17%', direction: 'outgoing', vatRate: 0.17, description: 'Outgoing, Lux VAT at 17% (taxable management/consulting)' },
} as const;

export type TreatmentCode = keyof typeof TREATMENT_CODES;

export const INCOMING_TREATMENTS: TreatmentCode[] = [
  'LUX_17', 'LUX_14', 'LUX_08', 'LUX_03', 'LUX_00',
  'RC_EU_TAX', 'RC_EU_EX', 'RC_NONEU_TAX', 'RC_NONEU_EX',
  'IC_ACQ', 'EXEMPT_44', 'OUT_SCOPE',
];

export const OUTGOING_TREATMENTS: TreatmentCode[] = [
  'OUT_LUX_00', 'OUT_EU_RC', 'OUT_LUX_17',
];
