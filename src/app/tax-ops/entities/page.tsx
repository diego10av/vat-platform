'use client';

// /tax-ops/entities — master list of all legal entities, grouped by
// client-group (expandable sections). Summary columns tell Diego at
// a glance which entities are behind on their YTD filings.

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { SearchIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { crmLoadShape } from '@/lib/useCrmFetch';

interface EntityRow {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  is_active: boolean;
  group_id: string | null;
  group_name: string | null;
  csp_count: number;
  obligations_count: number;
  filings_ytd: number;
  filings_filed_ytd: number;
  last_assessment_year: number | null;
}

interface GroupRow {
  id: string;
  name: string;
  entity_count: number;
}

interface Response {
  entities: EntityRow[];
  groups: GroupRow[];
  year: number;
}

export default function EntitiesListPage() {
  const [year] = useState<string>('2026');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<EntityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    qs.set('year', year);
    crmLoadShape<Response>(`/api/tax-ops/entities?${qs}`, b => b as Response)
      .then(b => { setRows(b.entities); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRows([]); });
  }, [q, year]);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const m = new Map<string, EntityRow[]>();
    for (const r of rows) {
      const key = r.group_name ?? '(no group)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  function toggleGroup(name: string) {
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Entities"
        subtitle={`${rows.length} active entities across ${grouped.length} client groups.`}
      />

      <div className="flex gap-2 items-center mb-3">
        <div className="relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by legal name or VAT number…"
            className="pl-7 pr-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface w-[280px]"
          />
        </div>
      </div>

      {error && <CrmErrorBox message={error} onRetry={() => setQ(q)} />}

      {rows.length === 0 ? (
        <EmptyState title="No entities" description="Run the importer or add entities via the API." />
      ) : (
        <div className="space-y-2">
          {grouped.map(([groupName, items]) => {
            const isCollapsed = collapsed.has(groupName);
            return (
              <div key={groupName} className="rounded-md border border-border bg-surface overflow-hidden">
                <button
                  onClick={() => toggleGroup(groupName)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-surface-alt text-left hover:bg-surface-alt/70"
                >
                  {isCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
                  <span className="font-semibold text-[12.5px] text-ink">{groupName}</span>
                  <span className="text-[11.5px] text-ink-muted">({items.length})</span>
                </button>
                {!isCollapsed && (
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-alt/30 text-ink-muted">
                      <tr className="text-left">
                        <th className="px-3 py-1.5 font-medium">Legal name</th>
                        <th className="px-3 py-1.5 font-medium">VAT / Matricule</th>
                        <th className="px-3 py-1.5 font-medium text-right">Obligations</th>
                        <th className="px-3 py-1.5 font-medium text-right">YTD filed</th>
                        <th className="px-3 py-1.5 font-medium text-right">Last assessment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(e => {
                        const pct = e.filings_ytd > 0
                          ? Math.round((e.filings_filed_ytd / e.filings_ytd) * 100)
                          : null;
                        return (
                          <tr key={e.id} className="border-t border-border hover:bg-surface-alt/40">
                            <td className="px-3 py-1.5">
                              <Link href={`/tax-ops/entities/${e.id}`} className="font-medium text-ink hover:text-brand-700">
                                {e.legal_name}
                              </Link>
                            </td>
                            <td className="px-3 py-1.5 text-ink-soft">
                              {e.vat_number || e.matricule || '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{e.obligations_count}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {pct !== null ? (
                                <span className={pct >= 80 ? 'text-green-700' : pct >= 50 ? 'text-amber-700' : 'text-ink-muted'}>
                                  {e.filings_filed_ytd}/{e.filings_ytd} ({pct}%)
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                              {e.last_assessment_year ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
