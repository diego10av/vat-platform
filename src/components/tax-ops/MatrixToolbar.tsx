'use client';

// Shared toolbar strip above every tax-type category matrix:
// year selector + row count + export-to-Excel button.
//
// The export button calls GET /api/tax-ops/matrix/export (built in
// 36.D) with the page's tax_type + period_pattern + year and triggers
// a browser download. Falls back silently if the endpoint errors —
// the toast surfaces the failure.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DownloadIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { FILING_STATUSES, filingStatusLabel } from './FilingStatusBadge';
import { useTaxTeamMembers, ownershipNamesInCells } from './useMatrixData';
import type { MatrixEntity } from './TaxTypeMatrix';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';
import { NewEntityModal } from './NewEntityModal';

interface Props {
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
  count: number;
  countLabel: string;                 // "entities on quarterly VAT"
  extraChildren?: React.ReactNode;    // slot for page-specific controls (toggles)
  exportTaxType: string;              // e.g. 'vat_quarterly'
  exportPeriodPattern?: string;
  exportServiceKind?: 'filing' | 'review';
  exportShowInactive?: boolean;
  /**
   * Stint 39.D — status filter. When set (non-'all'), parent page should
   * hide rows where no period cell has that status. 'all' (default) shows
   * every row. Required for Diego's follow-up workflow: pick
   * "info_to_request" and see only the entities he still needs to chase.
   */
  statusFilter?: string;
  onStatusFilterChange?: (next: string) => void;
  /**
   * Stint 43.D7 — partner in charge filter. 'all' / '__unassigned' /
   * any tax_team_members.short_name. Combined AND with status + associate.
   */
  partnerFilter?: string;
  onPartnerFilterChange?: (next: string) => void;
  /** Stint 43.D7 — associate filter, mirrors partnerFilter. */
  associateFilter?: string;
  onAssociateFilterChange?: (next: string) => void;
  /**
   * Stint 44.F2 — pages pass the *unfiltered* entity list (data.entities,
   * not the post-filter slice) so the dropdown can offer the union of:
   * names that actually appear in the matrix cells (free-text, may not
   * exist in tax_team_members) ∪ team members from the team endpoint.
   * "What you see in the matrix is what you can filter on."
   */
  entitiesForFilters?: MatrixEntity[];
  /**
   * Stint 48 (post-audit) — period (quarter / month) sub-filter on top
   * of the year. Diego: "ahora mismo sólo aparece 2026 — habría que
   * poder filtrar por quarter y por mes". Quarterly pages pass the 4
   * quarters; monthly pages pass the 12 months. 'all' shows every
   * column; a specific period_label collapses the matrix to that one
   * period.
   */
  periodOptions?: Array<{ value: string; label: string }>;
  periodFilter?: string;
  onPeriodFilterChange?: (next: string) => void;
  periodLabel?: string;        // "Quarter" / "Month" — dropdown label
  /**
   * Stint 64 — search input on the toolbar. Pages pass a free-text
   * query that filters the matrix by entity legal_name (case-insensitive
   * substring match — see `filterEntities` in useMatrixData). Diego:
   * "haya un search, poniendo el nombre de la entidad o lo que sea,
   * porque si tengo 100 entidades a lo mejor no la encuentro pero si
   * me sé el nombre, pongo el nombre y voy a ella directamente."
   */
  searchQuery?: string;
  onSearchQueryChange?: (next: string) => void;
  /**
   * Stint 64 — slot for filters that should appear BETWEEN year and
   * status (currently used by VAT annual to position its Subtype filter
   * next to the year, where Diego expects it). Different from
   * `extraChildren` which renders AFTER the status/partner/associate
   * filters.
   */
  extraFiltersAfterYear?: React.ReactNode;
}

