'use client';

// /tax-ops/cit — Corporate tax returns (Form 500) per entity.
// Stint 37.D redesign: family column visible, Assessment {year-1}
// editable inline, NWT Review {year} collapsed into a column (was
// its own page), year-dynamic column labels.

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, applyStatusChange, useClientGroups, filterEntities,
  makeReorderHandler,
} from '@/components/tax-ops/useMatrixData';
import {
  cellNeedsFollowUp, PROVISION_WAITING_STATES, FILING_WAITING_STATES,
} from '@/components/tax-ops/follow-up';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import {
  partnerInChargeColumn, associatesWorkingColumn, lastActionColumn, contactsColumn, commentsColumn,
  priceColumn, deadlineColumn, familyColumn, formColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AssessmentInlineEditor } from '@/components/tax-ops/AssessmentInlineEditor';
import { NwtReviewInlineCell } from '@/components/tax-ops/NwtReviewInlineCell';
import { TaxProvisionInlineCell } from '@/components/tax-ops/TaxProvisionInlineCell';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';
import { FilingEditDrawer } from '@/components/tax-ops/FilingEditDrawer';

const YEAR_OPTIONS = yearOptions();

export default function CitPage() {
  const [year, setYear] = useState(2025);
  const [statusFilter, setStatusFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [associateFilter, setAssociateFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(''); // Stint 64
  const [needsFollowUp, setNeedsFollowUp] = useState(false); // Stint 64.L
  const [editingFilingId, setEditingFilingId] = useState<string | null>(null);

  // Stint 64.L Layer 3 — pre-activate the "Needs follow-up" toggle
  // when the URL carries ?needs_follow_up=1. The home widget link
  // uses this so a click jumps straight to the filtered view.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('needs_follow_up') === '1') setNeedsFollowUp(true);
  }, [searchParams]);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();

  const current = useMatrixData({ tax_type: 'cit_annual', year, period_pattern: 'annual' });
  const prior = useMatrixData({ tax_type: 'cit_annual', year: year - 1, period_pattern: 'annual' });
  // NWT review column — same entity set, but service_kind='review' + show_inactive
  // so we also see entities NOT opted in (so Diego can opt them in inline).
  const nwt = useMatrixData({
    tax_type: 'nwt_annual', year, period_pattern: 'annual',
    service_kind: 'review', show_inactive: true,
  });
  // Stint 64.J — CIT Provision column. Same entity set, service_kind='provision'
  // on tax_type='cit_annual'. ~20/160 entities opt in (Diego's estimate); the
  // rest render "+ Opt in" so he can attach a provision when a client suddenly
  // sends a draft FS mid-year.
  const citProvision = useMatrixData({
    tax_type: 'cit_annual', year, period_pattern: 'annual',
    service_kind: 'provision', show_inactive: true,
  });
  // Stint 64.L — NWT Provision column. Identical workflow to CIT Provision
  // but tracks the interim Net Wealth Tax (Form IF) calc separately, since
  // CIT and NWT can move on different timelines (a client may send draft FS
  // and want only the NWT calc, or vice versa).
  const nwtProvision = useMatrixData({
    tax_type: 'nwt_annual', year, period_pattern: 'annual',
    service_kind: 'provision', show_inactive: true,
  });

  // Map entity_id → prior-year cell (for assessment column)
  const priorCellByEntity = useMemo(() => {
    if (!prior.data) return new Map<string, ReturnType<typeof getCell>>();
    const m = new Map<string, ReturnType<typeof getCell>>();
    for (const e of prior.data.entities) {
      m.set(e.id, getCell(e, String(year - 1)));
    }
    return m;
  }, [prior.data, year]);

  // Map entity_id → NWT review cell + obligation_id
  const nwtCellByEntity = useMemo(() => {
    if (!nwt.data) return new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    const m = new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    for (const e of nwt.data.entities) {
      m.set(e.id, { obligation_id: e.obligation_id, cell: getCell(e, String(year)) });
    }
    return m;
  }, [nwt.data, year]);

  // Map entity_id → CIT Provision cell + obligation_id (stint 64.J).
  const citProvisionCellByEntity = useMemo(() => {
    if (!citProvision.data) return new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    const m = new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    for (const e of citProvision.data.entities) {
      m.set(e.id, { obligation_id: e.obligation_id, cell: getCell(e, String(year)) });
    }
    return m;
  }, [citProvision.data, year]);

  // Map entity_id → NWT Provision cell + obligation_id (stint 64.L).
  const nwtProvisionCellByEntity = useMemo(() => {
    if (!nwtProvision.data) return new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    const m = new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    for (const e of nwtProvision.data.entities) {
      m.set(e.id, { obligation_id: e.obligation_id, cell: getCell(e, String(year)) });
    }
    return m;
  }, [nwtProvision.data, year]);

  const refetchAll = useCallback(() => {
    current.refetch();
    prior.refetch();
    nwt.refetch();
    citProvision.refetch();
    nwtProvision.refetch();
  }, [current, prior, nwt, citProvision, nwtProvision]);

  async function patchFiling(filingId: string, patch: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/tax-ops/filings/${filingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
  }

  async function createFiling(body: Record<string, unknown>): Promise<void> {
    const res = await fetch('/api/tax-ops/filings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.error ?? `Create failed (${res.status})`);
    }
  }

  async function createObligation(body: Record<string, unknown>): Promise<void> {
    const res = await fetch('/api/tax-ops/obligations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.error ?? `Opt-in failed (${res.status})`);
    }
  }

  const periodLabel = String(year);
  const tolerance = current.data?.admin_tolerance_days ?? 0;

  // Stint 64.L Layer 2 — set of entity_ids that have at least one
  // stuck cell (amber or red follow-up chip). Computed across NWT
  // Review + CIT Provision + NWT Provision because that's where the
  // chip currently fires. The CIT main filing isn't included yet —
  // when Diego asks we'll add the chip there too.
  const stuckEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of nwt.data?.entities ?? []) {
      const c = getCell(e, periodLabel);
      if (cellNeedsFollowUp(c?.status, c?.last_action_at, FILING_WAITING_STATES)) ids.add(e.id);
    }
    for (const e of citProvision.data?.entities ?? []) {
      const c = getCell(e, periodLabel);
      if (cellNeedsFollowUp(c?.status, c?.last_action_at, PROVISION_WAITING_STATES)) ids.add(e.id);
    }
    for (const e of nwtProvision.data?.entities ?? []) {
      const c = getCell(e, periodLabel);
      if (cellNeedsFollowUp(c?.status, c?.last_action_at, PROVISION_WAITING_STATES)) ids.add(e.id);
    }
    return ids;
  }, [nwt.data, citProvision.data, nwtProvision.data, periodLabel]);

  let filtered = filterEntities({
    entities: current.data?.entities ?? [],
    status: statusFilter,
    partner: partnerFilter,
    associate: associateFilter,
    periodLabels: [periodLabel],
    query: searchQuery,
  });
  if (needsFollowUp) {
    filtered = filtered.filter(e => stuckEntityIds.has(e.id));
  }
  const columns: MatrixColumn[] = [
    familyColumn({
      groups,
      refetch: refetchAll,
      onGroupsChanged: refetchGroups,
    }),
    formColumn({ refetch: refetchAll, toast }),
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    lastActionColumn([periodLabel], current.refetch),
    deadlineColumn(periodLabel, tolerance),
    partnerInChargeColumn([periodLabel], current.refetch),
    associatesWorkingColumn([periodLabel], current.refetch),
    contactsColumn([periodLabel], current.refetch),
    {
      key: `assessment_${year - 1}`,
      label: `Assessment ${year - 1}`,
      widthClass: 'w-[180px]',
      render: (e) => {
        const priorCell = priorCellByEntity.get(e.id);
        return (
          <AssessmentInlineEditor
            filingId={priorCell?.filing_id ?? null}
            currentStatus={priorCell?.status ?? null}
            assessmentDate={priorCell?.tax_assessment_received_at ?? null}
            assessmentOutcome={(priorCell?.tax_assessment_outcome ?? null) as 'aligned' | 'under_audit' | null}
            onSave={async ({ status, assessmentDate, assessmentOutcome }) => {
              if (!priorCell?.filing_id) return;
              await patchFiling(priorCell.filing_id, {
                status,
                tax_assessment_received_at: assessmentDate,
                tax_assessment_outcome: assessmentOutcome,
              });
              refetchAll();
            }}
          />
        );
      },
    },
    {
      key: `nwt_review_${year}`,
      label: `NWT Review ${year}`,
      widthClass: 'w-[200px]',
      render: (e) => {
        const nwtInfo = nwtCellByEntity.get(e.id) ?? { obligation_id: null, cell: null };
        return (
          <NwtReviewInlineCell
            entityId={e.id}
            year={year}
            cell={{
              obligation_id: nwtInfo.obligation_id,
              filing_id: nwtInfo.cell?.filing_id ?? null,
              status: nwtInfo.cell?.status ?? null,
              draft_sent_at: nwtInfo.cell?.draft_sent_at ?? null,
              filed_at: nwtInfo.cell?.filed_at ?? null,
              comments: nwtInfo.cell?.comments ?? null,
              last_action_at: nwtInfo.cell?.last_action_at ?? null,
            }}
            onOptIn={async () => {
              await createObligation({
                entity_id: e.id,
                tax_type: 'nwt_annual',
                period_pattern: 'annual',
                service_kind: 'review',
              });
              nwt.refetch();
            }}
            onCreateFiling={async (nextStatus) => {
              // Need obligation_id — if just opted in, refetch first
              const info = nwtCellByEntity.get(e.id);
              if (!info?.obligation_id) {
                throw new Error('Opt in first, then set a status');
              }
              await createFiling({
                obligation_id: info.obligation_id,
                period_label: periodLabel,
                status: nextStatus,
              });
              nwt.refetch();
            }}
            onUpdateStatus={async (nextStatus) => {
              const info = nwtCellByEntity.get(e.id);
              if (!info?.cell?.filing_id) return;
              await patchFiling(info.cell.filing_id, { status: nextStatus });
              nwt.refetch();
            }}
            onPatchDates={async (patch) => {
              // Stint 43.D10 — quick action: mark interim/reco today
              // without leaving the matrix.
              const info = nwtCellByEntity.get(e.id);
              if (!info?.cell?.filing_id) return;
              await patchFiling(info.cell.filing_id, patch);
              nwt.refetch();
            }}
            onOptOut={async () => {
              // Stint 40.F — archive the nwt_annual review obligation.
              const info = nwtCellByEntity.get(e.id);
              if (!info?.obligation_id) return;
              const res = await fetch(`/api/tax-ops/obligations/${info.obligation_id}`, {
                method: 'DELETE',
              });
              if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                throw new Error(b?.error ?? `Opt-out failed (${res.status})`);
              }
              nwt.refetch();
            }}
          />
        );
      },
    },
    {
      // Stint 64.J / 64.L — CIT Provision column. Mirrors NWT Review pattern
      // (opt-in / status dropdown / opt-out). Uses provision-specific
      // status enum: awaiting_fs → fs_received → working → sent →
      // (optional) comments_received → working → sent → finalized.
      // Renamed from "Tax Provision" → "CIT Provision" in 64.L when
      // NWT Provision joined the matrix; "Tax provision" is ambiguous
      // when there's both.
      key: `cit_provision_${year}`,
      label: `CIT Provision ${year}`,
      widthClass: 'w-[200px]',
      render: (e) => {
        const info = citProvisionCellByEntity.get(e.id) ?? { obligation_id: null, cell: null };
        return (
          <TaxProvisionInlineCell
            entityId={e.id}
            year={year}
            cell={{
              obligation_id: info.obligation_id,
              filing_id: info.cell?.filing_id ?? null,
              status: info.cell?.status ?? null,
              comments: info.cell?.comments ?? null,
              last_action_at: info.cell?.last_action_at ?? null,
            }}
            onOptIn={async () => {
              await createObligation({
                entity_id: e.id,
                tax_type: 'cit_annual',
                period_pattern: 'annual',
                service_kind: 'provision',
              });
              citProvision.refetch();
            }}
            onCreateFiling={async (nextStatus) => {
              const cur = citProvisionCellByEntity.get(e.id);
              if (!cur?.obligation_id) {
                throw new Error('Opt in first, then set a status');
              }
              await createFiling({
                obligation_id: cur.obligation_id,
                period_label: periodLabel,
                status: nextStatus,
              });
              citProvision.refetch();
            }}
            onUpdateStatus={async (nextStatus) => {
              const cur = citProvisionCellByEntity.get(e.id);
              if (!cur?.cell?.filing_id) return;
              await patchFiling(cur.cell.filing_id, { status: nextStatus });
              citProvision.refetch();
            }}
            onOptOut={async () => {
              const cur = citProvisionCellByEntity.get(e.id);
              if (!cur?.obligation_id) return;
              const res = await fetch(`/api/tax-ops/obligations/${cur.obligation_id}`, { method: 'DELETE' });
              if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                throw new Error(b?.error ?? `Opt-out failed (${res.status})`);
              }
              citProvision.refetch();
            }}
          />
        );
      },
    },
    {
      // Stint 64.L — NWT Provision column. Same workflow as CIT
      // Provision but for the Net Wealth Tax (Form IF) interim calc.
      // Tracked separately because a client may opt in to one and
      // not the other (some clients only need NWT provision; others
      // only CIT; many ask for both at the same time).
      key: `nwt_provision_${year}`,
      label: `NWT Provision ${year}`,
      widthClass: 'w-[200px]',
      render: (e) => {
        const info = nwtProvisionCellByEntity.get(e.id) ?? { obligation_id: null, cell: null };
        return (
          <TaxProvisionInlineCell
            entityId={e.id}
            year={year}
            cell={{
              obligation_id: info.obligation_id,
              filing_id: info.cell?.filing_id ?? null,
              status: info.cell?.status ?? null,
              comments: info.cell?.comments ?? null,
              last_action_at: info.cell?.last_action_at ?? null,
            }}
            onOptIn={async () => {
              await createObligation({
                entity_id: e.id,
                tax_type: 'nwt_annual',
                period_pattern: 'annual',
                service_kind: 'provision',
              });
              nwtProvision.refetch();
            }}
            onCreateFiling={async (nextStatus) => {
              const cur = nwtProvisionCellByEntity.get(e.id);
              if (!cur?.obligation_id) {
                throw new Error('Opt in first, then set a status');
              }
              await createFiling({
                obligation_id: cur.obligation_id,
                period_label: periodLabel,
                status: nextStatus,
              });
              nwtProvision.refetch();
            }}
            onUpdateStatus={async (nextStatus) => {
              const cur = nwtProvisionCellByEntity.get(e.id);
              if (!cur?.cell?.filing_id) return;
              await patchFiling(cur.cell.filing_id, { status: nextStatus });
              nwtProvision.refetch();
            }}
            onOptOut={async () => {
              const cur = nwtProvisionCellByEntity.get(e.id);
              if (!cur?.obligation_id) return;
              const res = await fetch(`/api/tax-ops/obligations/${cur.obligation_id}`, { method: 'DELETE' });
              if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                throw new Error(b?.error ?? `Opt-out failed (${res.status})`);
              }
              nwtProvision.refetch();
            }}
          />
        );
      },
    },
    commentsColumn([periodLabel], current.refetch),
    priceColumn([periodLabel], current.refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Form 500"
        subtitle={`Annual CIT (IRC) · Municipal Business Tax (ICC) · Net Wealth Tax (IF) — one unified return per entity. Assessment ${year - 1}, NWT Review ${year}, CIT Provision ${year} and NWT Provision ${year} all editable inline. Click any status cell to update.`}
      />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.length}
        countLabel={`entities · ${countFiled(current.data?.entities ?? [], periodLabel)} filed`}
        exportTaxType="cit_annual"
        exportPeriodPattern="annual"
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        partnerFilter={partnerFilter}
        onPartnerFilterChange={setPartnerFilter}
        associateFilter={associateFilter}
        onAssociateFilterChange={setAssociateFilter}
        entitiesForFilters={current.data?.entities ?? []}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        needsFollowUp={needsFollowUp}
        onNeedsFollowUpChange={setNeedsFollowUp}
        needsFollowUpCount={stuckEntityIds.size}
      />

      {current.error && <CrmErrorBox message={current.error} onRetry={refetchAll} />}

      {current.isLoading && !current.data && <PageSkeleton />}

      {current.data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
          firstColLabel="Entity"
          onEditFiling={setEditingFilingId}
          periodLabelsForEdit={[periodLabel]}
          liquidationVisuals
          onLiquidationChanged={refetchAll}
          onReorderWithinFamily={makeReorderHandler(refetchAll)}
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch: current.refetch, toast })
          }
          rowAction={(entity) => (
            <RemoveRowButton
              obligationId={entity.obligation_id}
              entityName={entity.legal_name}
              onRemoved={refetchAll}
            />
          )}
          groupFooter={(group) => (
            <AddEntityRow
              groupId={group.groupId}
              groupName={group.name}
              taxType="cit_annual"
              periodPattern="annual"
              onCreated={refetchAll}
            />
          )}
          emptyMessage="No entities have an active CIT obligation."
        />
      )}
      <FilingEditDrawer
        filingId={editingFilingId}
        onClose={() => setEditingFilingId(null)}
        onSaved={refetchAll}
      />
    </div>
  );
}

function getCell(e: MatrixEntity, period: string) {
  return e.cells[period] ?? null;
}

function countFiled(entities: MatrixEntity[], period: string): number {
  return entities.filter(e => {
    const c = getCell(e, period);
    return c && c.status === 'filed';
  }).length;
}
