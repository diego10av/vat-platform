'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarIcon, AlertTriangleIcon, ClockIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Stat } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface DeadlineRow {
  entity_id: string; entity_name: string;
  regime: string; frequency: string;
  declaration_id: string | null; declaration_status: string;
  year: number; period: string;
  due_date: string; days_until: number; is_overdue: boolean;
  bucket: 'overdue' | 'urgent' | 'soon' | 'comfortable' | 'far';
  description: string;
}

export default function DeadlinesPage() {
  const [rows, setRows] = useState<DeadlineRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue'>('all');

  useEffect(() => {
    fetch('/api/deadlines').then(r => r.json()).then(setRows);
  }, []);

  if (!rows) return <PageSkeleton />;

  let visible = rows;
  if (filter === 'open') visible = rows.filter(r => r.declaration_status !== 'paid');
  if (filter === 'overdue') visible = rows.filter(r => r.is_overdue);
  visible = [...visible].sort((a, b) => a.days_until - b.days_until);

  const counts = {
    all: rows.length,
    overdue: rows.filter(r => r.is_overdue).length,
    urgent: rows.filter(r => r.bucket === 'urgent').length,
    soon: rows.filter(r => r.bucket === 'soon').length,
  };

  return (
    <div>
      <PageHeader
        title="Deadlines"
        subtitle="Next filing deadline per entity, computed from the declaration period and Luxembourg AED rules."
        actions={
          <div className="flex gap-1">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
            <Chip active={filter === 'open'} onClick={() => setFilter('open')}>Open</Chip>
            <Chip active={filter === 'overdue'} onClick={() => setFilter('overdue')}>Overdue ({counts.overdue})</Chip>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? 'danger' : 'muted'} />
        <Stat label="Due in 7 days" value={counts.urgent} tone={counts.urgent > 0 ? 'warning' : 'muted'} />
        <Stat label="Due in 30 days" value={counts.soon} tone="warning" />
        <Stat label="Tracked entities" value={counts.all} />
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={22} />}
            title="Nothing here"
            description="No items match this filter. Try 'All' to see the full list."
          />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt border-b border-divider text-ink-muted">
              <tr>
                <Th>Entity</Th>
                <Th>Regime · Freq.</Th>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th>Due date</Th>
                <Th align="right">Time left</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.entity_id + r.year + r.period} className="border-b border-divider last:border-0 hover:bg-surface-alt/60 transition-colors duration-150">
                  <td className="px-4 py-3">
                    <Link href={`/entities/${r.entity_id}`} className="font-medium text-ink hover:text-brand-600 transition-colors">
                      {r.entity_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft capitalize">{r.regime} · {r.frequency}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.year} {r.period}</td>
                  <td className="px-4 py-3"><StatusPill status={r.declaration_status} /></td>
                  <td className="px-4 py-3 text-ink-soft tabular-nums">{formatDate(r.due_date)}</td>
                  <td className="px-4 py-3 text-right"><BucketBadge bucket={r.bucket} days={r.days_until} /></td>
                  <td className="px-4 py-3 text-right">
                    {r.declaration_id ? (
                      <Link href={`/declarations/${r.declaration_id}`} className="text-brand-600 hover:text-brand-700 text-[11.5px] font-medium transition-colors">Open</Link>
                    ) : (
                      <Link href={`/declarations?entity_id=${r.entity_id}`} className="text-brand-600 hover:text-brand-700 text-[11.5px] font-medium transition-colors">Create</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-2.5 font-medium text-[10.5px] uppercase tracking-[0.06em] ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-md text-[12.5px] font-medium transition-all duration-150 ${
        active ? 'bg-brand-500 text-white shadow-xs' : 'bg-surface border border-border text-ink-soft hover:bg-surface-alt'
      }`}
    >
      {children}
    </button>
  );
}

function BucketBadge({ bucket, days }: { bucket: DeadlineRow['bucket']; days: number }) {
  if (bucket === 'overdue') return <Badge tone="danger" icon={<AlertTriangleIcon size={10} />}>{Math.abs(days)}d overdue</Badge>;
  if (bucket === 'urgent') return <Badge tone="warning" icon={<ClockIcon size={10} />}>{days}d</Badge>;
  if (bucket === 'soon') return <Badge tone="amber">{days}d</Badge>;
  if (bucket === 'comfortable') return <Badge tone="info">{days}d</Badge>;
  return <Badge tone="neutral">{days}d</Badge>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: 'neutral' | 'info' | 'violet' | 'amber' | 'warning' | 'success' | 'teal'; label: string }> = {
    not_started: { tone: 'neutral', label: 'Not started' },
    created:     { tone: 'neutral', label: 'Created' },
    uploading:   { tone: 'info',    label: 'Uploading' },
    extracting:  { tone: 'violet',  label: 'Extracting' },
    classifying: { tone: 'amber',   label: 'Classifying' },
    review:      { tone: 'warning', label: 'Review' },
    approved:    { tone: 'success', label: 'Approved' },
    filed:       { tone: 'teal',    label: 'Filed' },
    paid:        { tone: 'success', label: 'Paid' },
  };
  const { tone, label } = map[status] || { tone: 'neutral' as const, label: status };
  return <Badge tone={tone}>{label}</Badge>;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}
