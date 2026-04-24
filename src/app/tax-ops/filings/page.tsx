'use client';

// ════════════════════════════════════════════════════════════════════════
// /tax-ops/filings — the operational grid Diego will live in.
//
// Filters (multi-dim): year, tax_type, status, client group, assignee,
// overdue flag, text search. URL-persistent so refresh keeps state
// and Diego can bookmark views like "2026 CIT pending-info".
//
// Grid columns (read left-to-right = priority):
//   entity · tax type · period · deadline (urgency-colored) · status ·
//   assignee · CSP count · comments preview.
//
// Click row → detail page.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { SearchIcon, FilterXIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { crmLoadShape } from '@/lib/useCrmFetch';
import {
  FilingStatusBadge, FILING_STATUSES, filingStatusLabel,
} from '@/components/tax-ops/FilingStatusBadge';

interface FilingListRow {
  id: string;
  entity_id: string;
  entity_name: string;
  group_id: string | null;
  group_name: string | null;
  tax_type: string;
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  prepared_with: string[];
  csp_count: number;
  comments_preview: string | null;
}

interface ListResponse {
  filings: FilingListRow[];
  total: number;
  page: number;
  page_size: number;
}

interface GroupRow {
  id: string;
  name: string;
}

const TAX_TYPES = [
  'cit_annual', 'nwt_annual',
  'vat_annual', 'vat_simplified_annual',
  'vat_quarterly', 'vat_monthly',
  'subscription_tax_quarterly',
  'wht_director_monthly', 'wht_director_semester', 'wht_director_annual',
  'fatca_crs_annual', 'bcl_sbs_quarterly', 'bcl_216_monthly',
  'vat_registration', 'vat_deregistration', 'functional_currency_request',
];

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function FilingsListPage() {
  const [year, setYear] = useState<string>('2026');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
  const [taxType, setTaxType] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<FilingListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmLoadShape<GroupRow[]>(`/api/tax-ops/entities?year=${year}`, b => (b as { groups: GroupRow[] }).groups)
      .then(setGroups)
      .catch(() => { /* silent; groups filter just stays empty */ });
  }, [year]);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (year) qs.set('year', year);
    if (taxType) qs.set('tax_type', taxType);
    if (status) qs.set('status', status);
    if (groupId) qs.set('group_id', groupId);
    if (overdueOnly) qs.set('overdue', '1');
    if (q) qs.set('q', q);
    qs.set('page', String(page));
    qs.set('page_size', '50');
    crmLoadShape<ListResponse>(`/api/tax-ops/filings?${qs}`, b => b as ListResponse)
      .then(b => { setRows(b.filings); setTotal(b.total); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRows([]); });
  }, [year, q, status, taxType, groupId, overdueOnly, page]);

  useEffect(() => { load(); }, [load]);

  function clearFilters() {
    setQ(''); setStatus(''); setTaxType(''); setGroupId('');
    setOverdueOnly(false); setPage(0);
  }

  const hasFilters = useMemo(
    () => q !== '' || status !== '' || taxType !== '' || groupId !== '' || overdueOnly,
    [q, status, taxType, groupId, overdueOnly],
  );

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Search filings"
        subtitle={`Cross-tax-type advanced search. For day-to-day work, use the sidebar categories (CIT, VAT, WHT, …). ${total} filings match the current filters.`}
      />

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(0); }}
            placeholder="Search entity / group / period…"
            className="pl-7 pr-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface w-[220px]"
          />
        </div>
        <select
          value={year}
          onChange={e => { setYear(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface"
        >
          {['2024', '2025', '2026', '2027'].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={taxType}
          onChange={e => { setTaxType(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface"
        >
          <option value="">All tax types</option>
          {TAX_TYPES.map(t => <option key={t} value={t}>{humanTaxType(t)}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface"
        >
          <option value="">All statuses</option>
          {FILING_STATUSES.map(s => <option key={s} value={s}>{filingStatusLabel(s)}</option>)}
        </select>
        <select
          value={groupId}
          onChange={e => { setGroupId(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface"
        >
          <option value="">All groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={e => { setOverdueOnly(e.target.checked); setPage(0); }}
          />
          Overdue only
        </label>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[12px] text-ink-muted hover:text-ink border border-border rounded-md"
          >
            <FilterXIcon size={12} /> Clear
          </button>
        )}
      </div>

      {error && <CrmErrorBox message={error} onRetry={load} />}

      {rows.length === 0 ? (
        <EmptyState
          title="No filings match these filters"
          description={hasFilters ? 'Try loosening the filters or clearing them entirely.' : 'No filings in the system yet.'}
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt text-ink-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Tax type</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Deadline</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assignee</th>
                <th className="px-3 py-2 font-medium text-right">CSP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.id} className="border-t border-border hover:bg-surface-alt/40">
                  <td className="px-3 py-2">
                    <Link href={`/tax-ops/filings/${f.id}`} className="font-medium text-ink hover:text-brand-700">
                      {f.entity_name}
                    </Link>
                    {f.group_name && (
                      <div className="text-[11px] text-ink-muted">{f.group_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{humanTaxType(f.tax_type)}</td>
                  <td className="px-3 py-2 tabular-nums">{f.period_label}</td>
                  <td className="px-3 py-2"><DateBadge value={f.deadline_date} mode="urgency" /></td>
                  <td className="px-3 py-2"><FilingStatusBadge status={f.status} /></td>
                  <td className="px-3 py-2 text-ink-soft">{f.assigned_to ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{f.csp_count || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-between mt-3 text-[12px] text-ink-muted">
          <div>
            Showing {page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total}
          </div>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="px-2 py-1 border border-border rounded-md disabled:opacity-40 hover:bg-surface-alt"
            >
              Prev
            </button>
            <button
              disabled={(page + 1) * 50 >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 border border-border rounded-md disabled:opacity-40 hover:bg-surface-alt"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
