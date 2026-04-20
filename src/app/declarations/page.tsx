'use client';

// Declarations list — every declaration (historical + in flight) with
// KPI row, status filter chips (URL-driven so deep links from the home
// dashboard work), and a clean table. Creating a new declaration
// happens here or from the home quick-actions.

import { useEffect, useState, Suspense, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { PlusIcon, ArrowRightIcon, FileTextIcon, SearchIcon, ChevronUpIcon, ChevronDownIcon, ChevronsLeftIcon, ChevronLeftIcon, ChevronRightIcon as ChevronRightMiniIcon, ChevronsRightIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Stat } from '@/components/ui/Stat';

interface Entity { id: string; name: string; regime: string; frequency: string; has_outgoing?: number | boolean }
interface Declaration { id: string; entity_id: string; entity_name: string; year: number; period: string; status: string; created_at: string }

type StatusFilter = 'all' | 'active' | 'review' | 'approved' | 'filed' | 'paid';
type SortKey = 'entity' | 'period' | 'status' | 'created';
type SortDir = 'asc' | 'desc';

const PAGE_SIZES = [25, 50, 100, 250] as const;

export default function DeclarationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DeclarationsContent />
    </Suspense>
  );
}

function DeclarationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const entityId = searchParams.get('entity_id');
  const initialStatus = (searchParams.get('status') as StatusFilter) || 'all';
  const initialQ = searchParams.get('q') || '';
  const initialSort = (searchParams.get('sort') as SortKey) || 'period';
  const initialDir = (searchParams.get('dir') as SortDir) || 'desc';
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const initialPageSize = (() => {
    const n = Number(searchParams.get('size'));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 50;
  })();

  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [declarations, setDeclarations] = useState<Declaration[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ entity_id: entityId || '', year: new Date().getFullYear(), period: '' });
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [search, setSearch] = useState(initialQ);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);
  const [page, setPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);

  // Reflect current UI state into the URL so filters + pagination are
  // shareable / back-button-friendly.
  const syncUrl = useCallback(() => {
    const qs = new URLSearchParams();
    if (entityId) qs.set('entity_id', entityId);
    if (statusFilter !== 'all') qs.set('status', statusFilter);
    if (search.trim()) qs.set('q', search.trim());
    if (sortKey !== 'period') qs.set('sort', sortKey);
    if (sortDir !== 'desc') qs.set('dir', sortDir);
    if (page > 1) qs.set('page', String(page));
    if (pageSize !== 50) qs.set('size', String(pageSize));
    const qstr = qs.toString();
    const url = qstr ? `/declarations?${qstr}` : '/declarations';
    router.replace(url, { scroll: false });
  }, [router, entityId, statusFilter, search, sortKey, sortDir, page, pageSize]);

  useEffect(() => { syncUrl(); }, [syncUrl]);

  // Reset to page 1 whenever a filter / search / sort changes.
  useEffect(() => { setPage(1); }, [statusFilter, search, sortKey, sortDir, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  useEffect(() => {
    fetch('/api/entities').then(r => r.json()).then(setEntities);
    const url = entityId ? `/api/declarations?entity_id=${entityId}` : '/api/declarations';
    fetch(url).then(r => r.json()).then(setDeclarations);
  }, [entityId]);

  const periodsForEntity = (id: string): string[] => {
    const entity = entities?.find(e => e.id === id);
    if (!entity) return ['Y1'];
    if (entity.frequency === 'annual') return ['Y1'];
    if (entity.frequency === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'];
    return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  };

  const nextSuggestion = useMemo(() => {
    if (!form.entity_id || !declarations) return null;
    const entity = entities?.find(e => e.id === form.entity_id);
    if (!entity) return null;
    const taken = new Set(declarations.filter(d => d.entity_id === form.entity_id).map(d => `${d.year}::${d.period}`));
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    for (let yOffset = 0; yOffset < 3; yOffset++) {
      const y = currentYear - yOffset;
      const periods = periodsForEntity(entity.id);
      for (let i = periods.length - 1; i >= 0; i--) {
        const p = periods[i];
        if (!taken.has(`${y}::${p}`)) return { year: y, period: p };
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.entity_id, entities, declarations]);

  useEffect(() => {
    if (nextSuggestion && !form.period) {
      setForm(f => ({ ...f, year: nextSuggestion.year, period: nextSuggestion.period }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextSuggestion]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/declarations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) { setError((await res.json()).error || 'Failed'); return; }
    const d = await res.json();
    window.location.href = `/declarations/${d.id}`;
  }

  if (!entities || !declarations) return <PageSkeleton />;

  const selectedEntity = entities.find(e => e.id === form.entity_id);

  // KPI counts (always computed from full list, not filtered view)
  const counts = {
    total:    declarations.length,
    active:   declarations.filter(d => ['uploading', 'extracting', 'classifying', 'review', 'approved'].includes(d.status)).length,
    review:   declarations.filter(d => d.status === 'review').length,
    filed:    declarations.filter(d => d.status === 'filed' || d.status === 'paid').length,
  };

  // Apply filter + search + sort
  const filtered = declarations
    .filter(d => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return ['uploading', 'extracting', 'classifying', 'review', 'approved'].includes(d.status);
      return d.status === statusFilter;
    })
    .filter(d => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return d.entity_name.toLowerCase().includes(q)
        || String(d.year).includes(q)
        || d.period.toLowerCase().includes(q)
        || d.status.toLowerCase().includes(q);
    });

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'entity') {
      return mul * a.entity_name.localeCompare(b.entity_name);
    }
    if (sortKey === 'status') {
      return mul * a.status.localeCompare(b.status);
    }
    if (sortKey === 'created') {
      return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    // 'period' sort: year desc then period desc by default. Respect dir.
    if (b.year !== a.year) return mul * (a.year - b.year);
    return mul * a.period.localeCompare(b.period);
  });

  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageStart = (effectivePage - 1) * pageSize;
  const visible = sorted.slice(pageStart, pageStart + pageSize);

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title={
          <>
            Declarations
            {entityId && selectedEntity && (
              <span className="text-[16px] text-ink-muted font-normal ml-3">for {selectedEntity.name}</span>
            )}
          </>
        }
        subtitle="Each declaration follows the lifecycle: uploaded → extracted → classified → reviewed → approved → filed → paid."
        actions={
          <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'New declaration'}
          </Button>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Total declarations"  value={counts.total} />
        <Stat label="Active"               value={counts.active}  tone={counts.active > 0 ? 'warning' : 'muted'} />
        <Stat label="In review"            value={counts.review}  tone={counts.review > 0 ? 'warning' : 'muted'} />
        <Stat label="Filed this year"      value={counts.filed}   tone="success" />
      </div>

      {showForm && (
        <Card className="mb-6 animate-fadeIn">
          <CardHeader
            title="New declaration"
            subtitle={nextSuggestion ? `Suggested next unfiled period: ${nextSuggestion.year} ${nextSuggestion.period}` : undefined}
          />
          <CardBody>
            <form onSubmit={handleCreate}>
              {error && (
                <div className="text-danger-700 text-[12.5px] mb-3 bg-danger-50 border border-[#F4B9B7] rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Entity *">
                  <Select required value={form.entity_id}
                    onChange={e => setForm({ ...form, entity_id: e.target.value, period: '' })}>
                    <option value="">Select entity…</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name} ({e.regime})</option>)}
                  </Select>
                </Field>
                <Field label="Year *">
                  <Select required value={form.year} onChange={e => setForm({ ...form, year: parseInt(e.target.value) })}>
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </Select>
                </Field>
                <Field label="Period *">
                  <Select required value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}>
                    <option value="">Select period…</option>
                    {form.entity_id && periodsForEntity(form.entity_id).map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="mt-4 flex gap-2">
                <Button type="submit" variant="primary">Create declaration</Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Filter + search bar */}
      {declarations.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
          <div className="flex items-center gap-1 flex-wrap">
            <FilterChip active={statusFilter === 'all'}       onClick={() => setStatusFilter('all')}>All</FilterChip>
            <FilterChip active={statusFilter === 'active'}    onClick={() => setStatusFilter('active')}>Active</FilterChip>
            <FilterChip active={statusFilter === 'review'}    onClick={() => setStatusFilter('review')}>In review</FilterChip>
            <FilterChip active={statusFilter === 'approved'}  onClick={() => setStatusFilter('approved')}>Approved</FilterChip>
            <FilterChip active={statusFilter === 'filed'}     onClick={() => setStatusFilter('filed')}>Filed</FilterChip>
            <FilterChip active={statusFilter === 'paid'}      onClick={() => setStatusFilter('paid')}>Paid</FilterChip>
          </div>
          <div className="flex-1" />
          <div className="relative w-full md:w-72">
            <SearchIcon size={14} className="absolute top-2.5 left-3 text-ink-muted pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by entity / year / period"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-surface text-[13px] placeholder:text-ink-muted focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20"
            />
          </div>
        </div>
      )}

      {declarations.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title="No declarations yet"
            description={
              entities.length === 0
                ? 'Create a client entity first, then start your first declaration.'
                : 'Click "New declaration" above to start your first one.'
            }
            action={
              entities.length === 0
                ? <Link href="/entities"><Button variant="primary">Create a client</Button></Link>
                : <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setShowForm(true)}>New declaration</Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title="No declarations match"
            description={search.trim() ? `Nothing matches "${search}". Try a different search or clear the filter.` : 'Try a different status filter.'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt border-b border-divider text-ink-muted">
              <tr>
                <SortableTh active={sortKey === 'entity'} dir={sortDir} onClick={() => toggleSort('entity')}>Entity</SortableTh>
                <SortableTh active={sortKey === 'period'} dir={sortDir} onClick={() => toggleSort('period')}>Year · Period</SortableTh>
                <SortableTh active={sortKey === 'status'} dir={sortDir} onClick={() => toggleSort('status')}>Status</SortableTh>
                <SortableTh active={sortKey === 'created'} dir={sortDir} onClick={() => toggleSort('created')}>Created</SortableTh>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map(d => (
                <tr key={d.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/60 transition-colors duration-150">
                  <td className="px-4 py-3">
                    <Link href={`/declarations/${d.id}`} className="group">
                      <span className="font-medium text-ink group-hover:text-brand-600 transition-colors">{d.entity_name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft tabular-nums">{d.year} · {d.period}</td>
                  <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                  <td className="px-4 py-3 text-ink-muted text-[11.5px]">{new Date(d.created_at).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/declarations/${d.id}`} className="inline-flex items-center text-brand-600 hover:text-brand-700 text-[11.5px] font-medium transition-colors gap-1">
                      Open <ArrowRightIcon size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pagination footer */}
          <div className="border-t border-divider px-4 py-2.5 flex items-center justify-between text-[11.5px] text-ink-muted bg-surface-alt/40">
            <span>
              <span className="font-semibold tabular-nums text-ink">{pageStart + 1}</span>
              {' – '}
              <span className="font-semibold tabular-nums text-ink">{Math.min(pageStart + pageSize, totalRows)}</span>
              {' of '}
              <span className="font-semibold tabular-nums text-ink">{totalRows}</span>
              {' '}
              {totalRows !== declarations.length && (
                <span className="text-ink-faint">(filtered from {declarations.length})</span>
              )}
            </span>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1">
                Page size
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  className="ml-1 border border-border rounded px-1.5 py-0.5 bg-surface text-ink tabular-nums"
                >
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-0.5">
                <PageBtn disabled={effectivePage === 1} onClick={() => setPage(1)} title="First"><ChevronsLeftIcon size={12} /></PageBtn>
                <PageBtn disabled={effectivePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))} title="Previous"><ChevronLeftIcon size={12} /></PageBtn>
                <span className="px-2 tabular-nums">{effectivePage} / {totalPages}</span>
                <PageBtn disabled={effectivePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} title="Next"><ChevronRightMiniIcon size={12} /></PageBtn>
                <PageBtn disabled={effectivePage >= totalPages} onClick={() => setPage(totalPages)} title="Last"><ChevronsRightIcon size={12} /></PageBtn>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium text-[10.5px] uppercase tracking-[0.06em]">{children}</th>;
}

function SortableTh({
  children, active, dir, onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2.5 text-left font-medium text-[10.5px] uppercase tracking-[0.06em]">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${active ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
      >
        {children}
        {active ? (
          dir === 'asc' ? <ChevronUpIcon size={11} /> : <ChevronDownIcon size={11} />
        ) : (
          <ChevronDownIcon size={11} className="opacity-30" />
        )}
      </button>
    </th>
  );
}

function PageBtn({
  children, disabled, onClick, title,
}: { children: React.ReactNode; disabled?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-6 h-6 inline-flex items-center justify-center rounded text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center h-8 px-3 rounded-md text-[12.5px] font-medium transition-all',
        active
          ? 'bg-brand-500 text-white shadow-xs'
          : 'bg-surface border border-border text-ink-soft hover:bg-surface-alt',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: 'neutral' | 'info' | 'violet' | 'amber' | 'warning' | 'success' | 'teal'; label: string }> = {
    created:     { tone: 'neutral', label: 'Created' },
    uploading:   { tone: 'info',    label: 'Uploading' },
    extracting:  { tone: 'violet',  label: 'Extracting' },
    classifying: { tone: 'amber',   label: 'Classifying' },
    review:      { tone: 'warning', label: 'Review' },
    approved:    { tone: 'success', label: 'Approved' },
    filed:       { tone: 'teal',    label: 'Filed' },
    paid:        { tone: 'success', label: 'Paid' },
  };
  const { tone, label } = map[status] || { tone: 'neutral' as const, label: status };
  return <Badge tone={tone}>{label}</Badge>;
}
