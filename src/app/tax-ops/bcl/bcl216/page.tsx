'use client';

// /tax-ops/bcl/bcl216 — BCL 2.16 monthly simplified reporting.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange, useClientGroups,
} from '@/components/tax-ops/useMatrixData';
import { BclTabs } from '@/components/tax-ops/BclTabs';
import {
  preparedWithColumn, commentsColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function Bcl216Page() {
  const [year, setYear] = useState(2026);
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'bcl_216_monthly',
    year,
    period_pattern: 'monthly',
  });

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
        title="BCL reporting"
        subtitle="BCL 2.16 simplified monthly declaration — due 10 days after month end."
      />
      <BclTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={data?.entities.length ?? 0}
        countLabel="entities"
        exportTaxType="bcl_216_monthly"
        exportPeriodPattern="monthly"
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={data.entities}
          columns={columns}
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch })
          }
          emptyMessage="No entities have an active BCL 2.16 obligation for this year."
        />
      )}
    </div>
  );
}
