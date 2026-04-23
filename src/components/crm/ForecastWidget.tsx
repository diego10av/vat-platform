'use client';

// ════════════════════════════════════════════════════════════════════════
// ForecastWidget — "Weighted pipeline this Q" on the CRM home. A
// single card showing the sum of crm_opportunities.weighted_value_eur
// for open opps closing this quarter, with count + quarter label.
//
// Actionable-first (CLAUDE.md §2 Rule §11): clicking the card drills
// into /crm/opportunities filtered for current-quarter close dates.
// Empty state explicitly reuses the <EmptyState> primitive so the
// home doesn't flash a "€0 · 0 opps" skeleton that looks broken.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { TargetIcon, ChevronRightIcon } from 'lucide-react';
import { formatEur } from '@/lib/crm-types';
import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';

interface ForecastData {
  weighted_total_eur: number;
  opportunity_count: number;
  quarter_label: string;
  quarter_start: string | null;
  quarter_end: string | null;
}

export function ForecastWidget() {
  const { data, error, isLoading, refetch } = useCrmFetch<ForecastData>('/api/crm/forecast');

  if (error) return <CrmErrorBox message={error} onRetry={refetch} compact />;
  if (!data || isLoading) {
    return (
      <div className="border border-border rounded-lg bg-white p-4 min-h-[110px] text-[12px] text-ink-muted italic flex items-center justify-center">
        Computing weighted pipeline…
      </div>
    );
  }

  const hasOpps = data.opportunity_count > 0;
  const qParam = data.quarter_start
    ? `?close_from=${data.quarter_start.slice(0, 10)}&close_to=${data.quarter_end?.slice(0, 10) ?? ''}`
    : '';

  return (
    <Link
      href={`/crm/opportunities${qParam}`}
      className="block border border-border rounded-lg bg-white p-4 hover:border-border-strong hover:bg-surface-alt/40 transition-colors group"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <TargetIcon size={13} className="text-brand-600" />
          <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
            Weighted pipeline · {data.quarter_label}
          </span>
        </div>
        <ChevronRightIcon size={14} className="text-ink-muted group-hover:text-ink transition-colors" />
      </div>
      {hasOpps ? (
        <>
          <div className="text-[22px] font-semibold tabular-nums text-ink">
            {formatEur(data.weighted_total_eur)}
          </div>
          <div className="text-[11.5px] text-ink-muted mt-0.5">
            across {data.opportunity_count} open opportunit{data.opportunity_count === 1 ? 'y' : 'ies'}
          </div>
        </>
      ) : (
        <>
          <div className="text-[14px] text-ink-muted italic">Nothing closing this quarter yet.</div>
          <div className="text-[11.5px] text-ink-muted mt-0.5">Add close dates to open opps so they surface here.</div>
        </>
      )}
    </Link>
  );
}
