'use client';

// /tax-ops/wht/annual — WHT director fees, annual summary filing.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData } from '@/components/tax-ops/useMatrixData';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function WhtAnnualPage() {
  const [year, setYear] = useState(2025);
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_annual',
    year,
    period_pattern: 'annual',
  });

  const columns: MatrixColumn[] = [
    { key: String(year), label: `Status ${year}`, widthClass: 'w-[140px]' },
    {
      key: 'deadline',
      label: 'Deadline',
      widthClass: 'w-[130px]',
      render: (e) => {
        const cell = e.cells[String(year)];
        return <DateBadge value={cell?.deadline_date ?? null} mode="urgency" />;
      },
    },
    {
      key: 'prepared_with',
      label: 'Prepared with',
      widthClass: 'w-[140px]',
      render: (e) => {
        const cell = e.cells[String(year)];
        if (!cell?.prepared_with?.length) return <span className="text-ink-faint">—</span>;
        return <span className="text-ink-soft">{cell.prepared_with.join(', ')}</span>;
      },
    },
    {
      key: 'comments',
      label: 'Comments',
      render: (e) => {
        const cell = e.cells[String(year)];
        const text = cell?.comments ?? '';
        if (!text) return <span className="text-ink-faint">—</span>;
        return <span className="text-ink-soft line-clamp-2 text-[11.5px]" title={text}>{text}</span>;
      },
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Withholding tax"
        subtitle="WHT director annual summary — 1 March N+1."
      />
      <WhtTabs />

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
          emptyMessage="No entities have an active WHT director annual obligation for this year."
        />
      )}
    </div>
  );
}
