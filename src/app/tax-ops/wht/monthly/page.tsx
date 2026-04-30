'use client';

// /tax-ops/wht/monthly — WHT director fees, monthly filings.

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
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  partnerInChargeColumn, associatesWorkingColumn, lastActionColumn, contactsColumn, commentsColumn,
  priceColumn, familyColumn, cadenceColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';
import { FilingEditDrawer } from '@/components/tax-ops/FilingEditDrawer';

const YEAR_OPTIONS = yearOptions();

export default function WhtMonthlyPage() {
  const [year, setYear] = useState(2026);
  const [statusFilter, setStatusFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [associateFilter, setAssociateFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(''); // Stint 64
  const [periodFilter, setPeriodFilter] = useState('all');
  const [editingFilingId, setEditingFilingId] = useState<string | null>(null);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_monthly',
    year,
    period_pattern: 'monthly',
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
    query: searchQuery,
  });

  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    cadenceColumn({ currentTaxType: 'wht_director_monthly', refetch, toast }),
  ];
  if (data) {
    for (const label of visiblePeriodLabels) {
      columns.push({ key: label, label: shortPeriodLabel(label), widthClass: 'w-[48px]' });
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
        title="Withholding tax"
        subtitle="WHT on director fees — monthly filings due on the 10th of the following month. Strict penalties."
      />
      <WhtTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.length}
        countLabel="entities"
        exportTaxType="wht_director_monthly"
        exportPeriodPattern="monthly"
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        partnerFilter={partnerFilter}
        onPartnerFilterChange={setPartnerFilter}
        associateFilter={associateFilter}
        onAssociateFilterChange={setAssociateFilter}
        entitiesForFilters={data?.entities ?? []}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        periodOptions={periodOptions}
        periodFilter={periodFilter}
        onPeriodFilterChange={setPeriodFilter}
        periodLabel="Month"
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
          onEditFiling={setEditingFilingId}
          periodLabelsForEdit={data.period_labels}
          onReorderWithinFamily={makeReorderHandler(refetch)}
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({
              entity, column, cell, nextStatus, refetch, toast,
              taxType: 'wht_director_monthly', periodPattern: 'monthly',
            })
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
              taxType="wht_director_monthly"
              periodPattern="monthly"
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active WHT director monthly obligation for this year."
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
