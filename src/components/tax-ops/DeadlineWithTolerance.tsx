'use client';

// ════════════════════════════════════════════════════════════════════════
// DeadlineWithTolerance — stint 37.C, refactored in mig 090.
//
// Renders a tax-ops filing deadline with two layers of context:
//
//   1. `value` is the EFFECTIVE deadline (statutory + administrative
//      tolerance). It drives the alert state — red when past, amber when
//      ≤7 days away. This is what the home dashboard / sidebar badges
//      key on, and what Diego cares about for "do I have to file this
//      today?".
//
//   2. `statutoryValue` (optional) is the LEGAL deadline. Shown as a
//      muted secondary line under the effective date so the legal date
//      remains visible for audit / reference. Tooltip explains both.
//
// Four states for the effective value:
//   value == null                        → "—" (ink-faint)
//   daysUntilEffective > 7               → neutral date
//   0 < daysUntilEffective <= 7          → amber "in Nd"
//   daysUntilEffective === 0             → amber "today"
//   daysUntilEffective < 0               → red "overdue Nd"
//
// Legacy `toleranceDays` prop is preserved for callers that still pass
// statutory-as-`value` (e.g. CIT today). When `toleranceDays > 0` and
// no `statutoryValue` is given, the older "within tolerance (Nd left)"
// state still renders. New call sites should pass `statutoryValue` and
// leave `toleranceDays` at 0.
// ════════════════════════════════════════════════════════════════════════

import { formatDate } from '@/lib/crm-types';

// Filing statuses that mean "the work is closed" — deadline is no
// longer actionable, render neutral so a historical row past its
// deadline doesn't keep blaring "overdue" in red.
const CLOSED_STATUSES = new Set(['filed', 'paid', 'waived', 'cancelled']);

export function DeadlineWithTolerance({
  value, statutoryValue, toleranceDays = 0, label, status,
}: {
  value: string | null | undefined;
  /** Statutory legal deadline, when distinct from `value`. Renders as a
   *  small muted secondary line under the effective date. */
  statutoryValue?: string | null;
  /** Legacy: admin tolerance days past statutory. Use only when `value`
   *  is the statutory date and the rule has no separate effective. */
  toleranceDays?: number;
  label?: string;
  /** Filing status. When closed (filed/paid/waived/cancelled) the
   *  deadline renders in neutral grey — the work is done, no alert
   *  state matters. */
  status?: string | null;
}) {
  if (!value) return <span className="text-ink-muted">—</span>;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="text-ink-muted">—</span>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysDelta = Math.round((d.getTime() - today.getTime()) / msPerDay);

  // Two-layer mode: caller passed a separate statutory date. value IS the
  // effective; alerts key on it directly with no overlay logic.
  const hasStatutoryLayer = !!statutoryValue && statutoryValue !== value;
  const isClosed = !!status && CLOSED_STATUSES.has(status);

  let toneClass: string;
  let prefix: string;
  let suffix: string | null = null;
  let title: string | undefined;

  if (isClosed) {
    // Work is done — no alert state, just the historical date in muted grey.
    toneClass = 'text-ink-muted';
    prefix = '';
  } else if (daysDelta > 7) {
    toneClass = 'text-ink-soft';
    prefix = '';
  } else if (daysDelta > 0) {
    toneClass = 'text-amber-700';
    prefix = `In ${daysDelta}d · `;
  } else if (daysDelta === 0) {
    toneClass = 'text-amber-700 font-semibold';
    prefix = 'Today · ';
  } else {
    const daysPast = Math.abs(daysDelta);
    if (!hasStatutoryLayer && toleranceDays > 0 && daysPast <= toleranceDays) {
      // Legacy single-layer: value = statutory + tolerance applied here.
      const daysLeft = toleranceDays - daysPast;
      toneClass = 'text-amber-700';
      prefix = '';
      suffix = ` · within tolerance (${daysLeft}d left)`;
      title = label
        ? `${label}: statutory ${formatDate(value)}; admin tolerance +${toleranceDays}d`
        : `Statutory: ${formatDate(value)} · admin tolerance +${toleranceDays}d (AED usually accepts without penalty)`;
    } else {
      // Past effective deadline — truly overdue.
      const effectivePast = (!hasStatutoryLayer && toleranceDays > 0)
        ? daysPast - toleranceDays
        : daysPast;
      toneClass = 'text-danger-700 font-semibold';
      prefix = `${effectivePast}d overdue · `;
    }
  }

  if (!title && hasStatutoryLayer) {
    title = label
      ? `${label} · effective ${formatDate(value)} (admin tolerance) · statutory ${formatDate(statutoryValue!)}`
      : `Effective: ${formatDate(value)} · statutory: ${formatDate(statutoryValue!)}`;
  }

  return (
    <span
      className={`inline-flex flex-col items-start ${hasStatutoryLayer ? 'leading-tight' : ''}`}
      title={title ?? (label ? `${label}: ${formatDate(value)}` : undefined)}
    >
      <span className={`tabular-nums whitespace-nowrap ${toneClass}`}>
        {prefix}{formatDate(value)}{suffix}
      </span>
      {hasStatutoryLayer && (
        <span className="text-2xs text-ink-faint tabular-nums whitespace-nowrap">
          legal · {formatDate(statutoryValue!)}
        </span>
      )}
    </span>
  );
}
