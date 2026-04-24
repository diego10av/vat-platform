'use client';

// /tax-ops/vat/annual — VAT annual returns (standard or simplified).
// Two matrices unified into one table with a Subtype column; each row
// carries subtype metadata so inline edits hit the right filing.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData, applyStatusChange, useClientGroups } from '@/components/tax-ops/useMatrixData';
import { VatTabs } from '@/components/tax-ops/VatTabs';
import {
  preparedWithColumn, commentsColumn, deadlineColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

type CombinedEntity = MatrixEntity & { subtype: 'standard' | 'simplified' };

export default function VatAnnualPage() {
  const [year, setYear] = useState(2025);
  const { groups, refetch: refetchGroups } = useClientGroups();
  const standard = useMatrixData({ tax_type: 'vat_annual', year, period_pattern: 'annual' });
  const simplified = useMatrixData({ tax_type: 'vat_simplified_annual', year, period_pattern: 'annual' });

  const refetch = () => { standard.refetch(); simplified.refetch(); };

  const combined: CombinedEntity[] = [];
  if (standard.data) {
    for (const e of standard.data.entities) combined.push({ ...e, subtype: 'standard' });
  }
  if (simplified.data) {
    for (const e of simplified.data.entities) combined.push({ ...e, subtype: 'simplified' });
  }

  const periodLabel = String(year);
  const tolerance = standard.data?.admin_tolerance_days ?? simplified.data?.admin_tolerance_days ?? 0;
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    {
      key: 'subtype',
      label: 'Subtype',
      widthClass: 'w-[100px]',
      render: (e) => {
        const subtype = (e as CombinedEntity).subtype;
        return (
          <span className={[
            'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px]',
            subtype === 'simplified' ? 'bg-brand-50 text-brand-700' : 'bg-surface-alt text-ink-soft',
          ].join(' ')}>
            {subtype}
          </span>
        );
      },
    },
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    deadlineColumn(periodLabel, tolerance),
    preparedWithColumn([periodLabel], refetch),
    commentsColumn([periodLabel], refetch),
  ];

  const hasError = standard.error || simplified.error;
  const isLoading = (standard.isLoading || simplified.isLoading) && !standard.data && !simplified.data;

  return (
    <div className="space-y-3">
      <PageHeader
        title="VAT"
        subtitle="Luxembourg VAT — annual return (standard + simplified variants), plus quarterly and monthly returns. Click a status cell to update inline."
      />
      <VatTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={combined.length}
        countLabel={`filings (${standard.data?.entities.length ?? 0} standard · ${simplified.data?.entities.length ?? 0} simplified)`}
        exportTaxType="vat_annual"
        exportPeriodPattern="annual"
      />

      {hasError && <CrmErrorBox message={String(hasError)} onRetry={refetch} />}

      {isLoading && <PageSkeleton />}

      {(standard.data || simplified.data) && (
        <TaxTypeMatrix
          entities={combined}
          columns={columns}
          firstColLabel="Entity"
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch })
          }
          emptyMessage="No entities have an active VAT annual obligation for this year."
        />
      )}
    </div>
  );
}
