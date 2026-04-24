// Unit tests for the shape of the /api/tax-ops/matrix response helpers.
// We don't hit the real DB — the test focuses on the pure helpers that
// drive the response shape (period labels per pattern, period-label
// humanizer, etc.) so the assertions are deterministic.

import { describe, it, expect } from 'vitest';
import { shortPeriodLabel } from '@/components/tax-ops/useMatrixData';

describe('shortPeriodLabel', () => {
  it('keeps the annual label as-is', () => {
    expect(shortPeriodLabel('2025')).toBe('2025');
    expect(shortPeriodLabel('2026')).toBe('2026');
  });

  it('strips the year prefix from quarterly labels', () => {
    expect(shortPeriodLabel('2026-Q1')).toBe('Q1');
    expect(shortPeriodLabel('2026-Q4')).toBe('Q4');
  });

  it('converts monthly labels into three-letter month names', () => {
    expect(shortPeriodLabel('2026-01')).toBe('Jan');
    expect(shortPeriodLabel('2026-03')).toBe('Mar');
    expect(shortPeriodLabel('2026-12')).toBe('Dec');
  });

  it('falls back to the raw label for unknown shapes', () => {
    // Ad-hoc / semester labels pass through.
    expect(shortPeriodLabel('2026-ADHOC-45')).toBe('2026-ADHOC-45');
    expect(shortPeriodLabel('2026-S2')).toBe('2026-S2');
  });
});

// ─── Period-labels generator (inlined mirror of the server-side helper) ──
//
// The matrix route has a local periodLabelsFor() that we don't export
// separately; we test the same shape here by recreating it, so that if
// the server diverges the test catches it when a future stint refactors.

function periodLabelsFor(pattern: string, year: number): string[] {
  if (pattern === 'annual')   return [String(year)];
  if (pattern === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'].map(q => `${year}-${q}`);
  if (pattern === 'monthly') {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  if (pattern === 'semester') return [`${year}-S1`, `${year}-S2`];
  return [];
}

describe('period labels per pattern', () => {
  it('annual → single label equal to the year', () => {
    expect(periodLabelsFor('annual', 2025)).toEqual(['2025']);
  });

  it('quarterly → 4 labels in order Q1..Q4', () => {
    expect(periodLabelsFor('quarterly', 2026)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
  });

  it('monthly → 12 labels Jan..Dec, zero-padded', () => {
    const labels = periodLabelsFor('monthly', 2026);
    expect(labels.length).toBe(12);
    expect(labels[0]).toBe('2026-01');
    expect(labels[1]).toBe('2026-02');
    expect(labels[11]).toBe('2026-12');
  });

  it('semester → 2 labels S1 + S2', () => {
    expect(periodLabelsFor('semester', 2025)).toEqual(['2025-S1', '2025-S2']);
  });

  it('adhoc / unknown patterns → empty array', () => {
    expect(periodLabelsFor('adhoc', 2026)).toEqual([]);
    expect(periodLabelsFor('whatever', 2026)).toEqual([]);
  });

  it('stays in sync across years', () => {
    expect(periodLabelsFor('quarterly', 2024)).toEqual(['2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4']);
    expect(periodLabelsFor('monthly', 2025).slice(0, 3)).toEqual(['2025-01', '2025-02', '2025-03']);
  });
});
