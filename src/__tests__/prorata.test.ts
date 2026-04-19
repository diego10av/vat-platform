// Pro-rata helper — unit tests.
//
// Covers the Art. 50 LTVA round-up behaviour, the general/direct/sector
// methodologies, the null-record fallback (100% deductible), and the
// period overlap matcher.

import { describe, it, expect } from 'vitest';
import {
  computeProrataBreakdown,
  pickProrataForPeriod,
  roundPercentUp,
  type ProrataRecord,
} from '@/lib/prorata';

function makeRecord(overrides: Partial<ProrataRecord> = {}): ProrataRecord {
  return {
    id: 'ep1',
    entity_id: 'ent1',
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    method: 'general',
    ratio_num: null,
    ratio_denom: null,
    ratio_pct: null,
    basis: null,
    notes: null,
    ...overrides,
  };
}

describe('roundPercentUp', () => {
  it('rounds up to the next whole percent per Directive Art. 174§1(b)', () => {
    expect(roundPercentUp(21.01)).toBe(22);
    expect(roundPercentUp(21.99)).toBe(22);
    expect(roundPercentUp(21)).toBe(21);
    expect(roundPercentUp(21.004)).toBe(21); // epsilon
  });
  it('clamps to [0, 100]', () => {
    expect(roundPercentUp(-5)).toBe(0);
    expect(roundPercentUp(0)).toBe(0);
    expect(roundPercentUp(100.5)).toBe(100);
    expect(roundPercentUp(150)).toBe(100);
  });
  it('returns 0 on NaN / Infinity (safe default: nothing deductible)', () => {
    expect(roundPercentUp(NaN)).toBe(0);
    expect(roundPercentUp(Infinity)).toBe(0);
    expect(roundPercentUp(-Infinity)).toBe(0);
  });
});

describe('computeProrataBreakdown', () => {
  it('defaults to 100% deductible with a clear flag when no record is provided', () => {
    const b = computeProrataBreakdown(1000, null);
    expect(b.ratio_pct).toBe(100);
    expect(b.deductible_eur).toBe(1000);
    expect(b.non_deductible_eur).toBe(0);
    expect(b.formula_text.toLowerCase()).toContain('no pro-rata');
  });

  it('applies the general ratio with rounding-up', () => {
    const record = makeRecord({ method: 'general', ratio_num: 820_000, ratio_denom: 3_920_000 });
    const b = computeProrataBreakdown(10_000, record);
    // 820_000 / 3_920_000 = 20.918... → rounded UP → 21%
    expect(b.ratio_pct).toBe(21);
    expect(b.deductible_eur).toBe(2100);
    expect(b.non_deductible_eur).toBe(7900);
    // LU locale formats with '.' as thousand separator and ',' as decimal.
    expect(b.formula_text).toContain('€820');
    expect(b.formula_text).toContain('€3');
    expect(b.formula_text).toContain('920');
    expect(b.formula_text).toContain('rounded UP to 21%');
  });

  it('uses ratio_pct directly for direct-attribution method', () => {
    const record = makeRecord({ method: 'direct', ratio_pct: 75, basis: 'Attributed line-by-line from the FY invoices.' });
    const b = computeProrataBreakdown(1000, record);
    expect(b.ratio_pct).toBe(75);
    expect(b.deductible_eur).toBe(750);
    expect(b.non_deductible_eur).toBe(250);
    expect(b.formula_text).toContain('Direct attribution');
  });

  it('uses ratio_pct for sector method and references BLC Baumarkt', () => {
    const record = makeRecord({ method: 'sector', ratio_pct: 42 });
    const b = computeProrataBreakdown(1000, record);
    expect(b.ratio_pct).toBe(42);
    expect(b.legal_refs).toContain('BLC_BAUMARKT');
  });

  it('handles zero total VAT', () => {
    const record = makeRecord({ method: 'general', ratio_num: 100, ratio_denom: 500 });
    const b = computeProrataBreakdown(0, record);
    expect(b.deductible_eur).toBe(0);
    expect(b.non_deductible_eur).toBe(0);
  });

  it('handles zero denominator gracefully (no divide-by-zero)', () => {
    const record = makeRecord({ method: 'general', ratio_num: 100, ratio_denom: 0 });
    const b = computeProrataBreakdown(1000, record);
    expect(b.ratio_pct).toBe(0);
    expect(b.deductible_eur).toBe(0);
    expect(b.non_deductible_eur).toBe(1000);
  });
});

describe('pickProrataForPeriod', () => {
  const calendar = makeRecord({ id: 'y2026', period_start: '2026-01-01', period_end: '2026-12-31' });
  const q1 = makeRecord({ id: 'q1', period_start: '2026-01-01', period_end: '2026-03-31', ratio_pct: 80 });
  const h2 = makeRecord({ id: 'h2', period_start: '2026-07-01', period_end: '2026-12-31', ratio_pct: 60 });

  it('picks the first overlapping record', () => {
    expect(pickProrataForPeriod([q1, h2, calendar], '2026-02-15', '2026-02-15')?.id).toBe('q1');
    expect(pickProrataForPeriod([q1, h2, calendar], '2026-08-01', '2026-08-31')?.id).toBe('h2');
    expect(pickProrataForPeriod([q1, h2], '2026-05-01', '2026-05-31')).toBeNull();
  });

  it('returns null when no record overlaps', () => {
    expect(pickProrataForPeriod([q1], '2027-01-01', '2027-01-31')).toBeNull();
  });
});
