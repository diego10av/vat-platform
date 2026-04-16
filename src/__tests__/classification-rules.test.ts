// Benchmark tests for the deterministic classification engine.
//
// These cases come from the PRD reference scenarios (anonymised). Every time
// the rules engine is touched, run `npm test` to confirm the previously known
// classifications still produce the expected treatment + rule.
//
// Add new cases when:
//  - You correct a misclassification (capture the input + the right answer)
//  - A new legal position changes treatment for a class of invoices
//  - A new keyword is added to one of the dictionaries

import { describe, it, expect } from 'vitest';
import {
  classifyInvoiceLine,
  type EntityContext,
  type InvoiceLineInput,
} from '@/config/classification-rules';

const FUND_CTX: EntityContext = {
  entity_type: 'fund',
  exempt_outgoing_total: 1_500_000,
};
const HOLDING_CTX: EntityContext = {
  entity_type: 'active_holding',
  exempt_outgoing_total: 0,
};

function inv(overrides: Partial<InvoiceLineInput>): InvoiceLineInput {
  return {
    direction: 'incoming',
    country: 'LU',
    vat_rate: null,
    vat_applied: null,
    amount_eur: 1000,
    description: '',
    invoice_text: null,
    ...overrides,
  };
}

describe('Direct evidence rules (priority 2)', () => {
  it('RULE 1 — LU + 17% → LUX_17', () => {
    const r = classifyInvoiceLine(inv({ country: 'LU', vat_rate: 0.17 }));
    expect(r.treatment).toBe('LUX_17');
    expect(r.rule).toBe('RULE 1');
  });

  it('RULE 2 — LU + 14% → LUX_14 (depositary)', () => {
    const r = classifyInvoiceLine(inv({ country: 'LU', vat_rate: 0.14 }));
    expect(r.treatment).toBe('LUX_14');
    expect(r.rule).toBe('RULE 2');
  });

  it('RULE 3 — LU + 8% → LUX_08', () => {
    const r = classifyInvoiceLine(inv({ country: 'LU', vat_rate: 0.08 }));
    expect(r.treatment).toBe('LUX_08');
  });

  it('RULE 4 — LU + 3% → LUX_03', () => {
    const r = classifyInvoiceLine(inv({ country: 'LU', vat_rate: 0.03 }));
    expect(r.treatment).toBe('LUX_03');
  });

  it('RULE 5 — LU + null + "Office rent" → LUX_00 (Art 44§1 b)', () => {
    const r = classifyInvoiceLine(inv({ country: 'LU', description: 'Office rent Q1 2025' }));
    expect(r.treatment).toBe('LUX_00');
    expect(r.rule).toBe('RULE 5');
  });

  it('RULE 6 — LU + "Cotisation Chambre de Commerce" → OUT_SCOPE', () => {
    const r = classifyInvoiceLine(inv({
      country: 'LU',
      description: 'Cotisation minimale annuelle 2025 - Chambre de Commerce',
    }));
    expect(r.treatment).toBe('OUT_SCOPE');
    expect(r.rule).toBe('RULE 6');
  });

  it('RULE 6 — LU + "CSSF subscription fee" → OUT_SCOPE', () => {
    const r = classifyInvoiceLine(inv({
      country: 'LU',
      description: 'CSSF annual subscription fee',
    }));
    expect(r.treatment).toBe('OUT_SCOPE');
  });

  it('RULE 7 — LU + null + Art 44 in invoice text → EXEMPT_44', () => {
    const r = classifyInvoiceLine(inv({
      country: 'LU',
      description: 'Investment management services Q1',
      invoice_text: 'Invoice exempt under Article 44 LTVA',
    }));
    expect(r.treatment).toBe('EXEMPT_44');
    expect(r.rule).toBe('RULE 7');
  });

  it('RULE 8 — LU + null + no keyword → LUX_00 but FLAGGED for manual review', () => {
    // The treatment still defaults to LUX_00 so the amount lands in the
    // exempt/no-VAT bucket, but the line must carry flag=true because we
    // cannot identify the actual legal basis from the invoice alone
    // (could be Art. 44, franchise threshold, out-of-scope, missing VAT).
    const r = classifyInvoiceLine(inv({ country: 'LU', description: 'Annex IV reporting' }));
    expect(r.treatment).toBe('LUX_00');
    expect(r.rule).toBe('RULE 8');
    expect(r.flag).toBe(true);
    expect(r.flag_reason).toBeTruthy();
  });

  it('RULE 9 — EU + "goods", no readable rate → IC_ACQ (generic fallback)', () => {
    const r = classifyInvoiceLine(inv({
      country: 'BE', description: 'Purchase of office equipment goods',
    }));
    expect(r.treatment).toBe('IC_ACQ');
    expect(r.rule).toBe('RULE 9');
  });
});

