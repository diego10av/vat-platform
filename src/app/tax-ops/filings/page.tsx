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
import { SearchIcon, FilterXIcon, CheckCircle2Icon, XIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { crmLoadShape } from '@/lib/useCrmFetch';
import { useToast } from '@/components/Toaster';
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
  service_kind: 'filing' | 'provision' | 'review';
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
  // Stint 94 — bulk close-out. Diego pays 4 VATs in a single bank
  // transfer; pre-94 he marked each filing paid one-by-one. Select
  // any number of rows → "Mark as paid" / "Mark as filed" run in one
  // PATCH against /api/tax-ops/filings.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toast = useToast();

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

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll(check: boolean) {
    if (!rows) return;
    setSelected(check ? new Set(rows.map(r => r.id)) : new Set());
  }

  function clearSelection() { setSelected(new Set()); }

  // Stint 94 — shared bulk PATCH helper. Status alone for "mark filed",
  // status + paid_at for "mark paid". /api/tax-ops/filings already
  // accepts a bulk PATCH with this shape (route.ts:140), so this is
  // pure UI plumbing.
  async function bulkPatch(patch: Record<string, unknown>, successMsg: string) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/tax-ops/filings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), patch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { updated: number };
      toast.success(`${successMsg} (${body.updated} filing${body.updated === 1 ? '' : 's'})`);
      clearSelection();
      load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBulkBusy(false);
    }
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
            className="pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-surface w-[220px]"
          />
        </div>
        <select
          value={year}
          onChange={e => { setYear(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
        >
          {['2024', '2025', '2026', '2027'].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={taxType}
          onChange={e => { setTaxType(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
        >
          <option value="">All tax types</option>
          {TAX_TYPES.map(t => <option key={t} value={t}>{humanTaxType(t)}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
        >
          <option value="">All statuses</option>
          {FILING_STATUSES.map(s => <option key={s} value={s}>{filingStatusLabel(s)}</option>)}
        </select>
        <select
          value={groupId}
          onChange={e => { setGroupId(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
        >
          <option value="">All groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
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
            className="inline-flex items-center gap-1 px-2 py-1.5 text-sm text-ink-muted hover:text-ink border border-border rounded-md"
          >
            <FilterXIcon size={12} /> Clear
          </button>
        )}
      </div>

      {error && <CrmErrorBox message={error} onRetry={load} />}

      {/* Stint 94 — bulk action bar appears when ≥1 row selected.
          Sits between filters and table; non-floating, accessible,
          dismissible. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md border border-brand-200 bg-brand-50 text-sm">
          <span className="font-semibold text-brand-700">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => void bulkPatch({ status: 'paid', paid_at: new Date().toISOString().slice(0, 10) }, 'Marked as paid')}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-success-500 text-white text-xs font-semibold hover:bg-success-700 disabled:opacity-50"
          >
            <CheckCircle2Icon size={12} /> Mark as paid
          </button>
          <button
            type="button"
            onClick={() => void bulkPatch({ status: 'filed', filed_at: new Date().toISOString().slice(0, 10) }, 'Marked as filed')}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-500 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            <CheckCircle2Icon size={12} /> Mark as filed
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={bulkBusy}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-ink-muted hover:text-ink hover:bg-surface-alt/50 text-xs"
          >
            <XIcon size={12} /> Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No filings match these filters"
          description={hasFilters ? 'Try loosening the filters or clearing them entirely.' : 'No filings in the system yet.'}
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-ink-muted">
              <tr className="text-left">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all visible filings"
                    checked={rows.length > 0 && selected.size === rows.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={e => toggleAll(e.target.checked)}
                    className="h-4 w-4 accent-brand-500 cursor-pointer"
                  />
                </th>
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
                <tr key={f.id} className={`border-t border-border hover:bg-surface-alt/50 ${selected.has(f.id) ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${f.entity_name} ${f.period_label}`}
                      checked={selected.has(f.id)}
                      onChange={() => toggleOne(f.id)}
                      className="h-4 w-4 accent-brand-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/tax-ops/filings/${f.id}`} className="font-medium text-ink hover:text-brand-700">
                      {f.entity_name}
                    </Link>
                    {f.group_name && (
                      <div className="text-xs text-ink-muted">{f.group_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{humanTaxType(f.tax_type)}</td>
                  <td className="px-3 py-2 tabular-nums">{f.period_label}</td>
                  <td className="px-3 py-2"><DateBadge value={f.deadline_date} mode="urgency" /></td>
                  <td className="px-3 py-2"><FilingStatusBadge status={f.status} serviceKind={f.service_kind} /></td>
                  <td className="px-3 py-2 text-ink-soft">{f.assigned_to ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{f.csp_count || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-between mt-3 text-sm text-ink-muted">
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
