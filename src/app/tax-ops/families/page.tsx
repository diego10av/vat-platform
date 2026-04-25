'use client';

// /tax-ops/families — index page (stint 43.D13).
//
// Diego had no entry point to the family-overview pages he asked for in
// 40.P. Group headers in the matrix link there, but those are buried;
// the sidebar needs a top-level "Families" target so he can browse the
// list directly.
//
// Single concern: list every family with its entity count + a click
// through to /tax-ops/families/[id]. No editing here — that lives on
// the [id] page already.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { familyChipClasses } from '@/components/tax-ops/familyColors';

interface Group {
  id: string;
  name: string;
  is_active: boolean;
  entity_count: number;
}

export default function FamiliesIndexPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQueryString] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch('/api/tax-ops/client-groups')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(body => {
        if (!cancelled) setGroups(body.groups ?? []);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    let out = groups;
    if (!showArchived) out = out.filter(g => g.is_active);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter(g => g.name.toLowerCase().includes(q));
    return out;
  }, [groups, query, showArchived]);

  const totalEntities = useMemo(
    () => filtered.reduce((sum, g) => sum + g.entity_count, 0),
    [filtered],
  );

  return (
    <div className="space-y-3 max-w-5xl">
      <PageHeader
        title="Families"
        subtitle="Client groups (a.k.a. families) — every entity belongs to one. Click a family to see all its entities + bulk-edit shared metadata."
      />

      <div className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-[12.5px]">
          <span className="text-ink-muted">Search:</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQueryString(e.target.value)}
            placeholder="name…"
            className="px-2 py-1 text-[12.5px] border border-border rounded-md bg-surface w-[200px]"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12.5px]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          <span className="text-ink-muted">Show archived</span>
        </label>
        <div className="text-[11.5px] text-ink-muted">
          {filtered.length} families · {totalEntities} entities
        </div>
      </div>

      {error && <CrmErrorBox message={error} onRetry={() => window.location.reload()} />}
      {isLoading && <PageSkeleton />}
      {!isLoading && !error && (
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-ink-muted italic">
              No families match this filter.
            </div>
          ) : (
            <table className="w-full text-[12.5px] border-collapse">
              <thead className="bg-surface-alt">
                <tr className="text-left text-ink-muted">
                  <th className="border-b border-border px-2.5 py-2 font-medium">Family</th>
                  <th className="border-b border-border px-2.5 py-2 font-medium w-[120px] text-right">Entities</th>
                  <th className="border-b border-border px-2.5 py-2 font-medium w-[100px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(g => (
                  <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-surface-alt/50">
                    <td className="px-2.5 py-1.5">
                      <Link
                        href={`/tax-ops/families/${g.id}`}
                        className="inline-flex items-center gap-2 hover:text-brand-700"
                      >
                        <span
                          className={[
                            'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium truncate max-w-[180px]',
                            familyChipClasses(g.name),
                          ].join(' ')}
                          title={g.name}
                        >
                          {g.name}
                        </span>
                        <span className="text-[11px] text-ink-muted hover:underline">view →</span>
                      </Link>
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{g.entity_count}</td>
                    <td className="px-2.5 py-1.5">
                      {g.is_active ? (
                        <span className="text-[11px] text-ink-muted">Active</span>
                      ) : (
                        <span className="text-[11px] text-ink-faint italic">Archived</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
