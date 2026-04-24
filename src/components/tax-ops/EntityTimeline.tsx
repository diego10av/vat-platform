'use client';

// EntityTimeline — stint 42.A.
//
// Vertical activity timeline on /tax-ops/entities/[id], grouped by
// year+month. Fetches from GET /api/tax-ops/entities/[id]/timeline
// which aggregates audit_log rows across the entity + its obligations
// + its filings. Read-only viewer; all mutations happen elsewhere,
// this just surfaces what happened and when.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLinkIcon } from 'lucide-react';
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

export function EntityTimeline({ entityId }: { entityId: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tax-ops/entities/${entityId}/timeline`)
      .then(r => r.ok ? r.json() as Promise<Response> : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(b => { if (!cancelled) { setData(b); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId]);

  if (loading) return <div className="text-[12px] text-ink-muted italic">Loading activity…</div>;
  if (error)   return <div className="text-[12px] text-danger-700">Activity load failed: {error}</div>;
  if (!data || data.rows.length === 0) {
    return (
      <div className="text-[12px] text-ink-muted italic">
        No recorded activity yet. Status changes, family moves, contact edits and merges
        will appear here as they happen.
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
            <div className="text-[11px] text-ink-muted mb-1.5 font-medium">{g.label}</div>
            <ul className="space-y-1.5">
              {g.items.map(r => (
                <li key={r.id} className="flex items-start gap-2 text-[12.5px]">
                  <span className="w-5 shrink-0 text-center" aria-hidden>{iconFor(r.action)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-ink">{humanize(r)}</span>
                    <span className="text-ink-muted ml-2 text-[11px] tabular-nums">
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
      <div className="mt-2 flex items-center gap-3">
        <span className="text-[11px] text-ink-muted">
          {data.rows.length} event{data.rows.length === 1 ? '' : 's'}
          {rowCapped ? ' (most recent 200)' : ''}
        </span>
        <Link
          href={`/audit?target_id=${entityId}`}
          className="text-[11px] text-brand-700 hover:text-brand-900 underline inline-flex items-center gap-1"
        >
          <ExternalLinkIcon size={10} /> Full audit log
        </Link>
      </div>
    </div>
  );
}