export function MatrixToolbar({
  year, years, onYearChange,
  count, countLabel,
  extraChildren,
  exportTaxType, exportPeriodPattern, exportServiceKind, exportShowInactive,
  statusFilter, onStatusFilterChange,
  partnerFilter, onPartnerFilterChange,
  associateFilter, onAssociateFilterChange,
  entitiesForFilters,
  periodOptions, periodFilter, onPeriodFilterChange, periodLabel = 'Period',
  searchQuery, onSearchQueryChange,
  extraFiltersAfterYear,
}: Props) {
  const [busy, setBusy] = useState(false);
  // Stint 51.G — global "+ New entity" CTA on every matrix toolbar so
  // Diego can register a fresh client + every obligation it's subject
  // to without having to drill into a family-specific row first.
  const [newEntityOpen, setNewEntityOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  // Lazy-load team members only when at least one ownership filter is wired
  // so pages that don't use them don't pay the fetch cost.
  const ownershipFiltersWired = !!(onPartnerFilterChange || onAssociateFilterChange);
  const { members } = useTaxTeamMembers();

  // Stint 44.F2 — partner and associate dropdowns are built independently
  // so each only offers names actually present in its respective field
  // (Diego: "los nombres que se han ido incluyendo, los exactos"). We
  // union team members + names found in the cells, dedupe, sort, then
  // pin "All" + "Unassigned" on top.
  const partnerOptions = useMemo<SearchableOption[]>(
    () => buildOwnershipOptions(
      ownershipFiltersWired,
      members,
      entitiesForFilters ?? [],
      'partner_in_charge',
    ),
    [ownershipFiltersWired, members, entitiesForFilters],
  );
  const associateOptions = useMemo<SearchableOption[]>(
    () => buildOwnershipOptions(
      ownershipFiltersWired,
      members,
      entitiesForFilters ?? [],
      'associates_working',
    ),
    [ownershipFiltersWired, members, entitiesForFilters],
  );

  async function downloadExcel() {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      qs.set('tax_type', exportTaxType);
      qs.set('year', String(year));
      if (exportPeriodPattern) qs.set('period_pattern', exportPeriodPattern);
      if (exportServiceKind) qs.set('service_kind', exportServiceKind);
      if (exportShowInactive) qs.set('show_inactive', '1');

      const res = await fetch(`/api/tax-ops/matrix/export?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const filename = `${exportTaxType}_${year}.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      toast.error(`Export failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Stint 64 — entity search. Renders first (most prominent) when
          wired so Diego can find a specific entity in 100+ row lists
          without scrolling. Filtering happens in `filterEntities`
          (useMatrixData) so it composes with status/partner/associate. */}
      {onSearchQueryChange && (
        <div className="relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search entity…"
            aria-label="Search by entity name"
            className="pl-7 pr-7 py-1 text-sm border border-border rounded-md bg-surface w-[200px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-ink-muted hover:text-ink rounded"
            >
              <XIcon size={11} />
            </button>
          )}
        </div>
      )}
      <label className="inline-flex items-center gap-1.5 text-sm">
        <span className="text-ink-muted">Period year:</span>
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="px-2 py-1 text-sm border border-border rounded-md bg-surface"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      {/* Stint 64 — slot for page-specific filters that should sit
          right after the year (e.g. VAT annual's Subtype). Diego's ask:
          "el subtipo, prefiero que esté entre period year y estatus." */}
      {extraFiltersAfterYear}
      {/* Stint 48 — period sub-filter for quarterly/monthly matrices.
          Pages pass the available periods; selecting one collapses the
          matrix to a single column. */}
      {periodOptions && onPeriodFilterChange && (
        <label className="inline-flex items-center gap-1.5 text-sm">
          <span className="text-ink-muted">{periodLabel}:</span>
          <select
            value={periodFilter ?? 'all'}
            onChange={(e) => onPeriodFilterChange(e.target.value)}
            className="px-2 py-1 text-sm border border-border rounded-md bg-surface"
          >
            <option value="all">All</option>
            {periodOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
      {onStatusFilterChange && (
        <label className="inline-flex items-center gap-1.5 text-sm">
          <span className="text-ink-muted">Status:</span>
          <select
            value={statusFilter ?? 'all'}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="px-2 py-1 text-sm border border-border rounded-md bg-surface"
          >
            <option value="all">All</option>
            {FILING_STATUSES.map(s => (
              <option key={s} value={s}>{filingStatusLabel(s)}</option>
            ))}
            <option value="__empty">No status set</option>
          </select>
        </label>
      )}
      {onPartnerFilterChange && (
        <label className="inline-flex items-center gap-1.5 text-sm">
          <span className="text-ink-muted">Partner:</span>
          <SearchableSelect
            options={partnerOptions}
            value={partnerFilter ?? 'all'}
            onChange={onPartnerFilterChange}
            ariaLabel="Filter by partner in charge"
          />
        </label>
      )}
      {onAssociateFilterChange && (
        <label className="inline-flex items-center gap-1.5 text-sm">
          <span className="text-ink-muted">Associate:</span>
          <SearchableSelect
            options={associateOptions}
            value={associateFilter ?? 'all'}
            onChange={onAssociateFilterChange}
            ariaLabel="Filter by associate working"
          />
        </label>
      )}
      {(statusFilter && statusFilter !== 'all')
        || (partnerFilter && partnerFilter !== 'all')
        || (associateFilter && associateFilter !== 'all') ? (
        <button
          type="button"
          onClick={() => {
            onStatusFilterChange?.('all');
            onPartnerFilterChange?.('all');
            onAssociateFilterChange?.('all');
          }}
          className="text-xs text-ink-muted hover:text-ink underline"
          title="Clear all filters"
        >
          clear filters
        </button>
      ) : null}
      {extraChildren}
      <div className="text-xs text-ink-muted">
        {count} {countLabel}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setNewEntityOpen(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600"
          title="Create a brand-new entity (any family) and tick its obligations"
        >
          <PlusIcon size={12} /> New entity
        </button>
        <button
          onClick={downloadExcel}
          disabled={busy || count === 0}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-md border border-border hover:bg-surface-alt disabled:opacity-50"
          title="Download this view as Excel"
        >
          <DownloadIcon size={12} />
          {busy ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>
      <NewEntityModal
        open={newEntityOpen}
        onClose={() => setNewEntityOpen(false)}
        onCreated={(id) => router.push(`/tax-ops/entities/${id}`)}
      />
    </div>
  );
}

/**
 * Stint 44.F2 — union team members + names in the cells, dedupe, sort,
 * pin "All" + "Unassigned" on top. Member entries get the "short · full"
 * label so Diego can disambiguate when two people share a short name.
 * Names not in the team table render as plain short names.
 */
function buildOwnershipOptions(
  wired: boolean,
  members: Array<{ short_name: string; full_name: string | null }>,
  entities: MatrixEntity[],
  field: 'partner_in_charge' | 'associates_working',
): SearchableOption[] {
  if (!wired) return [];
  const inCells = ownershipNamesInCells(entities, field);
  const memberByShort = new Map(members.map(m => [m.short_name, m] as const));
  const merged = new Set<string>();
  for (const m of members) merged.add(m.short_name);
  for (const n of inCells) merged.add(n);
  const sorted = Array.from(merged).sort((a, b) => a.localeCompare(b));
  return [
    { value: 'all', label: 'All' },
    { value: '__unassigned', label: 'Unassigned' },
    ...sorted.map(name => {
      const m = memberByShort.get(name);
      return {
        value: name,
        label: m?.full_name ? `${name} · ${m.full_name}` : name,
      };
    }),
  ];
}
