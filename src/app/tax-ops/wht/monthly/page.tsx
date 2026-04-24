'use client';

// /tax-ops/wht/monthly — WHT director fees, monthly filings.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange,
} from '@/components/tax-ops/useMatrixData';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  preparedWithColumn, commentsColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function WhtMonthlyPage() {
  const [year, setYear] = useState(2026);
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_monthly',
    year,
    period_pattern: 'monthly',
  });

  const columns: MatrixColumn[] = [];
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
        count={data?.entities.length ?? 0}
        countLabel="entities"
        exportTaxType="wht_director_monthly"
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
          emptyMessage="No entities have an active WHT director monthly obligation for this year."
        />
      )}
    </div>
  );
}
