'use client';

// ════════════════════════════════════════════════════════════════════════
// /tax-ops home — 4 actionable widgets (5th "upcoming tasks" ships
// with the tasks surface in 34.E).
//
// Principle: every row is clickable into the relevant filing detail,
// where Diego can take the next step (push status, upload assessment,
// chase CSP, etc.). No vanity counts; each widget surfaces rows that
// need action now (§11 actionable-first).
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  AlertCircleIcon, ClockIcon, HourglassIcon, ChevronRightIcon, FileQuestionIcon,
} from 'lucide-react';
import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';

interface ActionableFiling {
  id: string;
  entity_id: string;
  entity_name: string;
  group_name: string | null;
  tax_type: string;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  draft_sent_at: string | null;
  filed_at: string | null;
}

interface NextActionsResponse {
  deadline_radar: ActionableFiling[];
  stale_assessments: ActionableFiling[];
  pending_my_action: ActionableFiling[];
  pending_client_approval: ActionableFiling[];
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function FilingRow({ f, subLine }: { f: ActionableFiling; subLine?: string }) {
  return (
    <Link
      href={`/tax-ops/filings/${f.id}`}
      className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-alt transition-colors text-sm"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-ink truncate">{f.entity_name}</div>
        <div className="text-xs text-ink-muted truncate">
          {f.group_name && <span className="mr-2">{f.group_name}</span>}
          {humanTaxType(f.tax_type)} · {f.period_label}
          {subLine && <span className="ml-2">· {subLine}</span>}
        </div>
      </div>
      <div className="shrink-0 text-xs">
        <DateBadge value={f.deadline_date} mode="urgency" />
      </div>
      <ChevronRightIcon size={14} className="text-ink-faint shrink-0" />
    </Link>
  );
}

interface WidgetProps {
  title: string;
  subtitle: string;
  icon: typeof AlertCircleIcon;
  tone: 'red' | 'amber' | 'blue' | 'grey';
  count: number;
  children: React.ReactNode;
}

const TONE_HEADER: Record<WidgetProps['tone'], string> = {
  red:   'bg-danger-50/30 border-l-4 border-danger-500',
  amber: 'bg-amber-50/30  border-l-4 border-amber-500',
  blue:  'bg-brand-50/30  border-l-4 border-brand-500',
  grey:  'bg-surface-alt  border-l-4 border-border-strong',
};

function WidgetShell({ title, subtitle, icon: Icon, tone, count, children }: WidgetProps) {
  return (
    <div className="rounded-md border border-border bg-surface">
      <div className={`flex items-start gap-2 px-3 py-2 ${TONE_HEADER[tone]}`}>
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-ink">
            {title}
            <span className="ml-2 text-xs font-normal text-ink-muted tabular-nums">({count})</span>
          </div>
          <div className="text-xs text-ink-muted">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyWidget({ message }: { message: string }) {
  return <div className="px-3 py-3 text-sm text-ink-muted italic">{message}</div>;
}

export function TaxOpsHomeWidgets() {
  const { data, error, refetch, isLoading } = useCrmFetch<NextActionsResponse>('/api/tax-ops/next-actions');

  if (error) return <CrmErrorBox message={error} onRetry={refetch} />;

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-md border border-border bg-surface h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  // Stint 59.B — re-laid out as 2×2 grid (was 1 + 2-cols + 1).
  // Three "actionable" widgets in the grid (deadline / my action / client
  // approval), and Stale full-width below as a "low-frequency" hint that
  // doesn't compete for attention with the daily-action widgets.
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <WidgetShell
          title="Deadline radar — next 30d"
          subtitle="Filings due soon, not yet filed/paid/waived."
          icon={AlertCircleIcon}
          tone="red"
          count={data.deadline_radar.length}
        >
          {data.deadline_radar.length === 0
            ? <EmptyWidget message="No filings due in 30 days. Clear runway." />
            : data.deadline_radar.map(f => <FilingRow key={f.id} f={f} />)}
        </WidgetShell>

        <WidgetShell
          title="Pending my action"
          subtitle="Info-gather or in-progress work waiting on you."
          icon={ClockIcon}
          tone="amber"
          count={data.pending_my_action.length}
        >
          {data.pending_my_action.length === 0
            ? <EmptyWidget message="Nothing actively waiting on you. Enjoy." />
            : data.pending_my_action.map(f => (
                <FilingRow key={f.id} f={f} subLine={f.status.replace('_', ' ')} />
              ))}
        </WidgetShell>

        <WidgetShell
          title="Pending client approval (>7d)"
          subtitle="Drafts sent that clients haven't approved yet."
          icon={HourglassIcon}
          tone="amber"
          count={data.pending_client_approval.length}
        >
          {data.pending_client_approval.length === 0
            ? <EmptyWidget message="No stale drafts. Clients are responsive." />
            : data.pending_client_approval.map(f => (
                <FilingRow
                  key={f.id}
                  f={f}
                  subLine={f.draft_sent_at ? `sent ${new Date(f.draft_sent_at).toLocaleDateString()}` : undefined}
                />
              ))}
        </WidgetShell>

        <WidgetShell
          title="Stale assessments (>180d)"
          subtitle="Filed long ago, still no AED assessment. Worth chasing."
          icon={FileQuestionIcon}
          tone="grey"
          count={data.stale_assessments.length}
        >
          {data.stale_assessments.length === 0
            ? <EmptyWidget message="All filed returns have an assessment." />
            : data.stale_assessments.map(f => (
                <FilingRow
                  key={f.id}
                  f={f}
                  subLine={f.filed_at ? `filed ${new Date(f.filed_at).toLocaleDateString()}` : undefined}
                />
              ))}
        </WidgetShell>
      </div>
    </div>
  );
}
