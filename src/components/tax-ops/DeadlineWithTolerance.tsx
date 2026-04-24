'use client';

// ════════════════════════════════════════════════════════════════════════
// DeadlineWithTolerance — stint 37.C.
//
// Replaces the generic <DateBadge mode="urgency"> for tax-ops deadlines:
// Diego pointed out that "overdue" today ignores administrative tolerance.
// For VAT annual in Luxembourg the statutory deadline is 1 March N+1 but
// the AED routinely accepts filings until ~1 May (~60 days tolerance) with
// no penalty. For CIT Form 500 there's a standard extension to 31 December
// (~270 days). Rendering everything past statutory as red overdue makes
// the deadline scan useless.
//
// Four states:
//   value == null                        → "—" (ink-faint)
//   daysUntilStatutory > 7               → neutral date
//   0 < daysUntilStatutory <= 7          → amber "in Nd"
//   daysUntilStatutory === 0             → amber "today"
//   past statutory, within tolerance     → amber "within tolerance (Nd left)"
//   past tolerance (daysPastTolerance>0) → red "overdue Nd"
// ════════════════════════════════════════════════════════════════════════

import { formatDate } from '@/lib/crm-types';

export function DeadlineWithTolerance({
  value, toleranceDays = 0, label,
}: {
  value: string | null | undefined;
  /** Admin tolerance days past statutory before truly overdue. Pulled
   *  from the deadline rule (MatrixResponse.admin_tolerance_days). */
  toleranceDays?: number;
  label?: string;
}) {
  if (!value) return <span className="text-ink-muted">—</span>;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="text-ink-muted">—</span>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysDelta = Math.round((d.getTime() - today.getTime()) / msPerDay);

  let toneClass: string;
  let prefix: string;
  let suffix: string | null = null;
  let title: string | undefined;

  if (daysDelta > 7) {
    toneClass = 'text-ink-soft';
    prefix = '';
  } else if (daysDelta > 0) {
    toneClass = 'text-amber-700';
    prefix = `In ${daysDelta}d · `;
  } else if (daysDelta === 0) {
    toneClass = 'text-amber-700 font-semibold';
    prefix = 'Today · ';
  } else {
    // Past statutory. Check tolerance window.
    const daysPast = Math.abs(daysDelta);
    if (toleranceDays > 0 && daysPast <= toleranceDays) {
      const daysLeft = toleranceDays - daysPast;
      toneClass = 'text-amber-700';
      prefix = '';
      suffix = ` · within tolerance (${daysLeft}d left)`;
      title = label
        ? `${label}: statutory ${formatDate(value)}; admin tolerance +${toleranceDays}d`
        : `Statutory: ${formatDate(value)} · admin tolerance +${toleranceDays}d (AED usually accepts without penalty)`;
    } else {
      // Real overdue — past statutory AND past tolerance.
      const effectivePast = toleranceDays > 0 ? daysPast - toleranceDays : daysPast;
      toneClass = 'text-danger-700 font-semibold';
      prefix = `${effectivePast}d overdue · `;
    }
  }

  return (
    <span
      className={`tabular-nums ${toneClass}`}
      title={title ?? (label ? `${label}: ${formatDate(value)}` : undefined)}
    >
      {prefix}{formatDate(value)}{suffix}
    </span>
  );
}
