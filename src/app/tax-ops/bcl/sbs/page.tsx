'use client';

// /tax-ops/bcl/sbs — BCL SBS quarterly reporting.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange, useClientGroups,
  filterEntities, makeReorderHandler,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import { BclTabs } from '@/components/tax-ops/BclTabs';
import {
  partnerInChargeColumn, associatesWorkingColumn, lastActionColumn, contactsColumn, commentsColumn, priceColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';
import { FilingEditDrawer } from '@/components/tax-ops/FilingEditDrawer';

const YEAR_OPTIONS = yearOptions();

export default function BclSbsPage() {
  const [year, setYear] = useState(2026);
  const [statusFilter, setStatusFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [associateFilter, setAssociateFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [editingFilingId, setEditingFilingId] = useState<string | null>(null);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'bcl_sbs_quarterly',
    year,
    period_pattern: 'quarterly',
  });
  const visiblePeriodLabels = (data?.period_labels ?? []).filter(
    l => periodFilter === 'all' || l === periodFilter,
  );
  const filtered = filterEntities({
    entities: data?.entities ?? [],
    status: statusFilter,
    partner: partnerFilter,
    associate: associateFilter,
    periodLabels: visiblePeriodLabels,
  });

  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
  ];
  if (data) {
    for (const label of visiblePeriodLabels) {
      columns.push({ key: label, label: shortPeriodLabel(label), widthClass: 'w-[80px]' });
    }
    columns.push(lastActionColumn(visiblePeriodLabels, refetch));
    columns.push(partnerInChargeColumn(visiblePeriodLabels, refetch));
    columns.push(associatesWorkingColumn(visiblePeriodLabels, refetch));
    columns.push(contactsColumn(visiblePeriodLabels, refetch));
    columns.push(commentsColumn(visiblePeriodLabels, refetch));
    columns.push(priceColumn(visiblePeriodLabels, refetch));
  }
  const periodOptions = (data?.period_labels ?? []).map(l => ({
    value: l,
    label: shortPeriodLabel(l),
  }));

  return (
    <div className="space-y-3">
      <PageHeader
        title="BCL reporting"
        subtitle="BCL Statistical Business Survey (SBS) — quarterly declarations due 15 days after quarter end."
      />
      <BclTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.length}
        countLabel="entities"
        exportTaxType="bcl_sbs_quarterly"
        exportPeriodPattern="quarterly"
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        partnerFilter={partnerFilter}
        onPartnerFilterChange={setPartnerFilter}
        associateFilter={associateFilter}
        onAssociateFilterChange={setAssociateFilter}
        entitiesForFilters={data?.entities ?? []}
        periodOptions={periodOptions}
        periodFilter={periodFilter}
        onPeriodFilterChange={setPeriodFilter}
        periodLabel="Quarter"
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
          onReorderWithinFamily={makeReorderHandler(refetch)}
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch, toast })
          }
          rowAction={(entity) => (
            <RemoveRowButton
              obligationId={entity.obligation_id}
              entityName={entity.legal_name}
              onRemoved={refetch}
            />
          )}
          groupFooter={(group) => (
            <AddEntityRow
              groupId={group.groupId}
              groupName={group.name}
              taxType="bcl_sbs_quarterly"
              periodPattern="quarterly"
              // Stint 40.D — entities subject to BCL do BOTH reports.
              // Create the 2.16 monthly companion automatically.
              additionalObligations={[
                { tax_type: 'bcl_216_monthly', period_pattern: 'monthly' },
              ]}
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active BCL SBS obligation for this year."
        />
      )}
      <FilingEditDrawer
        filingId={editingFilingId}
        onClose={() => setEditingFilingId(null)}
        onSaved={refetch}
      />
    </div>
  );
}
