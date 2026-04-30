'use client';

// ════════════════════════════════════════════════════════════════════════
// DateBadge — small reusable date chip for CRM list views. Encodes
// urgency via color based on how far the date is from today:
//
//   past      → red (overdue)
//   ≤ 7 days  → amber (soon)
//   > 7 days  → grey (later)
//   null      → em dash
//
// The `tone` is inverted for upcoming-is-good dates (e.g. matter
// closing_date) vs overdue-is-bad dates (e.g. invoice due_date) via
// the `mode` prop: 'urgency' (default, overdue = red) or 'neutral'
// (just informational, no color).
// ════════════════════════════════════════════════════════════════════════

import { formatDate } from '@/lib/crm-types';

export function DateBadge({
  value, mode = 'urgency', label,
}: {
  value: string | null | undefined;
  mode?: 'urgency' | 'neutral';
  label?: string;
}) {
  if (!value) return <span className="text-ink-muted">—</span>;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="text-ink-muted">—</span>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const daysDelta = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let toneClass = 'text-ink-muted';
  let prefix = '';
  if (mode === 'urgency') {
    if (daysDelta < 0) {
      toneClass = 'text-danger-700 font-semibold';
      prefix = `${Math.abs(daysDelta)}d overdue · `;
    } else if (daysDelta === 0) {
      toneClass = 'text-amber-700 font-semibold';
      prefix = 'Today · ';
    } else if (daysDelta <= 7) {
      toneClass = 'text-amber-700';
      prefix = `In ${daysDelta}d · `;
    } else {
      toneClass = 'text-ink-soft';
    }
  }

  return (
    <span
      // Stint 64.X.8 — `whitespace-nowrap` so 10-char dates like
      // "2026-04-25" don't wrap inside narrow matrix columns. The
      // tabular-nums + nowrap pair gives the Linear/HubSpot tight
      // numeric look.
      className={`tabular-nums whitespace-nowrap ${toneClass}`}
      title={label ? `${label}: ${formatDate(value)}` : undefined}
    >
      {prefix}{formatDate(value)}
    </span>
  );
}
