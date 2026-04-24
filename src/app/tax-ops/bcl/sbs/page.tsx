'use client';

// /tax-ops/bcl/sbs — BCL SBS quarterly reporting.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange,
} from '@/components/tax-ops/useMatrixData';
import { BclTabs } from '@/components/tax-ops/BclTabs';
import {
  preparedWithColumn, commentsColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function BclSbsPage() {
  const [year, setYear] = useState(2026);
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'bcl_sbs_quarterly',
    year,
    period_pattern: 'quarterly',
  });

  const columns: MatrixColumn[] = [];
  if (data) {
    for (const label of data.period_labels) {
      columns.push({ key: label, label: shortPeriodLabel(label), widthClass: 'w-[80px]' });
    }
    columns.push(preparedWithColumn(data.period_labels, refetch));
    columns.push(commentsColumn(data.period_labels, refetch));
  }

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
        count={data?.entities.length ?? 0}
        countLabel="entities"
        exportTaxType="bcl_sbs_quarterly"
        exportPeriodPattern="quarterly"
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
          emptyMessage="No entities have an active BCL SBS obligation for this year."
        />
      )}
    </div>
  );
}
