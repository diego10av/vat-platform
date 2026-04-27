'use client';

// TaskTimeline — stint 56.B.
//
// Compact activity timeline on /tax-ops/tasks/[id], grouped by month.
// Mirrors EntityTimeline (stint 42.A) — same audit-humanize lib, same
// visual rhythm. Surfaces every audit_log row tagged target_type =
// 'tax_ops_task' for this id: status changes, sign-offs, attachments,
// reassignments, etc.

import { useEffect, useState } from 'react';
import { humanize, iconFor, groupByMonth, type AuditRow } from '@/lib/audit-humanize';

interface Response {
  rows: AuditRow[];
  limit: number;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mo  = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh  = String(d.getUTCHours()).padStart(2, '0');
    const mm  = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day}/${mo} ${hh}:${mm}`;
  } catch { return iso.slice(0, 10); }
}

export function TaskTimeline({ taskId }: { taskId: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tax-ops/tasks/${taskId}/timeline`)
      .then(r => r.ok ? r.json() as Promise<Response> : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(b => { if (!cancelled) { setData(b); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  if (loading) return <div className="text-sm text-ink-muted italic">Loading activity…</div>;
  if (error)   return <div className="text-sm text-danger-700">Activity load failed: {error}</div>;
  if (!data || data.rows.length === 0) {
    return (
      <div className="text-sm text-ink-muted italic">
        No recorded activity yet. Status changes, sign-offs and attachments
        will show up here as they happen.
      </div>
    );
  }

  const groups = groupByMonth(data.rows);
  const rowCapped = data.rows.length >= data.limit;

  return (
    <div>
      <ol className="relative border-l border-border ml-2">
        {groups.map(g => (
          <li key={g.key} className="mb-4 ml-4">
            <div className="text-xs text-ink-muted mb-1.5 font-medium">{g.label}</div>
            <ul className="space-y-1.5">
              {g.items.map(r => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <span className="w-5 shrink-0 text-center" aria-hidden>{iconFor(r.action)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-ink">{humanize(r)}</span>
                    <span className="text-ink-muted ml-2 text-xs tabular-nums">
                      {formatTime(r.created_at)}
                      {r.user_id && r.user_id !== 'founder' ? ` · ${r.user_id}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="mt-2 text-xs text-ink-muted">
        {data.rows.length} event{data.rows.length === 1 ? '' : 's'}
        {rowCapped ? ' (most recent 200)' : ''}
      </div>
    </div>
  );
}
