'use client';

// EntityTasksWidget — stint 51.A.
// Surfaces all tasks linked to a given entity (via either entity_id or
// the legacy related_entity_id) on the entity detail page. Diego asked
// for "tax que se han realizado, las que están pendientes, las que se
// tienen que hacer, follow up" → 3 buckets:
//   1. Pending      (status ∈ {queued, in_progress, waiting_*})
//   2. Follow-up    (follow_up_date ≤ today + 7d) — chase soon
//   3. Done         (status = done, completed in the last 90 days)
//
// Cancelled tasks and old-done are hidden by default to keep the widget
// focused on what's actionable. Clicking any task opens its detail page.

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  follow_up_date: string | null;
  assignee: string | null;
  task_kind: string | null;
  completed_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  waiting_on_external: 'Waiting (ext)',
  waiting_on_internal: 'Waiting (int)',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<string, string> = {
  queued: 'bg-surface-alt text-ink-muted',
  in_progress: 'bg-info-50 text-info-800',
  waiting_on_external: 'bg-warning-50 text-warning-800',
  waiting_on_internal: 'bg-warning-50 text-warning-800',
  done: 'bg-success-50 text-success-800',
  cancelled: 'bg-surface-alt text-ink-faint',
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'text-danger-700',
  high: 'text-warning-700',
  medium: 'text-ink-muted',
  low: 'text-ink-faint',
};

interface Props {
  entityId: string;
}

export function EntityTasksWidget({ entityId }: Props) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tax-ops/tasks?entity_id=${encodeURIComponent(entityId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { tasks: Task[] };
        if (!cancelled) {
          setTasks(body.tasks ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e instanceof Error ? e.message : e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [entityId]);

  if (error) {
    return (
      <div className="rounded-md border border-danger-200 bg-danger-50/40 px-4 py-3 text-sm text-danger-800">
        Couldn&apos;t load tasks: {error}
      </div>
    );
  }

  if (!tasks) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-ink-muted">
        Loading tasks…
      </div>
    );
  }

  // Bucket the tasks. A single task can match Follow-up + Pending; we
  // surface it in Follow-up (the more urgent bucket) and skip from Pending.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const followUpCutoff = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  const followUp: Task[] = [];
  const pending: Task[] = [];
  const done: Task[] = [];

  for (const t of tasks) {
    if (t.status === 'done') {
      const completedAt = t.completed_at ? new Date(t.completed_at) : null;
      if (completedAt && completedAt >= ninetyDaysAgo) done.push(t);
      continue;
    }
    if (t.status === 'cancelled') continue;
    const followDate = t.follow_up_date ? new Date(t.follow_up_date) : null;
    if (followDate && followDate <= followUpCutoff) {
      followUp.push(t);
    } else {
      pending.push(t);
    }
  }

  const totalActionable = followUp.length + pending.length;
  const newTaskHref = `/tax-ops/tasks?new=1&entity_id=${encodeURIComponent(entityId)}`;

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink">
          Tasks <span className="text-xs font-normal text-ink-muted">({totalActionable} pending · {done.length} done)</span>
        </h3>
        <Link
          href={newTaskHref}
          className="text-xs text-brand-700 hover:text-brand-800"
        >
          + New task for this entity
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-ink-muted italic">
          No tasks linked to this entity yet. Press <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-alt text-2xs">N</kbd> to capture one.
        </p>
      ) : (
        <div className="space-y-3">
          {followUp.length > 0 && (
            <Bucket title="Follow-up due" tone="warning" tasks={followUp} />
          )}
          {pending.length > 0 && (
            <Bucket title="Pending" tone="default" tasks={pending} />
          )}
          {done.length > 0 && (
            <Bucket title="Done · last 90 days" tone="muted" tasks={done} />
          )}
        </div>
      )}
    </div>
  );
}

function Bucket({
  title, tone, tasks,
}: { title: string; tone: 'warning' | 'default' | 'muted'; tasks: Task[] }) {
  const headerTone =
    tone === 'warning' ? 'text-warning-800'
    : tone === 'muted' ? 'text-ink-muted'
    : 'text-ink';
  return (
    <div>
      <div className={`text-xs font-semibold mb-1 ${headerTone}`}>
        {title} <span className="text-ink-faint font-normal">({tasks.length})</span>
      </div>
      <ul className="space-y-1">
        {tasks.map(t => (
          <li key={t.id}>
            <Link
              href={`/tax-ops/tasks/${t.id}`}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-alt/50 text-sm"
            >
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs ${STATUS_TONE[t.status] ?? 'bg-surface-alt'}`}>
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
              <span className="flex-1 text-ink truncate">{t.title}</span>
              {t.priority && t.priority !== 'medium' && (
                <span className={`text-2xs ${PRIORITY_TONE[t.priority] ?? ''}`}>
                  {t.priority}
                </span>
              )}
              {t.due_date && (
                <span className="text-2xs text-ink-faint shrink-0">
                  due {t.due_date}
                </span>
              )}
              {t.follow_up_date && (
                <span className="text-2xs text-warning-700 shrink-0">
                  ↻ {t.follow_up_date}
                </span>
              )}
              {t.assignee && (
                <span className="text-2xs text-ink-faint shrink-0">
                  · {t.assignee}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
