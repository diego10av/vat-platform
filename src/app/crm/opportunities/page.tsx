'use client';

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SearchIcon, PlusIcon, ExternalLinkIcon, BuildingIcon, Trash2Icon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { BulkActionBar } from '@/components/crm/BulkActionBar';
import { PipelineKanban } from '@/components/crm/PipelineKanban';
import { ExportButton } from '@/components/crm/ExportButton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
// Stint 63.G/H/I — port the patterns to opportunities.
import { CrmContextMenu, type CrmContextAction } from '@/components/crm/CrmContextMenu';
import { CrmSavedViews } from '@/components/crm/CrmSavedViews';
import { BulkEditDrawer, type BulkEditField } from '@/components/crm/BulkEditDrawer';
// Stint 63.L — hover preview on opportunity name.
import { OpportunityHoverPreview } from '@/components/crm/OpportunityHoverPreview';
import { crmLoadList } from '@/lib/useCrmFetch';
import { OPPORTUNITY_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
// Stint 63.A.2 — port Tax-Ops inline editors to opportunities table.
import { InlineTextCell, InlineDateCell } from '@/components/tax-ops/inline-editors';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import {
  LABELS_STAGE, OPPORTUNITY_STAGES, formatEur, formatDate,
  type OpportunityStage,
} from '@/lib/crm-types';

// Stint 64.Q.7 — pipeline stage tones. Cold-side stages added when
// the Outreach surface was folded into Opportunities. Order = real
// progression in a legal-services sales cycle.
const STAGE_TONES: Record<string, string> = {
  cold_identified: 'bg-surface-alt text-ink-soft',
  warm:            'bg-info-50 text-info-800',
  first_touch:     'bg-amber-50 text-amber-800',
  meeting_held:    'bg-amber-100 text-amber-900',
  proposal_sent:   'bg-danger-50 text-danger-800',
  in_negotiation:  'bg-brand-50 text-brand-800',
  won:             'bg-success-50 text-success-800',
  lost:            'bg-surface-alt text-ink-faint',
};

interface Opportunity {
  id: string;
  name: string;
  stage: string;
  stage_entered_at: string | null;
  practice_areas: string[];
  estimated_value_eur: number | null;
  probability_pct: number | null;
  weighted_value_eur: number | null;
  first_contact_date: string | null;
  estimated_close_date: string | null;
  next_action: string | null;
  next_action_due: string | null;
  company_name: string | null;
  company_id: string | null;
  primary_contact_name: string | null;
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpportunitiesPageContent />
    </Suspense>
  );
}

