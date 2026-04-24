'use client';

// /tax-ops/vat/annual — VAT annual returns (standard or simplified).

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData } from '@/components/tax-ops/useMatrixData';
import { VatTabs } from '@/components/tax-ops/VatTabs';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function VatAnnualPage() {
  const [year, setYear] = useState(2025);
  // Standard annual
  const standard = useMatrixData({ tax_type: 'vat_annual', year, period_pattern: 'annual' });
  // Simplified annual (some entities use this variant)
  const simplified = useMatrixData({ tax_type: 'vat_simplified_annual', year, period_pattern: 'annual' });

  // Unify both matrices into one list, keeping subtype metadata per entity.
  const combined: Array<MatrixEntity & { subtype: 'standard' | 'simplified' }> = [];
  if (standard.data) {
    for (const e of standard.data.entities) combined.push({ ...e, subtype: 'standard' });
  }
  if (simplified.data) {
    for (const e of simplified.data.entities) combined.push({ ...e, subtype: 'simplified' });
  }

  const columns: MatrixColumn[] = [
    {
      key: 'subtype',
      label: 'Subtype',
      widthClass: 'w-[100px]',
      render: (e) => {
        const subtype = (e as MatrixEntity & { subtype: string }).subtype;
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
    {
      key: String(year),
      label: `Status ${year}`,
      widthClass: 'w-[140px]',
    },
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

  const hasError = standard.error || simplified.error;
  const isLoading = (standard.isLoading || simplified.isLoading) && !standard.data && !simplified.data;

  return (
    <div className="space-y-3">
      <PageHeader
        title="VAT"
        subtitle="Luxembourg VAT — annual return (standard + simplified variants), plus quarterly and monthly returns. Switch tab to change cadence."
      />
      <VatTabs />

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
        <div className="text-[11.5px] text-ink-muted">
          {combined.length} filings ({(standard.data?.entities.length ?? 0)} standard, {(simplified.data?.entities.length ?? 0)} simplified)
        </div>
      </div>

      {hasError && <CrmErrorBox message={String(hasError)} onRetry={() => { standard.refetch(); simplified.refetch(); }} />}

      {isLoading && <PageSkeleton />}

      {(standard.data || simplified.data) && (
        <TaxTypeMatrix
          entities={combined}
          columns={columns}
          firstColLabel="Entity"
          emptyMessage="No entities have an active VAT annual obligation for this year."
        />
      )}
    </div>
  );
}