// ════════════════ Batch 6 — new direct-evidence rules (16-19) ════════════════
describe('Batch 6 rules (16-19)', () => {
  // ─── RULE 16 — extractor-flagged disbursement ───
  it('RULE 16 — is_disbursement=true → DEBOURS, regardless of country / rate', () => {
    const r = classifyInvoiceLine(inv({
      country: 'LU', description: 'Notary — registration duties', is_disbursement: true,
    }));
    expect(r.treatment).toBe('DEBOURS');
    expect(r.rule).toBe('RULE 16');
  });

  it('RULE 16 beats a LU-17% VAT rate (extractor signal is authoritative)', () => {
    // A disbursement flag is stronger than a rate — some invoices print a
    // rate on every line but disbursements are out-of-scope.
    const r = classifyInvoiceLine(inv({
      country: 'LU', vat_rate: 0.17, description: 'Débours', is_disbursement: true,
    }));
    expect(r.treatment).toBe('DEBOURS');
  });

  // ─── RULE 17 — IC acquisitions by rate ───
  it('RULE 17 — EU + goods + 17% → IC_ACQ_17', () => {
    const r = classifyInvoiceLine(inv({
      country: 'DE', description: 'Purchase of server hardware goods', vat_rate: 0.17,
    }));
    expect(r.treatment).toBe('IC_ACQ_17');
    expect(r.rule).toBe('RULE 17');
  });

  it('RULE 17 — EU + goods + 3% → IC_ACQ_03', () => {
    const r = classifyInvoiceLine(inv({
      country: 'FR', description: 'Purchase of books (livres) goods', vat_rate: 0.03,
    }));
    expect(r.treatment).toBe('IC_ACQ_03');
  });

  // ─── RULE 18 — outgoing to non-EU customer ───
  it('RULE 18 — outgoing, no VAT, customer_country=US → OUT_NONEU', () => {
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU', customer_country: 'US',
      vat_rate: 0, vat_applied: 0, description: 'Advisory services',
    }));
    expect(r.treatment).toBe('OUT_NONEU');
    expect(r.rule).toBe('RULE 18');
  });

  it('RULE 18 does NOT fire when the invoice is billed with 17% VAT', () => {
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU', customer_country: 'CH',
      vat_rate: 0.17, description: 'Taxable services',
    }));
    // 17% VAT was actually charged — the supply is taxable LU, not OUT_NONEU.
    expect(r.treatment).toBe('OUT_LUX_17');
    expect(r.rule).toBe('RULE 15');
  });

  it('RULE 18 does NOT fire for EU customer (that would be OUT_EU_RC territory)', () => {
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU', customer_country: 'DE',
      vat_rate: 0, description: 'Consulting services',
    }));
    expect(r.treatment).not.toBe('OUT_NONEU');
  });

  // ─── RULE 19 — import VAT from non-EU goods ───
  it('RULE 19 — non-EU country + goods + VAT paid → IMPORT_VAT', () => {
    const r = classifyInvoiceLine(inv({
      country: 'CN', description: 'Purchase of goods (industrial equipment)',
      vat_applied: 170, amount_eur: 1000,
    }));
    expect(r.treatment).toBe('IMPORT_VAT');
    expect(r.rule).toBe('RULE 19');
  });

  it('RULE 19 does NOT fire for non-EU services with no VAT (that is RC_NONEU_*)', () => {
    const r = classifyInvoiceLine(inv({
      country: 'CH', description: 'Consulting services', vat_applied: null,
    }));
    expect(r.treatment).not.toBe('IMPORT_VAT');
  });
});

describe('Reverse charge rules', () => {
  it('RULE 10 — EU + fund-mgmt + Art 44 → RC_EU_EX', () => {
    const r = classifyInvoiceLine(inv({
      country: 'DE',
      description: 'AIFM management services Q1 - exonéré Art. 44',
      invoice_text: 'Exempt from VAT under Article 44',
    }));
    expect(r.treatment).toBe('RC_EU_EX');
    expect(r.rule).toBe('RULE 10');
  });

  it('RULE 11 — EU services with no VAT, no exemption → RC_EU_TAX', () => {
    const r = classifyInvoiceLine(inv({
      country: 'PL', description: 'Investment advisory fee Q1 2025',
    }));
    // Without entity context, no inference; falls through to fallback
    expect(r.treatment).toBe('RC_EU_TAX');
    expect(r.rule).toBe('RULE 11');
  });

  it('RULE 13 — Non-EU services with no VAT → RC_NONEU_TAX', () => {
    const r = classifyInvoiceLine(inv({
      country: 'GB', description: 'Travel recovery service',
    }));
    expect(r.treatment).toBe('RC_NONEU_TAX');
    expect(r.rule).toBe('RULE 13');
  });
});

