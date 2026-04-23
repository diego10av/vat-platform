'use client';

// ════════════════════════════════════════════════════════════════════════
// UpcomingThisWeekWidget — unified "what's hitting in the next 7 days"
// list on the CRM home. Pulls from /api/crm/upcoming (date-driven
// feed across contacts/opps/matters/tasks/invoices).
//
// Distinct from NBA: NBA ranks actions by priority (urgency score);
// this surfaces EVENTS ordered by date. The two are complementary —
// NBA tells you what to do, this tells you what's coming.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { CalendarDaysIcon, ChevronRightIcon } from 'lucide-react';
import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';

type EventType =
  | 'follow_up' | 'birthday' | 'anniversary'
  | 'opp_close' | 'opp_next_action'
  | 'matter_close' | 'task_due' | 'invoice_due';

interface UpcomingEvent {
  id: string;
  type: EventType;
  date: string;
  title: string;
  detail?: string;
  link: string;
}

interface UpcomingResponse {
  days: number;
  events: UpcomingEvent[];
}

const TYPE_ICON: Record<EventType, string> = {
  follow_up:       '📞',
  birthday:        '🎂',
  anniversary:     '🥂',
  opp_close:       '🏁',
  opp_next_action: '🎯',
  matter_close:    '⚖️',
  task_due:        '☑️',
  invoice_due:     '💶',
};

const TYPE_LABEL: Record<EventType, string> = {
  follow_up:       'Follow-up',
  birthday:        'Birthday',
  anniversary:     'Anniversary',
  opp_close:       'Deal close',
  opp_next_action: 'Deal action',
  matter_close:    'Matter close',
  task_due:        'Task',
  invoice_due:     'Invoice due',
};

export function UpcomingThisWeekWidget() {
  const { data, error, isLoading, refetch } = useCrmFetch<UpcomingResponse>('/api/crm/upcoming?days=7');

  if (error) return <CrmErrorBox message={error} onRetry={refetch} />;
  if (!data || isLoading) {
    return <div className="text-[12px] text-ink-muted italic px-3 py-6">Computing upcoming events…</div>;
  }

  const events = data.events;
  if (events.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-white p-4">
        <div className="flex items-center gap-2 mb-2">
          <CalendarDaysIcon size={14} className="text-brand-600" />
          <h2 className="text-[13px] uppercase tracking-wide font-semibold text-ink-muted">Upcoming · next 7 days</h2>
        </div>
        <p className="text-[13px] text-ink-soft">Nothing scheduled. Good week to log time and chase invoices.</p>
        <p className="text-[11.5px] text-ink-muted mt-1 italic">
          Tip: add <code className="font-mono">next_follow_up</code> on contacts, <code className="font-mono">estimated_close_date</code> on opps, or <code className="font-mono">closing_date</code> on matters to populate this view.
        </p>
      </div>
    );
  }

  // Group events by date so the list has visual day markers.
  const groups = new Map<string, UpcomingEvent[]>();
  for (const e of events) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date)!.push(e);
  }

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon size={14} className="text-brand-600" />
          <h2 className="text-[13px] uppercase tracking-wide font-semibold text-ink-muted">
            Upcoming · next 7 days
          </h2>
        </div>
        <Link href="/crm/calendar" className="text-[11px] text-brand-700 hover:underline inline-flex items-center gap-0.5">
          Full calendar <ChevronRightIcon size={11} />
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {Array.from(groups.entries()).map(([date, dayEvents]) => (
          <li key={date} className="p-3">
            <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
              {formatDateHeader(date)}
            </div>
            <ul className="space-y-1">
              {dayEvents.map(e => (
                <li key={e.id}>
                  <Link
                    href={e.link}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-alt/60 text-[12.5px]"
                  >
                    <span className="shrink-0 text-[14px] leading-none w-5" aria-label={TYPE_LABEL[e.type]}>{TYPE_ICON[e.type]}</span>
                    <span className="flex-1 min-w-0 truncate text-ink">{e.title}</span>
                    {e.detail && <span className="shrink-0 text-[11px] text-ink-muted truncate max-w-[200px]">{e.detail}</span>}
                    <ChevronRightIcon size={12} className="shrink-0 text-ink-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

// "Mon 5 Jul" etc. — compact date header for the grouped list.
function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const daysDelta = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  if (daysDelta === 0) return `Today · ${label}`;
  if (daysDelta === 1) return `Tomorrow · ${label}`;
  return label;
}
