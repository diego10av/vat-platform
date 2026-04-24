'use client';

// /tax-ops/cit — Corporate tax returns (Form 500) per entity.

import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData, applyStatusChange } from '@/components/tax-ops/useMatrixData';
import { FilingStatusBadge } from '@/components/tax-ops/FilingStatusBadge';
import {
  preparedWithColumn, commentsColumn, deadlineColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function CitPage() {
  const [year, setYear] = useState(2025);

  const current = useMatrixData({ tax_type: 'cit_annual', year, period_pattern: 'annual' });
  const prior = useMatrixData({ tax_type: 'cit_annual', year: year - 1, period_pattern: 'annual' });

  const priorCellByEntity = useMemo(() => {
    if (!prior.data) return new Map<string, ReturnType<typeof getCell>>();
    const m = new Map<string, ReturnType<typeof getCell>>();
    for (const e of prior.data.entities) {
      m.set(e.id, getCell(e, String(year - 1)));
    }
    return m;
  }, [prior.data, year]);

  const periodLabel = String(year);
  const tolerance = current.data?.admin_tolerance_days ?? 0;
  const columns: MatrixColumn[] = [
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    deadlineColumn(periodLabel, tolerance),
    preparedWithColumn([periodLabel], current.refetch),
    {
      key: `assessment_${year - 1}`,
      label: `Assessment ${year - 1}`,
      widthClass: 'w-[150px]',
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
    commentsColumn([periodLabel], current.refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Corporate tax returns"
        subtitle="Form 500 — annual corporate income tax (CIT) + municipal business tax. NWT reviews, if done, live on their own page. Click a status cell to update inline."
      />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={current.data?.entities.length ?? 0}
        countLabel={`entities · ${countFiled(current.data?.entities ?? [], periodLabel)} filed`}
        exportTaxType="cit_annual"
        exportPeriodPattern="annual"
      />

      {current.error && <CrmErrorBox message={current.error} onRetry={current.refetch} />}

      {current.isLoading && !current.data && <PageSkeleton />}

      {current.data && (
        <TaxTypeMatrix
          entities={current.data.entities}
          columns={columns}
          firstColLabel="Entity"
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch: current.refetch })
          }
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
