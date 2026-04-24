'use client';

// /tax-ops/wht/semester — WHT director fees, S1 + S2.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData, applyStatusChange, useClientGroups } from '@/components/tax-ops/useMatrixData';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  preparedWithColumn, commentsColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function WhtSemesterPage() {
  const [year, setYear] = useState(2026);
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_semester',
    year,
    period_pattern: 'semester',
  });

  const periodLabels = data?.period_labels ?? [];
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    { key: `${year}-S1`, label: 'S1 (Jan-Jun)', widthClass: 'w-[120px]' },
    { key: `${year}-S2`, label: 'S2 (Jul-Dec)', widthClass: 'w-[120px]' },
    preparedWithColumn(periodLabels, refetch),
    commentsColumn(periodLabels, refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Withholding tax"
        subtitle="WHT director fees on a semester schedule — 10 days after each semester end."
      />
      <WhtTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={data?.entities.length ?? 0}
        countLabel="entities"
        exportTaxType="wht_director_semester"
        exportPeriodPattern="semester"
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
          emptyMessage="No entities have an active WHT semester obligation for this year."
        />
      )}
    </div>
  );
}
