'use client';

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SearchIcon, PlusIcon, ExternalLinkIcon, BuildingIcon, Trash2Icon, CheckIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { BulkActionBar } from '@/components/crm/BulkActionBar';
import { ExportButton } from '@/components/crm/ExportButton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
// Stint 63.G/H/I — port the patterns to matters.
import { CrmContextMenu, type CrmContextAction } from '@/components/crm/CrmContextMenu';
import { CrmSavedViews } from '@/components/crm/CrmSavedViews';
import { BulkEditDrawer, type BulkEditField } from '@/components/crm/BulkEditDrawer';
// Stint 63.L — hover preview on matter reference.
import { MatterHoverPreview } from '@/components/crm/MatterHoverPreview';
import { crmLoadList } from '@/lib/useCrmFetch';
import { MATTER_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
// Stint 63.A.2 — port Tax-Ops inline editors to matters table.
import { InlineTextCell, InlineDateCell } from '@/components/tax-ops/inline-editors';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import {
  LABELS_MATTER_STATUS, MATTER_STATUSES, formatEur,
  type MatterStatus,
} from '@/lib/crm-types';

// Stint 63.A.2 — matter status tones (active/on_hold/closed/archived).
const STATUS_TONES: Record<string, string> = {
  active:   'bg-success-50 text-success-800',
  on_hold:  'bg-amber-50 text-amber-800',
  closed:   'bg-info-50 text-info-800',
  archived: 'bg-surface-alt text-ink-faint',
};

interface Matter {
  id: string;
  matter_reference: string;
  title: string;
  status: string;
  practice_areas: string[];
  fee_type: string | null;
  hourly_rate_eur: number | null;
  opening_date: string | null;
  closing_date: string | null;
  conflict_check_done: boolean;
  client_name: string | null;
  client_id: string | null;
  total_billed: number | string;
  total_hours: number | string;
}

export default function MattersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MattersPageContent />
    </Suspense>
  );
}

function MattersPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<Matter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState<string>(searchParams.get('status') ?? '');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Stint 63.I — context menu state.
  const [contextMenu, setContextMenu] = useState<{ matter: Matter; x: number; y: number } | null>(null);
  // Stint 63.H — bulk-edit drawer state.
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const toast = useToast();

  // Stint 63.G — URL filter sync.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [q, status, router, pathname]);

  const currentQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    return qs.toString();
  }, [q, status]);

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
    if (status) qs.set('status', status);
    crmLoadList<Matter>(`/api/crm/matters?${qs}`)
      .then(rows => { setRows(rows); setError(null); })
      .catch((e: Error) => { setError(e.message || 'Network error'); setRows([]); });
  }, [q, status]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/matters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Matter created');
    await load();
  }

  // Stint 63.I — soft-delete (archive) helper for context menu.
  async function archiveMatter(id: string, ref: string) {
    if (!confirm(`Archive "${ref}"? Soft delete; restore from /crm/trash.`)) return;
    try {
      const res = await fetch(`/api/crm/matters/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Matter archived');
      await load();
    } catch (e) {
      toast.error(`Archive failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  // Stint 63.A.2 — inline-edit helper for matter rows.
  async function patchMatter(id: string, field: string, value: unknown): Promise<void> {
    try {
      const res = await fetch(`/api/crm/matters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Save failed (${res.status})`);
      }
      setRows(prev => prev?.map(r =>
        r.id === id ? { ...r, [field]: value as never } : r
      ) ?? null);
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
      await load();
      throw e;
    }
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Matters"
        subtitle="Client engagements — active and historical. Click any cell to edit inline."
        actions={
          <>
            <Link
              href="/crm/matters/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
            >
              <PlusIcon size={13} />
              New matter (wizard)
            </Link>
            <Button onClick={() => setNewOpen(true)} variant="secondary" size="sm" icon={<PlusIcon size={13} />}>
              Quick add
            </Button>
          </>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="Quick add matter"
        subtitle="Bypasses conflict-check wizard — use only for historic/imported matters."
        fields={MATTER_FIELDS}
        initial={{ status: 'active', conflict_check_done: false }}
        onSave={handleCreate}
      />
      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={load} /></div>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reference or title..."
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-border rounded-md" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white">
          <option value="">All statuses</option>
          {MATTER_STATUSES.map(s => <option key={s} value={s}>{LABELS_MATTER_STATUS[s]}</option>)}
        </select>
        <CrmSavedViews
          currentQuery={currentQuery}
          storageKey="cifra.crm.matters.savedViews.v1"
          defaultLabel="All matters"
        />
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="matters" />
          <span className="text-xs text-ink-muted">{rows.length} matters</span>
        </div>
      </div>

      {rows.length === 0 ? (
        (() => {
          const filtersActive = q !== '' || status !== '';
          return (
            <EmptyState
              illustration="folder"
              title={filtersActive ? 'No matters match these filters' : 'No matters yet'}
              description={filtersActive
                ? 'Loosen your filters or clear them to see all matters.'
                : 'Matters typically arrive from won opportunities. Use the wizard for full setup or quick-add for imports.'}
              action={filtersActive ? undefined : (
                <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
                  Quick add matter
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
                    checked={selected.size > 0 && selected.size === rows.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={e => toggleAll(e.target.checked)}
                    className="h-4 w-4 accent-brand-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Reference</th>
                <th className="text-left px-3 py-2 font-medium">Client</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Practice</th>
                <th className="text-left px-3 py-2 font-medium">Fee</th>
                <th className="text-right px-3 py-2 font-medium">Total billed</th>
                <th className="text-right px-3 py-2 font-medium">Hours</th>
                <th className="text-left px-3 py-2 font-medium">Opened</th>
                <th className="text-left px-3 py-2 font-medium">Closing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  onContextMenu={(e) => {
                    const tgt = e.target as HTMLElement;
                    const tag = tgt.tagName?.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;
                    e.preventDefault();
                    setContextMenu({ matter: r, x: e.clientX, y: e.clientY });
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
                  {/* Reference → link, wrapped in hover preview, with conflict-check warning chip. */}
                  <td className="px-3 py-2">
                    <MatterHoverPreview matterId={r.id}>
                      <Link href={`/crm/matters/${r.id}`} className="font-medium text-brand-700 hover:underline font-mono">{r.matter_reference}</Link>
                    </MatterHoverPreview>
                    {!r.conflict_check_done && r.status === 'active' && (
                      <span className="ml-2 text-2xs uppercase tracking-wide text-danger-700 bg-danger-50 border border-danger-200 rounded px-1 py-0.5" title="Conflict check pending">No conflict check</span>
                    )}
                  </td>
                  {/* Client → link, not editable inline (heavy action). */}
                  <td className="px-3 py-2">
                    {r.client_id ? <Link href={`/crm/companies/${r.client_id}`} className="text-ink-muted hover:underline">{r.client_name}</Link> : <span className="text-ink-muted">—</span>}
                  </td>
                  {/* Status — ChipSelect with active/on_hold/closed/archived tones. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.status}
                      options={MATTER_STATUSES.map(v => ({
                        value: v,
                        label: LABELS_MATTER_STATUS[v as MatterStatus],
                        tone: STATUS_TONES[v],
                      }))}
                      onChange={next => { void patchMatter(r.id, 'status', next); }}
                      ariaLabel="Matter status"
                    />
                  </td>
                  {/* Practice areas → read-only list (heavy edit; uses
                      tags-with-suggestions in detail page). */}
                  <td className="px-3 py-2 text-ink-muted">{(r.practice_areas ?? []).join(', ') || '—'}</td>
                  {/* Fee type — InlineTextCell (free text: hourly,
                      fixed, retainer, contingency, etc.). */}
                  <td className="px-3 py-2 max-w-[120px]">
                    <InlineTextCell
                      value={r.fee_type}
                      onSave={async v => { await patchMatter(r.id, 'fee_type', v); }}
                      placeholder="—"
                    />
                    {r.hourly_rate_eur && (
                      <div className="text-2xs text-ink-faint mt-0.5">
                        {formatEur(r.hourly_rate_eur)}/h
                      </div>
                    )}
                  </td>
                  {/* Total billed — read-only (server-aggregated from invoices). */}
                  <td className="px-3 py-2 text-right tabular-nums">{formatEur(r.total_billed)}</td>
                  {/* Hours — read-only (server-aggregated from time entries). */}
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.total_hours).toFixed(1)}h</td>
                  {/* Opening date — InlineDateCell, neutral mode (not action-triggering). */}
                  <td className="px-3 py-2">
                    <InlineDateCell
                      value={r.opening_date}
                      onSave={async v => { await patchMatter(r.id, 'opening_date', v); }}
                      mode="neutral"
                    />
                  </td>
                  {/* Closing date — InlineDateCell. urgency mode for active
                      matters (overdue/today highlighted), neutral otherwise. */}
                  <td className="px-3 py-2">
                    <InlineDateCell
                      value={r.closing_date}
                      onSave={async v => { await patchMatter(r.id, 'closing_date', v); }}
                      mode={r.status === 'active' ? 'urgency' : 'neutral'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_matter"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
        onEditFields={() => setBulkEditOpen(true)}
      />

      {/* Stint 63.H — bulk-edit drawer. */}
      <BulkEditDrawer
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        recordType="matter"
        selectedIds={Array.from(selected)}
        endpoint="/api/crm/matters/bulk-update"
        fields={[
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: MATTER_STATUSES.map(s => ({ value: s, label: LABELS_MATTER_STATUS[s] })),
          },
          { key: 'fee_type', label: 'Fee type', type: 'text', placeholder: 'hourly / fixed / retainer' },
        ] satisfies BulkEditField[]}
        onApplied={() => { clearSelection(); load(); }}
      />

      {/* Stint 63.I — right-click context menu. */}
      {contextMenu && (() => {
        const m = contextMenu.matter;
        const actions: CrmContextAction[] = [
          {
            label: 'Open detail',
            icon: ExternalLinkIcon,
            onClick: () => router.push(`/crm/matters/${m.id}`),
          },
          {
            label: m.client_id ? 'Open client company' : 'No client linked',
            icon: BuildingIcon,
            disabled: !m.client_id,
            onClick: () => { if (m.client_id) router.push(`/crm/companies/${m.client_id}`); },
          },
          {
            label: m.conflict_check_done ? 'Conflict check ✓' : 'Mark conflict-check done',
            icon: CheckIcon,
            disabled: m.conflict_check_done,
            onClick: () => { void patchMatter(m.id, 'conflict_check_done', true); },
          },
          {
            label: 'Mark as closed',
            disabled: m.status === 'closed' || m.status === 'archived',
            onClick: () => { void patchMatter(m.id, 'status', 'closed'); },
          },
          {
            label: 'Archive',
            icon: Trash2Icon,
            danger: true,
            separatorBefore: true,
            onClick: () => archiveMatter(m.id, m.matter_reference),
          },
        ];
        return (
          <CrmContextMenu
            title={m.matter_reference}
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
