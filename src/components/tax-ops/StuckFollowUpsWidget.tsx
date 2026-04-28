'use client';

// ════════════════════════════════════════════════════════════════════════
// StuckFollowUpsWidget — stint 64.L Layer 3
//
// Compact card on /tax-ops home that surfaces the count of filings
// stuck waiting on the client. Click-through opens
// /tax-ops/cit?needs_follow_up=1 with the toolbar toggle pre-active.
//
// Renders nothing if there's nothing stuck — clean home page when
// you're caught up. Renders a colored banner when there's red work.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { ClockIcon, ChevronRightIcon } from 'lucide-react';
import { useCrmFetch } from '@/lib/useCrmFetch';

interface StuckSummary {
  summary: { total: number; red: number; amber: number; oldest_days: number };
  items: Array<{
    filing_id: string;
    entity_name: string;
    group_name: string | null;
    tax_type: string;
    service_kind: string;
    period_label: string;
    days_stuck: number;
    tone: 'amber' | 'red';
  }>;
}

function describeKind(taxType: string, serviceKind: string): string {
  if (serviceKind === 'provision') {
    if (taxType === 'cit_annual') return 'CIT Provision';
    if (taxType === 'nwt_annual') return 'NWT Provision';
    return 'Provision';
  }
  if (serviceKind === 'review') {
    if (taxType === 'nwt_annual') return 'NWT Review';
    return 'Review';
  }
  return taxType.replace(/_/g, ' ');
}

export function StuckFollowUpsWidget() {
  const { data, isLoading } = useCrmFetch<StuckSummary>('/api/tax-ops/stuck-followups');

  // Loading skeleton matches the shape of a populated card so the
  // home page doesn't reflow on first paint.
  if (isLoading || !data) {
    return <div className="rounded-md border border-border bg-surface h-20 animate-pulse" />;
  }

  // Caught-up state. Don't add visual noise when there's nothing to
  // chase — Hard rule §11 (actionable-first).
  if (data.summary.total === 0) return null;

  const { red, amber, oldest_days, total } = data.summary;
  const tone = red > 0 ? 'red' : 'amber';
  const headerClass = tone === 'red'
    ? 'bg-danger-50/30 border-l-4 border-danger-500'
    : 'bg-amber-50/30 border-l-4 border-amber-500';

  // Top 4 stuck rows preview — same density as TaxOpsHomeWidgets.
  const preview = data.items.slice(0, 4);

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className={`flex items-start gap-2 px-3 py-2 ${headerClass}`}>
        <ClockIcon size={16} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-ink">
            Stuck — needs follow-up
            <span className="ml-2 text-xs font-normal text-ink-muted tabular-nums">({total})</span>
          </div>
          <div className="text-xs text-ink-muted">
            {red > 0 && <><strong className="text-danger-700">{red} red</strong> · </>}
            {amber > 0 && <><strong className="text-amber-700">{amber} amber</strong> · </>}
            oldest {oldest_days}d. Provision + NWT Review cells waiting on the client too long.
          </div>
        </div>
        <Link
          href="/tax-ops/cit?needs_follow_up=1"
          className="shrink-0 text-xs text-brand-700 hover:underline self-center"
          title="Open Form 500 with the 'Needs follow-up' filter pre-active"
        >
          Open →
        </Link>
      </div>
      <div>
        {preview.map(it => (
          <Link
            key={it.filing_id}
            href={`/tax-ops/filings/${it.filing_id}`}
            className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-alt transition-colors text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-ink truncate">{it.entity_name}</div>
              <div className="text-xs text-ink-muted truncate">
                {it.group_name && <span className="mr-2">{it.group_name}</span>}
                {describeKind(it.tax_type, it.service_kind)} · {it.period_label}
              </div>
            </div>
            <span
              className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${
                it.tone === 'red'
                  ? 'bg-red-100 text-red-900 border border-red-300'
                  : 'bg-amber-100 text-amber-900 border border-amber-300'
              }`}
              title={`${it.days_stuck} days stuck`}
            >
              ⏰ {it.days_stuck}d
            </span>
            <ChevronRightIcon size={14} className="text-ink-faint shrink-0" />
          </Link>
        ))}
        {data.items.length > preview.length && (
          <Link
            href="/tax-ops/cit?needs_follow_up=1"
            className="block px-3 py-2 text-xs text-ink-muted hover:bg-surface-alt hover:text-ink transition-colors"
          >
            + {data.items.length - preview.length} more — open Form 500 to see all →
          </Link>
        )}
      </div>
    </div>
  );
}