function OpportunitiesPageContent() {
  // Stint 63.G — URL-persistent filters (q, stage, view).
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [stage, setStage] = useState<string>(searchParams.get('stage') ?? '');
  // Stint 64.C — BD lawyer filter. Answers Diego's question "qué deals
  // lleva quién?" when there's >1 person on the team. Filter is
  // populated dynamically from the rows present in data (never offers
  // empty options).
  const [bdLawyerFilter, setBdLawyerFilter] = useState<string>(searchParams.get('bd_lawyer') ?? '');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'list' | 'kanban'>(
    searchParams.get('view') === 'kanban' ? 'kanban' : 'list'
  );
  // Stint 63.I — context menu state.
  const [contextMenu, setContextMenu] = useState<{ opp: Opportunity; x: number; y: number } | null>(null);
  // Stint 63.H — bulk-edit drawer state.
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const toast = useToast();

  // Stint 63.G — sync filter state → URL. View change is treated as
  // navigation (push) so Back returns to the previous view; pure
  // filters use replace so Back exits the page (mirror of stint 59.D).
  const firstSync = useRef(true);
  const prevView = useRef(view);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      prevView.current = view;
      return;
    }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (stage) qs.set('stage', stage);
    if (bdLawyerFilter) qs.set('bd_lawyer', bdLawyerFilter);
    if (view !== 'list') qs.set('view', view);
    const url = qs.toString() ? `${pathname}?${qs}` : pathname;
    if (view !== prevView.current) {
      router.push(url, { scroll: false });
      prevView.current = view;
    } else {
      router.replace(url, { scroll: false });
    }
  }, [q, stage, bdLawyerFilter, view, router, pathname]);

  // Stint 64.C — bdLawyer dropdown options come from the actual data,
  // sorted, no empties. Same pattern as `countriesInData` in companies
  // (HubSpot principle: never offer filter options that filter to zero).
  const bdLawyersInData = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      const v = (r as Opportunity & { bd_lawyer?: string | null }).bd_lawyer;
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // currentQuery for CrmSavedViews — excludes the view toggle (saved
  // views capture filters, not which layout you happen to be in).
  const currentQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (stage) qs.set('stage', stage);
    if (bdLawyerFilter) qs.set('bd_lawyer', bdLawyerFilter);
    return qs.toString();
  }, [q, stage, bdLawyerFilter]);

  // Stint 64.C — apply bd_lawyer filter client-side (API returns the
  // full set scoped to q + stage; bd_lawyer is cheap to filter locally).
  const filteredRows = useMemo(() => {
    if (!rows) return null;
    if (!bdLawyerFilter) return rows;
    return rows.filter(r =>
      (r as Opportunity & { bd_lawyer?: string | null }).bd_lawyer === bdLawyerFilter
    );
  }, [rows, bdLawyerFilter]);

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
    if (stage) qs.set('stage', stage);
    crmLoadList<Opportunity>(`/api/crm/opportunities?${qs}`)
      .then(rows => { setRows(rows); setError(null); })
      .catch((e: Error) => { setError(e.message || 'Network error'); setRows([]); });
  }, [q, stage]);

  useEffect(() => { load(); }, [load]);

  // Stint 63.I — soft-delete invoked from context menu.
  async function archiveOpportunity(id: string, name: string) {
    if (!confirm(`Archive "${name}"? Soft delete; restore from /crm/trash.`)) return;
    try {
      const res = await fetch(`/api/crm/opportunities/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Opportunity archived');
      await load();
    } catch (e) {
      toast.error(`Archive failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  async function handleStageChange(id: string, newStage: string) {
    const res = await fetch(`/api/crm/opportunities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage }),
    });
    if (!res.ok) {
      toast.error('Stage change failed');
      return;
    }
    toast.success(`Moved to ${newStage.replace(/_/g, ' ')}`);
    await load();
  }

  // Stint 63.A.2 — generic inline-edit helper. The Kanban already had
  // handleStageChange; this generalises it to any field. Numeric fields
  // (estimated_value_eur, probability_pct) come as strings from
  // InlineTextCell — coerce to number/null before sending.
  async function patchOpportunity(id: string, field: string, value: unknown): Promise<void> {
    let coerced = value;
    if (field === 'estimated_value_eur' || field === 'probability_pct') {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') coerced = null;
        else {
          const n = Number(trimmed.replace(/,/g, ''));
          coerced = Number.isFinite(n) ? n : null;
        }
      }
    }
    try {
      const res = await fetch(`/api/crm/opportunities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: coerced }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Save failed (${res.status})`);
      }
      // Optimistic local update. We reload from server only when the
      // weighted_value_eur generated column needs to recompute (changes
      // to estimated_value_eur or probability_pct).
      if (field === 'estimated_value_eur' || field === 'probability_pct') {
        await load();
      } else {
        setRows(prev => prev?.map(r =>
          r.id === id ? { ...r, [field]: coerced as never } : r
        ) ?? null);
      }
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
      await load();
      throw e;
    }
  }

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Opportunity created');
    await load();
  }

  const openRows = rows?.filter(r => r.stage !== 'won' && r.stage !== 'lost') ?? [];
  const totalPipeline = openRows.reduce((sum, r) => sum + (Number(r.weighted_value_eur) || 0), 0);

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Opportunities"
        subtitle={`Sales pipeline · ${formatEur(totalPipeline)} weighted across ${openRows.length} open. Press N anywhere to quick-create.`}
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New opportunity
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New opportunity"
        subtitle="Pipeline entry — will move through stages from Lead Identified to Won/Lost."
        fields={OPPORTUNITY_FIELDS}
        initial={{ stage: 'cold_identified', probability_pct: 10 }}
        onSave={handleCreate}
      />
      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={load} /></div>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex border border-border rounded-md overflow-hidden">
          <button
            onClick={() => setView('list')}
            className={`px-2.5 py-1.5 text-xs font-medium ${view === 'list' ? 'bg-brand-500 text-white' : 'bg-white text-ink-soft hover:bg-surface-alt'}`}
          >
            📋 List
          </button>
          <button
            onClick={() => setView('kanban')}
            className={`px-2.5 py-1.5 text-xs font-medium border-l border-border ${view === 'kanban' ? 'bg-brand-500 text-white' : 'bg-white text-ink-soft hover:bg-surface-alt'}`}
          >
            📊 Kanban
          </button>
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search opportunity name..."
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-border rounded-md" />
        </div>
        {view === 'list' && (
          <select value={stage} onChange={e => setStage(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-white">
            <option value="">All stages</option>
            {OPPORTUNITY_STAGES.map(s => <option key={s} value={s}>{LABELS_STAGE[s]}</option>)}
          </select>
        )}
        {/* Stint 64.C — BD lawyer filter. Only shown when there's
            actual data to filter on (avoid an empty dropdown). */}
        {view === 'list' && bdLawyersInData.length > 0 && (
          <select value={bdLawyerFilter} onChange={e => setBdLawyerFilter(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-white"
            aria-label="Filter by BD lawyer">
            <option value="">All BD lawyers</option>
            {bdLawyersInData.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        <CrmSavedViews
          currentQuery={currentQuery}
          storageKey="cifra.crm.opportunities.savedViews.v1"
          defaultLabel="All opportunities"
        />
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="opportunities" />
          <span className="text-xs text-ink-muted">
            {(filteredRows ?? rows).length}
            {filteredRows && filteredRows.length !== rows.length ? ` of ${rows.length}` : ''} opportunities
          </span>
        </div>
      </div>

      {(filteredRows ?? rows).length === 0 ? (
        (() => {
          const filtersActive = q !== '' || stage !== '' || bdLawyerFilter !== '';
          return (
            <EmptyState
              illustration="reports"
              title={filtersActive ? 'No opportunities match these filters' : 'No opportunities yet'}
              description={filtersActive
                ? 'Loosen your filters or clear them to see all opportunities.'
                : 'Track your sales pipeline. Create one or open a company detail page to add an opportunity for that account.'}
              action={filtersActive ? undefined : (
                <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
                  New opportunity
                </Button>
              )}
            />
          );
        })()
      ) : view === 'kanban' ? (
        <PipelineKanban rows={rows} onStageChange={handleStageChange} />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-ink-muted">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === (filteredRows?.length ?? rows.length)}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < (filteredRows?.length ?? rows.length); }}
                    onChange={e => toggleAll(e.target.checked)}
                    className="h-4 w-4 accent-brand-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Company</th>
                <th className="text-left px-3 py-2 font-medium">Stage</th>
                <th className="text-right px-3 py-2 font-medium">Value</th>
                <th className="text-right px-3 py-2 font-medium">Prob.</th>
                <th className="text-right px-3 py-2 font-medium">Weighted</th>
                <th className="text-left px-3 py-2 font-medium">Est. close</th>
                <th className="text-left px-3 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {(filteredRows ?? rows).map(r => (
                <tr
                  key={r.id}
                  onContextMenu={(e) => {
                    const tgt = e.target as HTMLElement;
                    const tag = tgt.tagName?.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;
                    e.preventDefault();
                    setContextMenu({ opp: r, x: e.clientX, y: e.clientY });
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
                  {/* Name → link to detail, wrapped in hover preview. */}
                  <td className="px-3 py-2">
                    <OpportunityHoverPreview opportunityId={r.id}>
                      <Link href={`/crm/opportunities/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link>
                    </OpportunityHoverPreview>
                  </td>
                  {/* Company → link, not editable inline (changing the
                      parent company is a heavy action). */}
                  <td className="px-3 py-2">
                    {r.company_id ? <Link href={`/crm/companies/${r.company_id}`} className="text-ink-muted hover:underline">{r.company_name}</Link> : <span className="text-ink-muted">—</span>}
                  </td>
                  {/* Stage — ChipSelect with pipeline-stage tones. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.stage}
                      options={OPPORTUNITY_STAGES.map(v => ({
                        value: v,
                        label: LABELS_STAGE[v as OpportunityStage],
                        tone: STAGE_TONES[v],
                      }))}
                      onChange={next => { void patchOpportunity(r.id, 'stage', next); }}
                      ariaLabel="Stage"
                    />
                  </td>
                  {/* Estimated value — InlineTextCell with numeric coerce. */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    <InlineTextCell
                      value={r.estimated_value_eur !== null ? formatEur(r.estimated_value_eur) : null}
                      onSave={async v => { await patchOpportunity(r.id, 'estimated_value_eur', v); }}
                      placeholder="—"
                    />
                  </td>
                  {/* Probability — InlineTextCell, just the % integer. */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    <InlineTextCell
                      value={r.probability_pct !== null ? `${r.probability_pct}` : null}
                      onSave={async v => { await patchOpportunity(r.id, 'probability_pct', v); }}
                      placeholder="—"
                    />
                  </td>
                  {/* Weighted — read-only (server-computed generated column). */}
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-ink-soft">
                    {formatEur(r.weighted_value_eur)}
                  </td>
                  {/* Estimated close — InlineDateCell, urgency mode. */}
                  <td className="px-3 py-2">
                    <InlineDateCell
                      value={r.estimated_close_date}
                      onSave={async v => { await patchOpportunity(r.id, 'estimated_close_date', v); }}
                    />
                  </td>
                  {/* Next action — InlineTextCell. The due date stays
                      read-only here (edit from detail page if needed). */}
                  <td className="px-3 py-2 max-w-[200px]">
                    <InlineTextCell
                      value={r.next_action}
                      onSave={async v => { await patchOpportunity(r.id, 'next_action', v); }}
                      placeholder="—"
                    />
                    {r.next_action_due && (
                      <div className="text-2xs text-ink-faint mt-0.5">
                        due {formatDate(r.next_action_due)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_opportunity"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
        onEditFields={() => setBulkEditOpen(true)}
      />

      {/* Stint 63.H — bulk-edit drawer. */}
      <BulkEditDrawer
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        recordType="opportunity"
        selectedIds={Array.from(selected)}
        endpoint="/api/crm/opportunities/bulk-update"
        fields={[
          {
            key: 'stage',
            label: 'Stage',
            type: 'select',
            options: OPPORTUNITY_STAGES.map(s => ({ value: s, label: LABELS_STAGE[s] })),
          },
          { key: 'bd_lawyer', label: 'BD lawyer', type: 'text', placeholder: 'e.g. Diego' },
          { key: 'source', label: 'Source', type: 'text', placeholder: 'e.g. Referral, LinkedIn' },
          { key: 'next_action_due', label: 'Next action due (YYYY-MM-DD)', type: 'text', placeholder: '2026-05-15' },
        ] satisfies BulkEditField[]}
        onApplied={() => { clearSelection(); load(); }}
      />

      {/* Stint 63.I — right-click context menu. */}
      {contextMenu && (() => {
        const o = contextMenu.opp;
        const actions: CrmContextAction[] = [
          {
            label: 'Open detail',
            icon: ExternalLinkIcon,
            onClick: () => router.push(`/crm/opportunities/${o.id}`),
          },
          {
            label: o.company_id ? 'Open company' : 'No company linked',
            icon: BuildingIcon,
            disabled: !o.company_id,
            onClick: () => { if (o.company_id) router.push(`/crm/companies/${o.company_id}`); },
          },
          {
            label: 'Mark as won',
            disabled: o.stage === 'won' || o.stage === 'lost',
            onClick: () => { void handleStageChange(o.id, 'won'); },
          },
          {
            label: 'Mark as lost',
            disabled: o.stage === 'won' || o.stage === 'lost',
            onClick: () => { void handleStageChange(o.id, 'lost'); },
          },
          {
            label: 'Archive',
            icon: Trash2Icon,
            danger: true,
            separatorBefore: true,
            onClick: () => archiveOpportunity(o.id, o.name),
          },
        ];
        return (
          <CrmContextMenu
            title={o.name}
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
