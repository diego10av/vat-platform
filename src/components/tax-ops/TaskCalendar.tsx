'use client';

// Stint 57.D.6 — calendar view for the tasks list.
//
// Reuses the data already loaded by the list page (no extra fetch).
// Buckets tasks by due_date into a month grid (Mon–Sun, 6 weeks).
// Click a day → side panel shows every task due on that day. Click
// a task chip → navigate to detail. Day cells show top 3 chips and
// a "+N more" line.
//
// Pattern lifted from /crm/calendar — same density, same Mon-first
// layout, same prev / today / next nav.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

interface CalendarTask {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  priority: string;
  is_starred: boolean;
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'bg-danger-50 text-danger-800 border-danger-200',
  high:   'bg-amber-50 text-amber-800 border-amber-200',
  medium: 'bg-brand-50 text-brand-800 border-brand-200',
  low:    'bg-surface-alt text-ink-soft border-border',
};

interface Props {
  tasks: CalendarTask[];
}

export function TaskCalendar({ tasks }: Props) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthStart = new Date(cursor);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarTask[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const key = t.due_date.slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return m;
  }, [tasks]);

  // Mon-first 6-week grid (42 cells max).
  const gridDays = useMemo(() => {
    const start = new Date(monthStart);
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
      if (i >= 34 && d > monthEnd) break;
    }
    return cells;
  }, [monthStart, monthEnd]);

  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const selectedTasks = selectedDate ? (byDate.get(selectedDate) ?? []) : [];
  // Stint 58.T1.2 — empty state: if no task in the visible set has a
  // due_date, the calendar grid would be entirely blank without
  // explanation. Surface a banner so Diego knows it's by design.
  const hasAnyDate = byDate.size > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-ink">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; })}
            className="h-8 w-8 rounded-md border border-border bg-surface inline-flex items-center justify-center hover:bg-surface-alt"
            aria-label="Previous month"
          >
            <ChevronLeftIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
              setCursor(d); setSelectedDate(null);
            }}
            className="h-8 px-3 rounded-md border border-border bg-surface text-sm hover:bg-surface-alt"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCursor(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; })}
            className="h-8 w-8 rounded-md border border-border bg-surface inline-flex items-center justify-center hover:bg-surface-alt"
            aria-label="Next month"
          >
            <ChevronRightIcon size={14} />
          </button>
        </div>
      </div>

      {!hasAnyDate && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
          None of the tasks in this view have a <strong>due date</strong> set,
          so the calendar is empty. Add a due date in the list view (or detail
          page) to see tasks here.
        </div>
      )}

      <div className="grid grid-cols-[1fr,320px] gap-4">
        <div className="border border-border rounded-lg bg-surface overflow-hidden">
          <div className="grid grid-cols-7 bg-surface-alt/50 border-b border-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-2xs uppercase font-semibold text-ink-muted px-2 py-1.5 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDays.slice(0, gridDays.length > 35 ? 42 : 35).map((d) => {
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = d.getTime() === today.getTime();
              const isSelected = iso === selectedDate;
              const dayTasks = byDate.get(iso) ?? [];
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDate(iso)}
                  className={[
                    'min-h-[92px] border-b border-r border-border text-left p-1.5',
                    inMonth ? 'bg-surface' : 'bg-surface-alt/30',
                    isSelected ? 'ring-2 ring-brand-500 ring-inset' : 'hover:bg-surface-alt/50',
                  ].join(' ')}
                >
                  <div className={`text-xs tabular-nums ${
                    isToday ? 'font-bold text-brand-700'
                    : inMonth ? 'text-ink'
                    : 'text-ink-muted'
                  }`}>
                    {d.getDate()}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayTasks.slice(0, 3).map(t => (
                      <div
                        key={t.id}
                        className={`text-2xs leading-tight border rounded px-1 py-0.5 truncate ${PRIORITY_TONE[t.priority] ?? PRIORITY_TONE.medium} ${t.status === 'done' ? 'opacity-50 line-through' : ''}`}
                        title={t.title}
                      >
                        {t.is_starred ? '⭐ ' : ''}{t.title}
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <div className="text-2xs text-ink-muted italic">+{dayTasks.length - 3} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="border border-border rounded-lg bg-surface p-3 h-fit sticky top-4">
          {selectedDate ? (
            <>
              <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">
                {new Date(selectedDate).toLocaleDateString('en-GB', {
                  weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
                })}
              </div>
              {selectedTasks.length === 0 ? (
                <p className="text-sm text-ink-muted italic">No tasks due that day.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedTasks.map(t => (
                    <li
                      key={t.id}
                      className={`border rounded-md p-2 text-sm ${PRIORITY_TONE[t.priority] ?? PRIORITY_TONE.medium}`}
                    >
                      <div className="font-medium">
                        {t.is_starred && <span className="mr-1">⭐</span>}
                        {t.title}
                      </div>
                      <div className="text-xs opacity-80 mt-0.5">
                        {t.priority} · {t.status}
                      </div>
                      <Link
                        href={`/tax-ops/tasks/${t.id}`}
                        className="inline-block mt-1 text-xs underline opacity-80 hover:opacity-100"
                      >
                        Open →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted italic">Click a day to see its tasks.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
