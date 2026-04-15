import { describe, it, expect } from 'vitest';
import { generatePaymentReference } from '@/lib/payment-ref';

describe('AED payment reference generation (PRD §7.2)', () => {
  it('formats annual period as Y1', () => {
    const r = generatePaymentReference({
      matricule: '20232456346', year: 2025, period: 'Y1', amount: 100,
    });
    expect(r.reference).toBe('20232456346 EA25Y1');
  });

  it('formats Q1 quarterly', () => {
    const r = generatePaymentReference({
      matricule: '20232456346', year: 2026, period: 'Q1', amount: 100,
    });
    expect(r.reference).toBe('20232456346 EA26Q1');
  });

  it('formats monthly period zero-padded', () => {
    const r = generatePaymentReference({
      matricule: '20232456346', year: 2026, period: '1', amount: 100,
    });
    expect(r.reference).toBe('20232456346 EA2601');
  });

  it('formats December as 12', () => {
    const r = generatePaymentReference({
      matricule: '20232456346', year: 2026, period: '12', amount: 100,
    });
    expect(r.reference).toBe('20232456346 EA2612');
  });

  it('strips whitespace from matricule', () => {
    const r = generatePaymentReference({
      matricule: '20232 456 346', year: 2025, period: 'Y1', amount: 100,
    });
    expect(r.matricule).toBe('20232456346');
  });

  it('rounds amount to 2 decimals', () => {
    const r = generatePaymentReference({
      matricule: 'X', year: 2025, period: 'Y1', amount: 3.4567,
    });
    expect(r.amount).toBe(3.46);
  });

  it('throws if matricule is missing', () => {
    expect(() => generatePaymentReference({
      matricule: null, year: 2025, period: 'Y1', amount: 100,
    })).toThrow();
  });

  it('attaches the AED bank details', () => {
    const r = generatePaymentReference({
      matricule: 'X', year: 2025, period: 'Y1', amount: 100,
    });
    expect(r.iban).toBe('LU35 0019 5655 0668 3000');
    expect(r.bic).toBe('BCEELULL');
    expect(r.beneficiary).toBe('AED-RECETTE CENTRALE-TVA');
  });
});
