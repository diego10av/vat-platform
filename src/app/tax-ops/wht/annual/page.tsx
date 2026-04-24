'use client';

// /tax-ops/wht/annual — WHT director annual summary.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData, applyStatusChange, useClientGroups } from '@/components/tax-ops/useMatrixData';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  preparedWithColumn, commentsColumn, deadlineColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function WhtAnnualPage() {
  const [year, setYear] = useState(2025);
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_annual',
    year,
    period_pattern: 'annual',
  });

  const periodLabel = String(year);
  const tolerance = data?.admin_tolerance_days ?? 0;
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    deadlineColumn(periodLabel, tolerance),
    preparedWithColumn([periodLabel], refetch),
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
        count={data?.entities.length ?? 0}
        countLabel="entities"
        exportTaxType="wht_director_annual"
        exportPeriodPattern="annual"
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
          emptyMessage="No entities have an active WHT director annual obligation for this year."
        />
      )}
    </div>
  );
}
