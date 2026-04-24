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
  filterEntitiesByStatus,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  preparedWithColumn, commentsColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';

const YEAR_OPTIONS = yearOptions();

export default function WhtMonthlyPage() {
  const [year, setYear] = useState(2026);
  const [statusFilter, setStatusFilter] = useState('all');
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_monthly',
    year,
    period_pattern: 'monthly',
  });
  const filtered = filterEntitiesByStatus(
    data?.entities ?? [], statusFilter, data?.period_labels ?? [],
  );

  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
  ];
  if (data) {
    for (const label of data.period_labels) {
      columns.push({ key: label, label: shortPeriodLabel(label), widthClass: 'w-[48px]' });
    }
    columns.push(preparedWithColumn(data.period_labels, refetch));
    columns.push(commentsColumn(data.period_labels, refetch));
  }

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
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
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
              taxType="wht_director_monthly"
              periodPattern="monthly"
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active WHT director monthly obligation for this year."
        />
      )}
    </div>
  );
}
