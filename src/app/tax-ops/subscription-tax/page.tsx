'use client';

// /tax-ops/subscription-tax — Subscription tax (quarterly, UCI/AIF).

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange,
} from '@/components/tax-ops/useMatrixData';
import {
  preparedWithColumn, commentsColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function SubscriptionTaxPage() {
  const [year, setYear] = useState(2026);
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'subscription_tax_quarterly',
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
        title="Subscription tax"
        subtitle="UCI / AIF quarterly subscription tax — filing + payment on the 15th day of the month after quarter-end. Strict deadline."
      />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={data?.entities.length ?? 0}
        countLabel="entities"
        exportTaxType="subscription_tax_quarterly"
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
          emptyMessage="No entities have an active subscription tax obligation for this year."
        />
      )}
    </div>
  );
}