describe('Inference rules (priority 4)', () => {
  it('INFERENCE A — EU advisory matching outgoing exempt pattern → RC_EU_EX (flagged)', () => {
    const r = classifyInvoiceLine(
      inv({
        country: 'PL',
        description: 'Investment advisory fee III Q 2025',
        amount_eur: 350_000,
      }),
      FUND_CTX
    );
    expect(r.treatment).toBe('RC_EU_EX');
    expect(r.rule).toBe('INFERENCE A');
    expect(r.flag).toBe(true);
    expect(r.source).toBe('inference');
  });

  it('INFERENCE A skips when amount magnitude is too different (and entity is not fund-type)', () => {
    // Outgoing exempt = 0 (holding context), so INFERENCE A's magnitude check fails.
    // Holding entity_type also fails INFERENCE C's fund/gp check. Falls through to RULE 11.
    const r = classifyInvoiceLine(
      inv({
        country: 'PL',
        description: 'Investment advisory fee tiny',
        amount_eur: 50,
      }),
      HOLDING_CTX
    );
    expect(r.treatment).toBe('RC_EU_TAX');
    expect(r.rule).toBe('RULE 11');
  });

  it('INFERENCE C — fund entity + EU + fund-mgmt keywords + no exemption → RC_EU_EX', () => {
    const r = classifyInvoiceLine(
      inv({
        country: 'DE',
        description: 'Sub-advisory fees for the fund',
      }),
      FUND_CTX
    );
    expect(r.treatment).toBe('RC_EU_EX');
    expect(r.rule).toBe('INFERENCE C');
  });

  it('INFERENCE C does not fire for non-fund entities', () => {
    const r = classifyInvoiceLine(
      inv({
        country: 'DE',
        description: 'Sub-advisory fees',
      }),
      HOLDING_CTX
    );
    // Falls through to RULE 11
    expect(r.treatment).toBe('RC_EU_TAX');
    expect(r.rule).toBe('RULE 11');
  });

  it('INFERENCE D — non-EU version of C → RC_NONEU_EX', () => {
    const r = classifyInvoiceLine(
      inv({
        country: 'CH',
        description: 'AIFM portfolio management services',
      }),
      FUND_CTX
    );
    expect(r.treatment).toBe('RC_NONEU_EX');
    expect(r.rule).toBe('INFERENCE D');
  });
});

describe('Outgoing rules', () => {
  it('RULE 14 — outgoing + no VAT + explicit Art. 44 reference → OUT_LUX_00', () => {
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU',
      vat_rate: 0, vat_applied: 0,
      description: 'Management fee Q1 2025 — exempt under Art. 44 LTVA',
    }));
    expect(r.treatment).toBe('OUT_LUX_00');
    expect(r.rule).toBe('RULE 14');
  });

  it('RULE 14 does NOT match a bare "management fee" description (no legal reference)', () => {
    // Regression: the earlier loose RULE 14 silently exempted any outgoing
    // containing "management fee". That caused taxable advisory fees billed
    // at 17% to be mis-classified as exempt. The tightened RULE 14 now
    // requires an explicit exemption reference AND no VAT charged.
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU',
      description: 'Management fee Q1 2025',
    }));
    expect(r.treatment).not.toBe('OUT_LUX_00');
  });

  it('RULE 14 does NOT match an outgoing "management fee" billed with 17% VAT', () => {
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU',
      vat_rate: 0.17,
      description: 'Management fee Q1 2025 — exonéré de TVA',
    }));
    // vat_rate = 17% must win over the exemption phrase
    expect(r.treatment).toBe('OUT_LUX_17');
    expect(r.rule).toBe('RULE 15');
  });

  it('RULE 15 — outgoing + 17% → OUT_LUX_17', () => {
    const r = classifyInvoiceLine(inv({
      direction: 'outgoing', country: 'LU', vat_rate: 0.17,
      description: 'Consulting services Q1',
    }));
    expect(r.treatment).toBe('OUT_LUX_17');
  });
});

describe('Manual classifications are protected', () => {
  // Note: 'manual' protection lives in lib/classify.ts (the runner), not in
  // classifyInvoiceLine itself. This is documentation of that contract.
  it('classifyInvoiceLine never returns source="manual" — that is set by the user', () => {
    const r = classifyInvoiceLine(inv({ country: 'LU', vat_rate: 0.17 }));
    expect(r.source).not.toBe('manual');
  });
});

describe('Multi-language exemption keywords (FIX 9)', () => {
  it.each([
    ['exempt from VAT', 'EN'],
    ['exonéré de TVA', 'FR'],
    ['steuerbefreit', 'DE'],
    ['esente IVA', 'IT'],
    ['exento de IVA', 'ES'],
    ['zwolniony z VAT', 'PL'],
    ['vrijgesteld van BTW', 'NL'],
    ['isento de IVA', 'PT'],
  ])('triggers EXEMPT_44 when invoice_text contains "%s" (%s)', (phrase) => {
    const r = classifyInvoiceLine(inv({
      country: 'LU',
      description: 'Investment management services',
      invoice_text: `Note: ${phrase}`,
    }));
    expect(r.treatment).toBe('EXEMPT_44');
    expect(r.rule).toBe('RULE 7');
  });
});

describe('No match', () => {
  it('returns NO_MATCH and flags for review when nothing fits', () => {
    const r = classifyInvoiceLine(inv({
      country: 'XX', // not a known country
      vat_rate: null, vat_applied: 1234, // VAT applied without LU rate match
      description: 'Mystery line',
    }));
    expect(r.treatment).toBeNull();
    expect(r.rule).toBe('NO_MATCH');
    expect(r.flag).toBe(true);
  });
});
