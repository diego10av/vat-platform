'use client';

// /tax-ops/bcl/bcl216 — BCL 2.16 monthly simplified reporting.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData, shortPeriodLabel } from '@/components/tax-ops/useMatrixData';
import { BclTabs } from '@/components/tax-ops/BclTabs';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function Bcl216Page() {
  const [year, setYear] = useState(2026);
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'bcl_216_monthly',
    year,
    period_pattern: 'monthly',
  });

  const columns: MatrixColumn[] = data
    ? data.period_labels.map(label => ({
        key: label,
        label: shortPeriodLabel(label),
        widthClass: 'w-[48px]',
      }))
    : [];
  columns.push({
    key: 'prepared_with',
    label: 'Prepared with',
    widthClass: 'w-[130px]',
    render: (e) => {
      const set = new Set<string>();
      if (data) {
        for (const label of data.period_labels) {
          const cell = e.cells[label];
          if (cell?.prepared_with) cell.prepared_with.forEach(v => set.add(v));
        }
      }
      if (set.size === 0) return <span className="text-ink-faint">—</span>;
      return <span className="text-ink-soft text-[11.5px]">{Array.from(set).join(', ')}</span>;
    },
  });

  return (
    <div className="space-y-3">
      <PageHeader
        title="BCL reporting"
        subtitle="BCL 2.16 simplified monthly declaration — due 10 days after month end."
      />
      <BclTabs />

      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-[12.5px]">
          <span className="text-ink-muted">Period year:</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-2 py-1 text-[12.5px] border border-border rounded-md bg-surface"
          >
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {data && <div className="text-[11.5px] text-ink-muted">{data.entities.length} entities</div>}
      </div>

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={data.entities}
          columns={columns}
          emptyMessage="No entities have an active BCL 2.16 obligation for this year."
        />
      )}
    </div>
  );
}
