'use client';

// /tax-ops/wht/annual — WHT director annual summary.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, applyStatusChange, useClientGroups, filterEntitiesByStatus,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  preparedWithColumn, lastChasedColumn, commentsColumn, deadlineColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';

const YEAR_OPTIONS = yearOptions();

export default function WhtAnnualPage() {
  const [year, setYear] = useState(2025);
  const [statusFilter, setStatusFilter] = useState('all');
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_annual',
    year,
    period_pattern: 'annual',
  });

  const periodLabel = String(year);
  const filtered = filterEntitiesByStatus(
    data?.entities ?? [], statusFilter, [periodLabel],
  );
  const tolerance = data?.admin_tolerance_days ?? 0;
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    deadlineColumn(periodLabel, tolerance),
    preparedWithColumn([periodLabel], refetch),
    lastChasedColumn([periodLabel], refetch),
    commentsColumn([periodLabel], refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Withholding tax"
        subtitle="WHT director annual summary — 1 March N+1."
      />
      <WhtTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.length}
        countLabel="entities"
        exportTaxType="wht_director_annual"
        exportPeriodPattern="annual"
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
              taxType="wht_director_annual"
              periodPattern="annual"
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active WHT director annual obligation for this year."
        />
      )}
    </div>
  );
}
