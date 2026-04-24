'use client';

// /tax-ops/vat/monthly — VAT monthly returns. 12 compact columns,
// inline status edit per cell, inline prepared-with + comments.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange,
} from '@/components/tax-ops/useMatrixData';
import { VatTabs } from '@/components/tax-ops/VatTabs';
import {
  preparedWithColumn, commentsColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function VatMonthlyPage() {
  const [year, setYear] = useState(2026);
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'vat_monthly',
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
        title="VAT"
        subtitle="Luxembourg VAT — monthly filings (Jan-Dec). Click a month cell to change its status; horizontal scroll on narrow screens."
      />
      <VatTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={data?.entities.length ?? 0}
        countLabel="entities on monthly VAT"
        exportTaxType="vat_monthly"
        exportPeriodPattern="monthly"
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={data.entities}
          columns={columns}
          firstColLabel="Entity"
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch })
          }
          emptyMessage="No entities have an active VAT monthly obligation for this year."
        />
      )}
    </div>
  );
}
