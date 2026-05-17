'use client';

// ════════════════════════════════════════════════════════════════════════
// ActionsDueWidget — successor to NextBestActionWidget. Same ranked
// NBA feed, with execution controls inline on each row:
//   - Tasks:   checkbox to mark done + snooze 3 days
//   - All:     click-through to the record itself.
//
// Stint 95 — removed the "Draft email" button that delegated to
// DraftEmailButton (Haiku-generated email body, copy-paste flow).
// Diego doesn't have Outlook integration and never used the AI-drafted
// bodies — they were noise per row. The click-through to the record
// remains, so Diego can navigate + take action manually.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircleIcon, ClockIcon, EuroIcon, TargetIcon, UserMinusIcon, CheckSquareIcon,
  ChevronRightIcon, RefreshCwIcon, CheckIcon, ClockArrowUpIcon,
} from 'lucide-react';
import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';

type ActionType =
  | 'task' | 'invoice_overdue' | 'opp_stuck' | 'opp_next_action'
  | 'dormant_key_account' | 'contact_follow_up' | 'matter_closing_soon'
  | 'opp_close_overdue';

interface NextAction {
  id: string;
  type: ActionType;
  priority: number;
  title: string;
  detail: string;
  link: string;
  target_type: string;
  target_id: string;
}

interface Response {
  actions: NextAction[];
}

const TYPE_META: Record<ActionType, { icon: typeof AlertCircleIcon; tone: 'red' | 'amber' | 'blue' }> = {
  invoice_overdue:       { icon: EuroIcon,         tone: 'red'   },
  task:                  { icon: CheckSquareIcon,  tone: 'red'   },
  opp_stuck:             { icon: ClockIcon,        tone: 'amber' },
  opp_close_overdue:     { icon: AlertCircleIcon,  tone: 'red'   },
  dormant_key_account:   { icon: UserMinusIcon,    tone: 'amber' },
  opp_next_action:       { icon: TargetIcon,       tone: 'blue'  },
  contact_follow_up:     { icon: UserMinusIcon,    tone: 'amber' },
  matter_closing_soon:   { icon: AlertCircleIcon,  tone: 'amber' },
};

const TONE_CLASSES = {
  red:   'border-l-danger-500 bg-danger-50/30',
  amber: 'border-l-amber-500  bg-amber-50/30',
  blue:  'border-l-brand-500  bg-brand-50/30',
};

export function ActionsDueWidget() {
  const toast = useToast();
  const { data, error, refetch } = useCrmFetch<Response>('/api/crm/next-actions');
  const [busy, setBusy] = useState<string | null>(null);

  async function markTaskDone(taskId: string) {
    setBusy(taskId);
    try {
      const res = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      if (!res.ok) { toast.error('Mark done failed'); return; }
      toast.success('Task marked done');
      await refetch();
    } finally { setBusy(null); }
  }

  async function snoozeTask(taskId: string) {
    setBusy(taskId);
    try {
      const newDue = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const res = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: newDue }),
      });
      if (!res.ok) { toast.error('Snooze failed'); return; }
      toast.success('Snoozed 3 days');
      await refetch();
    } finally { setBusy(null); }
  }

  if (error) return <CrmErrorBox message={error} onRetry={refetch} />;
  if (!data) {
    return <div className="text-sm text-ink-muted italic px-3 py-6">Computing today&apos;s focus…</div>;
  }

  const actions = data.actions ?? [];
  if (actions.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wide font-semibold text-ink-muted">Actions due</h2>
          <button onClick={refetch} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1">
            <RefreshCwIcon size={11} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-emerald-700 font-medium">✓ Inbox zero.</p>
        <p className="text-xs text-ink-muted mt-1 italic">Good time to prospect, log time, or polish a matter.</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-white">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-border">
        <h2 className="text-sm uppercase tracking-wide font-semibold text-ink-muted">
          Actions due · {actions.length}
        </h2>
        <button onClick={refetch} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1">
          <RefreshCwIcon size={11} />
          Refresh
        </button>
      </div>
      <ul className="divide-y divide-border">
        {actions.map(a => {
          const meta = TYPE_META[a.type];
          const Icon = meta.icon;
          const isTask = a.type === 'task';
          const taskId = a.target_type === 'crm_task' ? a.target_id : null;

          return (
            <li key={a.id} className={`border-l-4 ${TONE_CLASSES[meta.tone]}`}>
              <div className="flex items-start gap-3 px-4 py-2.5">
                <Icon size={15} className="mt-0.5 shrink-0 text-ink-soft" />
                <Link href={a.link} className="flex-1 min-w-0 hover:underline">
                  <div className="text-sm font-medium text-ink truncate">{a.title}</div>
                  <div className="text-xs text-ink-muted mt-0.5">{a.detail}</div>
                </Link>
                <div className="flex items-center gap-1 shrink-0">
                  {isTask && taskId && (
                    <>
                      <button
                        onClick={() => markTaskDone(taskId)}
                        disabled={busy === taskId}
                        title="Mark done"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:text-emerald-700 hover:border-emerald-300 disabled:opacity-40"
                      >
                        <CheckIcon size={12} />
                      </button>
                      <button
                        onClick={() => snoozeTask(taskId)}
                        disabled={busy === taskId}
                        title="Snooze 3 days"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:text-amber-700 hover:border-amber-300 disabled:opacity-40"
                      >
                        <ClockArrowUpIcon size={12} />
                      </button>
                    </>
                  )}
                  <span className="ml-1 text-2xs uppercase tracking-wide tabular-nums text-ink-muted">
                    {a.priority}
                  </span>
                  <Link href={a.link} className="text-ink-muted hover:text-ink">
                    <ChevronRightIcon size={13} />
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

