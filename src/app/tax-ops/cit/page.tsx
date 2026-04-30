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
  makeReorderHandler, useTaxTeamMembers, ownershipNamesInCells,
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

  // Stint 64.X.1 — `or_kinds` so entities with ONLY provision or
  // ONLY review (NWT review) obligations still show as rows. Diego:
  // "Jacques han desaparecido cuando he clicado en que las 2025 tax
  // provisions se han enviado al cliente". They were never lost —
  // just invisible because the matrix had been filtering rows on
  // `service_kind='filing'` only. Now any cit_annual obligation
  // (filing OR provision OR review) qualifies the entity for a row.
  // Status cell stays empty for rows without a filing obligation,
  // which is the right signal: "no main return tracked yet here".
  const current = useMatrixData({
    tax_type: 'cit_annual', year, period_pattern: 'annual',
    or_kinds: ['provision', 'review'],
  });
  const prior = useMatrixData({ tax_type: 'cit_annual', year: year - 1, period_pattern: 'annual' });
  // Stint 64.N — NWT Review column tracks the {year+1} period, not
  // {year}. Diego: "la siguiente columna quiero que sea netwell tax
  // review 2026 [cuando year=2025]". Reasoning fiscal: the NWT review
  // is performed for the assets snapshot at 1 January of the year
  // following the CIT close, so when you're working on the 2025 CIT
  // return you want to see the NWT review for the 2026 valuation.
  // service_kind='review' + show_inactive so entities NOT opted in
  // still render with the subtle "—/Opt in" cell.
  const nwt = useMatrixData({
    tax_type: 'nwt_annual', year: year + 1, period_pattern: 'annual',
    service_kind: 'review', show_inactive: true,
  });
  // Stint 64.J / renamed in 64.N — Tax Provision column. Same entity
  // set, service_kind='provision' on tax_type='cit_annual'. The "CIT"
  // qualifier from 64.L was dropped after Diego clarified the
  // taxonomy: there's only one provision tracked here (the CIT/MBT
  // calc on draft FS); NWT Provision was a misunderstanding from my
  // side that's now removed.
  const citProvision = useMatrixData({
    tax_type: 'cit_annual', year, period_pattern: 'annual',
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

  // Map entity_id → NWT review cell + obligation_id. Stint 64.N —
  // the NWT Review column tracks year+1, so the period_label key is
  // String(year + 1).
  const nwtCellByEntity = useMemo(() => {
    if (!nwt.data) return new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    const m = new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    for (const e of nwt.data.entities) {
      m.set(e.id, { obligation_id: e.obligation_id, cell: getCell(e, String(year + 1)) });
    }
    return m;
  }, [nwt.data, year]);

  // Map entity_id → Tax Provision cell + obligation_id (stint 64.J,
  // renamed in 64.N).
  const citProvisionCellByEntity = useMemo(() => {
    if (!citProvision.data) return new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    const m = new Map<string, { obligation_id: string | null; cell: ReturnType<typeof getCell> }>();
    for (const e of citProvision.data.entities) {
      m.set(e.id, { obligation_id: e.obligation_id, cell: getCell(e, String(year)) });
    }
    return m;
  }, [citProvision.data, year]);

  const refetchAll = useCallback(() => {
    current.refetch();
    prior.refetch();
    nwt.refetch();
    citProvision.refetch();
  }, [current, prior, nwt, citProvision]);

  // Partner options for the bulk reassign popover are built further
  // down (after periodLabel is in scope).
  const { members: teamMembers } = useTaxTeamMembers();

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

  // Stint 64.O F1 — bulk-reassign-partner data + handler. Lives here
  // because it needs `periodLabel` to be in scope when iterating the
  // selected entities.
  const bulkPartnerOptions = useMemo(() => {
    const inCells = ownershipNamesInCells(current.data?.entities ?? [], 'partner_in_charge');
    const membersByShort = new Map(teamMembers.map(m => [m.short_name, m]));
    const set = new Set<string>([...inCells, ...teamMembers.map(m => m.short_name)]);
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map(short => {
        const m = membersByShort.get(short);
        return { value: short, label: m?.full_name ? `${short} · ${m.full_name}` : short };
      });
  }, [current.data, teamMembers]);

  const handleBulkReassignPartner = useCallback(async ({ entityIds, partnerName }: { entityIds: string[]; partnerName: string }) => {
    let applied = 0;
    let skipped = 0;
    const entitiesById = new Map(
      (current.data?.entities ?? []).map(e => [e.id, e]),
    );
    for (const id of entityIds) {
      const e = entitiesById.get(id);
      const cell = e ? getCell(e, periodLabel) : null;
      if (!cell?.filing_id) { skipped += 1; continue; }
      try {
        await patchFiling(cell.filing_id, { partner_in_charge: [partnerName] });
        applied += 1;
      } catch {
        skipped += 1;
      }
    }
    refetchAll();
    if (skipped > 0) {
      throw new Error(`${applied} updated, ${skipped} skipped (no filing for ${periodLabel})`);
    }
  }, [current.data, periodLabel, refetchAll]);

  // Stint 64.L Layer 2 — set of entity_ids that have at least one
  // stuck cell (amber or red follow-up chip). Computed across NWT
  // Review + Tax Provision because that's where the chip currently
  // fires. NWT Review uses period_label = year+1 (stint 64.N); Tax
  // Provision uses periodLabel (current year). The CIT main filing
  // isn't included yet — when Diego asks we'll add the chip there too.
  const nwtPeriodLabel = String(year + 1);
  const stuckEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of nwt.data?.entities ?? []) {
      const c = getCell(e, nwtPeriodLabel);
      if (cellNeedsFollowUp(c?.status, c?.last_action_at, FILING_WAITING_STATES)) ids.add(e.id);
    }
    for (const e of citProvision.data?.entities ?? []) {
      const c = getCell(e, periodLabel);
      if (cellNeedsFollowUp(c?.status, c?.last_action_at, PROVISION_WAITING_STATES)) ids.add(e.id);
    }
    return ids;
  }, [nwt.data, citProvision.data, periodLabel, nwtPeriodLabel]);

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
      // Stint 64.J / renamed in 64.N — Tax Provision column. Order in
      // 64.N: comes BEFORE NWT Review (Diego: "después del assessment
      // …la siguiente columna quiero que sea tax provision … y la
      // siguiente columna quiero que sea netwell tax review").
      // service_kind='provision' on tax_type='cit_annual'. Same period
      // as the main CIT filing.
      key: `tax_provision_${year}`,
      label: `Tax Provision ${year}`,
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
      // NWT Review — moved AFTER Tax Provision in stint 64.N + period
      // is now {year + 1}. Tracks the Net Wealth Tax review for the
      // valuation date that lands on 1 Jan of the year following the
      // CIT close. period_label for the cell is String(year + 1).
      key: `nwt_review_${year + 1}`,
      label: `NWT Review ${year + 1}`,
      widthClass: 'w-[200px]',
      render: (e) => {
        const nwtInfo = nwtCellByEntity.get(e.id) ?? { obligation_id: null, cell: null };
        const nwtPeriod = String(year + 1);
        return (
          <NwtReviewInlineCell
            entityId={e.id}
            year={year + 1}
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
              const info = nwtCellByEntity.get(e.id);
              if (!info?.obligation_id) {
                throw new Error('Opt in first, then set a status');
              }
              await createFiling({
                obligation_id: info.obligation_id,
                period_label: nwtPeriod,
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
              const info = nwtCellByEntity.get(e.id);
              if (!info?.cell?.filing_id) return;
              await patchFiling(info.cell.filing_id, patch);
              nwt.refetch();
            }}
            onOptOut={async () => {
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
    commentsColumn([periodLabel], current.refetch),
    priceColumn([periodLabel], current.refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Form 500"
        subtitle={`Annual CIT (IRC) · Municipal Business Tax (ICC) · Net Wealth Tax (IF) — one unified return per entity. Assessment ${year - 1}, Tax Provision ${year} and NWT Review ${year + 1} all editable inline. Click any status cell to update.`}
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
          /* Stint 64.O F1 — opt in to bulk operations. */
          enableBulkSelection
          bulkPartnerOptions={bulkPartnerOptions}
          onBulkReassignPartner={handleBulkReassignPartner}
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
