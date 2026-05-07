// Deadline calculator for the legacy /api/deadlines endpoint. The
// authoritative VAT deadlines now live in `tax_deadline_rules` (mig
// 045 + 090) and are computed via `tax-ops-deadlines.ts`. This file
// is kept for the older VAT-module Deadlines page; statutory dates
// only — administrative tolerance is not modelled here.
//
// Statutory filing deadlines per LTVA Art. 64 / 64bis / 67bis:
//   - Simplified annual:    1 March of the following year   (Art. 67bis)
//   - Ordinary annual:      1 May  of the following year    (Art. 64bis)
//   - Quarterly (ordinary): period_end + 15 days             (Art. 64)
//                           Q1 ends 31 Mar → due 15 Apr (NOT 15 May —
//                           the previous "end-of-next-month + 15"
//                           formula was wrong and is fixed in mig 090).
//   - Monthly (ordinary):   period_end + 15 days             (Art. 64)
//                           e.g. period 2026-01 → due 15 Feb 2026.

export type Frequency = 'annual' | 'quarterly' | 'monthly';
export type Regime = 'simplified' | 'ordinary';

export interface DeadlineInfo {
  due_date: string;          // YYYY-MM-DD
  days_until: number;        // negative = overdue
  is_overdue: boolean;
  bucket: 'overdue' | 'urgent' | 'soon' | 'comfortable' | 'far';
  description: string;       // human-readable rule used
}

export function computeDeadline(params: {
  regime: Regime;
  frequency: Frequency;
  year: number;
  period: string;
  reference_date?: Date;     // defaults to today; injectable for tests
}): DeadlineInfo {
  const today = startOfDay(params.reference_date || new Date());
  const due = computeDueDate(params);
  const ms = due.getTime() - today.getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));

  return {
    due_date: toISODate(due),
    days_until: days,
    is_overdue: days < 0,
    bucket: bucketFor(days),
    description: describe(params),
  };
}

function computeDueDate(p: { regime: Regime; frequency: Frequency; year: number; period: string }): Date {
  const { regime, frequency, year, period } = p;

  if (frequency === 'annual') {
    // Simplified: 1 Mar Y+1; Ordinary: 1 May Y+1
    const month = regime === 'simplified' ? 2 : 4; // 0-indexed
    return new Date(Date.UTC(year + 1, month, 1));
  }

  if (frequency === 'quarterly') {
    const q = parseInt(period.replace(/[^0-9]/g, ''), 10);
    if (!q || q < 1 || q > 4) return new Date(Date.UTC(year + 1, 4, 1));
    // LTVA Art. 64: deadline = quarter_end + 15 days.
    // Q1 ends 31 Mar → due 15 Apr. The earlier "end-of-(next month) + 15"
    // formula yielded 15 May for Q1, which was wrong and over-allocated
    // 30 days of slack. Mig 090 corrects this everywhere.
    const endMonth = q * 3 - 1;                       // 0-indexed month of quarter end
    const endOfQuarter = lastDayOfMonth(year, endMonth);
    return addDays(endOfQuarter, 15);
  }

  if (frequency === 'monthly') {
    const m = parseInt(period.replace(/[^0-9]/g, ''), 10);
    if (!m || m < 1 || m > 12) return new Date(Date.UTC(year + 1, 0, 15));
    // End of month + 15 days.
    const endOfMonth = lastDayOfMonth(year, m - 1);
    return addDays(endOfMonth, 15);
  }

  return new Date(Date.UTC(year + 1, 4, 1));
}

function lastDayOfMonth(year: number, monthIndex: number): Date {
  // Day 0 of (monthIndex + 1) = last day of monthIndex
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function describe(p: { regime: Regime; frequency: Frequency }): string {
  if (p.frequency === 'annual') {
    return p.regime === 'simplified' ? '1 March of following year (simplified annual)' : '1 May of following year (ordinary annual)';
  }
  if (p.frequency === 'quarterly') return 'Quarter end + 15 days (statutory, LTVA Art. 64)';
  return 'Month end + 15 days (statutory, LTVA Art. 64)';
}

function bucketFor(days: number): DeadlineInfo['bucket'] {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'urgent';
  if (days <= 30) return 'soon';
  if (days <= 60) return 'comfortable';
  return 'far';
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
