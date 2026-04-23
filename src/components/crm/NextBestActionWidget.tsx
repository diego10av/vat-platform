'use client';

// ════════════════════════════════════════════════════════════════════════
// NextBestActionWidget — the centerpiece of the CRM landing page.
// Pulls the top ~10 ranked actions from /api/crm/next-actions and
// renders them as a scannable priority-ordered list. Each row is a
// click-through to the relevant record.
//
// The icon color + left-border encodes urgency so Diego can scan in
// 2 seconds: red = overdue invoice or task, amber = stuck / dormant,
// blue = normal follow-up.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircleIcon, ClockIcon, EuroIcon, TargetIcon, UserMinusIcon, CheckSquareIcon,
  ChevronRightIcon, RefreshCwIcon,
} from 'lucide-react';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';

interface NextAction {
  id: string;
  type: 'task' | 'invoice_overdue' | 'opp_stuck' | 'opp_next_action' | 'dormant_key_account';
  priority: number;
  title: string;
  detail: string;
  link: string;
  target_type: string;
  target_id: string;
}

const TYPE_META: Record<NextAction['type'], { icon: typeof AlertCircleIcon; tone: 'red' | 'amber' | 'blue' }> = {
  invoice_overdue:       { icon: EuroIcon,         tone: 'red'   },
  task:                  { icon: CheckSquareIcon,  tone: 'red'   },
  opp_stuck:             { icon: ClockIcon,        tone: 'amber' },
  dormant_key_account:   { icon: UserMinusIcon,    tone: 'amber' },
  opp_next_action:       { icon: TargetIcon,       tone: 'blue'  },
};

const TONE_CLASSES = {
  red:   'border-l-danger-500 bg-danger-50/30  text-danger-700',
  amber: 'border-l-amber-500  bg-amber-50/30   text-amber-700',
  blue:  'border-l-brand-500  bg-brand-50/30   text-brand-700',
};

export function NextBestActionWidget() {
  const [actions, setActions] = useState<NextAction[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/next-actions', { cache: 'no-store' });
      if (!res.ok) { setError(`${res.status} ${res.statusText}`); setActions(null); return; }
      const body = await res.json();
      setActions(body.actions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setActions(null);
    } finally { setRefreshing(false); }
  }
  useEffect(() => { load(); }, []);

  if (error) return <CrmErrorBox message={error} onRetry={load} />;
  if (actions === null) {
    return <div className="text-[12px] text-ink-muted italic px-3 py-6">Computing today&apos;s focus…</div>;
  }

  if (actions.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] uppercase tracking-wide font-semibold text-ink-muted">Today&apos;s focus</h2>
          <button onClick={load} disabled={refreshing} className="text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1">
            <RefreshCwIcon size={11} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <p className="text-[13px] text-emerald-700 font-medium">✓ Inbox zero — nothing urgent in the CRM right now.</p>
        <p className="text-[11.5px] text-ink-muted mt-1 italic">Good morning to catch up on pipeline, log time, or reach out to a lapsed contact.</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-white">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-border">
        <h2 className="text-[13px] uppercase tracking-wide font-semibold text-ink-muted">
          Today&apos;s focus · {actions.length} action{actions.length === 1 ? '' : 's'}
        </h2>
        <button onClick={load} disabled={refreshing} className="text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1">
          <RefreshCwIcon size={11} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <ul className="divide-y divide-border">
        {actions.map(a => {
          const meta = TYPE_META[a.type];
          const Icon = meta.icon;
          return (
            <li key={a.id}>
              <Link
                href={a.link}
                className={`flex items-start gap-3 px-4 py-2.5 hover:bg-surface-alt/60 border-l-4 ${TONE_CLASSES[meta.tone]}`}
              >
                <Icon size={15} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink truncate">{a.title}</div>
                  <div className="text-[11.5px] text-ink-muted mt-0.5">{a.detail}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0 text-ink-muted mt-1">
                  <span className="text-[10px] uppercase tracking-wide tabular-nums">{a.priority}</span>
                  <ChevronRightIcon size={13} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
