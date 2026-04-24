'use client';

// /tax-ops/cit — Corporate tax returns (Form 500) per entity.
//
// Mental model = Diego's CIT Excel book. Rows = entities grouped by
// fund family. Columns: Status for the selected year, prepared_with,
// prior-year assessment received (2024 for 2025 work), comments.
// NWT reviews live at /tax-ops/nwt — not here.

import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData } from '@/components/tax-ops/useMatrixData';
import { FilingStatusBadge } from '@/components/tax-ops/FilingStatusBadge';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function CitPage() {
  const [year, setYear] = useState(2025);

  // Current-year CIT matrix (period_label = String(year))
  const current = useMatrixData({ tax_type: 'cit_annual', year, period_pattern: 'annual' });
  // Prior-year CIT filings → used to surface "assessment received" column
  const prior = useMatrixData({ tax_type: 'cit_annual', year: year - 1, period_pattern: 'annual' });

  // Build a lookup of prior-year cells per entity_id for quick column render.
  const priorCellByEntity = useMemo(() => {
    if (!prior.data) return new Map<string, ReturnType<typeof getCell>>();
    const m = new Map<string, ReturnType<typeof getCell>>();
    for (const e of prior.data.entities) {
      m.set(e.id, getCell(e, String(year - 1)));
    }
    return m;
  }, [prior.data, year]);

  const columns: MatrixColumn[] = [
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
        const cell = getCell(e, String(year));
        return <DateBadge value={cell?.deadline_date ?? null} mode="urgency" />;
      },
    },
    {
      key: 'prepared_with',
      label: 'Prepared with',
      widthClass: 'w-[140px]',
      render: (e) => {
        const cell = getCell(e, String(year));
        if (!cell?.prepared_with?.length) return <span className="text-ink-faint">—</span>;
        return <span className="text-ink-soft">{cell.prepared_with.join(', ')}</span>;
      },
    },
    {
      key: `assessment_${year - 1}`,
      label: `Assessment ${year - 1}`,
      widthClass: 'w-[130px]',
      render: (e) => {
        const priorCell = priorCellByEntity.get(e.id);
        if (!priorCell) return <span className="text-ink-faint">—</span>;
        if (priorCell.tax_assessment_received_at) {
          return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">
              Received {priorCell.tax_assessment_received_at}
            </span>
          );
        }
        return <FilingStatusBadge status={priorCell.status} />;
      },
    },
    {
      key: 'comments',
      label: 'Comments',
      render: (e) => {
        const cell = getCell(e, String(year));
        const text = cell?.comments ?? '';
        if (!text) return <span className="text-ink-faint">—</span>;
        return (
          <span className="text-ink-soft line-clamp-2 text-[11.5px]" title={text}>
            {text}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Corporate tax returns"
        subtitle="Form 500 — annual corporate income tax (CIT) + municipal business tax. NWT reviews, if done, live on their own page."
      />

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
        {current.data && (
          <div className="text-[11.5px] text-ink-muted">
            {current.data.entities.length} entities · {countFiled(current.data.entities, String(year))} filed
          </div>
        )}
      </div>

      {current.error && <CrmErrorBox message={current.error} onRetry={current.refetch} />}

      {current.isLoading && !current.data && <PageSkeleton />}

      {current.data && (
        <TaxTypeMatrix
          entities={current.data.entities}
          columns={columns}
          firstColLabel="Entity"
          emptyMessage="No entities have an active CIT obligation."
        />
      )}
    </div>
  );
}

function getCell(e: MatrixEntity, period: string) {
  return e.cells[period] ?? null;
}

function countFiled(entities: MatrixEntity[], period: string): number {
  return entities.filter(e => {
    const c = getCell(e, period);
    return c && (c.status === 'filed' || c.status === 'assessment_received' || c.status === 'paid');
  }).length;
}
