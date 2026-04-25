'use client';

// /tax-ops/entities — master list of all legal entities, grouped by
// client-group (expandable sections). Summary columns tell Diego at
// a glance which entities are behind on their YTD filings.
//
// Stint 42 cleanup-batch — bulk ops:
//   - Checkbox per row + "select all visible" toggle
//   - Sticky toolbar appears with N selected + 3 actions:
//       Change family · Archive · Reactivate
//   - All actions go through POST /api/tax-ops/entities/bulk-update
//     (single transaction + per-entity audit_log row each).

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  SearchIcon, ChevronDownIcon, ChevronRightIcon, XIcon,
  ArchiveIcon, ArchiveRestoreIcon, FoldersIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { crmLoadShape } from '@/lib/useCrmFetch';
import { useToast } from '@/components/Toaster';

interface EntityRow {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  is_active: boolean;
  liquidation_date: string | null;
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

type BulkAction =
  | { kind: 'change_family' }
  | { kind: 'archive' }
  | { kind: 'reactivate' };

export default function EntitiesListPage() {
  const [year] = useState<string>('2026');
  const [q, setQ] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openAction, setOpenAction] = useState<BulkAction | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    qs.set('year', year);
    if (includeArchived) qs.set('is_active', '0');  // include only inactive
    crmLoadShape<Response>(`/api/tax-ops/entities?${qs}`, b => b as Response)
      .then(b => { setData(b); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setData({ entities: [], groups: [], year: 2026 }); });
  }, [q, year, includeArchived]);

  // Also load all entities (active + archived) when toggle is on. The
  // API treats is_active=0 as "only inactive" not "include both"; load
  // both lists separately and merge when the toggle is on.
  const [archivedRows, setArchivedRows] = useState<EntityRow[]>([]);
  useEffect(() => {
    if (!includeArchived) { setArchivedRows([]); return; }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    qs.set('year', year);
    qs.set('is_active', '0');
    crmLoadShape<Response>(`/api/tax-ops/entities?${qs}`, b => b as Response)
      .then(b => setArchivedRows(b.entities))
      .catch(() => setArchivedRows([]));
  }, [q, year, includeArchived]);

  // Active list always loads.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    qs.set('year', year);
    crmLoadShape<Response>(`/api/tax-ops/entities?${qs}`, b => b as Response)
      .then(b => { setData(b); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setData({ entities: [], groups: [], year: 2026 }); });
  }, [q, year]);

  // The merged list shown in the table.
  const rows = useMemo(() => {
    const base = data?.entities ?? [];
    return includeArchived ? [...base, ...archivedRows] : base;
  }, [data, archivedRows, includeArchived]);

  const grouped = useMemo(() => {
    const m = new Map<string, EntityRow[]>();
    for (const r of rows) {
      const key = r.group_name ?? '(no group)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  function toggleGroup(name: string) {
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(rows.map(r => r.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // Determine which actions make sense given the selection.
  const selectedRows = useMemo(
    () => rows.filter(r => selected.has(r.id)),
    [rows, selected],
  );
  const anyActiveSelected = selectedRows.some(r => r.is_active);
  const anyArchivedSelected = selectedRows.some(r => !r.is_active);

  async function applyBulk(patch: Record<string, unknown>, msg: string) {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    try {
      const res = await fetch('/api/tax-ops/entities/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_ids: ids, patch }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${msg} (${ids.length})`);
      clearSelection();
      setOpenAction(null);
      load();
    } catch (e) {
      toast.error(`Bulk update failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  if (data === null) return <PageSkeleton />;

  const allFamilies = data.groups;

  return (
    <div>
      <PageHeader
        title="Entities"
        subtitle={`${data.entities.length} active entit${data.entities.length === 1 ? 'y' : 'ies'} across ${grouped.filter(([, items]) => items.some(i => i.is_active)).length} client groups${includeArchived ? ` · ${archivedRows.length} archived included` : ''}.`}
      />

      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <div className="relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by legal name or VAT number…"
            className="pl-7 pr-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface w-[280px]"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span className="text-ink-muted">Include archived</span>
        </label>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={selected.size === rows.length ? clearSelection : selectAllVisible}
            className="ml-auto text-[11.5px] text-ink-muted hover:text-ink underline"
          >
            {selected.size === rows.length ? 'Clear selection' : `Select all (${rows.length})`}
          </button>
        )}
      </div>

      {/* Bulk-action toolbar — sticky banner when any rows selected */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-30 mb-3 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] text-ink font-medium">
            {selected.size} {selected.size === 1 ? 'entity' : 'entities'} selected
          </span>
          <button
            type="button"
            onClick={() => setOpenAction({ kind: 'change_family' })}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border border-border bg-surface hover:bg-surface-alt"
          >
            <FoldersIcon size={12} /> Change family…
          </button>
          {anyActiveSelected && (
            <button
              type="button"
              onClick={() => setOpenAction({ kind: 'archive' })}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border border-border bg-surface hover:bg-danger-50 hover:text-danger-700"
            >
              <ArchiveIcon size={12} /> Archive…
            </button>
          )}
          {anyArchivedSelected && (
            <button
              type="button"
              onClick={() => setOpenAction({ kind: 'reactivate' })}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border border-border bg-surface hover:bg-green-50 hover:text-green-700"
            >
              <ArchiveRestoreIcon size={12} /> Reactivate…
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-ink-muted hover:text-ink p-1"
            aria-label="Clear selection"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {error && <CrmErrorBox message={error} onRetry={load} />}

      {rows.length === 0 ? (
        <EmptyState title="No entities" description="Run the importer or add entities via the API." />
      ) : (
        <div className="space-y-2">
          {grouped.map(([groupName, items]) => {
            const isCollapsed = collapsed.has(groupName);
            const groupAllSelected = items.every(i => selected.has(i.id));
            const someGroupSelected = items.some(i => selected.has(i.id));
            return (
              <div key={groupName} className="rounded-md border border-border bg-surface overflow-hidden">
                <div className="w-full flex items-center gap-2 px-3 py-2 bg-surface-alt">
                  <input
                    type="checkbox"
                    checked={groupAllSelected}
                    ref={(el) => { if (el) el.indeterminate = !groupAllSelected && someGroupSelected; }}
                    onChange={() => {
                      const ids = items.map(i => i.id);
                      setSelected(prev => {
                        const n = new Set(prev);
                        if (groupAllSelected) ids.forEach(id => n.delete(id));
                        else ids.forEach(id => n.add(id));
                        return n;
                      });
                    }}
                    aria-label={`Select all in ${groupName}`}
                    className="cursor-pointer"
                  />
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className="flex-1 flex items-center gap-1 text-left hover:text-brand-700"
                  >
                    {isCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
                    <span className="font-semibold text-[12.5px] text-ink">{groupName}</span>
                    <span className="text-[11.5px] text-ink-muted">({items.length})</span>
                  </button>
                </div>
                {!isCollapsed && (
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-alt/30 text-ink-muted">
                      <tr className="text-left">
                        <th className="px-2 py-1.5 w-[28px]"></th>
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
                        const isSelected = selected.has(e.id);
                        return (
                          <tr
                            key={e.id}
                            className={[
                              'border-t border-border hover:bg-surface-alt/40',
                              isSelected ? 'bg-brand-50/50' : '',
                              !e.is_active ? 'opacity-60' : '',
                            ].join(' ')}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleOne(e.id)}
                                aria-label={`Select ${e.legal_name}`}
                                className="cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Link href={`/tax-ops/entities/${e.id}`} className="font-medium text-ink hover:text-brand-700">
                                {e.legal_name}
                              </Link>
                              {!e.is_active && (
                                <span className="ml-2 inline-flex items-center px-1 py-0 rounded-full text-[9.5px] bg-surface-alt text-ink-muted">
                                  {e.liquidation_date ? `Liquidated ${e.liquidation_date}` : 'Inactive'}
                                </span>
                              )}
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

      {/* Bulk action modals */}
      {openAction?.kind === 'change_family' && (
        <ChangeFamilyModal
          count={selected.size}
          families={allFamilies}
          onClose={() => setOpenAction(null)}
          onApply={(group_id) => applyBulk({ client_group_id: group_id }, 'Family changed')}
        />
      )}
      {openAction?.kind === 'archive' && (
        <ArchiveModal
          count={selectedRows.filter(r => r.is_active).length}
          onClose={() => setOpenAction(null)}
          onApply={(date) => applyBulk(
            { is_active: false, liquidation_date: date },
            'Entities archived',
          )}
        />
      )}
      {openAction?.kind === 'reactivate' && (
        <ConfirmModal
          title={`Reactivate ${selectedRows.filter(r => !r.is_active).length} entit${selectedRows.filter(r => !r.is_active).length === 1 ? 'y' : 'ies'}?`}
          body="They'll be marked active again. liquidation_date will be cleared."
          confirmLabel="Reactivate"
          onClose={() => setOpenAction(null)}
          onApply={() => applyBulk(
            { is_active: true, liquidation_date: null },
            'Entities reactivated',
          )}
        />
      )}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────────────

function ChangeFamilyModal({
  count, families, onClose, onApply,
}: {
  count: number;
  families: GroupRow[];
  onClose: () => void;
  onApply: (groupId: string | null) => void | Promise<void>;
}) {
  const [pick, setPick] = useState<string>('');  // '' = no choice yet
  return (
    <ModalShell onClose={onClose} title={`Change family for ${count} entit${count === 1 ? 'y' : 'ies'}`}>
      <p className="text-[12px] text-ink-muted mb-2">
        Move all selected entities into the same family — or unassign them.
      </p>
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="w-full px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface mb-3"
      >
        <option value="">— pick a family —</option>
        <option value="__unassign__">— Unassign (no family)</option>
        {families.map(g => (
          <option key={g.id} value={g.id}>{g.name} ({g.entity_count})</option>
        ))}
      </select>
      <ModalButtons
        onClose={onClose}
        confirmLabel="Apply"
        confirmDisabled={pick === ''}
        onConfirm={() => onApply(pick === '__unassign__' ? null : pick)}
      />
    </ModalShell>
  );
}

function ArchiveModal({
  count, onClose, onApply,
}: {
  count: number;
  onClose: () => void;
  onApply: (date: string | null) => void | Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(today);
  return (
    <ModalShell onClose={onClose} title={`Archive ${count} entit${count === 1 ? 'y' : 'ies'}`}>
      <p className="text-[12px] text-ink-muted mb-2">
        They&apos;ll stop appearing in matrices for years AFTER the liquidation date.
        Their existing filings stay intact and remain visible.
      </p>
      <label className="block text-[11px] font-medium text-ink-muted mb-1">
        Liquidation / de-registration date (optional)
      </label>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface tabular-nums mb-3"
      />
      <ModalButtons
        onClose={onClose}
        confirmLabel="Archive"
        onConfirm={() => onApply(date || null)}
      />
    </ModalShell>
  );
}

function ConfirmModal({
  title, body, confirmLabel, onClose, onApply,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onApply: () => void | Promise<void>;
}) {
  return (
    <ModalShell onClose={onClose} title={title}>
      <p className="text-[12px] text-ink-muted mb-3">{body}</p>
      <ModalButtons onClose={onClose} confirmLabel={confirmLabel} onConfirm={onApply} />
    </ModalShell>
  );
}

function ModalShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        role="dialog"
        aria-label={title}
        className="relative bg-surface border border-border rounded-lg shadow-xl max-w-md w-full p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-[14px] font-semibold text-ink flex-1">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink p-1">
            <XIcon size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalButtons({
  onClose, onConfirm, confirmLabel, confirmDisabled,
}: {
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel: string;
  confirmDisabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex justify-end gap-2 mt-2">
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-1 text-[12px] rounded-md border border-border hover:bg-surface-alt"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={busy || confirmDisabled}
        onClick={async () => {
          setBusy(true);
          try { await onConfirm(); } finally { setBusy(false); }
        }}
        className="px-3 py-1 text-[12px] rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? 'Applying…' : confirmLabel}
      </button>
    </div>
  );
}
