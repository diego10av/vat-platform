'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm/calendar — month-view calendar that cross-cuts every date
// source in the CRM (contacts/opps/matters/tasks/invoices). Powered
// by /api/crm/upcoming?days=N — we request the window spanning the
// visible month, then bucket events per day.
//
// Zero chart/calendar dependencies; pure CSS grid + simple day cells.
// Click a day → side panel with every event on that date.
// ════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';

type EventType =
  | 'follow_up' | 'birthday' | 'anniversary'
  | 'opp_close' | 'opp_next_action'
  | 'matter_close' | 'task_due' | 'invoice_due';

interface CalEvent {
  id: string;
  type: EventType;
  date: string;
  title: string;
  detail?: string;
  link: string;
}

interface Response {
  days: number;
  events: CalEvent[];
}

const TYPE_META: Record<EventType, { icon: string; label: string; tone: string }> = {
  follow_up:       { icon: '📞', label: 'Follow-up',     tone: 'bg-brand-50 text-brand-800 border-brand-200' },
  birthday:        { icon: '🎂', label: 'Birthday',      tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  anniversary:     { icon: '🥂', label: 'Anniversary',   tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  opp_close:       { icon: '🏁', label: 'Deal close',    tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  opp_next_action: { icon: '🎯', label: 'Deal action',   tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  matter_close:    { icon: '⚖️', label: 'Matter close',  tone: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  task_due:        { icon: '☑️', label: 'Task',          tone: 'bg-surface-alt text-ink-soft border-border' },
  invoice_due:     { icon: '💶', label: 'Invoice due',   tone: 'bg-danger-50 text-danger-800 border-danger-200' },
};

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Month boundaries.
  const monthStart = new Date(cursor);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

  // We load a 90-day window (enough to cover any visible month + a
  // bit of cushion for prev/next month cells). The endpoint caps at
  // 90 days max so this is safe.
  const { data, error, isLoading, refetch } = useCrmFetch<Response>('/api/crm/upcoming?days=90');

  // Bucket events by YYYY-MM-DD for the visible month.
  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of data?.events ?? []) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [data]);

  // Grid cells — from Monday of the week containing monthStart to
  // Sunday of the week containing monthEnd. 6 weeks × 7 days = 42 max.
  const gridDays = useMemo(() => {
    const startOfGrid = new Date(monthStart);
    // Monday = 1, Sunday = 0 — shift so Monday is the first column.
    const dayOfWeek = (startOfGrid.getDay() + 6) % 7;
    startOfGrid.setDate(startOfGrid.getDate() - dayOfWeek);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startOfGrid);
      d.setDate(startOfGrid.getDate() + i);
      cells.push(d);
      if (i >= 34 && d > monthEnd) break;  // stop if we've already covered month-end
    }
    return cells;
  }, [monthStart, monthEnd]);

  const selectedEvents = selectedDate ? (byDate.get(selectedDate) ?? []) : [];
  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div>
      <div className="text-[11.5px] text-ink-muted mb-2">
        <Link href="/crm" className="hover:underline">← CRM home</Link>
      </div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><CalendarIcon size={18} />Calendar</span>}
        subtitle="Every date-driven event across your CRM."
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCursor(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; })}
              className="h-8 w-8 rounded-md border border-border bg-white inline-flex items-center justify-center hover:bg-surface-alt"
              title="Previous month"
            >
              <ChevronLeftIcon size={14} />
            </button>
            <button
              onClick={() => {
                const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
                setCursor(d); setSelectedDate(null);
              }}
              className="h-8 px-3 rounded-md border border-border bg-white text-[12px] hover:bg-surface-alt"
            >
              Today
            </button>
            <button
              onClick={() => setCursor(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; })}
              className="h-8 w-8 rounded-md border border-border bg-white inline-flex items-center justify-center hover:bg-surface-alt"
              title="Next month"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
        }
      />

      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={refetch} /></div>}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[16px] font-semibold text-ink">{monthLabel}</h2>
        {isLoading && <span className="text-[11px] text-ink-muted italic">Loading events…</span>}
      </div>

      <div className="grid grid-cols-[1fr,320px] gap-4">
        {/* Calendar grid */}
        <div className="border border-border rounded-lg bg-white overflow-hidden">
          <div className="grid grid-cols-7 bg-surface-alt/50 border-b border-border">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
              <div key={d} className="text-[10.5px] uppercase font-semibold text-ink-muted px-2 py-1.5 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDays.slice(0, gridDays.length > 35 ? 42 : 35).map((d) => {
              const iso = d.toISOString().slice(0, 10);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = d.getTime() === today.getTime();
              const isSelected = iso === selectedDate;
              const events = byDate.get(iso) ?? [];
              return (
                <button
                  key={iso}
                  onClick={() => setSelectedDate(iso)}
                  className={`min-h-[92px] border-b border-r border-border text-left p-1.5 ${
                    inMonth ? 'bg-white' : 'bg-surface-alt/30'
                  } ${isSelected ? 'ring-2 ring-brand-500 ring-inset' : 'hover:bg-surface-alt/60'}`}
                >
                  <div className={`text-[11.5px] tabular-nums ${isToday ? 'font-bold text-brand-700' : inMonth ? 'text-ink' : 'text-ink-muted'}`}>
                    {d.getDate()}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {events.slice(0, 3).map(e => (
                      <div
                        key={e.id}
                        className={`text-[10px] leading-tight border rounded px-1 py-0.5 truncate ${TYPE_META[e.type].tone}`}
                        title={e.title}
                      >
                        {TYPE_META[e.type].icon} {e.title}
                      </div>
                    ))}
                    {events.length > 3 && (
                      <div className="text-[9.5px] text-ink-muted italic">+{events.length - 3} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        <aside className="border border-border rounded-lg bg-white p-3 h-fit sticky top-4">
          {selectedDate ? (
            <>
              <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
                {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
              {selectedEvents.length === 0 ? (
                <p className="text-[12px] text-ink-muted italic">Nothing scheduled on this day.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedEvents.map(e => (
                    <li key={e.id} className={`border rounded-md p-2 text-[12px] ${TYPE_META[e.type].tone}`}>
                      <div className="flex items-start gap-1.5">
                        <span>{TYPE_META[e.type].icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{e.title}</div>
                          {e.detail && <div className="text-[11px] opacity-80 mt-0.5">{e.detail}</div>}
                          <Link href={e.link} className="inline-block mt-1 text-[11px] underline opacity-80 hover:opacity-100">
                            Open →
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-[12px] text-ink-muted italic">Click a day to see its events.</p>
          )}
        </aside>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-2 text-[10.5px]">
        {(Object.keys(TYPE_META) as EventType[]).map(t => (
          <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${TYPE_META[t].tone}`}>
            {TYPE_META[t].icon} {TYPE_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}
