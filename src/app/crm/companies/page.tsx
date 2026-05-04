'use client';

// Stint 67.B.b: per-page force-dynamic — see /clients/page.tsx.
export const dynamic = 'force-dynamic';
import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { SearchIcon, PlusIcon, ExternalLinkIcon, Trash2Icon, TargetIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { BulkActionBar } from '@/components/crm/BulkActionBar';
import { ExportButton } from '@/components/crm/ExportButton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { CompanyHoverPreview } from '@/components/crm/CompanyHoverPreview';
import { CrmContextMenu, type CrmContextAction } from '@/components/crm/CrmContextMenu';
import { CrmSavedViews } from '@/components/crm/CrmSavedViews';
import { BulkEditDrawer, type BulkEditField } from '@/components/crm/BulkEditDrawer';
import { COMPANY_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
// Stint 63.A — port Tax-Ops inline-edit primitives. Same components,
// different endpoint. Closes Diego's "todo debería ser editable" — the
// table cells become live edit widgets without leaving the list view.
import { InlineTextCell, InlineTagsCell } from '@/components/tax-ops/inline-editors';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import {
  COMPANY_CLASSIFICATIONS, COMPANY_INDUSTRIES, COMPANY_SIZES,
  LABELS_CLASSIFICATION, LABELS_INDUSTRY, LABELS_SIZE,
  type CompanyClassification,
} from '@/lib/crm-types';

interface Company {
  id: string;
  company_name: string;
  country: string | null;
  industry: string | null;
  size: string | null;
  classification: string | null;
  website: string | null;
  linkedin_url: string | null;
  tags: string[];
  entity_id: string | null;
}

// Stint 63.A — chip tones per classification, mirroring the tax-ops
// pattern (status chips coloured by semantic meaning).
const CLASSIFICATION_TONES: Record<string, string> = {
  key_account:    'bg-brand-50 text-brand-800',
  standard:       'bg-info-50 text-info-800',
  occasional:     'bg-amber-50 text-amber-800',
  not_yet_client: 'bg-surface-alt text-ink-faint',
};

export default function CompaniesPage() {
  // Stint 63.D — Suspense boundary required by Next 16 useSearchParams
  // when the consumer renders during SSR.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CompaniesPageContent />
    </Suspense>
  );
}

function CompaniesPageContent() {
  // Stint 63.D — URL-persistent filters. State seeded from
  // searchParams; every mutation calls router.replace so refresh +
  // shareable deep links + saved views work.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [classFilter, setClassFilter] = useState<string>(searchParams.get('classification') ?? '');
  // Stint 64.B — extra filters inspired by HubSpot/Salesforce list views.
  // Diego: "deberías incluir más filtros... cómo lo hacen los CRM top top?
  // esa debería ser tu inspiración." Country + industry are the two
  // axes that are most-asked-for after classification (segmentation by
  // location + sector). Both filtered client-side over the already-loaded
  // list to keep the API surface stable.
  const [countryFilter, setCountryFilter] = useState<string>(searchParams.get('country') ?? '');
  const [industryFilter, setIndustryFilter] = useState<string>(searchParams.get('industry') ?? '');
  const [sizeFilter, setSizeFilter] = useState<string>(searchParams.get('size') ?? '');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Stint 63.C — context menu state. Lifted to page level so a single
  // CrmContextMenu instance is shared across all rows.
  const [contextMenu, setContextMenu] = useState<{ company: Company; x: number; y: number } | null>(null);
  // Stint 63.E — bulk-edit drawer state.
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const toast = useToast();

  // Stint 63.D — sync filter state → URL. router.replace (not push)
  // because filter changes shouldn't bloat the back-history (mirror of
  // stint 59.D pattern). Skip first render so we don't overwrite the
  // URL Diego came in with.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (classFilter) qs.set('classification', classFilter);
    if (countryFilter) qs.set('country', countryFilter);
    if (industryFilter) qs.set('industry', industryFilter);
    if (sizeFilter) qs.set('size', sizeFilter);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [q, classFilter, countryFilter, industryFilter, sizeFilter, router, pathname]);

  // currentQuery is what CrmSavedViews captures when Diego clicks
  // "Save current as…". Captures all filter dimensions so a saved
  // view restores Diego back to the exact same slice.
  const currentQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (classFilter) qs.set('classification', classFilter);
    if (countryFilter) qs.set('country', countryFilter);
    if (industryFilter) qs.set('industry', industryFilter);
    if (sizeFilter) qs.set('size', sizeFilter);
    return qs.toString();
  }, [q, classFilter, countryFilter, industryFilter, sizeFilter]);

  // Stint 64.B — list of unique non-null countries from the loaded
  // rows, sorted. Lets the country dropdown only show values that
  // actually exist in the data — Diego shouldn't have to remember
  // every ISO code.
  const countriesInData = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.country) set.add(r.country);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Stint 64.B — apply country/industry/size filters client-side over
  // the rows already returned by the API (which only filters on q +
  // classification). Avoids extending the /api/crm/companies query
  // surface for filters that are cheap to compute locally.
  const filteredRows = useMemo(() => {
    if (!rows) return null;
    return rows.filter(r => {
      if (countryFilter && r.country !== countryFilter) return false;
      if (industryFilter && r.industry !== industryFilter) return false;
      if (sizeFilter && r.size !== sizeFilter) return false;
      return true;
    });
  }, [rows, countryFilter, industryFilter, sizeFilter]);

  const hasActiveFilters = !!(q || classFilter || countryFilter || industryFilter || sizeFilter);
  const clearAllFilters = () => {
    setQ('');
    setClassFilter('');
    setCountryFilter('');
    setIndustryFilter('');
    setSizeFilter('');
  };

  const toggleOne = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = (on: boolean) => setSelected(on ? new Set((rows ?? []).map(r => r.id)) : new Set());
  const clearSelection = () => setSelected(new Set());

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (classFilter) qs.set('classification', classFilter);
    fetch(`/api/crm/companies?${qs}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? `${r.status} ${r.statusText}`);
        }
        return r.json();
      })
      .then(body => { setRows(Array.isArray(body) ? body : []); setError(null); })
      .catch((e: Error) => { setError(e.message || 'Network error'); setRows([]); });
  }, [q, classFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Company created');
    await load();
  }

  // Stint 63.C — soft-delete helper invoked by the context menu.
  async function archiveCompany(id: string, name: string) {
    if (!confirm(`Archive "${name}"? This soft-deletes; you can restore from /crm/trash.`)) return;
    try {
      const res = await fetch(`/api/crm/companies/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Company archived');
      await load();
    } catch (e) {
      toast.error(`Archive failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  // Stint 63.A — inline-edit helper. Each editable cell calls this with
  // a single field/value, hits PUT /api/crm/companies/[id] which only
  // touches that field (whitelist enforced server-side), and refetches
  // the list so any audit-log row flushed by the server is reflected.
  // Optimistic display happens inside InlineCellEditor; on save error
  // we toast and reload to rollback to server state.
  async function patchCompany(id: string, field: string, value: unknown): Promise<void> {
    try {
      const res = await fetch(`/api/crm/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Save failed (${res.status})`);
      }
      // Optimistic: patch the row in-place so the UI reflects the change
      // without the visual flicker of a full reload.
      setRows(prev => prev?.map(r =>
        r.id === id ? { ...r, [field]: value as never } : r
      ) ?? null);
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
      // Rollback by reloading from server.
      await load();
      throw e;
    }
  }

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const r of rows ?? []) by[r.classification ?? 'none'] = (by[r.classification ?? 'none'] || 0) + 1;
    return by;
  }, [rows]);

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="CRM accounts — firms, prospects, service providers, referrers. Press N anywhere to quick-create."
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New company
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New company"
        subtitle="Create a new account in the CRM."
        fields={COMPANY_FIELDS}
        onSave={handleCreate}
      />
      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={load} /></div>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search company name..."
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-border rounded-md"
          />
        </div>
        <select
          value={classFilter}
          onChange={e => setClassFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white"
        >
          <option value="">All classifications</option>
          {Object.entries(LABELS_CLASSIFICATION).map(([k, label]) => (
            <option key={k} value={k}>{label}{counts[k] ? ` · ${counts[k]}` : ''}</option>
          ))}
        </select>
        {/* Stint 64.B — Country filter (only countries actually present
            in data). HubSpot/Salesforce list-view inspiration: never
            show users dropdown options that filter to zero rows. */}
        <select
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white"
          aria-label="Filter by country"
        >
          <option value="">All countries</option>
          {countriesInData.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {/* Stint 64.B — Industry filter. Static list because industries
            are a fixed taxonomy (LABELS_INDUSTRY). */}
        <select
          value={industryFilter}
          onChange={e => setIndustryFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white"
          aria-label="Filter by industry"
        >
          <option value="">All industries</option>
          {Object.entries(LABELS_INDUSTRY).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        {/* Stint 64.B — Size filter. */}
        <select
          value={sizeFilter}
          onChange={e => setSizeFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white"
          aria-label="Filter by size"
        >
          <option value="">All sizes</option>
          {Object.entries(LABELS_SIZE).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs text-ink-muted hover:text-ink underline"
            title="Clear all filters"
          >
            Clear filters
          </button>
        )}
        <CrmSavedViews
          currentQuery={currentQuery}
          storageKey="cifra.crm.companies.savedViews.v1"
          defaultLabel="All companies"
        />
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="companies" />
          <span className="text-xs text-ink-muted">
            {filteredRows?.length ?? 0}{filteredRows && rows && filteredRows.length !== rows.length ? ` of ${rows.length}` : ''} companies
          </span>
        </div>
      </div>

      {(filteredRows ?? rows).length === 0 ? (
        // Stint 63.F — actionable empty state. The previous copy
        // pointed at a Notion import script Diego only ran once; for
        // ongoing use the right CTA is "create one now". Two distinct
        // copies: filtered-empty (loosen filters) vs truly-empty
        // (create your first one).
        (() => {
          return (
            <EmptyState
              illustration="clients"
              title={hasActiveFilters ? 'No companies match these filters' : 'No companies yet'}
              description={hasActiveFilters
                ? 'Loosen your filters or clear them to see all companies.'
                : 'Create your first company to start tracking accounts. Press N anywhere in /crm for quick-capture.'}
              action={hasActiveFilters ? undefined : (
                <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
                  New company
                </Button>
              )}
            />
          );
        })()
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-ink-muted">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === (filteredRows?.length ?? 0)}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < (filteredRows?.length ?? 0); }}
                    onChange={e => setSelected(e.target.checked ? new Set((filteredRows ?? []).map(r => r.id)) : new Set())}
                    className="h-4 w-4 accent-brand-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Company</th>
                <th className="text-left px-3 py-2 font-medium">Classification</th>
                <th className="text-left px-3 py-2 font-medium">Country</th>
                <th className="text-left px-3 py-2 font-medium">Industry</th>
                <th className="text-left px-3 py-2 font-medium">Size</th>
                <th className="text-left px-3 py-2 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {(filteredRows ?? rows).map(r => (
                <tr
                  key={r.id}
                  onContextMenu={(e) => {
                    // Stint 63.C — let the browser handle right-click
                    // when the target is an editable cell so paste / spell
                    // check stay accessible. Otherwise open our menu.
                    const tgt = e.target as HTMLElement;
                    const tag = tgt.tagName?.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;
                    e.preventDefault();
                    setContextMenu({ company: r, x: e.clientX, y: e.clientY });
                  }}
                  className={`border-t border-border hover:bg-surface-alt/50 ${selected.has(r.id) ? 'bg-brand-50/40' : ''}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      className="h-4 w-4 accent-brand-500 cursor-pointer"
                    />
                  </td>
                  {/* Company name — wrapped in CompanyHoverPreview (400ms
                      hover delay → popover with counts/tags). Link still
                      navigates to detail. */}
                  <td className="px-3 py-2">
                    <CompanyHoverPreview companyId={r.id}>
                      <Link href={`/crm/companies/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.company_name}
                      </Link>
                    </CompanyHoverPreview>
                    {r.entity_id && (
                      <span className="ml-2 text-2xs uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5">
                        Tax entity linked
                      </span>
                    )}
                  </td>
                  {/* Classification — ChipSelect with tone per value. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.classification ?? ''}
                      options={[
                        { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                        ...COMPANY_CLASSIFICATIONS.map(v => ({
                          value: v,
                          label: LABELS_CLASSIFICATION[v as CompanyClassification],
                          tone: CLASSIFICATION_TONES[v],
                        })),
                      ]}
                      onChange={next => { void patchCompany(r.id, 'classification', next || null); }}
                      ariaLabel="Classification"
                    />
                  </td>
                  {/* Country — free-text 2-letter code (LU, FR, BE, etc.). */}
                  <td className="px-3 py-2 tabular-nums max-w-[80px]">
                    <InlineTextCell
                      value={r.country}
                      onSave={async v => { await patchCompany(r.id, 'country', v); }}
                      placeholder="—"
                    />
                  </td>
                  {/* Industry — ChipSelect, fixed taxonomy. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.industry ?? ''}
                      options={[
                        { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                        ...COMPANY_INDUSTRIES.map(v => ({
                          value: v,
                          label: LABELS_INDUSTRY[v as keyof typeof LABELS_INDUSTRY],
                        })),
                      ]}
                      onChange={next => { void patchCompany(r.id, 'industry', next || null); }}
                      ariaLabel="Industry"
                    />
                  </td>
                  {/* Size — ChipSelect, fixed taxonomy. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.size ?? ''}
                      options={[
                        { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                        ...COMPANY_SIZES.map(v => ({
                          value: v,
                          label: LABELS_SIZE[v as keyof typeof LABELS_SIZE],
                        })),
                      ]}
                      onChange={next => { void patchCompany(r.id, 'size', next || null); }}
                      ariaLabel="Size"
                    />
                  </td>
                  {/* Tags — comma-separated free-text via InlineTagsCell. */}
                  <td className="px-3 py-2">
                    <InlineTagsCell
                      value={r.tags ?? []}
                      onSave={async v => { await patchCompany(r.id, 'tags', v); }}
                      placeholder="—"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_company"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
        onEditFields={() => setBulkEditOpen(true)}
      />

      {/* Stint 63.E — bulk-edit drawer. Whitelist of fields kept in
          sync with /api/crm/companies/bulk-update ALLOWED_FIELDS. */}
      <BulkEditDrawer
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        recordType="company"
        selectedIds={Array.from(selected)}
        endpoint="/api/crm/companies/bulk-update"
        fields={[
          {
            key: 'classification',
            label: 'Classification',
            type: 'select',
            options: Object.entries(LABELS_CLASSIFICATION).map(([value, label]) => ({ value, label })),
          },
          {
            key: 'industry',
            label: 'Industry',
            type: 'select',
            options: Object.entries(LABELS_INDUSTRY).map(([value, label]) => ({ value, label })),
          },
          {
            key: 'size',
            label: 'Size',
            type: 'select',
            options: Object.entries(LABELS_SIZE).map(([value, label]) => ({ value, label })),
          },
          { key: 'country', label: 'Country', type: 'text', placeholder: 'e.g. LU' },
          { key: 'lead_counsel', label: 'Lead counsel', type: 'text', placeholder: 'e.g. Diego' },
        ] satisfies BulkEditField[]}
        onApplied={() => { clearSelection(); load(); }}
      />

      {/* Stint 63.C — right-click context menu. Single instance per
          page lifted to here; rows hand it the company + cursor coords
          via setContextMenu(). */}
      {contextMenu && (() => {
        const c = contextMenu.company;
        const actions: CrmContextAction[] = [
          {
            label: 'Open detail',
            icon: ExternalLinkIcon,
            onClick: () => router.push(`/crm/companies/${c.id}`),
          },
          {
            label: 'New opportunity for this company',
            icon: TargetIcon,
            onClick: () => router.push(`/crm/opportunities?company_id=${c.id}`),
          },
          {
            label: 'Archive',
            icon: Trash2Icon,
            danger: true,
            separatorBefore: true,
            onClick: () => archiveCompany(c.id, c.company_name),
          },
        ];
        return (
          <CrmContextMenu
            title={c.company_name}
            x={contextMenu.x}
            y={contextMenu.y}
            actions={actions}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}
    </div>
  );
}
