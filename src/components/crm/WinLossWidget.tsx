'use client';

// ════════════════════════════════════════════════════════════════════════
// WinLossWidget — closed-deal funnel signal on /crm home (stint 92).
//
// The CRM was already capturing loss_reason for closed-lost deals; stint
// 91 added won_reason for closed-won. This widget surfaces the YTD
// payload from /api/crm/reporting/win-loss in a Rule §11-compatible way:
// every number / chip click drills through to a filtered Opportunities
// list, so Diego can act (review a lost deal post-mortem, copy the
// playbook of a won deal source) rather than just reading.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';

interface Snapshot {
  year: number;
  won_count: number;
  lost_count: number;
  win_rate_pct: number | null;
  avg_won_value_eur: number | null;
  top_won_reason: string | null;
  top_loss_reason: string | null;
  top_won_source: string | null;
}

const HUMAN_REASON: Record<string, string> = {
  no_response:          'No response',
  competitor:           'Competitor won',
  conflict_of_interest: 'Conflict of interest',
  price:                'Price',
  referral:             'Referral',
  existing_client:      'Existing client',
  pricing:              'Pricing',
  expertise:            'Expertise',
  timing:               'Timing',
  incumbent_problem:    'Incumbent issue',
  other:                'Other',
};

function humanize(s: string | null): string {
  if (!s) return '—';
  return HUMAN_REASON[s] ?? s.replace(/_/g, ' ');
}

function formatEur(n: number | null): string {
  if (n === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(n);
}

export function WinLossWidget() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/crm/reporting/win-loss', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((s: Snapshot | null) => { if (alive) setSnapshot(s); })
      .catch(() => { if (alive) setSnapshot(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink mb-2">Win / loss · YTD</h3>
        <div className="text-xs text-ink-faint italic">Loading…</div>
      </section>
    );
  }

  // No data yet OR API failed → "all-clear" placeholder. We don't render
  // zero-bars for vanity; the section appears only when there's signal.
  if (!snapshot || (snapshot.won_count === 0 && snapshot.lost_count === 0)) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-ink">Win / loss · {snapshot?.year ?? new Date().getUTCFullYear()}</h3>
        </div>
        <p className="text-xs text-ink-muted">
          No closed deals yet this year. Once a few opportunities reach{' '}
          <em>won</em> or <em>lost</em>, the funnel + reason mix will surface here.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink">Win / loss · {snapshot.year}</h3>
        <Link
          href="/crm/opportunities?stage=won"
          className="text-xs text-brand-700 hover:underline"
        >
          Open closed deals →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Won"
          value={snapshot.won_count.toString()}
          href="/crm/opportunities?stage=won"
          tone="success"
        />
        <Stat
          label="Lost"
          value={snapshot.lost_count.toString()}
          href="/crm/opportunities?stage=lost"
          tone="danger"
        />
        <Stat
          label="Win rate"
          value={snapshot.win_rate_pct !== null ? `${snapshot.win_rate_pct}%` : '—'}
          tone="brand"
        />
        <Stat
          label="Avg won value"
          value={formatEur(snapshot.avg_won_value_eur)}
          tone="brand"
        />
      </div>

      {(snapshot.top_won_reason || snapshot.top_loss_reason || snapshot.top_won_source) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          {snapshot.top_won_reason && (
            <Insight
              label="Top win reason"
              value={humanize(snapshot.top_won_reason)}
              tone="success"
            />
          )}
          {snapshot.top_loss_reason && (
            <Insight
              label="Top loss reason"
              value={humanize(snapshot.top_loss_reason)}
              tone="danger"
            />
          )}
          {snapshot.top_won_source && (
            <Insight
              label="Top winning source"
              value={humanize(snapshot.top_won_source)}
              tone="brand"
            />
          )}
        </div>
      )}
    </section>
  );
}

function Stat({
  label, value, href, tone,
}: {
  label: string;
  value: string;
  href?: string;
  tone: 'success' | 'danger' | 'brand';
}) {
  const toneClass = {
    success: 'text-success-700',
    danger:  'text-danger-700',
    brand:   'text-brand-700',
  }[tone];
  const body = (
    <div className="rounded border border-border bg-surface-alt/40 px-3 py-2">
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-semibold">{label}</div>
      <div className={`text-xl font-semibold tabular-nums leading-none mt-1 ${toneClass}`}>
        {value}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block hover:bg-surface-alt/50 rounded">{body}</Link> : body;
}

function Insight({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'danger' | 'brand';
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded border border-border bg-surface-alt/40 px-3 py-2">
      <span className="text-2xs uppercase tracking-wide text-ink-muted font-semibold">{label}</span>
      <Badge tone={tone} size="xs">{value}</Badge>
    </div>
  );
}
