'use client';

// /tax-ops home widget — "Tasks due this week" (stint 40.J).
//
// Diego's feedback: "lo de task está vinculado al calendario y que me
// aparecerían alertas cuando tuviese que hacer algo. Si me digo fecha
// límite para hacer esto el lunes, pues que me salga una alerta el
// lunes en plan de 'oye, esto hay que actuar ya'. Eso estaría bien que
// saliese en Overview de tax operation."
//
// Fetches open tasks due within 7 days and renders up to 8, sorted by
// due_date ascending. Each row links to the task (or its related
// filing) for one-click action.

import Link from 'next/link';
import { CheckSquareIcon, ChevronRightIcon } from 'lucide-react';
import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string | null;
  related_entity_id: string | null;
  related_entity_name: string | null;
  related_filing_id: string | null;
  related_filing_label: string | null;
}

interface TaskListResponse {
  tasks: TaskRow[];
  total: number;
}

const OPEN_STATUS = ['queued', 'in_progress', 'waiting_on_external', 'waiting_on_internal'];

function priorityTone(priority: string): string {
  if (priority === 'urgent') return 'text-danger-700';
  if (priority === 'high')   return 'text-amber-700';
  if (priority === 'medium') return 'text-ink';
  return 'text-ink-muted';
}

export function TasksDueWidget() {
  const params = new URLSearchParams();
  params.set('due_in_days', '7');
  for (const s of OPEN_STATUS) params.append('status', s);
  params.set('page_size', '8');
  const { data, error, refetch, isLoading } = useCrmFetch<TaskListResponse>(
    `/api/tax-ops/tasks?${params.toString()}`,
  );

  if (error) return <CrmErrorBox message={error} onRetry={refetch} />;
  if (isLoading || !data) {
    return <div className="rounded-md border border-border bg-surface h-24 animate-pulse" />;
  }

  const tasks = data.tasks ?? [];
  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/30 border-l-4 border-amber-500">
        <CheckSquareIcon size={14} className="text-amber-600" />
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-ink">Tasks due this week</div>
          <div className="text-[11px] text-ink-muted">
            Open tasks with due_date in the next 7 days.
          </div>
        </div>
        <div className="inline-flex items-center text-[11px] text-ink-muted">
          <span className="mr-1">{tasks.length} of {data.total}</span>
          <Link
            href="/tax-ops/tasks?due_in_days=7"
            className="text-brand-700 hover:text-brand-900 underline"
          >
            See all
          </Link>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-ink-muted italic">
          No tasks due this week. You&apos;re ahead.
        </div>
      ) : (
        <ul>
          {tasks.map(t => {
            const href = t.related_filing_id
              ? `/tax-ops/filings/${t.related_filing_id}`
              : '/tax-ops/tasks';
            const subParts: string[] = [];
            if (t.related_entity_name) subParts.push(t.related_entity_name);
            if (t.related_filing_label) subParts.push(t.related_filing_label);
            if (t.assignee) subParts.push(`@${t.assignee}`);
            return (
              <li key={t.id} className="border-b border-border last:border-b-0">
                <Link
                  href={href}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-surface-alt transition-colors text-[12.5px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${priorityTone(t.priority)}`}>
                      {t.title}
                    </div>
                    {subParts.length > 0 && (
                      <div className="text-[11.5px] text-ink-muted truncate">
                        {subParts.join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <DateBadge value={t.due_date} mode="urgency" />
                  </div>
                  <ChevronRightIcon size={14} className="text-ink-faint shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
