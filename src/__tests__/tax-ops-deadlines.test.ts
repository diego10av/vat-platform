import { describe, it, expect } from 'vitest';
import {
  computeDeadline,
  parsePeriodEnd,
  describeRule,
  type DeadlineRule,
} from '@/lib/tax-ops-deadlines';

// ─── parsePeriodEnd ─────────────────────────────────────────────────

describe('parsePeriodEnd', () => {
  it('annual → 31 Dec', () => {
    expect(parsePeriodEnd('2026').toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('quarters → last day of Mar/Jun/Sep/Dec', () => {
    expect(parsePeriodEnd('2026-Q1').toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(parsePeriodEnd('2026-Q2').toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(parsePeriodEnd('2026-Q3').toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(parsePeriodEnd('2026-Q4').toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('months → last day including Feb leap + non-leap', () => {
    expect(parsePeriodEnd('2026-01').toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(parsePeriodEnd('2026-02').toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(parsePeriodEnd('2024-02').toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(parsePeriodEnd('2026-04').toISOString().slice(0, 10)).toBe('2026-04-30');
    expect(parsePeriodEnd('2026-12').toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('semesters → 30 Jun / 31 Dec', () => {
    expect(parsePeriodEnd('2026-S1').toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(parsePeriodEnd('2026-S2').toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('throws on malformed label', () => {
    expect(() => parsePeriodEnd('2026-XX')).toThrow();
    expect(() => parsePeriodEnd('not-a-period')).toThrow();
    expect(() => parsePeriodEnd('2026-13')).toThrow();
  });
});

// ─── computeDeadline — days_after_period_end ────────────────────────

describe('computeDeadline — days_after_period_end', () => {
  const rule: DeadlineRule = {
    tax_type: 'vat_quarterly',
    period_pattern: 'quarterly',
    rule_kind: 'days_after_period_end',
    rule_params: { days_after: 15 },
  };

  it('VAT Q1 2026 → 15 April', () => {
    const d = computeDeadline(rule, 2026, '2026-Q1');
    expect(d.effective).toBe('2026-04-15');
    expect(d.extension).toBeNull();
    expect(d.statutory).toBe('2026-04-15');
  });

  it('VAT Q4 2026 → 15 Jan 2027', () => {
    const d = computeDeadline(rule, 2026, '2026-Q4');
    expect(d.effective).toBe('2027-01-15');
  });

  it('VAT monthly Jan 2026 (+15d) → 15 Feb', () => {
    const monthly: DeadlineRule = { ...rule, period_pattern: 'monthly' };
    const d = computeDeadline(monthly, 2026, '2026-01');
    expect(d.effective).toBe('2026-02-15');
  });

  it('WHT director monthly Jan (+10d) → 10 Feb', () => {
    const wht: DeadlineRule = {
      tax_type: 'wht_director_monthly',
      period_pattern: 'monthly',
      rule_kind: 'days_after_period_end',
      rule_params: { days_after: 10 },
    };
    const d = computeDeadline(wht, 2026, '2026-01');
    expect(d.effective).toBe('2026-02-10');
  });
});

// ─── computeDeadline — fixed_md ─────────────────────────────────────

describe('computeDeadline — fixed_md', () => {
  it('VAT annual 2026 → 1 March 2027', () => {
    const rule: DeadlineRule = {
      tax_type: 'vat_annual',
      period_pattern: 'annual',
      rule_kind: 'fixed_md',
      rule_params: { month: 3, day: 1 },
    };
    const d = computeDeadline(rule, 2026, '2026');
    expect(d.effective).toBe('2027-03-01');
    expect(d.extension).toBeNull();
  });

  it('FATCA/CRS 2026 → 30 June 2027', () => {
    const rule: DeadlineRule = {
      tax_type: 'fatca_crs_annual',
      period_pattern: 'annual',
      rule_kind: 'fixed_md',
      rule_params: { month: 6, day: 30 },
    };
    const d = computeDeadline(rule, 2026, '2026');
    expect(d.effective).toBe('2027-06-30');
  });
});

// ─── computeDeadline — fixed_md_with_extension ──────────────────────

describe('computeDeadline — fixed_md_with_extension (CIT/NWT)', () => {
  const rule: DeadlineRule = {
    tax_type: 'cit_annual',
    period_pattern: 'annual',
    rule_kind: 'fixed_md_with_extension',
    rule_params: { month: 3, day: 31, extension_month: 12, extension_day: 31 },
  };

  it('CIT FY 2025 → statutory 31 March 2026, extension 31 Dec 2026', () => {
    const d = computeDeadline(rule, 2025, '2025');
    expect(d.statutory).toBe('2026-03-31');
    expect(d.extension).toBe('2026-12-31');
    expect(d.effective).toBe('2026-12-31');   // extension wins when present
  });

  it('extension absent → falls back to statutory', () => {
    const noExt: DeadlineRule = {
      ...rule,
      rule_params: { month: 3, day: 31 },
    };
    const d = computeDeadline(noExt, 2025, '2025');
    expect(d.extension).toBeNull();
    expect(d.effective).toBe('2026-03-31');
  });
});

// ─── computeDeadline — error paths ──────────────────────────────────

describe('computeDeadline — errors', () => {
  it('rejects an unknown rule_kind', () => {
    const rule = {
      tax_type: 'x',
      period_pattern: 'annual' as const,
      rule_kind: 'totally_unknown' as never,
      rule_params: {},
    };
    expect(() => computeDeadline(rule, 2026, '2026')).toThrow();
  });

  it('rejects a year outside sane range', () => {
    const rule: DeadlineRule = {
      tax_type: 'vat_annual', period_pattern: 'annual',
      rule_kind: 'fixed_md', rule_params: { month: 3, day: 1 },
    };
    expect(() => computeDeadline(rule, 1899, '1899')).toThrow();
    expect(() => computeDeadline(rule, 2101, '2101')).toThrow();
  });
});

// ─── describeRule ───────────────────────────────────────────────────

describe('describeRule', () => {
  it('renders days_after_period_end', () => {
    expect(describeRule({
      tax_type: 'vat_q', period_pattern: 'quarterly',
      rule_kind: 'days_after_period_end', rule_params: { days_after: 15 },
    })).toContain('15d');
  });

  it('renders fixed_md', () => {
    expect(describeRule({
      tax_type: 'vat_a', period_pattern: 'annual',
      rule_kind: 'fixed_md', rule_params: { month: 3, day: 1 },
    })).toContain('1 Mar');
  });

  it('renders fixed_md_with_extension', () => {
    const desc = describeRule({
      tax_type: 'cit', period_pattern: 'annual',
      rule_kind: 'fixed_md_with_extension',
      rule_params: { month: 3, day: 31, extension_month: 12, extension_day: 31 },
    });
    expect(desc).toContain('31 Mar');
    expect(desc).toContain('extension');
    expect(desc).toContain('31 Dec');
  });
});
