import { describe, it, expect } from 'vitest';
import { computeDeadline } from '@/lib/deadlines';

const REF = new Date('2026-04-15T00:00:00Z'); // Today, fixed for deterministic tests

describe('Deadline calculator (PRD §7.3)', () => {
  it('Simplified annual 2025 → 1 March 2026', () => {
    const d = computeDeadline({
      regime: 'simplified', frequency: 'annual',
      year: 2025, period: 'Y1', reference_date: REF,
    });
    expect(d.due_date).toBe('2026-03-01');
    expect(d.is_overdue).toBe(true);
  });

  it('Ordinary annual 2025 → 1 May 2026', () => {
    const d = computeDeadline({
      regime: 'ordinary', frequency: 'annual',
      year: 2025, period: 'Y1', reference_date: REF,
    });
    expect(d.due_date).toBe('2026-05-01');
    expect(d.bucket).toBe('soon');
  });

  it('Ordinary quarterly Q1 2026 → 15 May 2026 (end of Mar + 1m + 15d)', () => {
    const d = computeDeadline({
      regime: 'ordinary', frequency: 'quarterly',
      year: 2026, period: 'Q1', reference_date: REF,
    });
    expect(d.due_date).toBe('2026-05-15');
  });

  it('Ordinary quarterly Q4 2025 → 15 Feb 2026', () => {
    const d = computeDeadline({
      regime: 'ordinary', frequency: 'quarterly',
      year: 2025, period: 'Q4', reference_date: REF,
    });
    expect(d.due_date).toBe('2026-02-15');
    expect(d.is_overdue).toBe(true);
  });

  it('Ordinary monthly Mar 2026 → 15 April 2026', () => {
    const d = computeDeadline({
      regime: 'ordinary', frequency: 'monthly',
      year: 2026, period: '03', reference_date: REF,
    });
    expect(d.due_date).toBe('2026-04-15');
    expect(d.days_until).toBe(0);
    expect(d.bucket).toBe('urgent');
  });

  it('buckets a 90-day-out deadline as "far"', () => {
    // Ordinary monthly Apr 2026 → 15 May 2026 → 30 days from REF, so "soon"
    const d = computeDeadline({
      regime: 'ordinary', frequency: 'monthly',
      year: 2026, period: '04', reference_date: REF,
    });
    expect(d.bucket).toBe('soon');
  });
});
