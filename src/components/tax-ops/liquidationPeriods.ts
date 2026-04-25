// Stint 43.D15 — pure helpers for the liquidation "final return" logic.
//
// Lives outside LiquidationChip.tsx (a 'use client' component) so unit
// tests can import the helpers without dragging the React component +
// browser-only deps into the test environment.

export interface PeriodWindow {
  start: string;  // YYYY-MM-DD inclusive
  end: string;    // YYYY-MM-DD inclusive
}

/**
 * Parse a period_label (e.g. "2025", "2025-Q3", "2025-06") into a
 * { start, end } window of YYYY-MM-DD strings (inclusive).
 *
 * Handles 30/31 day months and leap years correctly via Date math.
 * Returns null for shapes we don't model finely (semester labels,
 * ad-hoc labels) — the caller treats null as "this label can't carry
 * a final-return marker".
 */
export function periodWindow(label: string): PeriodWindow | null {
  const annual = label.match(/^(\d{4})$/);
  if (annual) {
    const y = annual[1]!;
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  const quarter = label.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) {
    const y = quarter[1]!;
    const q = Number(quarter[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    // Last day of endMonth via Date math (handles 30/31 + leap years).
    const endDay = new Date(Number(y), endMonth, 0).getDate();
    return {
      start: `${y}-${String(startMonth).padStart(2, '0')}-01`,
      end: `${y}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
    };
  }
  const month = label.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const y = month[1]!;
    const m = Number(month[2]);
    const last = new Date(Number(y), m, 0).getDate();
    return {
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    };
  }
  return null;
}

/**
 * Returns true when the entity's liquidation_date falls strictly
 * inside the given period's window. Used to flag the "final return"
 * status chip with an amber border.
 */
export function isFinalReturnPeriod(
  liquidationDate: string | null,
  periodLabel: string,
): boolean {
  if (!liquidationDate) return false;
  const w = periodWindow(periodLabel);
  if (!w) return false;
  return liquidationDate >= w.start && liquidationDate <= w.end;
}
